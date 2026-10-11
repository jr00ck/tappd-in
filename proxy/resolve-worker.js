/**
 * Cloudflare Worker — Untappd URL resolver for Tappd In (Perplexity Search).
 *
 * GET /resolve?brewery=Finback&beer=Something+Mosaic
 * GET /resolve?...&debug=1  → include considered URLs + scores
 *
 * Secrets: PERPLEXITY_API_KEY
 * Soft limit: SEARCH_LIMITER (30/min/IP)
 *
 *   npx wrangler@latest deploy
 *   npx wrangler@latest secret put PERPLEXITY_API_KEY
 */

import {
  buildQueryVariants,
  buildResolveResponse,
  flattenProviderResults,
} from './resolve-core.js';

const PERPLEXITY_SEARCH = 'https://api.perplexity.ai/search';

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
  const payload = await res.json();
  const flat = flattenProviderResults(payload);
  return flat.map((r) => ({
    title: String(r.title || ''),
    url: String(r.url || ''),
    snippet: String(r.snippet || ''),
  }));
}

async function resolveWithPasses(apiKey, brewery, beer, debug) {
  const queries = buildQueryVariants(brewery, beer);
  let providerCalls = 0;
  let pass = 'fast_multi';

  // Pass 1: multi-query, search_type fast (cheaper / lower latency).
  // max_results is a TOTAL budget split across queries — use API max (20).
  providerCalls += 1;
  let pages = await perplexitySearch(apiKey, {
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

  // Pass 2: only if needed — multi-query with search_type web; merge with pass 1
  if (!body.confident) {
    pass = 'web_multi';
    providerCalls += 1;
    const more = await perplexitySearch(apiKey, {
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
        hint: 'GET /resolve?brewery=…&beer=…[&debug=1]',
      }, 404, headers);
    }

    const brewery = (url.searchParams.get('brewery') || '').trim();
    const beer = (url.searchParams.get('beer') || '').trim();
    const debug = url.searchParams.get('debug') === '1';
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
