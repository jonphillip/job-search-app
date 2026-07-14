import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";

const client = generateClient<Schema>();

type Application = Schema["Application"]["type"];
type Role = Schema["Role"]["type"];
type Company = Schema["Company"]["type"];

type AppStatus =
  | "DRAFT"
  | "APPLIED"
  | "SCREENING"
  | "INTERVIEW"
  | "OFFER"
  | "REJECTED"
  | "WITHDRAWN";

const ALL_STATUSES: AppStatus[] = [
  "DRAFT",
  "APPLIED",
  "SCREENING",
  "INTERVIEW",
  "OFFER",
  "REJECTED",
  "WITHDRAWN",
];

const BOARD_COLUMNS: AppStatus[] = [
  "APPLIED",
  "SCREENING",
  "INTERVIEW",
  "OFFER",
];

// Pipeline order used by the ADVANCE button; terminal states have no next.
const ADVANCE_ORDER: AppStatus[] = [
  "DRAFT",
  "APPLIED",
  "SCREENING",
  "INTERVIEW",
  "OFFER",
];

function nextStatus(status: AppStatus): AppStatus | null {
  const i = ADVANCE_ORDER.indexOf(status);
  if (i === -1 || i === ADVANCE_ORDER.length - 1) return null;
  return ADVANCE_ORDER[i + 1];
}

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysInStatus(lastStatusChange?: string | null): number {
  if (!lastStatusChange) return 0;
  const [y, m, d] = lastStatusChange.split("-").map(Number);
  const then = new Date(y, m - 1, d).getTime();
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

interface CardData {
  app: Application;
  roleTitle: string;
  companyName: string;
  company?: Company;
}

const ACTIVE_STATUSES: AppStatus[] = [
  "APPLIED",
  "SCREENING",
  "INTERVIEW",
  "OFFER",
];

export default function PipelineBoard() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);

  useEffect(() => {
    const subs = [
      client.models.Application.observeQuery().subscribe({
        next: ({ items }) => setApplications([...items]),
      }),
      client.models.Role.observeQuery().subscribe({
        next: ({ items }) => setRoles([...items]),
      }),
      client.models.Company.observeQuery().subscribe({
        next: ({ items }) => setCompanies([...items]),
      }),
    ];
    return () => subs.forEach((s) => s.unsubscribe());
  }, []);

  const cards = useMemo<CardData[]>(() => {
    const roleById = new Map(roles.map((r) => [r.id, r]));
    const companyById = new Map(companies.map((c) => [c.id, c]));
    return applications.map((app) => {
      const role = app.roleId ? roleById.get(app.roleId) : undefined;
      const company = role?.companyId
        ? companyById.get(role.companyId)
        : undefined;
      return {
        app,
        roleTitle: role?.title ?? "(unknown role)",
        companyName: company?.name ?? "(unknown company)",
        company,
      };
    });
  }, [applications, roles, companies]);

  const byStatus = useMemo(() => {
    const groups = new Map<AppStatus, CardData[]>();
    for (const status of ALL_STATUSES) groups.set(status, []);
    for (const card of cards) {
      const status = (card.app.status ?? "DRAFT") as AppStatus;
      (groups.get(status) ?? groups.get("DRAFT"))!.push(card);
    }
    for (const group of groups.values()) {
      group.sort((a, b) => a.companyName.localeCompare(b.companyName));
    }
    return groups;
  }, [cards]);

  const closedCards = [
    ...byStatus.get("REJECTED")!,
    ...byStatus.get("WITHDRAWN")!,
  ];

  return (
    <section style={panelStyle}>
      <h2 style={headingStyle}>Pipeline</h2>
      <CollapsedStrip label="DRAFT" cards={byStatus.get("DRAFT")!} />
      <div style={boardStyle}>
        {BOARD_COLUMNS.map((status) => {
          const columnCards = byStatus.get(status)!;
          return (
            <div key={status} style={columnStyle}>
              <div style={columnHeaderStyle}>
                {status}{" "}
                <span style={{ color: "#C94E1A" }}>{columnCards.length}</span>
              </div>
              {columnCards.length === 0 ? (
                <div style={emptyColumnStyle}>&mdash; none yet &mdash;</div>
              ) : (
                columnCards.map((card) => (
                  <ApplicationCard key={card.app.id} card={card} />
                ))
              )}
            </div>
          );
        })}
      </div>
      <CollapsedStrip label="REJECTED / WITHDRAWN" cards={closedCards} />
    </section>
  );
}

