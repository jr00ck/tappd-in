# Tappd In — feature backlog

## Branches

| Branch | Purpose |
|--------|---------|
| `main` | Released / Pages baseline |
| `feat/catalog-beer-search` | **Active MVP** — typed fields → Catalog.beer |
| `beta/voice-aiche` | Voice / AICHE experiments (parked) |

---

## In the app today (`feat/catalog-beer-search`)

- Typed brewery + beer → **Catalog.beer** search → pick match
- On-device Settings for Catalog.beer API key + optional CORS proxy URL
- `proxy/catalog-worker.js` for Cloudflare (CORS)
- Selected beer: Catalog.beer page + **Search on Untappd** (public search handoff)
- Public Untappd URL helpers retained for future exact deep links
- Voice (AICHE) and photo OCR demoted to optional panels

---

## Wishlist

- Deploy Catalog.beer Cloudflare Worker and confirm search from Pages / iOS
- Exact Untappd `/b/…/id` deep link (API proxy or grounded search) after Catalog match
- Resume AICHE voice once Catalog.beer path is solid
- Cache recent matches on-device
