/**
 * Cloudflare Worker — Catalog.beer search proxy for Tappd In.
 *
 * Why: api.catalog.beer does not send browser CORS headers, so a GitHub Pages
 * PWA cannot call it directly. This worker forwards search and adds CORS.
 *
 * Search strategy (brewery-first — Catalog's recommended flow):
 *   GET /search?brewery=Mortalis&beer=Strange+Philosophies
 *   1) /brewer/search → pick best brewery
 *   2) /brewer/{id}/beer → rank by beer name
 *   Fallback: /beer/search?q=… then re-rank by brewery + beer tokens
 *
 * MVP protection (see proxy/README.md):
 *   - CATALOG_BEER_API_KEY Worker secret
 *   - SEARCH_LIMITER (Workers Rate Limiting) — deploy with wrangler@latest
 *
 *   npx wrangler@latest deploy
 *   npx wrangler@latest secret put CATALOG_BEER_API_KEY
 *
 * GET /search?brewery=…&beer=…&count=10
 * GET /search?q=…&count=10
 */

const CATALOG_BEER_SEARCH = 'https://api.catalog.beer/beer/search';
const CATALOG_BREWER_SEARCH = 'https://api.catalog.beer/brewer/search';

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
  if (allowList.includes('*')) {
    allow = origin || '*';
  } else if (origin && allowList.some((o) => origin === o || origin.startsWith(o))) {
    allow = origin;
  }

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
  return `Basic ${btoa(`${apiKey}:`)}`;
}

function clientKey(request) {
  return request.headers.get('CF-Connecting-IP')
    || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || 'unknown';
}

function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenSet(s) {
  return new Set(normalizeName(s).split(/\s+/).filter((t) => t.length > 1));
}

/** 0–3-ish: token overlap + substring / exact bonus. */
function nameScore(query, candidate) {
  const qn = normalizeName(query);
  const cn = normalizeName(candidate);
  if (!qn || !cn) return 0;
  if (qn === cn) return 3;
  const qTokens = tokenSet(query);
  if (!qTokens.size) return 0;
  let hit = 0;
  for (const t of qTokens) {
    if (cn.split(/\s+/).some((w) => w === t || w.startsWith(t) || t.startsWith(w))) hit += 1;
  }
  let score = hit / qTokens.size;
  if (cn.includes(qn) || qn.includes(cn)) score += 1;
  return score;
}

const MATCH_WEIGHT = { exact: 4, all_terms: 3, partial: 2, description: 0.5 };

function brewerRank(query, brewer) {
  const matchBoost = MATCH_WEIGHT[brewer.match] || 1;
  return nameScore(query, brewer.name) * 2 + matchBoost;
}

function beerRank(beerQuery, breweryQuery, beer) {
  const beerPart = beerQuery ? nameScore(beerQuery, beer.name) * 3 : 0;
  const breweryPart = breweryQuery
    ? nameScore(breweryQuery, beer.brewer?.name || '') * 2
    : 0;
  const matchBoost = MATCH_WEIGHT[beer.match] || 0;
  return beerPart + breweryPart + matchBoost * 0.25;
}

function compactBeer(beer) {
  return {
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
  };
}

async function catalogGet(url, auth) {
  const upstream = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: auth,
      'User-Agent': 'tappd-in-catalog-proxy/0.4',
    },
  });
  if (!upstream.ok) {
    const text = await upstream.text();
    const err = new Error('Catalog.beer API error');
    err.status = upstream.status;
    err.detail = text.slice(0, 500);
    throw err;
  }
  return upstream.json();
}

async function searchBrewers(auth, brewery, count) {
  const apiUrl = new URL(CATALOG_BREWER_SEARCH);
  apiUrl.searchParams.set('q', brewery);
  apiUrl.searchParams.set('count', String(Math.min(count, 25)));
  const payload = await catalogGet(apiUrl.href, auth);
  const data = Array.isArray(payload.data) ? payload.data : [];
  const ranked = data
    .map((b) => ({ ...b, _score: brewerRank(brewery, b) }))
    .sort((a, b) => b._score - a._score);
  // Catalog `description` matches are not brewery identity — never pick them.
  // Require a name-level match (exact / all_terms / partial) plus token score.
  return ranked.filter(
    (b) => (b.match === 'exact' || b.match === 'all_terms' || b.match === 'partial')
      && b._score >= 0.5
  );
}

async function listBrewerBeers(auth, brewerId, maxPages = 3) {
  const beers = [];
  let cursor = '';
  for (let page = 0; page < maxPages; page += 1) {
    const apiUrl = new URL(`https://api.catalog.beer/brewer/${brewerId}/beer`);
    apiUrl.searchParams.set('count', '100');
    if (cursor) apiUrl.searchParams.set('cursor', cursor);
    const payload = await catalogGet(apiUrl.href, auth);
    const data = Array.isArray(payload.data) ? payload.data : [];
    for (const row of data) {
      beers.push({
        ...row,
        brewer: row.brewer || undefined,
      });
    }
    if (!payload.has_more || !payload.next_cursor) break;
    cursor = payload.next_cursor;
  }
  return beers;
}

