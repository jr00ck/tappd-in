# Tappd In — feature backlog

What's in the app already and what's still on the wishlist.

---

## In the app today

- Mobile-first installable PWA (manifest + service worker + iOS home-screen tags)
- Take photo (rear camera when available) or choose an existing image
- On-device OCR: Chrome `TextDetector` when present, else Tesseract.js (WASM) — native Vision/ML Kit are **not** exposed to PWAs
- Editable brewery / beer / label-detail fields when OCR is uncertain
- Untappd match via optional self-hosted search proxy (official `/v4/search/beer`) — **never invents** beer URLs
- Manual path: open Untappd public search + paste a canonical `untappd.com/b/…/id` URL
- “Open in Untappd” uses the verified HTTPS beer link (app handoff on iOS/Android when Untappd is installed; website fallback)
- Settings (proxy URL) stored in `localStorage` only
- Pull-down to refresh for updates; ✓ Updated badge + release notes
- GitHub Pages deploy on `v*` tags (same pattern as Gassy)
- Changelog tooling: Conventional Commits + git-cliff

---

## Wishlist

- **Deployed search proxy** — stand up the Cloudflare Worker in `proxy/` with approved Untappd API credentials
- **Server-side OCR fallback** — optional Worker/endpoint when on-device Tesseract is too slow or inaccurate on a device
- **Smarter label parsing** — brewery/beer ranking using confidence, multi-line brand marks, barcode → Open Food Facts when present
- **Cache recent matches** — local history of beers opened from this device
- **Offline OCR assets** — pin Tesseract WASM + `eng` traineddata in the service worker cache
- **HEIC handling** — convert/preview iPhone HEIC picks more reliably across browsers
