# Untappd search proxy

Static GitHub Pages cannot call `api.untappd.com` from the browser (no CORS), and embedding `client_secret` in a public PWA would be unsafe.

`worker.js` is a small **Cloudflare Worker** that:

1. Holds your Untappd app credentials as Worker secrets
2. Forwards `GET /search?q=…` to Untappd’s official `/v4/search/beer`
3. Returns a compact JSON list of beers (slug + bid only from the API)

## Setup

1. Apply for an Untappd API app at https://untappd.com/api (approval is not instant or guaranteed).
2. Deploy `worker.js` as a Cloudflare Worker.
3. Set secrets `UNTAPPD_CLIENT_ID` and `UNTAPPD_CLIENT_SECRET`.
4. Optionally set `ALLOWED_ORIGIN` to `https://jr00ck.github.io`.
5. In the PWA: **Settings → Search proxy URL** → `https://<your-worker>/search`

Without a proxy, Tappd In still works: identify the label, open Untappd’s public search, paste the canonical beer URL. The app **never invents** `/b/…/id` links.
