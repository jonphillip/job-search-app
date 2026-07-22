import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";

const client = generateClient<Schema>();

type Company = Schema["Company"]["type"];
type Role = Schema["Role"]["type"];
type Application = Schema["Application"]["type"];

interface AppData {
  companies: Company[];
  roles: Role[];
  applications: Application[];
  // False until every one of the three collections below has reported its
  // first synced snapshot. observeQuery's first emission is typically an
  // unsynced empty/partial snapshot (isSynced: false) while it pages through
  // the backend, so gating on isSynced (not "first emission") avoids a
  // loading indicator that flashes off before data has actually arrived.
  loading: boolean;
}

// Single shared subscription to Company/Role/Application, consumed by
// StatsBar, PipelineBoard, Triage, and CompanyList's top-level list —
// previously each of those subscribed independently, so the same
// full-table data (including every Role's large text fields) was fetched
// redundantly 2-3x on every page load.
const AppDataCtx = createContext<AppData | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [synced, setSynced] = useState({
    companies: false,
    roles: false,
    applications: false,
  });

  useEffect(() => {
    // A sync error must still clear its `synced` flag — otherwise `loading`
    // would stay true forever, which is worse than the old behavior (an
    // empty list). errors here degrade to "loaded, empty" rather than
    // "stuck loading".
    const subs = [
      client.models.Company.observeQuery().subscribe({
        next: ({ items, isSynced }) => {
          setCompanies([...items]);
          if (isSynced) {
            setSynced((s) => ({ ...s, companies: true }));
          }
        },
        error: (err) => {
          console.error(err);
          setSynced((s) => ({ ...s, companies: true }));
        },
      }),
      client.models.Role.observeQuery().subscribe({
        next: ({ items, isSynced }) => {
          setRoles([...items]);
          if (isSynced) {
            setSynced((s) => ({ ...s, roles: true }));
          }
        },
        error: (err) => {
          console.error(err);
          setSynced((s) => ({ ...s, roles: true }));
        },
      }),
      client.models.Application.observeQuery().subscribe({
        next: ({ items, isSynced }) => {
          setApplications([...items]);
          if (isSynced) {
            setSynced((s) => ({ ...s, applications: true }));
          }
        },
        error: (err) => {
          console.error(err);
          setSynced((s) => ({ ...s, applications: true }));
        },
      }),
    ];
    return () => subs.forEach((s) => s.unsubscribe());
  }, []);

  const loading = !(synced.companies && synced.roles && synced.applications);

  return (
    <AppDataCtx.Provider value={{ companies, roles, applications, loading }}>
      {children}
    </AppDataCtx.Provider>
  );
}

export function useAppData(): AppData {
  const ctx = useContext(AppDataCtx);
  if (!ctx) {
    throw new Error("useAppData must be used within an AppDataProvider");
  }
  return ctx;
}
