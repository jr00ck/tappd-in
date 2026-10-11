/**
 * Pure Untappd resolve helpers (shared by Worker + unit tests).
 * No secrets, no fetch — provider I/O stays in resolve-worker.js.
 */

/** /b/{slug}/{id} with optional trailing path (/photos, /nearby, …). */
const BEER_PATH_RE = /^\/b\/([a-z0-9-]+)\/(\d+)(?:\/|$)/i;
const BEER_URL_IN_TEXT_RE =
  /https?:\/\/(?:www\.)?untappd\.com\/b\/([a-z0-9-]+)\/(\d+)/gi;

export function stripDiacritics(s) {
  return String(s || '').normalize('NFD').replace(/\p{M}/gu, '');
}

export function normalizeMatchText(s) {
  let t = stripDiacritics(s).toLowerCase();
  t = t.replace(/&/g, ' and ');
  t = t.replace(/\b(the|brewing|brewery|brew|co|company|llc|inc)\b/g, ' ');
  t = t.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t;
}

export function tokenList(s) {
  return normalizeMatchText(s).split(' ').filter((w) => w.length > 1);
}

export function slugToWords(slug) {
  return normalizeMatchText(String(slug || '').replace(/-/g, ' '));
}

/**
 * Accept beer pages with www, query strings, and extra path segments.
 * Ignore checkins, venues, brewery-only pages.
 */
