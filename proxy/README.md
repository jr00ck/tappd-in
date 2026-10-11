# Proxies for Tappd In

| Worker | Purpose |
|--------|---------|
| `resolve-worker.js` | **MVP** — Untappd URL resolve via Perplexity Search |
| `worker.js` | Untappd official API search (optional, parked) |

Catalog.beer proxy code lives on branch `feat/catalog-beer-search` (parked).

## Untappd resolver (`resolve-worker.js`)

```bash
npx wrangler@latest deploy
npx wrangler@latest secret put PERPLEXITY_API_KEY
```

Unused (Catalog.beer parked — delete later if desired, not required for MVP):

`CATALOG_BEER_API_KEY` may still exist on this Worker. Active secret is `PERPLEXITY_API_KEY`.

`GET /resolve?brewery=Finback&beer=Something+Mosaic`

Deployed:

`https://tappd-in-catalog.rerun-cost-xbox.workers.dev/resolve`

Protection: Worker secret + `SEARCH_LIMITER` (30/min/IP) + CORS allowlist (Pages + localhost).