async function searchBeersFallback(auth, q, count) {
  const apiUrl = new URL(CATALOG_BEER_SEARCH);
  apiUrl.searchParams.set('q', q);
  apiUrl.searchParams.set('count', String(Math.min(Math.max(count * 5, 25), 100)));
  const payload = await catalogGet(apiUrl.href, auth);
  return Array.isArray(payload.data) ? payload.data : [];
}

async function smartSearch(auth, { brewery, beer, q, count }) {
  const strategy = {
    mode: 'beer_search',
    breweryId: null,
    breweryName: null,
    brewerCandidates: [],
  };

  // Catalog's recommended flow: resolve brewery, then search within its beers.
  // Do NOT fall through to global /beer/search after a brewery hit — that is how
  // "Strange Philosophies" becomes a pile of unrelated "Strange" beers.
  if (brewery) {
    const brewers = await searchBrewers(auth, brewery, 10);
    strategy.brewerCandidates = brewers.slice(0, 5).map((b) => ({
      id: b.id,
      name: b.name,
      match: b.match,
      score: Math.round((b._score || 0) * 100) / 100,
    }));
    const best = brewers[0];
    if (best?.id) {
      strategy.mode = 'brewer_beers';
      strategy.breweryId = best.id;
      strategy.breweryName = best.name;

      let beers = await listBrewerBeers(auth, best.id);
      beers = beers.map((b) => ({
        ...b,
        brewer: b.brewer || { id: best.id, name: best.name },
      }));

      if (beer) {
        beers = beers
          .map((b) => ({ ...b, _score: beerRank(beer, '', b) }))
          .sort((a, b) => b._score - a._score);
        const strong = beers.filter((b) => b._score >= 1);
        if (strong.length) {
          beers = strong;
          strategy.beerFilter = 'strong_name_match';
        } else {
          // Keep closest names from this brewery only (never jump to other breweries).
          strategy.beerFilter = 'best_effort_within_brewery';
        }
      } else {
        strategy.beerFilter = 'all_from_brewery';
      }

      return {
        beers: beers.slice(0, count).map(compactBeer),
        strategy,
        query: { brewery, beer, q },
        has_more: false,
      };
    }
    strategy.mode = 'beer_search_brewery_unresolved';
  }

  // No brewery field, or brewery not in Catalog — global beer search.
  const fallbackQ = beer || q || brewery;
  if (!fallbackQ) {
    return { beers: [], strategy, query: { brewery, beer, q }, has_more: false };
  }

  let beers = await searchBeersFallback(auth, fallbackQ, count);
  const beerQuery = beer || fallbackQ;
  beers = beers
    .map((b) => ({ ...b, _score: beerRank(beerQuery, brewery, b) }))
    .sort((a, b) => b._score - a._score);

  // Multi-word beer names: drop weak single-token hits ("Strange" ≠ "Strange Philosophies").
  const beerTokens = tokenSet(beerQuery);
  if (beerTokens.size >= 2) {
    beers = beers.filter((b) => nameScore(beerQuery, b.name) >= 1);
  }

  if (brewery) {
    beers = beers.filter((b) => nameScore(brewery, b.brewer?.name || '') >= 0.5);
    strategy.beerFilter = beers.length ? 'global_filtered_by_brewery' : 'global_no_brewery_match';
  } else {
    strategy.beerFilter = 'global_beer_search';
  }

  return {
    beers: beers.slice(0, count).map(compactBeer),
    strategy,
    query: { brewery, beer, q },
    has_more: false,
  };
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
        hint: 'GET /search?brewery=…&beer=…  or  /search?q=…',
      }, 404, headers);
    }

    const brewery = (url.searchParams.get('brewery') || '').trim();
    const beer = (url.searchParams.get('beer') || '').trim();
    const q = (url.searchParams.get('q') || '').trim();
    if (!brewery && !beer && !q) {
      return json({ error: 'Missing brewery, beer, or q' }, 400, headers);
    }

    if (env.SEARCH_LIMITER) {
      const { success } = await env.SEARCH_LIMITER.limit({ key: clientKey(request) });
      if (!success) {
        return json({
          error: 'Rate limit exceeded',
          hint: 'Try again in a minute.',
        }, 429, headers);
      }
    }

    const count = Math.min(parseInt(url.searchParams.get('count') || '10', 10) || 10, 100);

    let auth = '';
    if (env.CATALOG_BEER_API_KEY) {
      auth = basicAuthHeader(env.CATALOG_BEER_API_KEY);
    } else {
      auth = request.headers.get('Authorization') || '';
    }
    if (!auth) {
      return json({
        error: 'Missing credentials',
        hint: 'Set CATALOG_BEER_API_KEY on the worker (recommended), or send Authorization from the PWA',
      }, 401, headers);
    }

    try {
      const result = await smartSearch(auth, { brewery, beer, q, count });
      return json({
        beers: result.beers,
        query: result.query,
        strategy: result.strategy,
        has_more: !!result.has_more,
      }, 200, headers);
    } catch (err) {
      return json({
        error: err.message || 'Catalog.beer API error',
        status: err.status || 502,
        detail: err.detail || '',
      }, 502, headers);
    }
  },
};
