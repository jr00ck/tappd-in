/**
 * Cloudflare Worker — Untappd URL resolver for Tappd In (Perplexity Search).
 *
 * GET /resolve?brewery=Finback&beer=Something+Mosaic
 *
 * Secrets: PERPLEXITY_API_KEY
 * Soft limit: SEARCH_LIMITER (30/min/IP)
 *
 *   npx wrangler@latest deploy
 *   npx wrangler@latest secret put PERPLEXITY_API_KEY
 */

const PERPLEXITY_SEARCH = 'https://api.perplexity.ai/search';
const BEER_PATH_RE = /^\/b\/([a-z0-9-]+)\/(\d+)\/?$/i;

function corsHeaders(origin, allowedOrigin) {
  const defaults = [
    'https://jr00ck.github.io',
    'http://localhost:8099',
    'http://127.0.0.1:8099',
  ];
  const configured = !allowedOrigin || allowedOrigin === '*'
    ? ['*']
    : allowedOrigin.split(',').map((s) => s.trim()).filter(Boolean);
  const allowList = configured.includes('*') ? ['*'] : [...new Set([...configured, ...defaults])];

  let allow = allowList[0] || '*';
  if (allowList.includes('*')) allow = origin || '*';
  else if (origin && allowList.some((o) => origin === o || origin.startsWith(o))) allow = origin;

  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

function clientKey(request) {
  return request.headers.get('CF-Connecting-IP')
    || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || 'unknown';
}

function stripDiacritics(s) {
  return String(s || '').normalize('NFD').replace(/\p{M}/gu, '');
}

/** Normalize for fuzzy match / cache keys. */
function normalizeMatchText(s) {
  let t = stripDiacritics(s).toLowerCase();
  t = t.replace(/&/g, ' and ');
  t = t.replace(/\b(the|brewing|brewery|brew|co|company|llc|inc)\b/g, ' ');
  t = t.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t;
}

function tokenSet(s) {
  return new Set(normalizeMatchText(s).split(' ').filter((w) => w.length > 1));
}

function parseUntappdBeerUrl(input) {
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
  const m = BEER_PATH_RE.exec(url.pathname);
  if (!m) return null;
  return {
    slug: m[1].toLowerCase(),
    id: m[2],
    url: `https://untappd.com/b/${m[1].toLowerCase()}/${m[2]}`,
  };
}

/** Pull /b/slug/id links out of titles/snippets when the result URL itself isn't a beer page. */
function extractBeerUrlsFromText(...parts) {
  const text = parts.filter(Boolean).join(' ');
  const found = [];
  const re = /https?:\/\/(?:www\.)?untappd\.com\/b\/[a-z0-9-]+\/\d+/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const parsed = parseUntappdBeerUrl(m[0]);
    if (parsed) found.push(parsed);
  }
  return found;
}

function slugToWords(slug) {
  return normalizeMatchText(String(slug || '').replace(/-/g, ' '));
}

/** 0–1-ish score: query tokens vs slug (+ title bonus). */
function scoreCandidate(brewery, beer, parsed, title) {
  const query = normalizeMatchText(`${brewery} ${beer}`);
  const qTokens = [...tokenSet(query)];
  if (!qTokens.length) return 0;
  const slugWords = slugToWords(parsed.slug);
  const titleWords = normalizeMatchText(title || '');
  const hay = `${slugWords} ${titleWords}`;
  let hit = 0;
  for (const t of qTokens) {
    if (hay.split(' ').some((w) => w === t || w.startsWith(t) || t.startsWith(w))) hit += 1;
  }
  let score = hit / qTokens.length;
  if (slugWords.includes(normalizeMatchText(beer)) || normalizeMatchText(beer).includes(slugWords)) {
    score += 0.15;
  }
  if (slugWords.includes(normalizeMatchText(brewery).split(' ')[0] || '')) {
    score += 0.1;
  }
  return Math.min(score, 1.25);
}

function untappdSearchWebUrl(brewery, beer) {
  const q = [brewery, beer].map((s) => String(s || '').trim()).filter(Boolean).join(' ');
  const url = new URL('https://untappd.com/search');
  url.searchParams.set('q', q);
  url.searchParams.set('type', 'beer');
  return url.href;
}

