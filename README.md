<img src="icons/icon-512.png" width="96" height="96" alt="Tappd In icon">

# Tappd In

Photograph a beer can, identify the label, and open the matching beer in **Untappd** — a mobile-first PWA for iOS and Android (not an App Store app). Check-ins, ratings, and social features stay in Untappd.

**Live app:** https://jr00ck.github.io/tappd-in/ *(deploys on version tags)*

## Features

- **Take a photo or pick an image** of a can/bottle label
- **On-device OCR** — uses the browser `TextDetector` API when available (mostly Chromium/Android); otherwise [Tesseract.js](https://github.com/naptha/tesseract.js) (WASM). iOS/Android **do not** expose native Vision / ML Kit OCR to PWAs
- **Editable brewery + beer fields** when recognition is uncertain, plus raw OCR text
- **Find on Untappd** via an optional self-hosted proxy that calls Untappd’s official public beer search (`client_id` / `client_secret`, no user login). Candidate matches are listed; URLs come only from API `beer_slug` + `bid`
- **Paste a beer URL** if you have no proxy — only `https://untappd.com/b/{slug}/{id}` is accepted (example: [Finback Something Mosaic](https://untappd.com/b/finback-brewery-something-mosaic/2706030))
- **Open in Untappd** — the public HTTPS beer link. With Untappd ≥ 4.1.4 installed, iOS/Android typically hand off into the app; otherwise the website loads
- **No private Untappd social APIs** and no scraping of untappd.com HTML in the app

## How Untappd resolution works

| Path | Permission model |
|------|------------------|
| Official API through your proxy (`proxy/`) | Untappd-approved app credentials on the worker; browser never sees the secret |
| Manual search + paste | You use Untappd’s public site; the PWA only validates the URL shape |

We **never invent** a beer URL from a guessed slug. Public pages being visible does not grant scraping rights, and new API credentials are not assumed to be available immediately — apply at https://untappd.com/api and see `proxy/README.md`.

## Data & privacy

Photos are processed **in the browser** for OCR. Settings (proxy URL) live in `localStorage`. The only network calls the app makes are: loading Tesseract assets from jsDelivr (first OCR run), your optional search proxy, and opening Untappd links you confirm.

## Installing

### iOS (Safari)

1. Open https://jr00ck.github.io/tappd-in/ in Safari.
2. Tap Share → **Add to Home Screen**.

### Android (Chrome / Samsung Internet)

1. Open the live URL in Chrome or Samsung Internet.
2. Use **Install app** / **Add to Home Screen** when prompted (or from the browser menu).

### Desktop (Chrome / Edge)

Install from the address bar / browser menu. Opens as a standalone window.

## Local development

```
npm run serve
# or: python3 -m http.server 8099
```

Open `http://localhost:8099`.

```
npm install
npm test
```

Service workers need HTTPS or `localhost`. Camera capture needs a secure context as well.

## Local development (Cursor browser)

```
npm run serve
# open http://127.0.0.1:8099 in the Cursor Simple Browser
```

Service workers need HTTPS or `localhost` / `127.0.0.1`. On desktop, reload the tab after a code change (network-first SW). On phone, **pull down to refresh** to fetch + activate a new build (same as Gassy).

While iterating before a tag, set `PREVIEW_BUILD` in `app.js` (e.g. `'a3'`) so the footer shows `v0.4.2-beta · a3` on non-Pages hosts. Clear it before tagging.

## Releasing

GitHub Pages deploys on a pushed version tag (`v*`), not on every `main` push — see `.github/workflows/deploy.yml`.

The `github-pages` environment must allow **tag** deployments matching `v*` (Settings → Environments → github-pages → Deployment branches/tags). Without that, tag pushes fail with “not allowed to deploy”.

Prefer [Conventional Commits](https://www.conventionalcommits.org) so [git-cliff](https://git-cliff.org) can group the changelog (`cliff.toml`).

```
# 1. Bump APP_VERSION + RELEASE_NOTES in app.js, package.json version, and CACHE in sw.js
#    Clear PREVIEW_BUILD to ''
# 2. Refresh CHANGELOG.md
npm run changelog

# 3. Tag + publish (Pages deploys from the tag)
git tag -a vX.Y.Z -m "vX.Y.Z - short description"
git push origin main vX.Y.Z
gh release create vX.Y.Z --title "vX.Y.Z" --notes-file - <<'EOF'
- bullet from RELEASE_NOTES
EOF
```

`APP_VERSION` drives the footer and the "✓ Updated" badge after pull-to-refresh. `RELEASE_NOTES` is the short list shown when that badge is tapped.
