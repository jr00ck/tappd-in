/**
 * Cloudflare Worker — Untappd URL resolver for Tappd In.
 *
 * Primary: Untappd’s public Algolia beer search (same as untappd.com/search).
 * Fallback: Perplexity Search for typos / messy OCR when Algolia isn’t confident.
 *
 * GET  /resolve?brewery=…&beer=…[&debug=1]
 * POST /resolve-batch  { items: [{ brewery, beer }], debug? }
 *
 * Secrets: PERPLEXITY_API_KEY
 * Soft limit: SEARCH_LIMITER (30/min/IP)
 *
 *   npx wrangler@latest deploy
 *   npx wrangler@latest secret put PERPLEXITY_API_KEY
 */

import {
  UNTAPPD_ALGOLIA,
  applyUntappdSearchHits,
  buildBatchQuery,
  buildQueryVariants,
  buildResolveResponse,
  flattenProviderResults,
  groupProviderResults,
  isConfident,
  parseUntappdSearchConfig,
} from './resolve-core.js';

const PERPLEXITY_SEARCH = 'https://api.perplexity.ai/search';
const BATCH_MAX = 20;
const CHUNK = 5;
const ALGOLIA_CREDS_TTL_MS = 6 * 60 * 60 * 1000;

/** In-isolate cache of Untappd’s public Algolia search-only credentials. */
let algoliaCreds = { ...UNTAPPD_ALGOLIA, fetchedAt: 0 };

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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

function mapPages(rows) {
  return (rows || []).map((r) => ({
    title: String(r.title || ''),
    url: String(r.url || ''),
    snippet: String(r.snippet || ''),
  }));
}

/**
 * Provider adapter — one HTTP request to Perplexity Search.
 * Multi-query array is billed as one Search request (rate-limit counts each query).
 * Pass domainFilter: null to skip the filter (last-resort for brand-new beers).
 */
async function perplexitySearch(apiKey, { queries, searchType, maxResults, domainFilter }) {
  const body = {
    query: queries.length === 1 ? queries[0] : queries,
    search_type: searchType,
    max_results: maxResults,
  };
  if (domainFilter !== null) {
    body.search_domain_filter = domainFilter || ['untappd.com/b'];
  }
  const res = await fetch(PERPLEXITY_SEARCH, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error('Perplexity Search API error');
    err.status = res.status;
    err.detail = detail.slice(0, 400);
    throw err;
  }
  return res.json();
}

async function perplexityPages(apiKey, opts) {
  const payload = await perplexitySearch(apiKey, opts);
  return mapPages(flattenProviderResults(payload));
}

async function perplexityGrouped(apiKey, opts) {
  const payload = await perplexitySearch(apiKey, opts);
  return groupProviderResults(payload).map(mapPages);
}

async function resolveWithPasses(apiKey, brewery, beer, debug) {
  let providerCalls = 0;
  let pass = 'untappd_search';
  const q = `${brewery} ${beer}`.trim();
  let allQueries = [`untappd-algolia:${q}`];

  // 1) Untappd’s own search first (fresh beers, exact /b links).
  const hits = await algoliaBeerSearch(q, { hitsPerPage: 8 });
  let body = applyUntappdSearchHits(
    buildResolveResponse(brewery, beer, [], {
      pass,
      providerCalls,
      queries: allQueries,
      debug,
    }),
    brewery,
    beer,
    hits,
    { pass, providerCalls }
  );

  if (body.confident) {
    body.pass = pass;
    body.providerCalls = providerCalls;
    return body;
  }

  // 2) Perplexity fallback for typos / OCR noise Algolia didn’t nail.
  const queries = buildQueryVariants(brewery, beer);
  allQueries = [...allQueries, ...queries];
  pass = 'fast_multi';
  providerCalls += 1;
  let pages = await perplexityPages(apiKey, {
    queries,
    searchType: 'fast',
    maxResults: 20,
  });
  const afterFast = buildResolveResponse(brewery, beer, pages, {
    pass,
    providerCalls,
    queries: allQueries,
    debug,
  });
  body = mergeResolveBodies(body, afterFast, pass, providerCalls, brewery, beer);

  if (!body.confident) {
    pass = 'web_multi';
    providerCalls += 1;
    const more = await perplexityPages(apiKey, {
      queries,
      searchType: 'web',
      maxResults: 20,
    });
    pages = [...pages, ...more];
    const afterWeb = buildResolveResponse(brewery, beer, pages, {
      pass,
      providerCalls,
      queries: allQueries,
      debug,
    });
    body = mergeResolveBodies(body, afterWeb, pass, providerCalls, brewery, beer);
  }

  body.pass = pass;
  body.providerCalls = providerCalls;
  return body;
}

