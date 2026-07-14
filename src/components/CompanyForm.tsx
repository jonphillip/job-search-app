import { useState, type CSSProperties, type FormEvent } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";

const client = generateClient<Schema>();

type CompanyStatus = "RESEARCHING" | "TARGETING" | "COLD";

export default function CompanyForm() {
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [status, setStatus] = useState<CompanyStatus>("RESEARCHING");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      await client.models.Company.create({
        name: name.trim(),
        website: website.trim() || undefined,
        status,
        notes: notes.trim() || undefined,
      });
      setName("");
      setWebsite("");
      setStatus("RESEARCHING");
      setNotes("");
    } catch (err) {
      console.error(err);
      setError("Failed to add company. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section style={panelStyle}>
      <h2 style={headingStyle}>Add Company</h2>
      <form onSubmit={handleSubmit} style={formStyle}>
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
        <label style={labelStyle}>
          Status
          <select
            className="field-input"
            value={status}
            onChange={(e) => setStatus(e.target.value as CompanyStatus)}
            style={inputStyle}
          >
            <option value="RESEARCHING">Researching</option>
            <option value="TARGETING">Targeting</option>
            <option value="COLD">Cold</option>
          </select>
        </label>
        <label style={labelStyle}>
          Notes
          <textarea
            className="field-input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </label>
        {error && <span style={errorStyle}>{error}</span>}
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? "Adding…" : "Add Company"}
        </button>
      </form>
    </section>
  );
}

const panelStyle: CSSProperties = {
  margin: "24px 20px 0",
  background: "#141414",
  border: "1px solid #333",
  padding: "16px",
};

const headingStyle: CSSProperties = {
  fontFamily: '"VT323", monospace',
  fontSize: "24px",
  color: "#CCCCBB",
  margin: "0 0 16px",
};

const formStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  maxWidth: "480px",
};

const labelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  fontFamily: '"Courier Prime", monospace',
  fontSize: "13px",
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
