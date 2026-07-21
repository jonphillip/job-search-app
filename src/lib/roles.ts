import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import { normalizeUrl, normalizeLocation } from "./normalize";

const client = generateClient<Schema>();

// A job posting reduced to the fields a Role is built from — accepted either
// hand-edited (manual parser) or straight from parseJobPosting (board import).
// Strings may be untrimmed; salary values are already integers.
export interface RoleDraft {
  companyId: string;
  title: string;
  url?: string | null;
  location?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryIsEstimated?: boolean | null;
  compensationNote?: string | null;
  description?: string | null;
  requirements?: readonly (string | null | undefined)[] | null;
}

/**
 * The single creation path for a Role built from a parsed/edited job posting.
 * Applies URL + location normalization, salary/estimate handling, and
 * requirements cleanup. Used by BOTH the manual parser and the job-board
 * import so their behavior can never drift apart.
 */
export async function createRoleFromDraft(draft: RoleDraft) {
  const requirements = (draft.requirements ?? [])
    .map((r) => (typeof r === "string" ? r.trim() : ""))
    .filter((r) => r.length > 0);

  return client.models.Role.create({
    companyId: draft.companyId,
    title: draft.title.trim(),
    url: draft.url && draft.url.trim() ? normalizeUrl(draft.url) : undefined,
    location:
      draft.location && draft.location.trim()
        ? normalizeLocation(draft.location)
        : undefined,
    salaryMin: draft.salaryMin ?? undefined,
    salaryMax: draft.salaryMax ?? undefined,
    salaryIsEstimated: draft.salaryIsEstimated ?? false,
    compensationNote:
      draft.compensationNote && draft.compensationNote.trim()
        ? draft.compensationNote.trim()
        : undefined,
    description:
      draft.description && draft.description.trim()
        ? draft.description.trim()
        : undefined,
    requirements: requirements.length > 0 ? requirements : undefined,
  });
}