/** Prefer higher-scoring candidates when merging Algolia + Perplexity passes. */
function mergeResolveBodies(prev, next, pass, providerCalls, brewery, beer) {
  const byId = new Map();
  for (const c of prev.candidates || []) byId.set(c.id, c);
  for (const c of next.candidates || []) {
    const older = byId.get(c.id);
    if (!older || c.score > older.score) byId.set(c.id, c);
  }
  const merged = [...byId.values()].sort((a, b) => b.score - a.score || a.slug.length - b.slug.length);
  const best = merged[0] || next.best || prev.best || null;
  const second = merged[1];
  return {
    ...next,
    best,
    candidates: merged.slice(0, 5),
    confident: isConfident(best, second, beer, brewery) || next.confident || prev.confident,
    pass,
    providerCalls,
    meta: {
      ...(prev.meta || {}),
      ...(next.meta || {}),
    },
    untappdSearchUrl: next.untappdSearchUrl || prev.untappdSearchUrl,
  };
}

/** Pull current public Algolia keys from Untappd’s search page (visitor path). */
async function refreshAlgoliaCredsFromSite() {
  try {
    const res = await fetch('https://untappd.com/search?q=tappd&type=beer', {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'tappd-in-resolve/0.9.4',
      },
    });
    if (!res.ok) return null;
    const cfg = parseUntappdSearchConfig(await res.text());
    if (!cfg) return null;
    algoliaCreds = { ...cfg, fetchedAt: Date.now() };
    return algoliaCreds;
  } catch {
    return null;
  }
}

async function getAlgoliaCreds({ force = false } = {}) {
  // Seed keys work until Untappd rotates them. Refresh on force (401/403) or
  // after a successful page fetch ages past TTL — never block the first query
  // on an HTML scrape.
  const stale = algoliaCreds.fetchedAt > 0
    && (Date.now() - algoliaCreds.fetchedAt) > ALGOLIA_CREDS_TTL_MS;
  if (force || stale) {
    const fresh = await refreshAlgoliaCredsFromSite();
    if (fresh) return fresh;
  }
  return algoliaCreds;
}

async function algoliaQueryOnce(creds, query, hitsPerPage) {
  const endpoint = `https://${creds.appId}-dsn.algolia.net/1/indexes/${creds.index || 'beer'}/query`;
  const params = new URLSearchParams({
    query,
    hitsPerPage: String(hitsPerPage),
  });
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      'X-Algolia-Application-Id': creds.appId,
      'X-Algolia-API-Key': creds.searchKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ params: params.toString() }),
  });
}

/** Same public Algolia search Untappd.com uses; refreshes keys if they rotate. */
async function algoliaBeerSearch(query, { hitsPerPage = 8 } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  try {
    let creds = await getAlgoliaCreds();
    let res = await algoliaQueryOnce(creds, q, hitsPerPage);
    if (res.status === 401 || res.status === 403) {
      const fresh = await getAlgoliaCreds({ force: true });
      if (fresh && (fresh.searchKey !== creds.searchKey || fresh.appId !== creds.appId)) {
        creds = fresh;
        res = await algoliaQueryOnce(creds, q, hitsPerPage);
      } else if (fresh) {
        // Same seed still; force-fetched page may have updated in-place.
        creds = fresh;
        res = await algoliaQueryOnce(creds, q, hitsPerPage);
      }
    }
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.hits) ? data.hits : [];
  } catch {
    return [];
  }
}

/**
 * Batch: Algolia first per beer, then Perplexity for remaining misses
 * (≤5 beers per billed Search call).
 */
