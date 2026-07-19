import { useEffect, useRef, useState, type CSSProperties } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";

const client = generateClient<Schema>();

type Application = Schema["Application"]["type"];
type Interaction = Schema["Interaction"]["type"];
type Role = Schema["Role"]["type"];
type Company = Schema["Company"]["type"];
type Contact = Schema["Contact"]["type"];

const MAX_ENTRIES = 15;

interface Entry {
  id: number;
  text: string;
  ts: number;
}

let entrySeq = 0;
const nextId = () => ++entrySeq;

function parseDate(d?: string | null): number | null {
  if (!d) return null;
  const [y, m, day] = d.split("-").map(Number);
  if (!y || !m || !day) return null;
  return new Date(y, m - 1, day).getTime();
}

function timeAgo(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/**
 * Client-side, in-memory feed of the last few Application / Interaction
 * mutations. On first load we seed it from the stored dates of existing
 * records; after that we diff each observeQuery snapshot to catch new
 * applications, status changes, and logged interactions as they happen.
 */
export default function ActivityTicker() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [now, setNow] = useState(() => Date.now());

  // Latest lookup data, kept in refs so the diff logic can resolve names
  // regardless of which subscription fired last.
  const rolesRef = useRef(new Map<string, Role>());
  const companiesRef = useRef(new Map<string, Company>());
  const contactsRef = useRef(new Map<string, Contact>());
  const appsRef = useRef<Application[]>([]);
  const interactionsRef = useRef<Interaction[]>([]);

  // Baselines for change detection.
  const prevAppStatus = useRef(new Map<string, string>());
  const prevInteractionIds = useRef(new Set<string>());

  const loaded = useRef({
    roles: false,
    companies: false,
    contacts: false,
    apps: false,
    interactions: false,
  });
  const seeded = useRef(false);

  useEffect(() => {
    const companyNameFor = (app: Application): string => {
      const role = app.roleId ? rolesRef.current.get(app.roleId) : undefined;
      const company = role?.companyId
        ? companiesRef.current.get(role.companyId)
        : undefined;
      return company?.name ?? "a company";
    };
    const contactNameFor = (it: Interaction): string => {
      const contact = it.contactId
        ? contactsRef.current.get(it.contactId)
        : undefined;
      return contact?.name ?? "a contact";
    };

    const push = (text: string, ts: number) => {
      setEntries((prev) =>
        [{ id: nextId(), text, ts }, ...prev].slice(0, MAX_ENTRIES),
      );
    };

    const process = () => {
      const l = loaded.current;
      if (!l.roles || !l.companies || !l.contacts || !l.apps || !l.interactions)
        return;

      if (!seeded.current) {
        const seed: Entry[] = [];
        for (const app of appsRef.current) {
          const name = companyNameFor(app);
          const at = parseDate(app.appliedDate);
          if (at !== null)
            seed.push({ id: nextId(), text: `Applied to ${name}`, ts: at });
          const status = app.status ?? "DRAFT";
          const lc = parseDate(app.lastStatusChange);
          if (status !== "DRAFT" && status !== "APPLIED" && lc !== null)
            seed.push({
              id: nextId(),
              text: `Status changed: ${name} → ${status}`,
              ts: lc,
            });
          prevAppStatus.current.set(app.id, status);
        }
        for (const it of interactionsRef.current) {
          const t = parseDate(it.date);
          if (t !== null)
            seed.push({
              id: nextId(),
              text: `Logged ${it.type} with ${contactNameFor(it)}`,
              ts: t,
            });
          prevInteractionIds.current.add(it.id);
        }
        seed.sort((a, b) => b.ts - a.ts);
        setEntries(seed.slice(0, MAX_ENTRIES));
        seeded.current = true;
        return;
      }

      // Live diff against the previous snapshot.
      const ts = Date.now();
      const seenApps = new Set<string>();
      for (const app of appsRef.current) {
        seenApps.add(app.id);
        const status = app.status ?? "DRAFT";
        const prev = prevAppStatus.current.get(app.id);
        if (prev === undefined) {
          push(`Applied to ${companyNameFor(app)}`, ts);
        } else if (prev !== status) {
          push(`Status changed: ${companyNameFor(app)} → ${status}`, ts);
        }
        prevAppStatus.current.set(app.id, status);
      }
      for (const id of prevAppStatus.current.keys())
        if (!seenApps.has(id)) prevAppStatus.current.delete(id);

      for (const it of interactionsRef.current) {
        if (!prevInteractionIds.current.has(it.id)) {
          push(`Logged ${it.type} with ${contactNameFor(it)}`, ts);
          prevInteractionIds.current.add(it.id);
        }
      }
    };

    const subs = [
      client.models.Role.observeQuery().subscribe({
        next: ({ items }) => {
          rolesRef.current = new Map(items.map((r) => [r.id, r]));
          loaded.current.roles = true;
          process();
        },
      }),
      client.models.Company.observeQuery().subscribe({
        next: ({ items }) => {
          companiesRef.current = new Map(items.map((c) => [c.id, c]));
          loaded.current.companies = true;
          process();
        },
      }),
      client.models.Contact.observeQuery().subscribe({
        next: ({ items }) => {
          contactsRef.current = new Map(items.map((c) => [c.id, c]));
          loaded.current.contacts = true;
          process();
        },
      }),
      client.models.Application.observeQuery().subscribe({
        next: ({ items }) => {
          appsRef.current = [...items];
          loaded.current.apps = true;
          process();
        },
      }),
      client.models.Interaction.observeQuery().subscribe({
        next: ({ items }) => {
          interactionsRef.current = [...items];
          loaded.current.interactions = true;
          process();
        },
      }),
    ];
    return () => subs.forEach((s) => s.unsubscribe());
  }, []);

  // Refresh relative timestamps periodically.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (entries.length === 0) {
    return (
      <div style={containerStyle}>
        <span style={emptyStyle}>&mdash; no recent activity &mdash;</span>
      </div>
    );
  }

  const unit =
    entries.map((e) => `${e.text} — ${timeAgo(e.ts, now)}`).join("  ·  ") +
    "  ·  ";
  // Slower for longer feeds so scroll speed stays roughly constant.
  const duration = `${Math.max(24, entries.length * 4)}s`;

  return (
    <div style={containerStyle} className="ticker-viewport">
      <div className="ticker-track" style={{ animationDuration: duration }}>
        <span className="ticker-unit">{unit}</span>
        <span className="ticker-unit" aria-hidden="true">
          {unit}
        </span>
      </div>
    </div>
  );
}

const containerStyle: CSSProperties = {
  position: "fixed",
  left: 0,
  right: 0,
  bottom: 0,
  height: "28px",
  display: "flex",
  alignItems: "center",
  overflow: "hidden",
  background: "#000000",
  borderTop: "1px solid #333",
  zIndex: 50,
};

const emptyStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontSize: "11px",
  letterSpacing: "0.05em",
  color: "#555550",
  padding: "0 16px",
};
