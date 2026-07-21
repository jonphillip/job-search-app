import { useState, type CSSProperties } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import { createRoleFromDraft } from "../lib/roles";

const client = generateClient<Schema>();

interface FetchedJob {
  title: string;
  location: string;
  url: string;
  descriptionText: string;
}

interface ChecklistItem {
  job: FetchedJob;
  duplicate: boolean;
  checked: boolean;
}

// Existing roles reduced to what dedup needs.
type ExistingRole = { title: string; url?: string | null };

// Normalize a URL for comparison: lowercase, drop query params and any
// trailing slash. (Deliberately ignores scheme differences via lowercase only.)
function urlKey(url?: string | null): string {
  if (!url) return "";
  let s = url.trim().toLowerCase();
  const q = s.indexOf("?");
  if (q !== -1) s = s.slice(0, q);
  return s.replace(/\/+$/, "");
}

function titleKey(title?: string | null): string {
  return (title ?? "").trim().toLowerCase();
}

export default function JobBoardImport({
  companyId,
  roles,
  onClose,
}: {
  companyId: string;
  roles: ExistingRole[];
  onClose: () => void;
}) {
  const [url, setUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [items, setItems] = useState<ChecklistItem[] | null>(null);

  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [result, setResult] = useState<string | null>(null);

  const handleFetch = async () => {
    if (!url.trim() || fetching) return;
    setFetching(true);
    setMessage(null);
    setItems(null);
    setResult(null);
    try {
      const { data, errors } = await client.queries.fetchCompanyJobs({
        url: url.trim(),
      });
      if (errors && errors.length > 0) {
        throw new Error(errors[0].message);
      }
      const jobs: FetchedJob[] = (data?.jobs ?? [])
        .filter((j): j is NonNullable<typeof j> => j != null)
        .map((j) => ({
          title: j.title ?? "",
          location: j.location ?? "",
          url: j.url ?? "",
          descriptionText: j.descriptionText ?? "",
        }));

      if (jobs.length === 0) {
        setMessage(data?.message || "No open roles found.");
        return;
      }

      // Dedup against THIS company's existing roles.
      const existingUrls = new Set(
        roles.map((r) => urlKey(r.url)).filter((k) => k.length > 0),
      );
      const existingTitles = new Set(
        roles.map((r) => titleKey(r.title)).filter((k) => k.length > 0),
      );

      const checklist: ChecklistItem[] = jobs.map((job) => {
        const uKey = urlKey(job.url);
        const duplicate =
          (uKey.length > 0 && existingUrls.has(uKey)) ||
          existingTitles.has(titleKey(job.title));
        return { job, duplicate, checked: !duplicate };
      });
      setItems(checklist);
    } catch (err) {
      console.error(err);
      setMessage("Couldn't fetch this job board. Check the URL and try again.");
    } finally {
      setFetching(false);
    }
  };

  const toggle = (index: number) => {
    setItems((prev) =>
      prev
        ? prev.map((item, i) =>
            i === index && !item.duplicate
              ? { ...item, checked: !item.checked }
              : item,
          )
        : prev,
    );
  };

  const handleImport = async () => {
    if (!items || importing) return;
    const selected = items.filter((i) => i.checked && !i.duplicate);
    if (selected.length === 0) return;

    setImporting(true);
    setResult(null);
    let created = 0;
    let failed = 0;

    for (let i = 0; i < selected.length; i++) {
      setProgress({ done: i, total: selected.length });
      const { job } = selected[i];
      try {
        // Reuse the SAME parser + creation path as the manual flow: run the
        // description through parseJobPosting, then build the Role via the
        // shared createRoleFromDraft (URL/location normalization, salary
        // estimate handling, requirements cleanup all live there).
        const { data, errors } = await client.queries.parseJobPosting({
          text: job.descriptionText,
        });
        if (errors && errors.length > 0) {
          throw new Error(errors[0].message);
        }
        await createRoleFromDraft({
          companyId,
          // The board is authoritative for title/url/location; the parser
          // supplies salary/estimate/description/requirements.
          title: job.title || data?.roleTitle || "Untitled role",
          url: job.url || data?.url,
          location: job.location || data?.location,
          salaryMin: data?.salaryMin ?? undefined,
          salaryMax: data?.salaryMax ?? undefined,
          salaryIsEstimated: data?.salaryIsEstimated ?? false,
          compensationNote: data?.compensationNote,
          description: data?.description,
          requirements: data?.requirements ?? undefined,
        });
        created++;
      } catch (err) {
        console.error(err);
        failed++;
      }
    }

    setProgress(null);
    setImporting(false);
    const skipped = items.length - selected.length;
    setResult(
      `Created ${created} role${created === 1 ? "" : "s"} · skipped ${skipped}` +
        (failed > 0 ? ` · ${failed} failed` : ""),
    );
    setItems(null); // roles list refreshes via observeQuery
  };

  const summary = items
    ? {
        total: items.length,
        dup: items.filter((i) => i.duplicate).length,
        fresh: items.filter((i) => !i.duplicate).length,
      }
    : null;
  const selectedCount = items
    ? items.filter((i) => i.checked && !i.duplicate).length
    : 0;

  return (
    <div style={panelStyle}>
      <div style={titleRowStyle}>
        <span style={titleStyle}>IMPORT FROM JOB BOARD</span>
        <button type="button" className="signout-btn" onClick={onClose}>
          Close
        </button>
      </div>

      <div style={inputRowStyle}>
        <input
          className="field-input"
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleFetch();
          }}
          placeholder="Paste this company's Greenhouse, Ashby, or Lever careers URL"
          style={inputStyle}
          disabled={fetching}
        />
        <button
          type="button"
          className="btn-primary"
          onClick={handleFetch}
          disabled={fetching || !url.trim()}
        >
          {fetching ? "FETCHING…" : "FETCH"}
        </button>
      </div>

      {message && <div style={messageStyle}>{message}</div>}

      {items && summary && (
        <>
          <div style={summaryStyle}>
            {summary.total} open role{summary.total === 1 ? "" : "s"} ·{" "}
            {summary.dup} already in your list · {summary.fresh} new
          </div>

          <ul style={listStyle}>
            {items.map((item, i) => (
              <li key={`${item.job.url}-${i}`} style={itemStyle}>
                <label
                  style={{
                    ...itemLabelStyle,
                    ...(item.duplicate ? dupStyle : null),
                  }}
                >
                  <input
                    type="checkbox"
                    checked={item.checked}
                    disabled={item.duplicate || importing}
                    onChange={() => toggle(i)}
                    style={{ accentColor: "#C94E1A", marginTop: "3px" }}
                  />
                  <span style={{ display: "flex", flexDirection: "column" }}>
                    <span>
                      {item.job.title}
                      {item.duplicate && (
                        <span style={dupTagStyle}> — already added</span>
                      )}
                    </span>
                    {item.job.location && (
                      <span style={itemMetaStyle}>{item.job.location}</span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <div style={actionRowStyle}>
            <button
              type="button"
              className="btn-primary"
              onClick={handleImport}
              disabled={importing || selectedCount === 0}
            >
              {importing
                ? progress
                  ? `IMPORTING ${progress.done + 1} OF ${progress.total}…`
                  : "IMPORTING…"
                : `IMPORT SELECTED (${selectedCount})`}
            </button>
          </div>
        </>
      )}

      {result && <div style={resultStyle}>{result}</div>}
    </div>
  );
}

/* ---------- styles (theme as established) ---------- */

const panelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  border: "1px solid #333",
  background: "#141414",
  padding: "12px",
  maxWidth: "640px",
};

const titleRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
};

const titleStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontWeight: 700,
  fontSize: "14px",
  textTransform: "uppercase",
  letterSpacing: "1.5px",
  color: "#C94E1A",
};

const inputRowStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  alignItems: "stretch",
  flexWrap: "wrap",
};

const inputStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontSize: "14px",
  color: "#CCCCBB",
  background: "#0f0f0f",
  border: "1px solid #333",
  padding: "8px 10px",
  textTransform: "none",
  flex: "1 1 320px",
  minWidth: "0",
};

const messageStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontSize: "13px",
  color: "#C8951E",
};

const summaryStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontSize: "13px",
  fontWeight: 700,
  letterSpacing: "0.03em",
  color: "#CCCCBB",
};

const listStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
};

const itemStyle: CSSProperties = {
  borderBottom: "1px solid #222",
  padding: "6px 0",
};

const itemLabelStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
  alignItems: "flex-start",
  fontFamily: '"Courier Prime", monospace',
  fontSize: "14px",
  color: "#CCCCBB",
  cursor: "pointer",
};

const dupStyle: CSSProperties = {
  color: "#666660",
  cursor: "default",
};

const dupTagStyle: CSSProperties = {
  fontSize: "12px",
  color: "#666660",
  fontStyle: "italic",
};

const itemMetaStyle: CSSProperties = {
  fontSize: "12px",
  color: "#666660",
  marginTop: "2px",
};

const actionRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "14px",
  flexWrap: "wrap",
};

const resultStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontSize: "13px",
  color: "#7FA96B",
};
