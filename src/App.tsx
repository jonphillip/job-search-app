import { useState, type CSSProperties } from "react";
import { Authenticator, ThemeProvider } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { theme } from "./theme";
import CompanyForm from "./components/CompanyForm";
import CompanyList from "./components/CompanyList";
import PipelineBoard from "./components/PipelineBoard";
import JobPostingParser from "./components/JobPostingParser";
import ProfileSection from "./components/ProfileSection";
import Triage from "./components/Triage";
import StatsBar from "./components/StatsBar";
import ActivityTicker from "./components/ActivityTicker";
import { AppDataProvider } from "./lib/AppDataContext";

function App() {
  // The paste-parser is a fallback for career sites with no importable ATS —
  // de-emphasized behind a muted toggle, collapsed by default.
  const [showParser, setShowParser] = useState(false);

  return (
    <ThemeProvider theme={theme}>
      <Authenticator>
        {({ signOut, user }) => (
          <main>
            <header
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "1rem",
                padding: "12px 20px",
                background: "#1a1a1a",
                borderBottom: "1px solid #333",
              }}
            >
              <span
                style={{
                  fontFamily: '"Courier Prime", monospace',
                  fontWeight: 700,
                  fontSize: "22px",
                  lineHeight: 1,
                  textTransform: "uppercase",
                  letterSpacing: "3px",
                  color: "#C94E1A",
                }}
              >
                JOB TRACKER&copy;
              </span>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "16px",
                }}
              >
                <span
                  style={{
                    fontFamily: '"Courier Prime", monospace',
                    fontSize: "14px",
                    color: "#CCCCBB",
                  }}
                >
                  {user?.signInDetails?.loginId}
                </span>
                <button className="signout-btn" onClick={signOut}>
                  Sign out
                </button>
              </div>
            </header>
            <AppDataProvider>
              <StatsBar />
              <ProfileSection />
              <PipelineBoard />
              <Triage />
              <CompanyForm />
              <div style={parserToggleWrapStyle}>
                <button
                  type="button"
                  style={parserToggleStyle}
                  onClick={() => setShowParser((v) => !v)}
                  aria-expanded={showParser}
                >
                  {showParser ? "− cancel" : "+ paste a job posting manually"}
                </button>
              </div>
              {showParser && (
                <JobPostingParser onDone={() => setShowParser(false)} />
              )}
              <CompanyList />
            </AppDataProvider>
            <ActivityTicker />
          </main>
        )}
      </Authenticator>
    </ThemeProvider>
  );
}

const parserToggleWrapStyle: CSSProperties = {
  margin: "20px 20px 0",
};

// Muted fallback link, matching "+ add role manually" / "+ add contact".
const parserToggleStyle: CSSProperties = {
  fontFamily: '"Courier Prime", monospace',
  fontSize: "13px",
  color: "#666660",
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  textAlign: "left",
};

export default App;
