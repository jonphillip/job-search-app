import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import type { Schema } from '../../data/resource';

const client = new BedrockRuntimeClient();
const MODEL_ID = process.env.MODEL_ID!;

interface Parsed {
  companyName: string | null;
  roleTitle: string | null;
  location: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryIsEstimated: boolean;
  compensationNote: string | null;
  url: string | null;
  description: string | null;
  requirements: string[];
}

const EMPTY: Parsed = {
  companyName: null,
  roleTitle: null,
  location: null,
  salaryMin: null,
  salaryMax: null,
  salaryIsEstimated: false,
  compensationNote: null,
  url: null,
  description: null,
  requirements: [],
};

const SYSTEM_PROMPT = `You extract structured data from job postings.
Return ONLY a single JSON object, no prose, no markdown fences, with exactly these keys:
- companyName: string, the hiring company's name
- roleTitle: string, the job title
- location: string, e.g. "San Francisco, CA" or "Remote"
- salaryMin: integer, the low end of the ANNUAL base salary in whole dollars (e.g. 150000). May be a directly stated annual figure OR a computed estimate from an hourly wage (see salary rules).
- salaryMax: integer, the high end of the ANNUAL base salary in whole dollars
- salaryIsEstimated: boolean, true ONLY when salaryMin/salaryMax were computed from an hourly wage rather than stated as an annual figure; false otherwise
- compensationNote: string, a short human-readable basis for an estimate, e.g. "$20–$22/hr, full-time (~40 hrs/week assumed)". Empty string when no estimation was done.
- url: string, the posting/apply URL
- description: string, a single terse one-line summary of the role (e.g. "TTS/voice AI. Primary target." register — clipped, factual, no marketing language, no full sentences required)
- requirements: array of strings, the 3-6 most important qualifications/requirements actually stated in the posting, each a short phrase

Rules:
- Extract ONLY what is explicitly present in the text. Do not guess, infer, or invent anything (the hourly→annual estimation below is the sole exception, and only when an hourly wage is actually stated).
- For any field not clearly stated, use null. For requirements, use an empty array if none are stated.
- Salaries — a directly stated ANNUAL figure: convert "$150k" to 150000. If only a single figure is given, put it in both salaryMin and salaryMax. Set salaryIsEstimated: false and compensationNote: "".
- Salaries — HOURLY wage stated instead of (or in addition to) an annual figure, and NO annual figure is stated: estimate the annual salary.
  1. Extract the hourly range (a single hourly rate goes in both ends).
  2. Determine weekly hours: use an explicit "X hours/week" if present; else derive from stated shift times if given; else if the role is marked full-time assume 40; else if part-time and no hours are stated, still assume the stated/derivable hours or 40 if truly unknown. If nothing indicates hours, assume a standard 40-hour week.
  3. Compute annual = round(hourly × weeklyHours × 52) for each end, and store those in salaryMin/salaryMax.
  4. Set salaryIsEstimated: true and compensationNote to a short basis string like "$20–$22/hr, full-time (~40 hrs/week assumed)".
  If an annual figure IS directly stated, prefer it and do NOT estimate (salaryIsEstimated: false, compensationNote: "").
- If neither an hourly wage nor an annual figure is present, salaryMin and salaryMax are null, salaryIsEstimated is false, compensationNote is "".
- description: keep it to one short line in a clipped, note-taking style — not a paragraph, not marketing copy.
- requirements: only include qualifications the posting actually lists; keep each entry short; do not pad to reach a count.
- Never wrap the JSON in code fences or commentary.`;

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

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

function toBoolean(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.trim().toLowerCase() === 'true';
  return false;
}

function toIntOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  if (typeof v === 'string') {
    const digits = v.replace(/[^0-9.]/g, '');
    if (digits.length === 0) return null;
    const n = Number(digits);
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  return null;
}

export const handler: Schema['parseJobPosting']['functionHandler'] = async (
  event,
) => {
  const text = (event.arguments.text ?? '').trim();
  if (text.length === 0) {
    return EMPTY;
  }

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 700,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Job posting text:\n\n${text}`,
        },
      ],
    }),
  });

  const response = await client.send(command);
  const payload = JSON.parse(new TextDecoder().decode(response.body));
  const modelText: string = payload?.content?.[0]?.text ?? '';

  const raw = extractJson(modelText) as Record<string, unknown>;

  const salaryMin = toIntOrNull(raw.salaryMin);
  const salaryMax = toIntOrNull(raw.salaryMax);
  // An estimate only makes sense when we actually have a salary figure; the
  // note is only meaningful alongside an estimate. Enforce that consistency
  // regardless of what the model returned.
  const hasSalary = salaryMin != null || salaryMax != null;
  const salaryIsEstimated = hasSalary && toBoolean(raw.salaryIsEstimated);
  const compensationNote = salaryIsEstimated
    ? toStringOrNull(raw.compensationNote)
    : null;

  return {
    companyName: toStringOrNull(raw.companyName),
    roleTitle: toStringOrNull(raw.roleTitle),
    location: toStringOrNull(raw.location),
    salaryMin,
    salaryMax,
    salaryIsEstimated,
    compensationNote,
    url: toStringOrNull(raw.url),
    description: toStringOrNull(raw.description),
    requirements: toStringArray(raw.requirements),
  };
};
