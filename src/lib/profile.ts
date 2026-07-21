import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";

const client = generateClient<Schema>();

export type ProfileData = Schema["Profile"]["type"];

// Owner auth already scopes list() to the caller's own records; as long as
// saveProfile always updates an existing record instead of creating a
// second one, there's at most one Profile per user.
export async function getMyProfile(): Promise<ProfileData | null> {
  const { data } = await client.models.Profile.list();
  return data[0] ?? null;
}

export async function saveProfile(input: {
  resumeText: string;
  targetingStatement: string;
}): Promise<ProfileData> {
  const existing = await getMyProfile();
  const payload = {
    resumeText: input.resumeText.trim() || undefined,
    targetingStatement: input.targetingStatement.trim() || undefined,
  };
  const result = existing
    ? await client.models.Profile.update({ id: existing.id, ...payload })
    : await client.models.Profile.create(payload);
  if (!result.data) {
    throw new Error("Failed to save profile");
  }
  return result.data;
}
