# Tappd In — feature backlog

## Branches

| Branch | Purpose |
|--------|---------|
| `main` | Released / Pages baseline |
| `feat/mvp-untappd-resolver` | **Active MVP** — Perplexity → Untappd `/b/…/id` |
| `feat/catalog-beer-search` | Catalog.beer path (**parked**, do not merge for MVP) |
| `beta/voice-aiche` | Voice / AICHE experiments (parked) |

## In the app today (`feat/mvp-untappd-resolver`)

- Quick brewery + multi-beer entry
- Cloudflare Worker `GET /resolve` via Perplexity Search (`untappd.com` domain filter)
- localStorage URL cache (never re-search a resolved beer)
- Session groups + brewery autocomplete history
- Manual Fix link / candidate pick when not confident

## Wishlist

- Confirm Perplexity free-tier cost at real usage
- Optional Cloudflare KV cache sync across devices
- Resume voice/OCR later if useful

## Secrets / cleanup later

- Worker `tappd-in-catalog` may still have unused secret `CATALOG_BEER_API_KEY` (Catalog.beer path parked).
  Safe to delete when convenient: `npx wrangler@latest secret delete CATALOG_BEER_API_KEY` (from `proxy/`).
  Active secret: `PERPLEXITY_API_KEY`.
