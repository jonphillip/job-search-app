import type { Schema } from '../../data/resource';

type Ats = 'ASHBY' | 'GREENHOUSE' | 'LEVER';

interface NormalizedJob {
  title: string;
  location: string;
  url: string;
  descriptionText: string;
}

interface Result {
  count: number;
  message: string;
  atsType: string;
  slug: string;
  jobs: NormalizedJob[];
}

function result(partial: Partial<Result>): Result {
  return {
    count: partial.jobs?.length ?? 0,
    message: partial.message ?? '',
    atsType: partial.atsType ?? '',
    slug: partial.slug ?? '',
    jobs: partial.jobs ?? [],
  };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/* ---------- HTML → plain text (for Greenhouse's escaped HTML content) ---------- */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const num =
        code[1] === 'x' || code[1] === 'X'
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
      return Number.isFinite(num) ? String.fromCodePoint(num) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

/**
 * Greenhouse `content` is HTML that has been entity-escaped once (e.g.
 * "&lt;p&gt;"). Decode once to get real tags, strip them, then decode again to
 * resolve entities that were inside the text (e.g. "R&amp;D" → "R&D").
 */
function stripHtml(input: string): string {
  if (!input) return '';
  const html = decodeEntities(input);
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|table|section)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(text)
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ---------- ATS detection ---------- */

function detectFromUrl(rawUrl: string): { atsType: Ats | null; slug: string } {
  let parsed: URL;
  const trimmed = rawUrl.trim();
  try {
    parsed = new URL(trimmed);
  } catch {
    try {
      parsed = new URL(`https://${trimmed}`);
    } catch {
      return { atsType: null, slug: '' };
    }
  }
  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent);

  if (host.endsWith('ashbyhq.com')) {
    return { atsType: 'ASHBY', slug: segments[0] ?? '' };
  }
  if (host.endsWith('greenhouse.io')) {
    let slug = segments[0] ?? '';
    // Embedded boards carry the slug in ?for=, not the path.
    if (!slug || slug === 'embed') slug = parsed.searchParams.get('for') ?? '';
    return { atsType: 'GREENHOUSE', slug };
  }
  if (host.endsWith('lever.co')) {
    // jobs.lever.co/{slug}; slug is the first path segment. Query params
    // (e.g. ?department=...) are already excluded by using the pathname.
    return { atsType: 'LEVER', slug: segments[0] ?? '' };
  }
  return { atsType: null, slug: '' };
}

/* ---------- Ashby compensation → text ---------- */

/**
 * Ashby returns pay in a structured `compensation` object (because we request
 * includeCompensation=true), NOT in descriptionPlain. Flatten it into a short
 * readable line, e.g.:
 *   "Compensation: Senior Software Engineer — $197K–$246K; Staff Software Engineer — $246K–$307K"
 * so it can be appended to descriptionText and picked up by parseJobPosting the
 * same way a manually pasted salary line would be. Returns '' when absent.
 */
function formatAshbyCompensation(comp: unknown): string {
  if (!comp || typeof comp !== 'object') return '';
  const c = comp as Record<string, unknown>;

  const tiers = Array.isArray(c.compensationTiers) ? c.compensationTiers : [];
  const parts: string[] = [];
  for (const entry of tiers) {
    if (!entry || typeof entry !== 'object') continue;
    const tier = entry as Record<string, unknown>;
    const title = str(tier.title);

    // Prefer the Salary component's own summary (avoids equity/bonus noise);
    // fall back to the tier's overall summary.
    let summary = '';
    const components = Array.isArray(tier.components) ? tier.components : [];
    for (const c2 of components) {
      const component = c2 as Record<string, unknown>;
      if (str(component.componentType).toLowerCase() === 'salary') {
        summary = str(component.summary);
        break;
      }
    }
    if (!summary) summary = str(tier.tierSummary);
    if (!summary) continue;

    parts.push(title ? `${title} — ${summary}` : summary);
  }

  if (parts.length > 0) return `Compensation: ${parts.join('; ')}`;

  // No structured tiers — use whatever top-level summary string Ashby provides.
  const single =
    str(c.compensationTierSummary) ||
    str(c.scrapeableCompensationSalarySummary);
  return single ? `Compensation: ${single}` : '';
}

/* ---------- board fetchers ---------- */

async function fetchAshby(slug: string): Promise<NormalizedJob[]> {
  const res = await fetch(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(
      slug,
    )}?includeCompensation=true`,
    { headers: { accept: 'application/json' } },
  );
  if (!res.ok) throw new Error(`Ashby responded ${res.status}`);
  const data = (await res.json()) as { jobs?: unknown };
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  return jobs
    .map((entry): NormalizedJob => {
      const job = entry as Record<string, unknown>;
      const base =
        str(job.descriptionPlain) || stripHtml(str(job.descriptionHtml));
      const comp = formatAshbyCompensation(job.compensation);
      return {
        title: str(job.title),
        location: str(job.location),
        url: str(job.jobUrl) || str(job.applyUrl),
        descriptionText: comp ? (base ? `${base}\n\n${comp}` : comp) : base,
      };
    })
    .filter((job) => job.title.length > 0);
}

// Note: the Greenhouse job-board list API exposes no structured compensation
// field — any pay range lives inside `content` (the HTML), which stripHtml
// already folds into descriptionText. So no separate comp handling is needed.
async function fetchGreenhouse(slug: string): Promise<NormalizedJob[]> {
  const res = await fetch(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(
      slug,
    )}/jobs?content=true`,
    { headers: { accept: 'application/json' } },
  );
  if (!res.ok) throw new Error(`Greenhouse responded ${res.status}`);
  const data = (await res.json()) as { jobs?: unknown };
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  return jobs
    .map((entry): NormalizedJob => {
      const job = entry as Record<string, unknown>;
      const location = job.location as Record<string, unknown> | undefined;
      return {
        title: str(job.title),
        location: location ? str(location.name) : '',
        url: str(job.absolute_url),
        descriptionText: stripHtml(str(job.content)),
      };
    })
    .filter((job) => job.title.length > 0);
}

