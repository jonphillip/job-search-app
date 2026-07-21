import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";

const client = generateClient<Schema>();

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// The single creation path for a fresh DRAFT application against a role.
// Used by both the per-company role list and the triage worklist so "add
// application" behaves identically everywhere.
export async function createDraftApplication(roleId: string) {
  const today = localToday();
  return client.models.Application.create({
    status: "DRAFT",
    appliedDate: today,
    lastStatusChange: today,
    roleId,
  });
}
