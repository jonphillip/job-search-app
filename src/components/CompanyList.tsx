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

const STATUS_COLORS: Record<string, string> = {
  TARGETING: "#5BA85A",
  RESEARCHING: "#C8951E",
  COLD: "#883322",
};

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatSalary(min?: number | null, max?: number | null): string {
  const fmt = (n: number) => `$${n.toLocaleString()}`;
  if (min != null && max != null) return `${fmt(min)}–${fmt(max)}`;
  if (min != null) return `${fmt(min)}+`;
  if (max != null) return `up to ${fmt(max)}`;
  return "";
}

export default function CompanyList() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
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
  return (
    <>
      <tr>
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
        </td>
        <td style={cellStyle}>
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
          {company.status}
        </td>
        <td style={cellStyle}>
          {company.website ? (
            <a
              href={company.website}
              target="_blank"
              rel="noreferrer"
              style={{ color: "#C94E1A" }}
            >
              {company.website}
            </a>
          ) : (
            <span style={{ color: "#666660" }}>&mdash;</span>
          )}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={3} style={{ padding: 0, borderBottom: "1px solid #222" }}>
            <RoleSection companyId={company.id} />
          </td>
        </tr>
      )}
    </>
  );
}

function RoleSection({ companyId }: { companyId: string }) {
  const [roles, setRoles] = useState<Role[]>([]);

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
      <RoleForm companyId={companyId} />
    </div>
  );
}

function RoleItem({ role }: { role: Role }) {
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(false);

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

  return (
    <li style={roleItemStyle}>
      <span style={{ color: "#CCCCBB" }}>{role.title}</span>
      {role.location && <span style={roleMetaStyle}>{role.location}</span>}
      {formatSalary(role.salaryMin, role.salaryMax) && (
        <span style={salaryStyle}>
          {formatSalary(role.salaryMin, role.salaryMax)}
        </span>
      )}
      {role.url && (
        <a
          href={role.url}
          target="_blank"
          rel="noreferrer"
          style={{ color: "#C94E1A", fontSize: "13px" }}
        >
          posting
        </a>
      )}
      <button
        type="button"
        className="advance-btn"
        disabled={creating}
        onClick={addApplication}
        style={{ marginLeft: "auto" }}
      >
        {created ? "ADDED ✓" : creating ? "ADDING…" : "ADD APPLICATION"}
      </button>
    </li>
  );
}

function RoleForm({ companyId }: { companyId: string }) {
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
        url: url.trim() || undefined,
        salaryMin: salaryMin ? Number(salaryMin) : undefined,
        salaryMax: salaryMax ? Number(salaryMax) : undefined,
        location: location.trim() || undefined,
        notes: notes.trim() || undefined,
        companyId,
      });
      setTitle("");
      setUrl("");
      setSalaryMin("");
      setSalaryMax("");
      setLocation("");
      setNotes("");
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
      <button type="submit" className="btn-primary" disabled={submitting}>
        {submitting ? "Adding…" : "Add Role"}
      </button>
    </form>
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
};

const nestedStyle: CSSProperties = {
  background: "#131313",
  borderTop: "1px solid #222",
  padding: "12px 16px 16px 40px",
};

const nestedHeadingStyle: CSSProperties = {
  fontFamily: '"VT323", monospace',
  fontSize: "18px",
  color: "#CCCCBB",
  margin: "0 0 8px",
};

const roleListStyle: CSSProperties = {
  listStyle: "none",
  margin: "0 0 12px",
  padding: 0,
};

const roleItemStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "16px",
  fontFamily: '"Courier Prime", monospace',
  fontSize: "14px",
  padding: "6px 0",
  borderBottom: "1px solid #222",
};

const roleMetaStyle: CSSProperties = {
  color: "#666660",
  fontSize: "13px",
};

const salaryStyle: CSSProperties = {
  fontFamily: '"VT323", monospace',
  fontSize: "17px",
  color: "#C94E1A",
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
  fontFamily: '"VT323", monospace',
  fontSize: "16px",
  letterSpacing: "0.08em",
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