/**
 * Lever exposes optional compensation on a posting via `salaryRange`
 * ({ min, max, currency, interval }) and/or a `salaryDescriptionPlain` string.
 * Flatten whatever is present into a line appended to descriptionText, same as
 * the Ashby fix, so parseJobPosting can pick up the salary. Returns '' when
 * absent.
 */
function formatLeverCompensation(posting: Record<string, unknown>): string {
  const plain = str(posting.salaryDescriptionPlain);
  if (plain) return `Compensation: ${plain}`;

  const range = posting.salaryRange;
  if (range && typeof range === 'object') {
    const r = range as Record<string, unknown>;
    const min = typeof r.min === 'number' ? r.min : undefined;
    const max = typeof r.max === 'number' ? r.max : undefined;
    const currency = str(r.currency);
    const interval = str(r.interval);
    let amount = '';
    if (min != null && max != null) amount = `${min}–${max}`;
    else if (min != null) amount = `${min}`;
    else if (max != null) amount = `${max}`;
    if (amount) {
      return `Compensation: ${currency ? `${currency} ` : ''}${amount}${
        interval ? ` (${interval})` : ''
      }`;
    }
  }
  return '';
}

// Lever's posting API returns a bare JSON ARRAY (not { jobs: [...] }). apiHost
// lets the caller retry the EU host (api.eu.lever.co) for EU-hosted accounts.
async function fetchLever(slug: string, apiHost: string): Promise<NormalizedJob[]> {
  const res = await fetch(
    `https://${apiHost}/v0/postings/${encodeURIComponent(slug)}?mode=json`,
    { headers: { accept: 'application/json' } },
  );
  if (!res.ok) throw new Error(`Lever responded ${res.status}`);
  const data = await res.json();
  const postings = Array.isArray(data) ? data : [];
  return postings
    .map((entry): NormalizedJob => {
      const posting = entry as Record<string, unknown>;
      const categories = posting.categories as
        | Record<string, unknown>
        | undefined;
      const base =
        str(posting.descriptionPlain) || stripHtml(str(posting.description));
      const comp = formatLeverCompensation(posting);
      return {
        title: str(posting.text),
        location: categories ? str(categories.location) : '',
        url: str(posting.hostedUrl) || str(posting.applyUrl),
        descriptionText: comp ? (base ? `${base}\n\n${comp}` : comp) : base,
      };
    })
    .filter((job) => job.title.length > 0);
}

type Attempt = { ok: boolean; jobs: NormalizedJob[] };

async function attempt(fn: () => Promise<NormalizedJob[]>): Promise<Attempt> {
  try {
    return { ok: true, jobs: await fn() };
  } catch (err) {
    console.error(err);
    return { ok: false, jobs: [] };
  }
}

/* ---------- handler ---------- */

export const handler: Schema['fetchCompanyJobs']['functionHandler'] = async (
  event,
) => {
  const { url, atsType: atsArg, slug: slugArg } = event.arguments;

  let atsType: Ats | null = null;
  let slug = '';

  if (atsArg && slugArg) {
    const upper = String(atsArg).toUpperCase();
    if (upper === 'ASHBY' || upper === 'GREENHOUSE' || upper === 'LEVER') {
      atsType = upper;
      slug = String(slugArg).trim();
    }
  } else if (url && url.trim()) {
    const detected = detectFromUrl(url);
    atsType = detected.atsType;
    slug = detected.slug;
  }

  if (!atsType || !slug) {
    return result({
      message:
        "Couldn't recognize a Greenhouse, Ashby, or Lever careers URL. Paste a link like jobs.ashbyhq.com/acme, boards.greenhouse.io/acme, or jobs.lever.co/acme.",
    });
  }

  const label =
    atsType === 'ASHBY' ? 'Ashby' : atsType === 'LEVER' ? 'Lever' : 'Greenhouse';
  let outcome: Attempt;

  if (atsType === 'ASHBY') {
    // Ashby slugs can be case-sensitive: try lowercase, and if that yields
    // nothing (or fails), retry with the original casing from the URL.
    const lower = slug.toLowerCase();
    outcome = await attempt(() => fetchAshby(lower));
    if ((!outcome.ok || outcome.jobs.length === 0) && slug !== lower) {
      const retry = await attempt(() => fetchAshby(slug));
      if (retry.jobs.length > 0 || (!outcome.ok && retry.ok)) outcome = retry;
    }
  } else if (atsType === 'LEVER') {
    // Some Lever accounts are EU-hosted: if the primary host is empty or
    // errors (e.g. 404), retry api.eu.lever.co before giving up.
    outcome = await attempt(() => fetchLever(slug, 'api.lever.co'));
    if (!outcome.ok || outcome.jobs.length === 0) {
      const retry = await attempt(() => fetchLever(slug, 'api.eu.lever.co'));
      if (retry.jobs.length > 0 || (!outcome.ok && retry.ok)) outcome = retry;
    }
  } else {
    outcome = await attempt(() => fetchGreenhouse(slug));
  }

  if (!outcome.ok) {
    return result({
      atsType,
      slug,
      message: `Couldn't reach the ${label} board for "${slug}". Double-check the URL and try again.`,
    });
  }

  if (outcome.jobs.length === 0) {
    return result({
      atsType,
      slug,
      message: `No open roles found on the ${label} board for "${slug}".`,
    });
  }

  return result({ atsType, slug, jobs: outcome.jobs });
};
