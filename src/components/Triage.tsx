import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import { getMyProfile } from "../lib/profile";
import { createDraftApplication } from "../lib/applications";
import { useAppData } from "../lib/AppDataContext";

const client = generateClient<Schema>();

type Role = Schema["Role"]["type"];
type Attainability = "ENTRY_FREELANCE" | "MID" | "SENIOR_ONLY";
type SortOption = "FIT_DESC" | "FIT_ASC" | "RECENT" | "OLDEST";

const SORT_LABELS: Record<SortOption, string> = {
  FIT_DESC: "Fit score, high → low",
  FIT_ASC: "Fit score, low → high",
  RECENT: "Recently scored first",
  OLDEST: "Oldest scored first",
};

const ATTAINABILITY_COLORS: Record<string, string> = {
  ENTRY_FREELANCE: "#5BA85A",
  MID: "#C8951E",
  SENIOR_ONLY: "#883322",
};

const ATTAINABILITY_LABELS: Record<string, string> = {
  ENTRY_FREELANCE: "ENTRY/FREELANCE",
  MID: "MID",
  SENIOR_ONLY: "SENIOR ONLY",
};

function formatFitScore(score?: number | null): string {
  return score != null ? String(score) : "—";
}

export default function Triage() {
  const { roles, applications, companies, loading } = useAppData();

  const [scoring, setScoring] = useState(false);
  const [scoreProgress, setScoreProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [scoreMessage, setScoreMessage] = useState<string | null>(null);
  const stopRef = useRef(false);

  const [filterAttainability, setFilterAttainability] = useState<
    "ALL" | Attainability
  >("ALL");
  const [minFitScore, setMinFitScore] = useState(0);
  const [filterCompany, setFilterCompany] = useState<string>("ALL");
  const [sortOption, setSortOption] = useState<SortOption>("FIT_DESC");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // Primary workflow view — expanded by default so it's usable at a glance.
  const [collapsed, setCollapsed] = useState(false);

  // The batch scoring loop below reads `stopRef` each iteration; flip it on
  // unmount so an in-flight run stops writing once this component is gone.
  useEffect(() => {
    return () => {
      stopRef.current = true;
    };
  }, []);

  const companyNameById = useMemo(
    () => new Map(companies.map((c) => [c.id, c.name])),
    [companies],
  );

  const appliedRoleIds = useMemo(
    () =>
      new Set(
        applications
          .map((a) => a.roleId)
          .filter((id): id is string => !!id),
      ),
    [applications],
  );

  const candidates = useMemo(
    () =>
      roles.filter(
        (r) =>
          r.scoredAt && !r.triageDismissed && !appliedRoleIds.has(r.id),
      ),
    [roles, appliedRoleIds],
  );

  const companyOptions = useMemo(() => {
    const ids = new Set(candidates.map((r) => r.companyId).filter(Boolean));
    return [...ids]
      .map((id) => ({ id: id as string, name: companyNameById.get(id as string) ?? "—" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [candidates, companyNameById]);

  const worklist = useMemo(() => {
    const filtered = candidates
      .filter(
        (r) =>
          filterAttainability === "ALL" ||
          r.attainability === filterAttainability,
      )
      .filter((r) => (r.fitScore ?? 0) >= minFitScore)
      .filter((r) => filterCompany === "ALL" || r.companyId === filterCompany);

    // Sort is a single explicit axis (no hidden secondary sort) — surfacing
    // ENTRY_FREELANCE roles is handled purely via the Attainability filter
    // above, so switching sort options here always means what it says.
    return filtered.sort((a, b) => {
      switch (sortOption) {
        case "FIT_DESC":
          return (b.fitScore ?? 0) - (a.fitScore ?? 0);
        case "FIT_ASC":
          return (a.fitScore ?? 0) - (b.fitScore ?? 0);
        case "RECENT":
          return (b.scoredAt ?? "").localeCompare(a.scoredAt ?? "");
        case "OLDEST":
          return (a.scoredAt ?? "").localeCompare(b.scoredAt ?? "");
      }
    });
  }, [candidates, filterAttainability, minFitScore, filterCompany, sortOption]);

  const unscoredCount = roles.filter((r) => !r.scoredAt).length;

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleScoreAll = async () => {
    if (scoring) return;
    setScoreMessage(null);

    const profile = await getMyProfile();
    if (!profile?.resumeText?.trim()) {
      setScoreMessage(
        "Save your profile (resume text required) before scoring roles.",
      );
      return;
    }

    const unscored = roles.filter((r) => !r.scoredAt);
    if (unscored.length === 0) {
      setScoreMessage("All roles are already scored.");
      return;
    }

    stopRef.current = false;
    setScoring(true);
    let done = 0;
    let failed = 0;

    for (const role of unscored) {
      if (stopRef.current) break;
      setScoreProgress({ done, total: unscored.length });
      try {
        const { data, errors } = await client.queries.scoreRole({
          roleTitle: role.title,
          requirements: (role.requirements ?? []).filter(
            (r): r is string => !!r,
          ),
          description: role.description ?? undefined,
          resumeText: profile.resumeText,
          targetingStatement: profile.targetingStatement ?? undefined,
        });
        if (errors && errors.length > 0) {
          throw new Error(errors[0].message);
        }
        await client.models.Role.update({
          id: role.id,
          fitScore: data?.fitScore ?? null,
          attainability: (data?.attainability as Attainability | null) ?? null,
          scoreRationale: data?.rationale ?? null,
          scoreGaps: data?.gaps ?? null,
          scoredAt: new Date().toISOString(),
        });
      } catch (err) {
        // Leave scoredAt unset — this role is picked up again next run.
        console.error(err);
        failed++;
      }
      done++;
    }

    setScoreProgress(null);
    setScoring(false);
    if (stopRef.current) {
      setScoreMessage(`Stopped after scoring ${done} of ${unscored.length}.`);
    } else {
      setScoreMessage(
        `Scored ${done - failed} of ${unscored.length}` +
          (failed > 0 ? ` · ${failed} failed (will retry next run)` : ""),
      );
    }
  };

  const handleStop = () => {
    stopRef.current = true;
  };

  return (
    <section style={panelStyle}>
      <div style={headerRowStyle}>
        <button
          type="button"
          className="section-toggle-btn"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
        >
          <span style={{ color: "#666660", marginRight: "8px" }}>
            {collapsed ? "▶" : "▼"}
          </span>
          TRIAGE <span style={{ color: "#C94E1A" }}>({candidates.length})</span>
        </button>
        <div style={scoreActionStyle}>
          {scoring ? (
            <>
              <span style={progressStyle}>
                {scoreProgress
                  ? `Scoring ${scoreProgress.done + 1} of ${scoreProgress.total}…`
                  : "Scoring…"}
              </span>
              <button
                type="button"
                className="signout-btn"
                onClick={handleStop}
              >
                Stop
              </button>
            </>
          ) : (
            <button
              type="button"
              className="score-btn"
              disabled={loading}
              onClick={handleScoreAll}
            >
              SCORE UNSCORED ROLES{unscoredCount > 0 ? ` (${unscoredCount})` : ""}
            </button>
          )}
          {scoreMessage && <span style={scoreMessageStyle}>{scoreMessage}</span>}
        </div>
      </div>

      {collapsed ? null : loading ? (
        <p style={emptyStyle}>Loading roles…</p>
      ) : (
        <>
          <div style={filterRowStyle}>
            <label style={filterLabelStyle}>
              Sort
              <select
                className="field-input"
                value={sortOption}
                onChange={(e) => setSortOption(e.target.value as SortOption)}
                style={filterSelectStyle}
              >
                {(Object.keys(SORT_LABELS) as SortOption[]).map((opt) => (
                  <option key={opt} value={opt}>
                    {SORT_LABELS[opt]}
                  </option>
                ))}
              </select>
            </label>
            <label style={filterLabelStyle}>
              Attainability
              <select
                className="field-input"
                value={filterAttainability}
                onChange={(e) =>
                  setFilterAttainability(
                    e.target.value as "ALL" | Attainability,
                  )
                }
                style={filterSelectStyle}
              >
                <option value="ALL">ALL</option>
                <option value="ENTRY_FREELANCE">ENTRY/FREELANCE</option>
                <option value="MID">MID</option>
                <option value="SENIOR_ONLY">SENIOR ONLY</option>
              </select>
            </label>
            <label style={filterLabelStyle}>
              Min Fit Score
              <input
                className="field-input"
                type="number"
                min={0}
                max={100}
                value={minFitScore}
                onChange={(e) => setMinFitScore(Number(e.target.value) || 0)}
                style={{ ...filterSelectStyle, width: "70px" }}
              />
            </label>
            <label style={filterLabelStyle}>
              Company
              <select
                className="field-input"
                value={filterCompany}
                onChange={(e) => setFilterCompany(e.target.value)}
                style={filterSelectStyle}
              >
                <option value="ALL">ALL</option>
                {companyOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {worklist.length === 0 ? (
            <p style={emptyStyle}>
              {candidates.length === 0
                ? "No scored roles waiting on triage yet."
                : "No roles match the current filters."}
            </p>
          ) : (
            <ul style={listStyle}>
              {worklist.map((role) => (
                <TriageRow
                  key={role.id}
                  role={role}
                  companyName={
                    companyNameById.get(role.companyId ?? "") ?? "—"
                  }
                  expanded={expandedIds.has(role.id)}
                  onToggleExpanded={() => toggleExpanded(role.id)}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function TriageRow({
  role,
  companyName,
  expanded,
  onToggleExpanded,
}: {
  role: Role;
  companyName: string;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [busy, setBusy] = useState(false);

  const addApplication = async () => {
    setAdding(true);
    try {
      await createDraftApplication(role.id);
      setAdded(true);
    } catch (err) {
      console.error(err);
    } finally {
      setAdding(false);
    }
  };

  const dismiss = async () => {
    setBusy(true);
    try {
      await client.models.Role.update({
        id: role.id,
        triageDismissed: true,
      });
    } catch (err) {
      console.error(err);
      setBusy(false);
    }
  };

  const clearScore = async () => {
    setBusy(true);
    try {
      await client.models.Role.update({
        id: role.id,
        fitScore: null,
        attainability: null,
        scoreRationale: null,
        scoreGaps: null,
        scoredAt: null,
      });
    } catch (err) {
      console.error(err);
      setBusy(false);
    }
  };

  const color = ATTAINABILITY_COLORS[role.attainability ?? ""] ?? "#666660";
  const label = ATTAINABILITY_LABELS[role.attainability ?? ""] ?? "UNKNOWN";

  return (
    <li style={rowBlockStyle}>
      <div className="tracker-row" style={rowStyle}>
        <span style={fitScoreStyle}>{formatFitScore(role.fitScore)}</span>
        <span style={tagStyle(color)}>{label}</span>
        <span style={companyNameStyle}>{companyName}</span>
        <span style={{ color: "#CCCCBB" }}>{role.title}</span>
        <span style={{ ...rowControlsStyle, marginLeft: "auto" }}>
          <button
            type="button"
            className="advance-btn"
            disabled={adding || added}
            onClick={addApplication}
          >
            {added ? "ADDED ✓" : adding ? "ADDING…" : "ADD APPLICATION"}
          </button>
          <button
            type="button"
            className="edit-btn"
            disabled={busy}
            onClick={onToggleExpanded}
          >
            {expanded ? "HIDE GAPS" : "GAPS"}
          </button>
          <button
            type="button"
            className="edit-btn"
            disabled={busy}
            onClick={clearScore}
            title="Clear this score — the role goes back into the unscored queue"
          >
            RESCORE
          </button>
          <button
            type="button"
            className="edit-btn"
            disabled={busy}
            onClick={dismiss}
            title="Not interested — removes this role from triage only"
          >
            NOT INTERESTED
          </button>
        </span>
      </div>
      {role.scoreRationale && (
        <div style={rationaleStyle}>{role.scoreRationale}</div>
      )}
      {expanded && (
        <div style={gapsStyle}>
          {role.scoreGaps || "No notable gaps noted."}
        </div>
      )}
    </li>
  );
}

/* ---------- styles ---------- */

const panelStyle: CSSProperties = {
  margin: "24px 20px 0",
  background: "#141414",
  border: "1px solid #333",
};

const headerRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexWrap: "wrap",
  gap: "10px",
  borderBottom: "1px solid #333",
  padding: "12px 16px",
};

const scoreActionStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  flexWrap: "wrap",
};

const progressStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontSize: "13px",
  color: "#C8951E",
};

const scoreMessageStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontSize: "13px",
  color: "#666660",
};

const filterRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  gap: "16px",
  flexWrap: "wrap",
  padding: "12px 16px",
  borderBottom: "1px solid #222",
};

const filterLabelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  fontFamily: '"Courier Prime", monospace',
  fontSize: "11px",
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  color: "#666660",
};

const filterSelectStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontSize: "13px",
  color: "#CCCCBB",
  background: "#0f0f0f",
  border: "1px solid #333",
  padding: "6px 8px",
};

const emptyStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  color: "#666660",
  padding: "16px",
  margin: 0,
  fontSize: "14px",
};

const listStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
};

const rowBlockStyle: CSSProperties = {
  display: "block",
  padding: "10px 16px",
  borderBottom: "1px solid #222",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "16px",
  fontFamily: '"Courier Prime", monospace',
  fontSize: "14px",
  flexWrap: "wrap",
};

const fitScoreStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontWeight: 700,
  fontSize: "17px",
  letterSpacing: "1.5px",
  color: "#C94E1A",
  minWidth: "28px",
};

function tagStyle(color: string): CSSProperties {
  return {
    fontFamily: '"Courier Prime", monospace',
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "0.05em",
    color,
    border: `1px solid ${color}`,
    padding: "2px 6px",
  };
}

const companyNameStyle: CSSProperties = {
  color: "#666660",
  fontSize: "13px",
};

const rowControlsStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
};

const rationaleStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontSize: "13px",
  color: "#666660",
  marginTop: "4px",
};

const gapsStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontSize: "13px",
  color: "#888880",
  marginTop: "4px",
  fontStyle: "italic",
};
