import { useState, type CSSProperties, type FormEvent } from "react";
import { getMyProfile, saveProfile, type ProfileData } from "../lib/profile";

export default function ProfileSection() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [resumeText, setResumeText] = useState("");
  const [targetingStatement, setTargetingStatement] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const open_ = async () => {
    setOpen(true);
    if (loaded) return;
    try {
      const p = await getMyProfile();
      setProfile(p);
      setResumeText(p?.resumeText ?? "");
      setTargetingStatement(p?.targetingStatement ?? "");
    } catch (err) {
      console.error(err);
    } finally {
      setLoaded(true);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSavedMsg(null);
    try {
      const updated = await saveProfile({ resumeText, targetingStatement });
      setProfile(updated);
      setSavedMsg("Profile saved.");
    } catch (err) {
      console.error(err);
      setError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={wrapStyle}>
      {open ? (
        <button
          type="button"
          style={toggleStyle}
          onClick={() => setOpen(false)}
          aria-expanded={open}
        >
          − cancel
        </button>
      ) : (
        <button
          type="button"
          style={toggleStyle}
          onClick={open_}
          aria-expanded={open}
        >
          + my profile
        </button>
      )}
      {open && (
        <form onSubmit={handleSubmit} style={panelStyle}>
          <span style={panelTitleStyle}>MY PROFILE</span>
          <p style={subtitleStyle}>
            The fixed picture role-fit scoring compares roles against — your
            resume and a short note on what you're targeting.
          </p>
          <label style={labelStyle}>
            Resume Text
            <textarea
              className="field-input"
              value={resumeText}
              onChange={(e) => setResumeText(e.target.value)}
              rows={10}
              placeholder="Paste your resume text…"
              style={textareaStyle}
              disabled={saving}
            />
          </label>
          <label style={labelStyle}>
            Targeting Statement
            <textarea
              className="field-input"
              value={targetingStatement}
              onChange={(e) => setTargetingStatement(e.target.value)}
              rows={3}
              placeholder="What you're looking for / what level you're targeting…"
              style={textareaStyle}
              disabled={saving}
            />
          </label>
          {error && <span style={errorStyle}>{error}</span>}
          <div style={actionRowStyle}>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "SAVING…" : "SAVE PROFILE"}
            </button>
            {savedMsg && <span style={successStyle}>{savedMsg}</span>}
            {profile?.updatedAt && (
              <span style={metaStyle}>
                last updated {new Date(profile.updatedAt).toLocaleString()}
              </span>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

const wrapStyle: CSSProperties = {
  margin: "20px 20px 0",
};

// Muted fallback link, matching "+ paste a job posting manually" etc.
const toggleStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontSize: "13px",
  color: "#666660",
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  textAlign: "left",
};

const panelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  marginTop: "12px",
  background: "#141414",
  border: "1px solid #333",
  padding: "16px",
  maxWidth: "640px",
};

const panelTitleStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontWeight: 700,
  fontSize: "14px",
  textTransform: "uppercase",
  letterSpacing: "1.5px",
  color: "#C94E1A",
};

const subtitleStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontSize: "13px",
  color: "#666660",
  margin: 0,
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

const textareaStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontSize: "14px",
  color: "#CCCCBB",
  background: "#0f0f0f",
  border: "1px solid #333",
  padding: "8px 10px",
  textTransform: "none",
  resize: "vertical",
  width: "100%",
};

const actionRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "14px",
  flexWrap: "wrap",
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

const metaStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontSize: "12px",
  color: "#666660",
};
