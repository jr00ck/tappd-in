# Tappd In — feature backlog

What's in the app already and what's still on the wishlist.

---

## In the app today

- Mobile-first installable PWA (manifest + service worker + iOS home-screen tags)
- **Voice-first (beta):** batch AICHE `POST /v1/transcribe` with API key in on-device Settings only
- Public Untappd URL helpers: beer `/b/`, brewery `/w/`, user, check-in, venue `/v/`, venue RSS, search
- Photo / OCR demoted to an optional panel (TextDetector / Tesseract) — often weak on can art
- Editable brewery / beer fields after voice or OCR
- Optional Untappd search proxy still supported; paste URL kept as temporary fallback
- “Open in Untappd” uses verified HTTPS beer links only
- Pull-down to refresh; GitHub Pages on `v*` tags; git-cliff changelog tooling

---

## Wishlist

- **Automatic beer lookup** (no paste) — Catalog.beer and/or grounded search → verified Untappd URL; evaluate Catalog.beer as primary catalog with Untappd for social handoff
- **AICHE browser CORS verification** — confirm `Allow-Origin` for GitHub Pages; fall back to streaming WebSocket or system dictation if batch is blocked
- **AICHE custom vocabulary workflow** — guide for top ~50 brewery/beer names (account max 50; no bulk import API)
- **Deployed search proxy** — only if Untappd official API remains the chosen resolver
- **Cache recent matches** — local history of beers opened from this device
- **HEIC handling** — convert/preview iPhone HEIC picks more reliably across browsers
