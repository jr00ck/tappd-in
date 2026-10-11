# Proxies for Tappd In

Static GitHub Pages cannot call most beer APIs from the browser (no CORS), and secrets must not live in the public repo.

| Worker | Purpose |
|--------|---------|
| `catalog-worker.js` | **Primary MVP** — Catalog.beer beer search |
| `worker.js` | Untappd official API search (optional, needs Untappd app credentials) |

## Catalog.beer (`catalog-worker.js`)

### Protection model (MVP)

| Layer | What it does |
|-------|----------------|
| Worker secret `CATALOG_BEER_API_KEY` | Catalog key never appears in the PWA or git |
| `SEARCH_LIMITER` (Workers Rate Limiting) | Soft cap: **30 searches / minute / client IP** (per Cloudflare location) |
| CORS allowlist | Browser-only; not auth |

Accepted tradeoff: the Worker URL is public (hardcoded in the PWA). Anyone who finds it can search on your Catalog.beer quota until the rate limit slows them down. For a friends PWA that is enough; Access / WAF are later options if abuse shows up.

Search quality depends on Catalog.beer’s database. If a brewery/beer isn’t in Catalog, the API correctly returns no good match — use the PWA’s Untappd search handoff.

### Setup

Use a current Wrangler (rate-limit bindings need a recent CLI — not 4.19.x):

```bash
cd proxy
npx wrangler@latest deploy
npx wrangler@latest secret put CATALOG_BEER_API_KEY   # once; survives redeploys
```

Or set the secret in Dashboard → Workers → `tappd-in-catalog` → Settings → Variables and Secrets.

The PWA hardcodes the proxy URL; friends need no Settings for search once the secret is set.

Deployed URL (`app.js` → `DEFAULT_CATALOG_PROXY_URL`):

`https://tappd-in-catalog.rerun-cost-xbox.workers.dev/search`

### Search API

Brewery-first (preferred):

`GET /search?brewery=Mortalis&beer=Strange+Philosophies&count=10`

Legacy combined query:

`GET /search?q=Mortalis+Strange+Philosophies&count=10`

### Verify checklist

Run from any terminal after deploy + secret:

```bash
# 1) Secret is present (name only — value never shown)
npx wrangler@latest secret list
# expect: CATALOG_BEER_API_KEY

# 2) Auth + brewery-first search works
curl -sS \
  'https://tappd-in-catalog.rerun-cost-xbox.workers.dev/search?brewery=Mortalis&beer=Strange%20Philosophies&count=5' \
  | python3 -m json.tool
# expect: strategy.mode = "brewer_beers", strategy.breweryName contains Mortalis
#         every beers[].brewer.name is that brewery (not Joyride / random "Strange")
# not: Missing credentials
# tip: jq '.strategy, [.beers[]|.name,.brewer.name]'

# 3) Rate limiter is wired (optional — Dashboard or API)
# Dashboard → Workers → tappd-in-catalog → Settings → bindings include SEARCH_LIMITER
# Or after many rapid curls from one IP you eventually get HTTP 429

# 4) PWA
# npm run serve  →  http://localhost:8099
# Find beer: Mortalis / Strange Philosophies → sensible matches, no Catalog key in Settings
```

Catalog.beer quota itself: check https://catalog.beer/account or their usage endpoint if you need monthly totals.

## Untappd (`worker.js`)

See comments in `worker.js`. Requires Untappd API app approval — not needed for the Catalog.beer MVP.
