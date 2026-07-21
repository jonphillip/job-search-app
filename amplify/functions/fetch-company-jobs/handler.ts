import type { Schema } from '../../data/resource';

type Ats = 'ASHBY' | 'GREENHOUSE';

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
  return { atsType: null, slug: '' };
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
      return {
        title: str(job.title),
        location: str(job.location),
        url: str(job.jobUrl) || str(job.applyUrl),
        descriptionText:
          str(job.descriptionPlain) || stripHtml(str(job.descriptionHtml)),
      };
    })
    .filter((job) => job.title.length > 0);
}

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
    if (upper === 'ASHBY' || upper === 'GREENHOUSE') {
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
        "Couldn't recognize a Greenhouse or Ashby careers URL. Paste a link like jobs.ashbyhq.com/acme or boards.greenhouse.io/acme.",
    });
  }

  const label = atsType === 'ASHBY' ? 'Ashby' : 'Greenhouse';
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