/**
 * Provider adapter — swap this if Search API changes or we switch vendors.
 * @returns {Promise<Array<{ title: string, url: string, snippet?: string }>>}
 */
async function searchUntappdPages(apiKey, brewery, beer) {
  // Bias toward beer pages; domain filter still restricts to untappd.com
  const query = `${brewery} ${beer} site:untappd.com/b`.trim();
  const res = await fetch(PERPLEXITY_SEARCH, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      query,
      search_type: 'fast',
      max_results: 5,
      search_domain_filter: ['untappd.com'],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error('Perplexity Search API error');
    err.status = res.status;
    err.detail = detail.slice(0, 400);
    throw err;
  }
  const payload = await res.json();
  const results = Array.isArray(payload.results) ? payload.results : [];
  return results.map((r) => ({
    title: String(r.title || ''),
    url: String(r.url || ''),
    snippet: String(r.snippet || ''),
  }));
}

function buildResolveResponse(brewery, beer, pages) {
  const byUrl = new Map();
  const consider = (parsed, title) => {
    if (!parsed) return;
    const score = scoreCandidate(brewery, beer, parsed, title);
    const prev = byUrl.get(parsed.url);
    if (!prev || score > prev.score) {
      byUrl.set(parsed.url, {
        url: parsed.url,
        id: parsed.id,
        slug: parsed.slug,
        title: title || parsed.slug,
        score: Math.round(score * 1000) / 1000,
      });
    }
  };

  for (const page of pages) {
    consider(parseUntappdBeerUrl(page.url), page.title);
    for (const parsed of extractBeerUrlsFromText(page.title, page.snippet, page.url)) {
      consider(parsed, page.title);
    }
  }

  const scored = [...byUrl.values()].sort((a, b) => b.score - a.score);
  const best = scored[0] || null;
  const second = scored[1];
  const confident = !!(
    best
    && best.score >= 0.72
    && (!second || best.score - second.score >= 0.08 || best.score >= 0.9)
  );
  return {
    best,
    candidates: scored.slice(0, 5),
    confident,
    untappdSearchUrl: untappdSearchWebUrl(brewery, beer),
    query: { brewery, beer },
    // Diagnostic only — helps tune when candidates stay empty
    meta: {
      providerResults: pages.length,
      beerUrlsFound: scored.length,
      sampleProviderUrls: pages.slice(0, 5).map((p) => p.url),
    },
  };
}

export default {
  async fetch(request, env) {
    const headers = corsHeaders(
      request.headers.get('Origin') || '',
      env.ALLOWED_ORIGIN || '*'
    );

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== 'GET') {
      return json({ error: 'GET only' }, 405, headers);
    }

    const url = new URL(request.url);
    if (url.pathname !== '/' && !url.pathname.endsWith('/resolve')) {
      return json({
        error: 'Not found',
        hint: 'GET /resolve?brewery=…&beer=…',
      }, 404, headers);
    }

    const brewery = (url.searchParams.get('brewery') || '').trim();
    const beer = (url.searchParams.get('beer') || '').trim();
    if (!brewery || !beer) {
      return json({ error: 'Missing brewery or beer' }, 400, headers);
    }

    if (env.SEARCH_LIMITER) {
      const { success } = await env.SEARCH_LIMITER.limit({ key: clientKey(request) });
      if (!success) {
        return json({ error: 'Rate limit exceeded', hint: 'Try again in a minute.' }, 429, headers);
      }
    }

    const apiKey = env.PERPLEXITY_API_KEY;
    if (!apiKey) {
      return json({
        error: 'Missing PERPLEXITY_API_KEY',
        hint: 'npx wrangler@latest secret put PERPLEXITY_API_KEY',
      }, 500, headers);
    }

    try {
      const pages = await searchUntappdPages(apiKey, brewery, beer);
      const body = buildResolveResponse(brewery, beer, pages);
      return json(body, 200, headers);
    } catch (err) {
      return json({
        error: err.message || 'Resolve failed',
        status: err.status || 502,
        detail: err.detail || '',
      }, 502, headers);
    }
  },
};