export function parseUntappdBeerUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  if (host !== 'untappd.com') return null;
  if (/^\/user\//i.test(url.pathname) || /^\/v\//i.test(url.pathname)) return null;
  if (/^\/w\//i.test(url.pathname)) return null; // brewery pages
  const m = BEER_PATH_RE.exec(url.pathname);
  if (!m) return null;
  const slug = m[1].toLowerCase();
  const id = m[2];
  return {
    slug,
    id,
    url: `https://untappd.com/b/${slug}/${id}`,
  };
}

export function extractBeerUrlsFromText(...parts) {
  const text = parts.filter(Boolean).join(' ');
  const found = [];
  let m;
  const re = new RegExp(BEER_URL_IN_TEXT_RE.source, 'gi');
  while ((m = re.exec(text)) !== null) {
    const parsed = parseUntappdBeerUrl(m[0]);
    if (parsed) found.push(parsed);
  }
  return found;
}

export function buildQueryVariants(brewery, beer) {
  const b = String(brewery || '').trim();
  const beerName = String(beer || '').trim();
  // Up to 5 variants; one multi-query Search request bills as one.
  // Prefer exact beer title form Untappd uses: "{Beer} - {Brewery}"
  return [
    `${b} ${beerName} untappd`,
    `${beerName} ${b} untappd.com/b`,
    `${beerName} by ${b}`,
    `${beerName} ${b} beer`,
    `"${beerName} - ${b}" untappd`,
  ].filter(Boolean).slice(0, 5);
}

function hasPhrase(haystack, phrase) {
  if (!phrase) return false;
  return ` ${haystack} `.includes(` ${phrase} `);
}

/**
 * Exact beer-name preference with penalties for extra/missing tokens.
 * Brewery match required (tolerant of brewing/co stripping via normalize).
 */
export function scoreCandidate(brewery, beer, parsed, title) {
  const beerNorm = normalizeMatchText(beer);
  const brewTokens = tokenList(brewery);
  const beerTokens = tokenList(beer);
  if (!beerTokens.length) return 0;

  const slugWords = slugToWords(parsed.slug);
  const slugTokenList = slugWords.split(' ').filter(Boolean);
  const titleNorm = normalizeMatchText(title || '');
  // Untappd titles: "{Beer} - {Brewery}"
  const titleBeer = titleNorm.includes(' - ')
    ? titleNorm.split(' - ')[0].trim()
    : titleNorm;

  // Brewery required in slug or title
  const brewOk = !brewTokens.length
    || brewTokens.some((t) => slugWords.includes(t) || titleNorm.includes(t));
  if (!brewOk) return 0;

  const beerHits = beerTokens.filter((t) => slugTokenList.includes(t) || titleBeer.split(' ').includes(t)).length;
  const beerCoverage = beerHits / beerTokens.length;

  // Extra tokens in slug/title-beer beyond brewery+beer (e.g. "double", "nothing")
  const expected = new Set([...brewTokens, ...beerTokens]);
  const noise = new Set(['ipa', 'dipa', 'neipa', 'ale', 'lager', 'stout', 'sour', 'hazy']);
  const slugExtras = slugTokenList.filter((t) => !expected.has(t) && !noise.has(t) && t.length > 2);
  const titleExtras = titleBeer.split(' ').filter((t) => t && !expected.has(t) && !noise.has(t) && t.length > 2);

  let score = beerCoverage * 0.7;

  const beerPortion = beerPortionFromSlug(parsed.slug, brewery);

  // Exact beer portion of slug / title — "something mosaic" ≠ "double something mosaic"
  if (beerPortion === beerNorm || titleBeer === beerNorm) {
    score += 0.55;
  } else if (hasPhrase(titleBeer, beerNorm) && titleExtras.length === 0) {
    score += 0.35;
  }

  // Penalize look-alikes hard (extra words in beer portion / title)
  score -= slugExtras.length * 0.35;
  score -= titleExtras.length * 0.2;
  score -= (1 - beerCoverage) * 0.4;
  if (beerPortion && beerPortion !== beerNorm && beerNorm && beerPortion.includes(beerNorm)) {
    score -= 0.4; // subset look-alike with prefixes like "double"
  }

  if (brewTokens.every((t) => slugWords.includes(t) || titleNorm.includes(t))) {
    score += 0.08;
  }

  return Math.max(0, Math.min(score, 1.35));
}

/** Beer tokens in slug after stripping brewery words + trailing numeric variants. */
export function beerPortionFromSlug(slug, brewery) {
  const brewTokens = new Set(tokenList(brewery));
  let parts = slugToWords(slug).split(' ').filter(Boolean);
  while (parts.length && brewTokens.has(parts[0])) parts.shift();
  while (parts.length && /^\d+$/.test(parts[parts.length - 1])) parts.pop();
  return parts.join(' ');
}

export function isConfident(best, second, beer, brewery) {
  if (!best || best.score < 0.72) return false;
  // Exact beer portion of slug (not a look-alike like "double something mosaic")
  if (beer && brewery) {
    const portion = beerPortionFromSlug(best.slug, brewery);
    if (portion === normalizeMatchText(beer) && best.score >= 0.72) return true;
  }
  if (!second) return true;
  return best.score - second.score >= 0.08 || best.score >= 0.95;
}

export function untappdSearchWebUrl(brewery, beer) {
  const q = [brewery, beer].map((s) => String(s || '').trim()).filter(Boolean).join(' ');
  const url = new URL('https://untappd.com/search');
  url.searchParams.set('q', q);
  url.searchParams.set('type', 'beer');
  return url.href;
}

/** Flatten single- or multi-query Perplexity `results`. */
export function flattenProviderResults(payload) {
  const r = payload && payload.results;
  if (!Array.isArray(r)) return [];
  // Grouped: [resultsForQ1, resultsForQ2, ...]
  if (r.length && Array.isArray(r[0])) {
    return r.flat().filter(Boolean);
  }
  // Grouped objects: [{ results: [...] }, ...]
  if (r.length && r[0] && typeof r[0] === 'object' && Array.isArray(r[0].results)) {
    return r.flatMap((g) => g.results || []);
  }
  return r;
}

/**
 * @param {Array<{title?: string, url?: string, snippet?: string}>} pages
 */
export function buildResolveResponse(brewery, beer, pages, extras = {}) {
  const byId = new Map();
  const debugRows = [];

  const consider = (parsed, title, sourceUrl) => {
    if (!parsed) return;
    const score = scoreCandidate(brewery, beer, parsed, title);
    const row = {
      url: parsed.url,
      id: parsed.id,
      slug: parsed.slug,
      title: title || parsed.slug,
      score: Math.round(score * 1000) / 1000,
      sourceUrl: sourceUrl || parsed.url,
    };
    debugRows.push(row);
    const prev = byId.get(parsed.id);
    if (!prev || row.score > prev.score) byId.set(parsed.id, row);
  };

  for (const page of pages || []) {
    const title = String(page.title || '');
    const pageUrl = String(page.url || '');
    consider(parseUntappdBeerUrl(pageUrl), title, pageUrl);
    for (const parsed of extractBeerUrlsFromText(title, page.snippet, pageUrl)) {
      consider(parsed, title, pageUrl);
    }
  }

  const brewTokens = tokenList(brewery);
  const beerTokens = tokenList(beer);

  let scored = [...byId.values()].filter((c) => {
    const slug = slugToWords(c.slug);
    if (brewTokens.length && !brewTokens.some((t) => slug.includes(t) || normalizeMatchText(c.title).includes(t))) {
      return false;
    }
    if (!beerTokens.length) return true;
    const hits = beerTokens.filter((t) => slug.includes(t)).length;
    return hits >= 1 && hits / beerTokens.length >= 0.5;
  });

  scored.sort((a, b) => b.score - a.score
    || a.slug.length - b.slug.length); // prefer shorter slug among ties (fewer variant suffixes)
  const best = scored[0] || null;
  const second = scored[1];
  const confident = isConfident(best, second, beer, brewery);

  const body = {
    best,
    candidates: scored.slice(0, 5).map(({ sourceUrl, ...rest }) => rest),
    confident,
    untappdSearchUrl: untappdSearchWebUrl(brewery, beer),
    query: { brewery, beer },
    pass: extras.pass || null,
    providerCalls: extras.providerCalls || 0,
    meta: {
      providerResults: (pages || []).length,
      beerUrlsFound: scored.length,
      sampleProviderUrls: (pages || []).slice(0, 8).map((p) => p.url),
      queries: extras.queries || null,
    },
  };

  if (extras.debug) {
    // Dedupe by id for debug (keep best score / prefer higher)
    const debugById = new Map();
    for (const r of debugRows) {
      const prev = debugById.get(r.id);
      if (!prev || r.score > prev.score) debugById.set(r.id, r);
    }
    body.debug = {
      considered: [...debugById.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, 20)
        .map((r) => ({
          url: r.url,
          id: r.id,
          slug: r.slug,
          title: r.title,
          score: r.score,
          from: r.sourceUrl,
        })),
    };
  }

  return body;
}
