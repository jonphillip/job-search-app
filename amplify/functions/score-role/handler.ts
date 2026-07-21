import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import type { Schema } from '../../data/resource';

const client = new BedrockRuntimeClient();
const MODEL_ID = process.env.MODEL_ID!;

const ATTAINABILITY_VALUES = new Set(['ENTRY_FREELANCE', 'MID', 'SENIOR_ONLY']);

interface Scored {
  fitScore: number | null;
  attainability: string | null;
  rationale: string | null;
  gaps: string | null;
}

const EMPTY: Scored = {
  fitScore: null,
  attainability: null,
  rationale: null,
  gaps: null,
};

const SYSTEM_PROMPT = `You score how well a candidate's profile fits a specific job posting.
Return ONLY a single JSON object, no prose, no markdown fences, with exactly these keys:
- fitScore: integer 0-100. How well the CANDIDATE'S ACTUAL BACKGROUND (as stated in their resume and targeting note) matches THIS ROLE'S STATED REQUIREMENTS. Score against evidence in the profile, not aspiration or potential.
- attainability: one of "ENTRY_FREELANCE", "MID", "SENIOR_ONLY" — the ROLE's own experience bar, judged independently of fitScore:
  - ENTRY_FREELANCE: open to early-career candidates or freelance/contract work; no multi-year experience requirement stated.
  - MID: expects some professional experience but not senior/staff/lead level.
  - SENIOR_ONLY: explicitly requires multiple years of experience, or a senior+/staff/lead/principal title.
  A role can be high-fit and SENIOR_ONLY, or low-fit and ENTRY_FREELANCE — these are independent judgments, not derived from each other.
- rationale: one concise sentence explaining the fit score. Name the specific matching background from the profile where it exists. If there's little or no match, say so plainly rather than softening it.
- gaps: one concise, factual, neutral sentence describing what the role requires that the profile doesn't demonstrate. Not discouraging in tone, just what's missing. Empty string if there are no notable gaps.

Calibration — be honest and calibrated, not encouraging:
- Do not inflate fitScore for a role the profile doesn't support. A profile with no matching background for a role's core requirements should score well under 40.
- Do not penalize the candidate for lacking something the role doesn't actually require — only weigh what the posting actually lists.
- Base fitScore ONLY on evidence actually present in the resume/targeting note. Do not assume skills, credentials, or experience that aren't stated.
- attainability describes the role's bar, not whether this particular candidate clears it.

Never wrap the JSON in code fences or commentary.`;

/** Pull the first balanced JSON object out of the model's text response. */
function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('No JSON object found in model response');
  }
  return JSON.parse(text.slice(start, end + 1));
}

function toStringOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toFitScore(v: unknown): number | null {
  let n: number | null = null;
  if (typeof v === 'number' && Number.isFinite(v)) n = Math.round(v);
  else if (typeof v === 'string' && v.trim().length > 0) {
    const parsed = Number(v.trim());
    if (Number.isFinite(parsed)) n = Math.round(parsed);
  }
  if (n == null) return null;
  return Math.max(0, Math.min(100, n));
}

function toAttainability(v: unknown): string | null {
  return typeof v === 'string' && ATTAINABILITY_VALUES.has(v) ? v : null;
}

export const handler: Schema['scoreRole']['functionHandler'] = async (
  event,
) => {
  const roleTitle = (event.arguments.roleTitle ?? '').trim();
  const resumeText = (event.arguments.resumeText ?? '').trim();
  if (roleTitle.length === 0 || resumeText.length === 0) {
    return EMPTY;
  }

  const description = (event.arguments.description ?? '').trim();
  const targetingStatement = (event.arguments.targetingStatement ?? '').trim();
  const requirements = (event.arguments.requirements ?? []).filter(
    (r): r is string => !!r && r.trim().length > 0,
  );

  const userContent = [
    `Role title: ${roleTitle}`,
    description ? `Role description: ${description}` : null,
    requirements.length > 0
      ? `Role requirements:\n${requirements.map((r) => `- ${r}`).join('\n')}`
      : null,
    '',
    `Candidate resume:\n${resumeText}`,
    targetingStatement
      ? `\nCandidate targeting note: ${targetingStatement}`
      : null,
  ]
    .filter((line): line is string => line != null)
    .join('\n');

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 400,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: userContent,
        },
      ],
    }),
  });

  const response = await client.send(command);
  const payload = JSON.parse(new TextDecoder().decode(response.body));
  const modelText: string = payload?.content?.[0]?.text ?? '';

  const raw = extractJson(modelText) as Record<string, unknown>;

  return {
    fitScore: toFitScore(raw.fitScore),
    attainability: toAttainability(raw.attainability),
    rationale: toStringOrNull(raw.rationale),
    gaps: toStringOrNull(raw.gaps),
  };
};
