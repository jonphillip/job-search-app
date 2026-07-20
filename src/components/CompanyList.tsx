import {
  useEffect,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";

const client = generateClient<Schema>();

type Company = Schema["Company"]["type"];
type Role = Schema["Role"]["type"];
type Contact = Schema["Contact"]["type"];
type Interaction = Schema["Interaction"]["type"];
type Application = Schema["Application"]["type"];

type InteractionType = "EMAIL" | "CALL" | "COFFEE" | "DM" | "EVENT";

const INTERACTION_TYPES: InteractionType[] = [
  "EMAIL",
  "CALL",
  "COFFEE",
  "DM",
  "EVENT",
];

const STATUS_COLORS: Record<string, string> = {
  TARGETING: "#5BA85A",
  RESEARCHING: "#C8951E",
  COLD: "#883322",
};

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysSince(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const then = new Date(y, m - 1, d).getTime();
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

function formatSalary(min?: number | null, max?: number | null): string {
  const fmt = (n: number) => `$${n.toLocaleString()}`;
  if (min != null && max != null) return `${fmt(min)}–${fmt(max)}`;
  if (min != null) return `${fmt(min)}+`;
  if (max != null) return `up to ${fmt(max)}`;
  return "";
}

export function normalizeUrl(value: string): string {
  const v = value.trim();
  if (!v) return v;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`;
}

// Full US state (and DC) names → USPS two-letter abbreviations.
const US_STATES: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  "district of columbia": "DC",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
};

const US_STATE_ABBRS = new Set(Object.values(US_STATES));

// Normalize freeform location text toward "City, ST". Split on the first comma,
// trim both parts, and map a full state name (or existing abbreviation) to its
// two-letter code. If the state segment isn't a recognized US state (e.g.
// "Remote", a country), it's left exactly as written rather than guessed at.
export function normalizeLocation(value: string): string {
  const v = value.trim();
  if (!v) return v;
  const comma = v.indexOf(",");
  if (comma === -1) return v;
  const city = v.slice(0, comma).trim();
  const state = v.slice(comma + 1).trim();
  const fromFullName = US_STATES[state.toLowerCase()];
  if (fromFullName) return `${city}, ${fromFullName}`;
  if (US_STATE_ABBRS.has(state.toUpperCase())) {
    return `${city}, ${state.toUpperCase()}`;
  }
  return `${city}, ${state}`;
}

/* ---------- cascade deletes (schema has no cascade; deepest first) ---------- */

async function listAll<T>(
  page: (
    nextToken?: string | null,
  ) => Promise<{ data: T[]; nextToken?: string | null }>,
): Promise<T[]> {
  const items: T[] = [];
  let nextToken: string | null | undefined;
  do {
    const res = await page(nextToken);
    items.push(...res.data);
    nextToken = res.nextToken;
  } while (nextToken);
  return items;
}

// One-time backfill: normalize location on every existing role. Guarded by a
// localStorage flag (and a module-level flag) so it runs at most once per
// browser; it's also idempotent, since re-normalizing an already-"City, ST"
// value yields the same string and skips the update.
const LOCATION_MIGRATION_KEY = "roleLocationNormalized_v1";
let locationMigrationStarted = false;

async function migrateRoleLocations() {
  if (locationMigrationStarted) return;
  locationMigrationStarted = true;
  if (localStorage.getItem(LOCATION_MIGRATION_KEY)) return;
  try {
    const roles = await listAll<Role>((nextToken) =>
      client.models.Role.list({ nextToken }),
    );
    await Promise.all(
      roles
        .filter((role) => role.location)
        .map((role) => {
          const normalized = normalizeLocation(role.location as string);
          return normalized === role.location
            ? null
            : client.models.Role.update({ id: role.id, location: normalized });
        })
        .filter((p): p is NonNullable<typeof p> => p !== null),
    );
    localStorage.setItem(LOCATION_MIGRATION_KEY, "1");
  } catch (err) {
    console.error("Role location migration failed", err);
    locationMigrationStarted = false; // allow a retry on next mount
  }
}

async function deleteRoleCascade(roleId: string) {
  const apps = await listAll<Application>((nextToken) =>
    client.models.Application.list({
      filter: { roleId: { eq: roleId } },
      nextToken,
    }),
  );
  await Promise.all(
    apps.map((a) => client.models.Application.delete({ id: a.id })),
  );
  await client.models.Role.delete({ id: roleId });
}

async function deleteContactCascade(contactId: string) {
  const interactions = await listAll<Interaction>((nextToken) =>
    client.models.Interaction.list({
      filter: { contactId: { eq: contactId } },
      nextToken,
    }),
  );
  await Promise.all(
    interactions.map((i) => client.models.Interaction.delete({ id: i.id })),
  );
  await client.models.Contact.delete({ id: contactId });
}

async function deleteCompanyCascade(companyId: string) {
  const roles = await listAll<Role>((nextToken) =>
    client.models.Role.list({
      filter: { companyId: { eq: companyId } },
      nextToken,
    }),
  );
  for (const role of roles) {
    await deleteRoleCascade(role.id);
  }
  const contacts = await listAll<Contact>((nextToken) =>
    client.models.Contact.list({
      filter: { companyId: { eq: companyId } },
      nextToken,
    }),
  );
  for (const contact of contacts) {
    await deleteContactCascade(contact.id);
  }
  await client.models.Company.delete({ id: companyId });
}

/* ---------- shared small components ---------- */

function DeleteControl({ onDelete }: { onDelete: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      await onDelete();
      // On success the record vanishes from observeQuery and this unmounts.
    } catch (err) {
      console.error(err);
      setBusy(false);
      setConfirming(false);
    }
  };

  if (confirming) {
    return (
      <span style={confirmWrapStyle}>
        <span style={{ color: "#883322" }}>
          {busy ? "DELETING…" : "DELETE?"}
        </span>
        {!busy && (
          <>
            <button type="button" className="confirm-yes-btn" onClick={run}>
              Y
            </button>
            <button
              type="button"
              className="confirm-no-btn"
              onClick={() => setConfirming(false)}
            >
              N
            </button>
          </>
        )}
      </span>
    );
  }

  return (
    <button
      type="button"
      className="delete-x-btn"
      title="Delete"
      onClick={() => setConfirming(true)}
    >
      ✕
    </button>
  );
}

function NotesLine({
  notes,
  style,
}: {
  notes?: string | null;
  style?: CSSProperties;
}) {
  const [full, setFull] = useState(false);
  if (!notes) return null;
  const long = notes.length > 100;
  return (
    <div style={{ ...notesLineStyle, ...style }}>
      {long && !full ? notes.slice(0, 100) : notes}
      {long && (
        <button
          type="button"
          className="notes-more-btn"
          onClick={() => setFull((v) => !v)}
        >
          {full ? " less" : "…more"}
        </button>
      )}
    </div>
  );
}

/* ---------- company list ---------- */

export default function CompanyList() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    void migrateRoleLocations();
    const sub = client.models.Company.observeQuery().subscribe({
      next: ({ items }) => {
        setCompanies(
          [...items].sort((a, b) => a.name.localeCompare(b.name)),
        );
      },
    });
    return () => sub.unsubscribe();
  }, []);

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <section style={panelStyle}>
      <h2 style={headingStyle}>Companies</h2>
      {companies.length === 0 ? (
        <p style={emptyStyle}>No companies yet. Add one above.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={headerCellStyle}>Name</th>
              <th style={headerCellStyle}>Status</th>
              <th style={headerCellStyle}>Website</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((company) => (
              <CompanyRow
                key={company.id}
                company={company}
                expanded={expandedIds.has(company.id)}
                onToggle={() => toggleExpanded(company.id)}
              />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function CompanyRow({
  company,
  expanded,
  onToggle,
}: {
  company: Company;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <tr>
        <td colSpan={3} style={editRowCellStyle}>
          <CompanyEditForm
            company={company}
            onDone={() => setEditing(false)}
          />
        </td>
      </tr>
    );
  }

  return (
    <>
      <tr className="tracker-row">
        <td style={cellStyle}>
          <button
            type="button"
            className="company-name-btn"
            onClick={onToggle}
            aria-expanded={expanded}
          >
            <span style={{ color: "#666660", marginRight: "8px" }}>
              {expanded ? "▼" : "▶"}
            </span>
            {company.name}
          </button>
          <NotesLine notes={company.notes} style={{ marginLeft: "22px" }} />
        </td>
        <td style={cellStyle}>
          <StatusEditor company={company} />
        </td>
        <td style={cellStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {company.website ? (
              <a
                href={normalizeUrl(company.website)}
                target="_blank"
                rel="noreferrer"
                style={{ color: "#C94E1A" }}
              >
                {company.website}
              </a>
            ) : (
              <span style={{ color: "#666660" }}>&mdash;</span>
            )}
            <span style={rowControlsStyle}>
              <button
                type="button"
                className="edit-btn"
                onClick={() => setEditing(true)}
              >
                EDIT
              </button>
              <DeleteControl
                onDelete={() => deleteCompanyCascade(company.id)}
              />
            </span>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={3} style={{ padding: 0, borderBottom: "1px solid #222" }}>
            <RoleSection companyId={company.id} />
            <ContactSection companyId={company.id} />
          </td>
        </tr>
      )}
    </>
  );
}

function CompanyEditForm({
  company,
  onDone,
}: {
  company: Company;
  onDone: () => void;
}) {
  const [name, setName] = useState(company.name);
  const [website, setWebsite] = useState(company.website ?? "");
  const [notes, setNotes] = useState(company.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await client.models.Company.update({
        id: company.id,
        name: name.trim(),
        website: website.trim() ? normalizeUrl(website) : null,
        notes: notes.trim() || null,
      });
      onDone();
    } catch (err) {
      console.error(err);
      setError("Failed to save. Please try again.");
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={roleFormStyle}>
      <span style={roleFormTitleStyle}>EDIT COMPANY</span>
      <div style={roleFormGridStyle}>
        <label style={labelStyle}>
          Name *
          <input
            className="field-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          Website
          <input
            className="field-input"
            type="text"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>
          Notes
          <textarea
            className="field-input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </label>
      </div>
      {error && <span style={errorStyle}>{error}</span>}
      <div style={{ display: "flex", gap: "8px" }}>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" className="signout-btn" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

type CompanyStatus = "RESEARCHING" | "TARGETING" | "COLD";

function StatusEditor({ company }: { company: Company }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async (status: CompanyStatus) => {
    setSaving(true);
    try {
      await client.models.Company.update({ id: company.id, status });
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <select
        className="field-input"
        autoFocus
        value={company.status ?? "RESEARCHING"}
        disabled={saving}
        onChange={(e) => save(e.target.value as CompanyStatus)}
        onBlur={() => setEditing(false)}
        style={statusSelectStyle}
      >
        <option value="RESEARCHING">RESEARCHING</option>
        <option value="TARGETING">TARGETING</option>
        <option value="COLD">COLD</option>
      </select>
    );
  }

  return (
    <button
      type="button"
      className="status-edit-btn"
      onClick={() => setEditing(true)}
      title="Change status"
    >
      <span
        style={{
          display: "inline-block",
          width: "10px",
          height: "10px",
          borderRadius: "50%",
          background: STATUS_COLORS[company.status ?? ""] ?? "#666660",
          marginRight: "8px",
        }}
      />
      {company.status ?? "—"}
    </button>
  );
}

/* ---------- roles ---------- */

function RoleSection({ companyId }: { companyId: string }) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [addingManually, setAddingManually] = useState(false);

  useEffect(() => {
    const sub = client.models.Role.observeQuery({
      filter: { companyId: { eq: companyId } },
    }).subscribe({
      next: ({ items }) => {
        setRoles([...items].sort((a, b) => a.title.localeCompare(b.title)));
      },
    });
    return () => sub.unsubscribe();
  }, [companyId]);

  return (
    <div style={nestedStyle}>
      <h3 style={nestedHeadingStyle}>Roles</h3>
      {roles.length === 0 ? (
        <p style={{ ...emptyStyle, padding: "0 0 12px" }}>No roles yet.</p>
      ) : (
        <ul style={roleListStyle}>
          {roles.map((role) => (
            <RoleItem key={role.id} role={role} />
          ))}
        </ul>
      )}
      {addingManually ? (
        <RoleForm
          companyId={companyId}
          onAdded={() => setAddingManually(false)}
          onCancel={() => setAddingManually(false)}
        />
      ) : (
        <button
          type="button"
          style={addRoleLinkStyle}
          onClick={() => setAddingManually(true)}
        >
          + add role manually
        </button>
      )}
    </div>
  );
}

function RoleItem({ role }: { role: Role }) {
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(false);
  const [editing, setEditing] = useState(false);

  const addApplication = async () => {
    setCreating(true);
    try {
      const today = localToday();
      await client.models.Application.create({
        status: "DRAFT",
        appliedDate: today,
        lastStatusChange: today,
        roleId: role.id,
      });
      setCreated(true);
      setTimeout(() => setCreated(false), 2000);
    } catch (err) {
      console.error(err);
    } finally {
      setCreating(false);
    }
  };

  if (editing) {
    return (
      <li style={roleBlockStyle}>
        <RoleEditForm role={role} onDone={() => setEditing(false)} />
      </li>
    );
  }

  return (
    <li style={roleBlockStyle}>
      <div className="tracker-row" style={roleRowStyle}>
        <span style={{ color: "#CCCCBB" }}>{role.title}</span>
        {role.location && (
          <span style={roleMetaStyle}>{normalizeLocation(role.location)}</span>
        )}
        {formatSalary(role.salaryMin, role.salaryMax) && (
          <span style={salaryStyle}>
            {formatSalary(role.salaryMin, role.salaryMax)}
          </span>
        )}
        {role.url && (
          <a
            href={normalizeUrl(role.url)}
            target="_blank"
            rel="noreferrer"
            style={{ color: "#C94E1A", fontSize: "13px" }}
          >
            posting
          </a>
        )}
        <span style={{ ...rowControlsStyle, marginLeft: "auto" }}>
          <button
            type="button"
            className="advance-btn"
            disabled={creating}
            onClick={addApplication}
          >
            {created ? "ADDED ✓" : creating ? "ADDING…" : "ADD APPLICATION"}
          </button>
          <button
            type="button"
            className="edit-btn"
            onClick={() => setEditing(true)}
          >
            EDIT
          </button>
          <DeleteControl onDelete={() => deleteRoleCascade(role.id)} />
        </span>
      </div>
      {role.description && (
        <div style={roleDescriptionStyle}>{role.description}</div>
      )}
      {role.requirements && role.requirements.length > 0 && (
        <ul style={requirementListStyle}>
          {role.requirements
            .filter((r): r is string => !!r)
            .map((req, i) => (
              <li key={i} style={requirementItemStyle}>
                <span style={requirementBulletStyle}>–</span>
                <span>{req}</span>
              </li>
            ))}
        </ul>
      )}
      <NotesLine notes={role.notes} />
    </li>
  );
}

function RoleEditForm({ role, onDone }: { role: Role; onDone: () => void }) {
  const [title, setTitle] = useState(role.title);
  const [url, setUrl] = useState(role.url ?? "");
  const [salaryMin, setSalaryMin] = useState(
    role.salaryMin != null ? String(role.salaryMin) : "",
  );
  const [salaryMax, setSalaryMax] = useState(
    role.salaryMax != null ? String(role.salaryMax) : "",
  );
  const [location, setLocation] = useState(role.location ?? "");
  const [notes, setNotes] = useState(role.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await client.models.Role.update({
        id: role.id,
        title: title.trim(),
        url: url.trim() ? normalizeUrl(url) : null,
        salaryMin: salaryMin ? Number(salaryMin) : null,
        salaryMax: salaryMax ? Number(salaryMax) : null,
        location: location.trim() || null,
        notes: notes.trim() || null,
      });
      onDone();
    } catch (err) {
      console.error(err);
      setError("Failed to save. Please try again.");
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={roleFormStyle}>
      <span style={roleFormTitleStyle}>EDIT ROLE</span>
      <div style={roleFormGridStyle}>
        <label style={labelStyle}>
          Title *
          <input
            className="field-input"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          URL
          <input
            className="field-input"
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          Salary Min
          <input
            className="field-input"
            type="number"
            min="0"
            value={salaryMin}
            onChange={(e) => setSalaryMin(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          Salary Max
          <input
            className="field-input"
            type="number"
            min="0"
            value={salaryMax}
            onChange={(e) => setSalaryMax(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          Location
          <input
            className="field-input"
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>
          Notes
          <textarea
            className="field-input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </label>
      </div>
      {error && <span style={errorStyle}>{error}</span>}
      <div style={{ display: "flex", gap: "8px" }}>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" className="signout-btn" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function RoleForm({
  companyId,
  onAdded,
  onCancel,
}: {
  companyId: string;
  onAdded?: () => void;
  onCancel?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [salaryMin, setSalaryMin] = useState("");
  const [salaryMax, setSalaryMax] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      await client.models.Role.create({
        title: title.trim(),
        url: url.trim() ? normalizeUrl(url) : undefined,
        salaryMin: salaryMin ? Number(salaryMin) : undefined,
        salaryMax: salaryMax ? Number(salaryMax) : undefined,
        location: location.trim() ? normalizeLocation(location) : undefined,
        notes: notes.trim() || undefined,
        companyId,
      });
      setTitle("");
      setUrl("");
      setSalaryMin("");
      setSalaryMax("");
      setLocation("");
      setNotes("");
      onAdded?.();
    } catch (err) {
      console.error(err);
      setError("Failed to add role. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={roleFormStyle}>
      <span style={roleFormTitleStyle}>ADD ROLE</span>
      <div style={roleFormGridStyle}>
        <label style={labelStyle}>
          Title *
          <input
            className="field-input"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          URL
          <input
            className="field-input"
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          Salary Min
          <input
            className="field-input"
            type="number"
            min="0"
            value={salaryMin}
            onChange={(e) => setSalaryMin(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          Salary Max
          <input
            className="field-input"
            type="number"
            min="0"
            value={salaryMax}
            onChange={(e) => setSalaryMax(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          Location
          <input
            className="field-input"
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>
          Notes
          <textarea
            className="field-input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </label>
      </div>
      {error && <span style={errorStyle}>{error}</span>}
      <div style={{ display: "flex", gap: "8px" }}>
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? "Adding…" : "Add Role"}
        </button>
        {onCancel && (
          <button
            type="button"
            className="signout-btn"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

/* ---------- contacts ---------- */

function ContactSection({ companyId }: { companyId: string }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const sub = client.models.Contact.observeQuery({
      filter: { companyId: { eq: companyId } },
    }).subscribe({
      next: ({ items }) => {
        setContacts([...items].sort((a, b) => a.name.localeCompare(b.name)));
      },
    });
    return () => sub.unsubscribe();
  }, [companyId]);

  const toggle = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div style={{ ...nestedStyle, borderTop: "1px dashed #333" }}>
      <h3 style={nestedHeadingStyle}>
        CONTACTS <span style={{ color: "#C94E1A" }}>{contacts.length}</span>
      </h3>
      {contacts.length === 0 ? (
        <p style={{ ...emptyStyle, padding: "0 0 12px" }}>No contacts yet.</p>
      ) : (
        <ul style={roleListStyle}>
          {contacts.map((contact) => (
            <ContactRow
              key={contact.id}
              contact={contact}
              expanded={expandedIds.has(contact.id)}
              onToggle={() => toggle(contact.id)}
            />
          ))}
        </ul>
      )}
      <ContactForm companyId={companyId} />
    </div>
  );
}

function ContactRow({
  contact,
  expanded,
  onToggle,
}: {
  contact: Contact;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const sub = client.models.Interaction.observeQuery({
      filter: { contactId: { eq: contact.id } },
    }).subscribe({
      next: ({ items }) => {
        setInteractions(
          [...items].sort((a, b) => b.date.localeCompare(a.date)),
        );
      },
    });
    return () => sub.unsubscribe();
  }, [contact.id]);

  const lastTouchDays =
    interactions.length > 0 ? daysSince(interactions[0].date) : null;

  if (editing) {
    return (
      <li style={roleBlockStyle}>
        <ContactEditForm contact={contact} onDone={() => setEditing(false)} />
      </li>
    );
  }

  return (
    <li style={roleBlockStyle}>
      <div className="tracker-row" style={roleRowStyle}>
        <button
          type="button"
          className="company-name-btn"
          onClick={onToggle}
          aria-expanded={expanded}
        >
          <span style={{ color: "#666660", marginRight: "8px" }}>
            {expanded ? "▼" : "▶"}
          </span>
          {contact.name}
        </button>
        {contact.title && <span style={roleMetaStyle}>{contact.title}</span>}
        {contact.email && (
          <a
            href={`mailto:${contact.email}`}
            style={{ color: "#C94E1A", fontSize: "13px" }}
          >
            {contact.email}
          </a>
        )}
        {contact.linkedin && (
          <a
            href={normalizeUrl(contact.linkedin)}
            target="_blank"
            rel="noreferrer"
            style={{ color: "#C94E1A", fontSize: "13px" }}
          >
            linkedin
          </a>
        )}
        <span style={{ ...rowControlsStyle, marginLeft: "auto" }}>
          <span style={{ fontSize: "12px" }}>
            {lastTouchDays === null ? (
              <span style={{ color: "#883322" }}>no contact yet</span>
            ) : (
              <span
                style={{ color: lastTouchDays > 14 ? "#C8951E" : "#666660" }}
              >
                last touch{" "}
                <span
                  style={{
                    fontFamily: '"Courier Prime", monospace',
                    fontWeight: 700,
                    fontSize: "15px",
                    letterSpacing: "1.5px",
                  }}
                >
                  {lastTouchDays}
                </span>{" "}
                {lastTouchDays === 1 ? "day" : "days"} ago
              </span>
            )}
          </span>
          <button
            type="button"
            className="edit-btn"
            onClick={() => setEditing(true)}
          >
            EDIT
          </button>
          <DeleteControl onDelete={() => deleteContactCascade(contact.id)} />
        </span>
      </div>
      {expanded && (
        <div style={interactionPanelStyle}>
          <NotesLine notes={contact.notes} style={{ margin: "0 0 8px" }} />
          {interactions.length === 0 ? (
            <p style={{ ...emptyStyle, padding: "0 0 10px" }}>
              No interactions logged.
            </p>
          ) : (
            <ul style={roleListStyle}>
              {interactions.map((interaction) => (
                <li key={interaction.id} style={interactionItemStyle}>
                  <span style={interactionTypeStyle}>{interaction.type}</span>
                  <span style={interactionDateStyle}>{interaction.date}</span>
                  {interaction.notes && (
                    <span style={{ color: "#CCCCBB" }}>
                      {interaction.notes}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <InteractionForm contactId={contact.id} />
        </div>
      )}
    </li>
  );
}

function ContactEditForm({
  contact,
  onDone,
}: {
  contact: Contact;
  onDone: () => void;
}) {
  const [name, setName] = useState(contact.name);
  const [title, setTitle] = useState(contact.title ?? "");
  const [email, setEmail] = useState(contact.email ?? "");
  const [linkedin, setLinkedin] = useState(contact.linkedin ?? "");
  const [notes, setNotes] = useState(contact.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await client.models.Contact.update({
        id: contact.id,
        name: name.trim(),
        title: title.trim() || null,
        email: email.trim() || null,
        linkedin: linkedin.trim() ? normalizeUrl(linkedin) : null,
        notes: notes.trim() || null,
      });
      onDone();
    } catch (err) {
      console.error(err);
      setError("Failed to save. Please try again.");
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={roleFormStyle}>
      <span style={roleFormTitleStyle}>EDIT CONTACT</span>
      <div style={roleFormGridStyle}>
        <label style={labelStyle}>
          Name *
          <input
            className="field-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          Title
          <input
            className="field-input"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          Email
          <input
            className="field-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          LinkedIn
          <input
            className="field-input"
            type="text"
            value={linkedin}
            onChange={(e) => setLinkedin(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>
          Notes
          <textarea
            className="field-input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </label>
      </div>
      {error && <span style={errorStyle}>{error}</span>}
      <div style={{ display: "flex", gap: "8px" }}>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" className="signout-btn" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ContactForm({ companyId }: { companyId: string }) {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      await client.models.Contact.create({
        name: name.trim(),
        title: title.trim() || undefined,
        email: email.trim() || undefined,
        linkedin: linkedin.trim() ? normalizeUrl(linkedin) : undefined,
        notes: notes.trim() || undefined,
        companyId,
      });
      setName("");
      setTitle("");
      setEmail("");
      setLinkedin("");
      setNotes("");
    } catch (err) {
      console.error(err);
      setError("Failed to add contact. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={roleFormStyle}>
      <span style={roleFormTitleStyle}>ADD CONTACT</span>
      <div style={roleFormGridStyle}>
        <label style={labelStyle}>
          Name *
          <input
            className="field-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          Title
          <input
            className="field-input"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          Email
          <input
            className="field-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          LinkedIn
          <input
            className="field-input"
            type="text"
            value={linkedin}
            onChange={(e) => setLinkedin(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>
          Notes
          <textarea
            className="field-input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </label>
      </div>
      {error && <span style={errorStyle}>{error}</span>}
      <button type="submit" className="btn-primary" disabled={submitting}>
        {submitting ? "Adding…" : "Add Contact"}
      </button>
    </form>
  );
}

function InteractionForm({ contactId }: { contactId: string }) {
  const [type, setType] = useState<InteractionType>("EMAIL");
  const [date, setDate] = useState(localToday());
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!date) return;

    setSubmitting(true);
    setError(null);
    try {
      await client.models.Interaction.create({
        type,
        date,
        notes: notes.trim() || undefined,
        contactId,
      });
      setType("EMAIL");
      setDate(localToday());
      setNotes("");
    } catch (err) {
      console.error(err);
      setError("Failed to log interaction. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={roleFormStyle}>
      <span style={roleFormTitleStyle}>LOG INTERACTION</span>
      <div style={roleFormGridStyle}>
        <label style={labelStyle}>
          Type
          <select
            className="field-input"
            value={type}
            onChange={(e) => setType(e.target.value as InteractionType)}
            style={inputStyle}
          >
            {INTERACTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label style={labelStyle}>
          Date *
          <input
            className="field-input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            style={{ ...inputStyle, colorScheme: "dark" }}
          />
        </label>
        <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>
          Notes
          <textarea
            className="field-input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </label>
      </div>
      {error && <span style={errorStyle}>{error}</span>}
      <button type="submit" className="btn-primary" disabled={submitting}>
        {submitting ? "Logging…" : "Log Interaction"}
      </button>
    </form>
  );
}

/* ---------- styles ---------- */

const panelStyle: CSSProperties = {
  margin: "24px 20px 0",
  background: "#141414",
  border: "1px solid #333",
};

const headingStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontWeight: 700,
  fontSize: "22px",
  textTransform: "uppercase",
  letterSpacing: "1.5px",
  color: "#CCCCBB",
  margin: 0,
  padding: "12px 16px",
  borderBottom: "1px solid #333",
};

const emptyStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  color: "#666660",
  padding: "16px",
  margin: 0,
  fontSize: "14px",
};

const headerCellStyle: CSSProperties = {
  textAlign: "left",
  fontFamily: '"Courier Prime", monospace',
  fontSize: "12px",
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  color: "#666660",
  padding: "8px 16px",
  borderBottom: "1px solid #333",
};

const cellStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontSize: "14px",
  color: "#CCCCBB",
  padding: "10px 16px",
  borderBottom: "1px solid #222",
  verticalAlign: "top",
};

const editRowCellStyle: CSSProperties = {
  padding: "12px 16px",
  borderBottom: "1px solid #222",
  background: "#131313",
};

const rowControlsStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  marginLeft: "auto",
};

const confirmWrapStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  fontFamily: '"Courier Prime", monospace',
  fontSize: "11px",
  letterSpacing: "0.05em",
};

const notesLineStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontSize: "12px",
  color: "#666660",
  marginTop: "3px",
};

const roleDescriptionStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontSize: "13px",
  color: "#666660",
  marginTop: "4px",
};

const requirementListStyle: CSSProperties = {
  listStyle: "none",
  margin: "6px 0 0",
  padding: 0,
};

const requirementItemStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  fontFamily: '"Courier Prime", monospace',
  fontSize: "12px",
  color: "#666660",
  padding: "1px 0",
};

const requirementBulletStyle: CSSProperties = {
  color: "#C94E1A",
  flexShrink: 0,
};

const nestedStyle: CSSProperties = {
  background: "#131313",
  borderTop: "1px solid #222",
  padding: "12px 16px 16px 40px",
};

const nestedHeadingStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontWeight: 700,
  fontSize: "16px",
  textTransform: "uppercase",
  letterSpacing: "1.5px",
  color: "#CCCCBB",
  margin: "0 0 8px",
};

const roleListStyle: CSSProperties = {
  listStyle: "none",
  margin: "0 0 12px",
  padding: 0,
};

const roleBlockStyle: CSSProperties = {
  display: "block",
  padding: "6px 0",
  borderBottom: "1px solid #222",
};

const roleRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "16px",
  fontFamily: '"Courier Prime", monospace',
  fontSize: "14px",
};

const roleMetaStyle: CSSProperties = {
  color: "#666660",
  fontSize: "13px",
};

const salaryStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontWeight: 700,
  fontSize: "15px",
  letterSpacing: "1.5px",
  color: "#C94E1A",
};

const addRoleLinkStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontSize: "13px",
  color: "#666660",
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  textAlign: "left",
};

const roleFormStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  border: "1px solid #333",
  background: "#141414",
  padding: "12px",
  maxWidth: "640px",
};

const roleFormTitleStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontWeight: 700,
  fontSize: "14px",
  textTransform: "uppercase",
  letterSpacing: "1.5px",
  color: "#C94E1A",
};

const roleFormGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "10px",
};

const labelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  fontFamily: '"Courier Prime", monospace',
  fontSize: "12px",
  letterSpacing: "0.03em",
  textTransform: "uppercase",
  color: "#666660",
};

const inputStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontSize: "14px",
  color: "#CCCCBB",
  background: "#0f0f0f",
  border: "1px solid #333",
  padding: "8px 10px",
  textTransform: "none",
};

const errorStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontSize: "13px",
  color: "#C86A5A",
};

const interactionPanelStyle: CSSProperties = {
  margin: "8px 0 6px 24px",
  padding: "10px 12px",
  background: "#141414",
  border: "1px solid #222",
};

const interactionItemStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "14px",
  fontFamily: '"Courier Prime", monospace',
  fontSize: "13px",
  padding: "5px 0",
  borderBottom: "1px solid #222",
};

const interactionTypeStyle: CSSProperties = {
  color: "#C94E1A",
  fontSize: "12px",
  letterSpacing: "0.05em",
  minWidth: "60px",
};

const interactionDateStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontWeight: 700,
  fontSize: "13px",
  letterSpacing: "1.5px",
  color: "#666660",
};

const statusSelectStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontSize: "12px",
  color: "#CCCCBB",
  background: "#0f0f0f",
  border: "1px solid #333",
  padding: "3px 4px",
};
