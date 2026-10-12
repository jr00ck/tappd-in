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
  // Keep single letters (e.g. "X" in "X-Raying …") — length>1 filter dropped them.
  return normalizeMatchText(s).split(' ').filter((w) => w.length > 1 || /^[a-z]$/.test(w));
}

/** Levenshtein for short OCR/typo soft-matches (e.g. racau → rakau). */
export function editDistance(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  if (s === t) return 0;
  const m = s.length;
  const n = t.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

export function tokensSoftMatch(a, b) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 4) return false;
  return editDistance(a, b) <= 1;
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

  const titleBeerTokens = titleBeer.split(' ').filter(Boolean);
  const beerHits = beerTokens.filter((t) =>
    slugTokenList.some((s) => tokensSoftMatch(s, t))
    || titleBeerTokens.some((s) => tokensSoftMatch(s, t))
  ).length;
  const beerCoverage = beerHits / beerTokens.length;

  // Extra tokens in slug/title-beer beyond brewery+beer (e.g. "double", "nothing")
  const expected = new Set([...brewTokens, ...beerTokens]);
  // "beer" appears in Untappd slugs as "…-beer-company-…" filler — not a look-alike token
  const noise = new Set(['ipa', 'dipa', 'neipa', 'ale', 'lager', 'stout', 'sour', 'hazy', 'beer']);
  const slugExtras = slugTokenList.filter((t) => !expected.has(t) && !noise.has(t) && t.length > 2);
  const titleExtras = titleBeer.split(' ').filter((t) => t && !expected.has(t) && !noise.has(t) && t.length > 2);

  let score = beerCoverage * 0.7;

  const beerPortion = beerPortionFromSlug(parsed.slug, brewery);
  const softPortion = beerPortionSoftEqual(beerPortion, beerNorm);
  const softTitle = beerPortionSoftEqual(titleBeer, beerNorm);

  // Exact beer portion of slug / title — "something mosaic" ≠ "double something mosaic"
  if (beerPortion === beerNorm || titleBeer === beerNorm) {
    score += 0.55;
  } else if (softPortion || softTitle) {
    score += 0.5; // OCR/typo near-exact (racau ≈ rakau)
  } else if (hasPhrase(titleBeer, beerNorm) && titleExtras.length === 0) {
    score += 0.35;
  }

  // Penalize look-alikes hard (extra words in beer portion / title)
  score -= slugExtras.length * 0.35;
  score -= titleExtras.length * 0.2;
  score -= (1 - beerCoverage) * 0.4;
  if (
    beerPortion
    && beerPortion !== beerNorm
    && !softPortion
    && beerNorm
    && beerPortion.includes(beerNorm)
  ) {
    score -= 0.4; // subset look-alike with prefixes like "double"
  }

  if (brewTokens.every((t) => slugWords.includes(t) || titleNorm.includes(t))) {
    score += 0.08;
  }

  return Math.max(0, Math.min(score, 1.35));
}

/** Slug filler after brewery name in Untappd paths (…-beer-company-…). */
const SLUG_FILLER = new Set(['beer', 'brewing', 'brewery', 'brew', 'co', 'company', 'llc', 'inc']);

/** Beer tokens in slug after stripping brewery + filler + trailing numeric variants. */
export function beerPortionFromSlug(slug, brewery) {
  const brewTokens = new Set(tokenList(brewery));
  let parts = slugToWords(slug).split(' ').filter(Boolean);
  while (parts.length && (brewTokens.has(parts[0]) || SLUG_FILLER.has(parts[0]))) {
    parts.shift();
  }
  while (parts.length && /^\d+$/.test(parts[parts.length - 1])) parts.pop();
  return parts.join(' ');
}

/** Token-wise soft equality (edit distance ≤1 on tokens length ≥4). */
export function beerPortionSoftEqual(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const ta = a.split(' ').filter(Boolean);
  const tb = b.split(' ').filter(Boolean);
  if (ta.length !== tb.length) return false;
  return ta.every((tok, i) => tokensSoftMatch(tok, tb[i]));
}

export function isConfident(best, second, beer, brewery) {
  if (!best || best.score < 0.72) return false;
  // Exact / soft beer portion of slug (not a look-alike like "double something mosaic")
  if (beer && brewery) {
    const portion = beerPortionFromSlug(best.slug, brewery);
    const beerNorm = normalizeMatchText(beer);
    if ((portion === beerNorm || beerPortionSoftEqual(portion, beerNorm)) && best.score >= 0.72) {
      return true;
    }
  }
  if (!second) return true;
  return best.score - second.score >= 0.08 || best.score >= 0.95;
}

/** One strong query per beer — used when batching up to 5 beers in one Search call. */
export function buildBatchQuery(brewery, beer) {
  const b = String(brewery || '').trim();
  const beerName = String(beer || '').trim();
  // Unquoted — quoted OCR typos (racau) over-constrain the provider.
  return `${b} ${beerName} untappd`;
}

/** Preserve Perplexity multi-query grouping: results[i] ↔ queries[i]. */
export function groupProviderResults(payload) {
  const r = payload && payload.results;
  if (!Array.isArray(r)) return [];
  if (r.length && Array.isArray(r[0])) return r.map((g) => (Array.isArray(g) ? g : []));
  if (r.length && r[0] && typeof r[0] === 'object' && Array.isArray(r[0].results)) {
    return r.map((g) => g.results || []);
  }
  return [r];
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
    const slugParts = slug.split(' ').filter(Boolean);
    if (brewTokens.length && !brewTokens.some((t) => slug.includes(t) || normalizeMatchText(c.title).includes(t))) {
      return false;
    }
    if (!beerTokens.length) return true;
    const hits = beerTokens.filter((t) => slugParts.some((s) => tokensSoftMatch(s, t))).length;
    return hits >= 1 && hits / beerTokens.length >= 0.5;
  });

  scored = scored.filter((c) => c.score > 0);
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
