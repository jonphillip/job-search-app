import { useEffect, useState, useMemo, type CSSProperties } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import { useAppData } from "../lib/AppDataContext";

const client = generateClient<Schema>();

type Contact = Schema["Contact"]["type"];

// APPLIED or later, excluding the terminal REJECTED / WITHDRAWN states.
const ACTIVE_STATUSES = ["APPLIED", "SCREENING", "INTERVIEW", "OFFER"];

function parseDate(d?: string | null): number | null {
  if (!d) return null;
  const [y, m, day] = d.split("-").map(Number);
  if (!y || !m || !day) return null;
  return new Date(y, m - 1, day).getTime();
}

export default function StatsBar() {
  const { applications } = useAppData();
  const [contacts, setContacts] = useState<Contact[]>([]);

  useEffect(() => {
    const sub = client.models.Contact.observeQuery().subscribe({
      next: ({ items }) => setContacts([...items]),
    });
    return () => sub.unsubscribe();
  }, []);

  const stats = useMemo(() => {
    const applied = applications.filter((a) =>
      ACTIVE_STATUSES.includes(a.status ?? "DRAFT"),
    ).length;
    const screening = applications.filter(
      (a) => a.status === "SCREENING",
    ).length;

    let earliest: number | null = null;
    for (const a of applications) {
      const t = parseDate(a.appliedDate);
      if (t !== null && (earliest === null || t < earliest)) earliest = t;
    }
    const daysActive =
      earliest === null
        ? 0
        : Math.max(0, Math.floor((Date.now() - earliest) / 86_400_000));

    return { applied, screening, contacts: contacts.length, daysActive };
  }, [applications, contacts]);

  const items = [
    { value: stats.applied, label: "Applied" },
    { value: stats.screening, label: "Screening" },
    { value: stats.contacts, label: "Contacts" },
    { value: stats.daysActive, label: "Days Active" },
  ];

  return (
    <div style={barStyle}>
      {items.map((it, i) => (
        <div
          key={it.label}
          style={{
            ...statStyle,
            borderLeft: i > 0 ? "1px solid #333" : "none",
          }}
        >
          <span style={numberStyle}>{it.value}</span>
          <span style={labelStyle}>{it.label}</span>
        </div>
      ))}
    </div>
  );
}

const barStyle: CSSProperties = {
  display: "flex",
  width: "100%",
  background: "#141414",
  borderBottom: "1px solid #333",
};

const statStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: "10px 8px",
  minWidth: 0,
};

const numberStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontWeight: 700,
  fontSize: "24px",
  lineHeight: 1,
  letterSpacing: "1.5px",
  color: "#C94E1A",
};

const labelStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontSize: "10px",
  letterSpacing: "1.5px",
  textTransform: "uppercase",
  color: "#666660",
  marginTop: "5px",
};
