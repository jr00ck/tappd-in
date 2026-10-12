/**
 * Cloudflare Worker — Untappd URL resolver for Tappd In (Perplexity Search).
 *
 * GET  /resolve?brewery=…&beer=…[&debug=1]
 * POST /resolve-batch  { items: [{ brewery, beer }], debug? }
 *   → up to 5 beers per Search call (1 billed request), then web pass for misses
 *
 * Secrets: PERPLEXITY_API_KEY
 * Soft limit: SEARCH_LIMITER (30/min/IP)
 *
 *   npx wrangler@latest deploy
 *   npx wrangler@latest secret put PERPLEXITY_API_KEY
 */

import {
  buildBatchQuery,
  buildQueryVariants,
  buildResolveResponse,
  flattenProviderResults,
  groupProviderResults,
} from './resolve-core.js';

const PERPLEXITY_SEARCH = 'https://api.perplexity.ai/search';
const BATCH_MAX = 20;
const CHUNK = 5;

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
 */
async function perplexitySearch(apiKey, { queries, searchType, maxResults }) {
  const res = await fetch(PERPLEXITY_SEARCH, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      query: queries.length === 1 ? queries[0] : queries,
      search_type: searchType,
      max_results: maxResults,
      search_domain_filter: ['untappd.com/b'],
    }),
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
  const queries = buildQueryVariants(brewery, beer);
  let providerCalls = 0;
  let pass = 'fast_multi';

  providerCalls += 1;
  let pages = await perplexityPages(apiKey, {
    queries,
    searchType: 'fast',
    maxResults: 20,
  });
  let body = buildResolveResponse(brewery, beer, pages, {
    pass,
    providerCalls,
    queries,
    debug,
  });

  if (!body.confident) {
    pass = 'web_multi';
    providerCalls += 1;
    const more = await perplexityPages(apiKey, {
      queries,
      searchType: 'web',
      maxResults: 20,
    });
    pages = [...pages, ...more];
    body = buildResolveResponse(brewery, beer, pages, {
      pass,
      providerCalls,
      queries,
      debug,
    });
  }

  body.pass = pass;
  body.providerCalls = providerCalls;
  return body;
}

/**
 * Batch: 1 query per beer, ≤5 beers per billed Search call.
 * Unconfident items get a second web chunk pass (still batched).
 * Still-unconfident fall back to full multi-variant resolve (≤2 calls each).
 */
async function resolveBatch(apiKey, items, debug) {
  // Single beer: full multi-variant path (best hit-rate). Batching shines at 2+.
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

  async function runChunked(indices, searchType) {
    for (let i = 0; i < indices.length; i += CHUNK) {
      const slice = indices.slice(i, i + CHUNK);
      const queries = slice.map((idx) => buildBatchQuery(items[idx].brewery, items[idx].beer));
      providerCalls += 1;
      // Merge all hits from the multi-query call; per-beer scoring + brewery
      // filters keep matches separated (more reliable than depending on group shape).
      const pages = await perplexityPages(apiKey, {
        queries,
        searchType,
        maxResults: 20,
      });
      slice.forEach((idx) => {
        results[idx].pages = [...results[idx].pages, ...pages];
        results[idx].body = buildResolveResponse(items[idx].brewery, items[idx].beer, results[idx].pages, {
          pass: searchType === 'fast' ? 'batch_fast' : 'batch_web',
          providerCalls,
          queries,
          debug,
        });
      });
    }
  }

  const allIdx = items.map((_, i) => i);
  await runChunked(allIdx, 'fast');

  const needWeb = results
    .map((r, i) => (r.body && !r.body.confident ? i : -1))
    .filter((i) => i >= 0);
  if (needWeb.length) {
    await runChunked(needWeb, 'web');
  }

  // No per-beer multi-variant fallback here — that would defeat batching.
  // Unconfident rows surface candidates + Untappd search in the PWA.

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
