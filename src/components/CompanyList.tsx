import { useEffect, useState, type CSSProperties } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";

const client = generateClient<Schema>();

type Company = Schema["Company"]["type"];

const STATUS_COLORS: Record<string, string> = {
  TARGETING: "#5BA85A",
  RESEARCHING: "#C8951E",
  COLD: "#883322",
};

export default function CompanyList() {
  const [companies, setCompanies] = useState<Company[]>([]);

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
              <tr key={company.id}>
                <td style={cellStyle}>{company.name}</td>
                <td style={cellStyle}>
                  <span
                    style={{
                      display: "inline-block",
                      width: "10px",
                      height: "10px",
                      borderRadius: "50%",
                      background:
                        STATUS_COLORS[company.status ?? ""] ?? "#666660",
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
            ))}
          </tbody>
        </table>
      )}
    </section>
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