function CollapsedStrip({
  label,
  cards,
}: {
  label: string;
  cards: CardData[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div style={stripStyle}>
      <button
        type="button"
        className="strip-toggle-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span style={{ marginRight: "8px" }}>{open ? "▼" : "▶"}</span>
        {label} <span style={{ color: "#C94E1A" }}>({cards.length})</span>
      </button>
      {open && (
        <div style={stripCardsStyle}>
          {cards.length === 0 ? (
            <span style={{ color: "#666660", fontSize: "13px" }}>
              &mdash; none &mdash;
            </span>
          ) : (
            cards.map((card) => (
              <ApplicationCard key={card.app.id} card={card} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ApplicationCard({ card }: { card: CardData }) {
  const [updating, setUpdating] = useState(false);
  const status = (card.app.status ?? "DRAFT") as AppStatus;
  const next = nextStatus(status);
  const days = daysInStatus(card.app.lastStatusChange);

  const changeStatus = async (newStatus: AppStatus) => {
    if (newStatus === status) return;
    setUpdating(true);
    try {
      await client.models.Application.update({
        id: card.app.id,
        status: newStatus,
        lastStatusChange: localToday(),
      });
      // Auto-promotion: a DRAFT going active means we're actively pursuing
      // this company, so bump RESEARCHING/COLD companies to TARGETING.
      const { company } = card;
      if (
        status === "DRAFT" &&
        ACTIVE_STATUSES.includes(newStatus) &&
        company &&
        (company.status === "RESEARCHING" || company.status === "COLD")
      ) {
        await client.models.Company.update({
          id: company.id,
          status: "TARGETING",
        });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="pipeline-card" style={cardStyle}>
      <div style={cardCompanyStyle}>{card.companyName}</div>
      <div style={cardRoleStyle}>{card.roleTitle}</div>
      <div
        style={{
          ...cardDaysStyle,
          color: days > 7 ? "#C8951E" : "#666660",
        }}
      >
        <span style={{ fontFamily: '"VT323", monospace', fontSize: "15px" }}>
          {days}
        </span>{" "}
        {days === 1 ? "day" : "days"} in {status.toLowerCase()}
      </div>
      <div style={cardActionsStyle}>
        {next && (
          <button
            type="button"
            className="advance-btn"
            disabled={updating}
            onClick={() => changeStatus(next)}
          >
            ADVANCE &rarr;
          </button>
        )}
        <select
          className="field-input"
          value={status}
          disabled={updating}
          onChange={(e) => changeStatus(e.target.value as AppStatus)}
          style={statusSelectStyle}
        >
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

const panelStyle: CSSProperties = {
  margin: "24px 20px 0",
  background: "#141414",
  border: "1px solid #333",
};

const headingStyle: CSSProperties = {
  fontFamily: '"VT323", monospace',
  fontSize: "24px",
  color: "#CCCCBB",
  margin: 0,
  padding: "12px 16px",
  borderBottom: "1px solid #333",
};

const boardStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, 1fr)",
  gap: "12px",
  padding: "16px",
  alignItems: "start",
};

const columnStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  minWidth: 0,
};

const columnHeaderStyle: CSSProperties = {
  fontFamily: '"VT323", monospace',
  fontSize: "20px",
  color: "#CCCCBB",
  borderBottom: "1px solid #333",
  paddingBottom: "6px",
};

const emptyColumnStyle: CSSProperties = {
  border: "1px dashed #333",
  color: "#666660",
  fontFamily: '"Courier Prime", monospace',
  fontSize: "13px",
  textAlign: "center",
  padding: "20px 8px",
};

const cardStyle: CSSProperties = {
  background: "#161616",
  border: "1px solid #333",
  padding: "10px 12px",
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  minWidth: "180px",
};

const cardCompanyStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontWeight: 700,
  fontSize: "14px",
  color: "#CCCCBB",
};

const cardRoleStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontSize: "13px",
  color: "#CCCCBB",
};

const cardDaysStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontSize: "12px",
};

const cardActionsStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  marginTop: "6px",
};

const statusSelectStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontSize: "11px",
  color: "#CCCCBB",
  background: "#0f0f0f",
  border: "1px solid #333",
  padding: "3px 4px",
};

const stripStyle: CSSProperties = {
  borderBottom: "1px solid #222",
  padding: "8px 16px",
};

const stripCardsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
  padding: "10px 0 6px",
};
