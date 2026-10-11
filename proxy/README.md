# Proxies for Tappd In

Static GitHub Pages cannot call most beer APIs from the browser (no CORS), and secrets must not live in the public repo.

| Worker | Purpose |
|--------|---------|
| `catalog-worker.js` | **Primary MVP** — Catalog.beer beer search |
| `worker.js` | Untappd official API search (optional, needs Untappd app credentials) |

## Catalog.beer (`catalog-worker.js`)

1. Free key: https://catalog.beer/signup → verify email → https://catalog.beer/account  
2. Deploy `catalog-worker.js` as a Cloudflare Worker.  
3. Either:
   - Set secret `CATALOG_BEER_API_KEY` on the worker (shared quota for anyone using your PWA), **or**
   - Leave secret empty and put the key in the PWA Settings (device-only); the PWA sends `Authorization` to *your* worker only.  
4. Optional: `ALLOWED_ORIGIN=https://jr00ck.github.io`  
5. PWA → Settings → **Catalog.beer proxy URL** = `https://<your-worker>/search`

`GET /search?q=Roses+by+the+Stairs+This+Is+Growing+Up&count=10`

## Untappd (`worker.js`)

See comments in `worker.js`. Requires Untappd API app approval — not needed for the Catalog.beer MVP.
