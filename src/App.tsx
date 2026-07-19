import { Authenticator, ThemeProvider } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { theme } from "./theme";
import CompanyForm from "./components/CompanyForm";
import CompanyList from "./components/CompanyList";
import PipelineBoard from "./components/PipelineBoard";
import SeedButton from "./components/SeedButton";

function App() {
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
                <SeedButton />
                <button className="signout-btn" onClick={signOut}>
                  Sign out
                </button>
              </div>
            </header>
            <PipelineBoard />
            <CompanyForm />
            <CompanyList />
          </main>
        )}
      </Authenticator>
    </ThemeProvider>
  );
}

export default App;
