/**
 * Cloudflare Worker — Catalog.beer search proxy for Tappd In.
 *
 * Why: api.catalog.beer does not send browser CORS headers, so a GitHub Pages
 * PWA cannot call it directly. This worker forwards search and adds CORS.
 *
 * Deploy:
 *   1. Create a Worker, paste this file.
 *   2. Optional secret: CATALOG_BEER_API_KEY (friends can use the PWA on your quota).
 *      Or omit it and have the PWA send Authorization: Basic … from on-device Settings.
 *   3. Optional: ALLOWED_ORIGIN=https://jr00ck.github.io
 *   4. PWA Settings → Catalog.beer proxy URL = https://<worker>/search
 *
 * GET /search?q=Brewery+Beer&count=10
 */

const CATALOG_SEARCH = 'https://api.catalog.beer/beer/search';

function corsHeaders(origin, allowedOrigin) {
  const allow = !allowedOrigin || allowedOrigin === '*'
    ? (origin || '*')
    : (origin && origin.startsWith(allowedOrigin) ? origin : allowedOrigin);
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}

function basicAuthHeader(apiKey) {
  // Catalog.beer: API key as username, empty password.
  const token = btoa(`${apiKey}:`);
  return `Basic ${token}`;
}

export default {
  async fetch(request, env) {
    const allowedOrigin = env.ALLOWED_ORIGIN || '*';
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin, allowedOrigin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== 'GET') {
      return json({ error: 'GET only' }, 405, headers);
    }

    const url = new URL(request.url);
    if (url.pathname !== '/' && !url.pathname.endsWith('/search')) {
      return json({
        error: 'Not found',
        hint: 'GET /search?q=Brewery+Beer+Name',
      }, 404, headers);
    }

    const q = (url.searchParams.get('q') || '').trim();
    if (!q) {
      return json({ error: 'Missing q' }, 400, headers);
    }

    const count = Math.min(parseInt(url.searchParams.get('count') || '10', 10) || 10, 100);

    const incomingAuth = request.headers.get('Authorization') || '';
    let auth = incomingAuth;
    if (!auth && env.CATALOG_BEER_API_KEY) {
      auth = basicAuthHeader(env.CATALOG_BEER_API_KEY);
    }
    if (!auth) {
      return json({
        error: 'Missing credentials',
        hint: 'Set CATALOG_BEER_API_KEY on the worker, or send Authorization: Basic from the PWA',
      }, 401, headers);
    }

    const apiUrl = new URL(CATALOG_SEARCH);
    apiUrl.searchParams.set('q', q);
    apiUrl.searchParams.set('count', String(count));

    const upstream = await fetch(apiUrl.href, {
      headers: {
        Accept: 'application/json',
        Authorization: auth,
        'User-Agent': 'tappd-in-catalog-proxy/0.3',
      },
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return json({
        error: 'Catalog.beer API error',
        status: upstream.status,
        detail: text.slice(0, 500),
      }, 502, headers);
    }

    const payload = await upstream.json();
    const data = Array.isArray(payload.data) ? payload.data : [];

    // Compact shape for the PWA (full objects still available under `raw` if needed).
    const beers = data.map((beer) => ({
      id: beer.id,
      name: beer.name,
      style: beer.style,
      abv: beer.abv,
      ibu: beer.ibu,
      match: beer.match,
      description: beer.description || '',
      brewer: beer.brewer
        ? { id: beer.brewer.id, name: beer.brewer.name }
        : null,
      catalogUrl: beer.id ? `https://catalog.beer/beer/${beer.id}` : null,
    }));

    return json({
      beers,
      query: q,
      has_more: !!payload.has_more,
    }, 200, headers);
  },
};
