import { useState, type CSSProperties } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import { normalizeUrl, normalizeLocation } from "./CompanyList";

const client = generateClient<Schema>();

// Editable preview state — everything is a string so empty/missing fields are
// simply blank inputs, never an error condition.
interface Preview {
  companyName: string;
  roleTitle: string;
  location: string;
  salaryMin: string;
  salaryMax: string;
  url: string;
  description: string;
  // One requirement per line; split/joined on newlines at the edges.
  requirements: string;
  compensationNote: string;
  // Carried through from the parse; true when salary was estimated from an
  // hourly wage. Not directly user-editable, but persisted with the role.
  salaryIsEstimated: boolean;
}

// The string-valued preview fields that the plain text inputs edit.
type StringField = Exclude<keyof Preview, "salaryIsEstimated">;

function splitRequirements(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function salaryToInt(value: string): number | undefined {
  const digits = value.replace(/[^0-9]/g, "");
  if (digits.length === 0) return undefined;
  const n = Number(digits);
  return Number.isFinite(n) ? n : undefined;
}

export default function JobPostingParser() {
  const [text, setText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const setField = (key: StringField, value: string) =>
    setPreview((p) => (p ? { ...p, [key]: value } : p));

  const handleParse = async () => {
    if (!text.trim() || parsing) return;
    setParsing(true);
    setParseError(null);
    setSaveError(null);
    setSavedMsg(null);
    try {
      const { data, errors } = await client.queries.parseJobPosting({
        text: text.trim(),
      });
      if (errors && errors.length > 0) {
        throw new Error(errors[0].message);
      }
      setPreview({
        companyName: data?.companyName ?? "",
        roleTitle: data?.roleTitle ?? "",
        location: data?.location ?? "",
        salaryMin: data?.salaryMin != null ? String(data.salaryMin) : "",
        salaryMax: data?.salaryMax != null ? String(data.salaryMax) : "",
        url: data?.url ?? "",
        description: data?.description ?? "",
        requirements: (data?.requirements ?? [])
          .filter((r): r is string => !!r)
          .join("\n"),
        compensationNote: data?.compensationNote ?? "",
        salaryIsEstimated: data?.salaryIsEstimated ?? false,
      });
    } catch (err) {
      console.error(err);
      setParseError("Couldn't parse this posting. Please try again.");
    } finally {
      setParsing(false);
    }
  };

  const handleConfirm = async () => {
    if (!preview || saving) return;
    const companyName = preview.companyName.trim();
    const roleTitle = preview.roleTitle.trim();
    if (!companyName || !roleTitle) {
      setSaveError("Company name and role title are required to add.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      // Reuse an existing company when the name matches (case-insensitive),
      // otherwise create a fresh one.
      const { data: companies } = await client.models.Company.list();
      const existing = companies.find(
        (c) => c.name.trim().toLowerCase() === companyName.toLowerCase(),
      );

      let companyId = existing?.id;
      if (!companyId) {
        const created = await client.models.Company.create({
          name: companyName,
          status: "RESEARCHING",
        });
        if (!created.data) {
          throw new Error("Failed to create company");
        }
        companyId = created.data.id;
      }

      const requirements = splitRequirements(preview.requirements);

      await client.models.Role.create({
        title: roleTitle,
        companyId,
        url: preview.url.trim() ? normalizeUrl(preview.url) : undefined,
        location: preview.location.trim()
          ? normalizeLocation(preview.location)
          : undefined,
        salaryMin: salaryToInt(preview.salaryMin),
        salaryMax: salaryToInt(preview.salaryMax),
        salaryIsEstimated: preview.salaryIsEstimated,
        compensationNote: preview.compensationNote.trim() || undefined,
        description: preview.description.trim() || undefined,
        requirements: requirements.length > 0 ? requirements : undefined,
      });

      setSavedMsg(
        existing
          ? `Added role to existing company "${companyName}".`
          : `Created "${companyName}" and added the role.`,
      );
      setPreview(null);
      setText("");
    } catch (err) {
      console.error(err);
      setSaveError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    setPreview(null);
    setSaveError(null);
  };

  return (
    <section style={panelStyle}>
      <h2 style={headingStyle}>Parse Job Posting</h2>
      <p style={subtitleStyle}>
        Paste a job posting below and let AI extract the details.
      </p>

      <textarea
        className="field-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        placeholder="Paste the full job posting text here…"
        style={textareaStyle}
        disabled={parsing}
      />

      <div style={actionRowStyle}>
        <button
          type="button"
          className="btn-primary"
          onClick={handleParse}
          disabled={parsing || !text.trim()}
        >
          {parsing ? "PARSING…" : "PARSE"}
        </button>
        {parseError && <span style={errorStyle}>{parseError}</span>}
        {savedMsg && <span style={successStyle}>{savedMsg}</span>}
      </div>

      {preview && (
        <div style={previewWrapStyle}>
          <div style={previewTitleStyle}>Extracted fields — review &amp; edit</div>
          <div style={gridStyle}>
            <Field
              label="Company Name"
              value={preview.companyName}
              onChange={(v) => setField("companyName", v)}
            />
            <Field
              label="Role Title"
              value={preview.roleTitle}
              onChange={(v) => setField("roleTitle", v)}
            />
            <Field
              label="Location"
              value={preview.location}
              onChange={(v) => setField("location", v)}
            />
            <Field
              label="Posting URL"
              value={preview.url}
              onChange={(v) => setField("url", v)}
            />
            <Field
              label="Salary Min"
              value={preview.salaryMin}
              onChange={(v) => setField("salaryMin", v)}
              inputMode="numeric"
              placeholder="—"
            />
            <Field
              label="Salary Max"
              value={preview.salaryMax}
              onChange={(v) => setField("salaryMax", v)}
              inputMode="numeric"
              placeholder="—"
            />
          </div>

          <label style={{ ...labelStyle, marginTop: "12px" }}>
            Compensation Note
            <input
              className="field-input"
              type="text"
              value={preview.compensationNote}
              onChange={(e) => setField("compensationNote", e.target.value)}
              placeholder="e.g. $20–$22/hr, full-time (~40 hrs/week assumed)"
              style={{ ...inputStyle, width: "100%" }}
            />
          </label>

          <label style={{ ...labelStyle, marginTop: "12px" }}>
            Description
            <textarea
              className="field-input"
              value={preview.description}
              onChange={(e) => setField("description", e.target.value)}
              rows={2}
              placeholder="One-line summary of the role…"
              style={previewTextareaStyle}
            />
          </label>

          <label style={{ ...labelStyle, marginTop: "12px" }}>
            Requirements — one per line
            <textarea
              className="field-input"
              value={preview.requirements}
              onChange={(e) => setField("requirements", e.target.value)}
              rows={5}
              placeholder={"e.g.\n5+ years Python\nExperience with ASR models"}
              style={previewTextareaStyle}
            />
          </label>

          {saveError && <span style={errorStyle}>{saveError}</span>}

          <div style={actionRowStyle}>
            <button
              type="button"
              className="btn-primary"
              onClick={handleConfirm}
              disabled={saving}
            >
              {saving ? "ADDING…" : "CONFIRM & ADD"}
            </button>
            <button
              type="button"
              className="signout-btn"
              onClick={handleDiscard}
              disabled={saving}
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  inputMode,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputMode?: "numeric";
  placeholder?: string;
}) {
  return (
    <label style={labelStyle}>
      {label}
      <input
        className="field-input"
        type="text"
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
      />
    </label>
  );
}

const panelStyle: CSSProperties = {
  margin: "24px 20px 0",
  background: "#141414",
  border: "1px solid #333",
  padding: "16px",
};

const headingStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontWeight: 700,
  fontSize: "22px",
  textTransform: "uppercase",
  letterSpacing: "1.5px",
  color: "#CCCCBB",
  margin: "0 0 6px",
};

const subtitleStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontSize: "13px",
  color: "#666660",
  margin: "0 0 14px",
};

const textareaStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontSize: "14px",
  color: "#CCCCBB",
  background: "#0f0f0f",
  border: "1px solid #333",
  padding: "10px",
  width: "100%",
  maxWidth: "720px",
  resize: "vertical",
  textTransform: "none",
};

const actionRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "14px",
  marginTop: "12px",
  flexWrap: "wrap",
};

const previewWrapStyle: CSSProperties = {
  marginTop: "18px",
  paddingTop: "16px",
  borderTop: "1px solid #333",
  maxWidth: "720px",
};

const previewTitleStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontWeight: 700,
  fontSize: "13px",
  letterSpacing: "1.5px",
  textTransform: "uppercase",
  color: "#C94E1A",
  marginBottom: "12px",
};

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "12px",
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

const previewTextareaStyle: CSSProperties = {
  ...inputStyle,
  resize: "vertical",
  width: "100%",
};

const errorStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontSize: "13px",
  color: "#C86A5A",
};

const successStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontSize: "13px",
  color: "#7FA96B",
};