async function resolveBatch(apiKey, items, debug) {
  // Single beer: full Algolia → Perplexity path.
  if (items.length === 1) {
    const body = await resolveWithPasses(apiKey, items[0].brewery, items[0].beer, debug);
    return {
      results: [{ brewery: items[0].brewery, beer: items[0].beer, ...body }],
      providerCalls: body.providerCalls || 0,
      pass: 'single',
    };
  }

  let providerCalls = 0;
  const results = items.map((item) => ({
    brewery: item.brewery,
    beer: item.beer,
    body: null,
    pages: [],
  }));

  // 1) Untappd Algolia for every beer (cheap, exact).
  for (let idx = 0; idx < items.length; idx += 1) {
    const q = `${items[idx].brewery} ${items[idx].beer}`.trim();
    const hits = await algoliaBeerSearch(q, { hitsPerPage: 8 });
    results[idx].body = applyUntappdSearchHits(
      buildResolveResponse(items[idx].brewery, items[idx].beer, [], {
        pass: 'untappd_search',
        providerCalls,
        debug,
      }),
      items[idx].brewery,
      items[idx].beer,
      hits,
      { pass: 'untappd_search', providerCalls }
    );
  }

  async function runChunked(indices, searchType) {
    for (let i = 0; i < indices.length; i += CHUNK) {
      const slice = indices.slice(i, i + CHUNK);
      const queries = slice.map((idx) => buildBatchQuery(items[idx].brewery, items[idx].beer));
      providerCalls += 1;
      const groups = await perplexityGrouped(apiKey, {
        queries,
        searchType,
        maxResults: 15,
      });
      const flatShare = groups.length === 1 && slice.length > 1 ? groups[0] : null;
      slice.forEach((idx, j) => {
        const pages = flatShare || groups[j] || [];
        results[idx].pages = [...results[idx].pages, ...pages];
        const next = buildResolveResponse(items[idx].brewery, items[idx].beer, results[idx].pages, {
          pass: searchType === 'fast' ? 'batch_fast' : 'batch_web',
          providerCalls,
          queries,
          debug,
        });
        results[idx].body = mergeResolveBodies(
          results[idx].body || { candidates: [] },
          next,
          next.pass,
          providerCalls,
          items[idx].brewery,
          items[idx].beer
        );
      });
    }
  }

  // 2) Perplexity only for beers Algolia didn’t resolve confidently.
  const needFast = results
    .map((r, i) => (r.body && !r.body.confident ? i : -1))
    .filter((i) => i >= 0);
  if (needFast.length) {
    await runChunked(needFast, 'fast');
  }

  const needWeb = results
    .map((r, i) => (r.body && !r.body.confident ? i : -1))
    .filter((i) => i >= 0);
  if (needWeb.length) {
    await runChunked(needWeb, 'web');
  }

  // Empty-candidate misses — full multi-variant (Algolia already tried; helps OCR).
  const needVariant = results
    .map((r, i) => {
      if (!r.body || r.body.confident) return -1;
      if ((r.body.candidates || []).length) return -1;
      return i;
    })
    .filter((i) => i >= 0);
  for (const idx of needVariant) {
    const body = await resolveWithPasses(apiKey, items[idx].brewery, items[idx].beer, debug);
    providerCalls += body.providerCalls || 0;
    results[idx].body = body;
    results[idx].pages = [];
  }

  return {
    results: results.map((r) => {
      const body = r.body || { confident: false, best: null, candidates: [] };
      body.providerCalls = providerCalls;
      body.pass = body.pass || 'batch';
      return {
        brewery: r.brewery,
        beer: r.beer,
        ...body,
      };
    }),
    providerCalls,
    pass: 'batch',
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

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';
    const isResolve = path === '/' || path.endsWith('/resolve');
    const isBatch = path.endsWith('/resolve-batch');

    if (!isResolve && !isBatch) {
      return json({
        error: 'Not found',
        hint: 'GET /resolve?brewery=…&beer=… or POST /resolve-batch',
      }, 404, headers);
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
      if (isBatch) {
        if (request.method !== 'POST') {
          return json({ error: 'POST only', hint: 'POST /resolve-batch with JSON body' }, 405, headers);
        }
        const payload = await request.json().catch(() => null);
        const rawItems = Array.isArray(payload?.items) ? payload.items : [];
        const items = rawItems
          .map((it) => ({
            brewery: String(it?.brewery || '').trim(),
            beer: String(it?.beer || '').trim(),
          }))
          .filter((it) => it.brewery && it.beer)
          .slice(0, BATCH_MAX);
        if (!items.length) {
          return json({ error: 'Missing items', hint: '{ "items": [{ "brewery", "beer" }] }' }, 400, headers);
        }
        const debug = !!payload?.debug;
        const body = await resolveBatch(apiKey, items, debug);
        return json(body, 200, headers);
      }

      if (request.method !== 'GET') {
        return json({ error: 'GET only for /resolve' }, 405, headers);
      }

      const brewery = (url.searchParams.get('brewery') || '').trim();
      const beer = (url.searchParams.get('beer') || '').trim();
      const debug = url.searchParams.get('debug') === '1';
      if (!brewery || !beer) {
        return json({ error: 'Missing brewery or beer' }, 400, headers);
      }

      const body = await resolveWithPasses(apiKey, brewery, beer, debug);
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
