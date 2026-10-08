/**
 * Optional Cloudflare Worker — Untappd beer search proxy for Tappd In.
 *
 * Why this exists:
 * - Untappd’s official `/v4/search/beer` is the permitted way to resolve beers.
 * - It needs an approved app’s client_id + client_secret (not user OAuth).
 * - api.untappd.com does not send browser CORS headers, so a static GitHub Pages
 *   PWA cannot call it directly.
 *
 * Deploy (Cloudflare):
 *   1. Create a Worker, paste this file.
 *   2. Set secrets: UNTAPPD_CLIENT_ID, UNTAPPD_CLIENT_SECRET
 *      (register at https://untappd.com/api — approval is not guaranteed/instant).
 *   3. Optionally set ALLOWED_ORIGIN to https://jr00ck.github.io
 *   4. Put the Worker URL (…/search) into Tappd In → Settings → Search proxy URL.
 *
 * This worker does NOT scrape untappd.com HTML. It only forwards the official API.
 */

const UNTAPPD_SEARCH = 'https://api.untappd.com/v4/search/beer';

function corsHeaders(origin, allowedOrigin) {
  const allow = !allowedOrigin || allowedOrigin === '*'
    ? (origin || '*')
    : (origin && origin.startsWith(allowedOrigin) ? origin : allowedOrigin);
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
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
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
    // Accept /search or bare worker URL with ?q=
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

    const clientId = env.UNTAPPD_CLIENT_ID;
    const clientSecret = env.UNTAPPD_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return json({
        error: 'Server missing UNTAPPD_CLIENT_ID / UNTAPPD_CLIENT_SECRET',
      }, 500, headers);
    }

    const limit = Math.min(parseInt(url.searchParams.get('limit') || '10', 10) || 10, 50);
    const apiUrl = new URL(UNTAPPD_SEARCH);
    apiUrl.searchParams.set('q', q);
    apiUrl.searchParams.set('limit', String(limit));
    apiUrl.searchParams.set('client_id', clientId);
    apiUrl.searchParams.set('client_secret', clientSecret);

    const upstream = await fetch(apiUrl.href, {
      headers: { Accept: 'application/json', 'User-Agent': 'tappd-in-proxy/0.1' },
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return json({
        error: 'Untappd API error',
        status: upstream.status,
        detail: text.slice(0, 500),
      }, 502, headers);
    }

    const payload = await upstream.json();
    const items = (((payload || {}).response || {}).beers || {}).items || [];
    const beers = items.map((row) => {
      const beer = row.beer || {};
      const brewery = row.brewery || beer.brewery || {};
      return {
        bid: beer.bid,
        beer_slug: beer.beer_slug,
        beer_name: beer.beer_name,
        beer_style: beer.beer_style,
        beer_abv: beer.beer_abv,
        brewery: { brewery_name: brewery.brewery_name },
      };
    }).filter((b) => b.bid != null && b.beer_slug);

    return json({ beers, query: q }, 200, headers);
  },
};
