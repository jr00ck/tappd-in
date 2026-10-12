# Tappd In — status

**Version:** 0.6.2-beta  
**Live:** https://jr00ck.github.io/tappd-in/  
**Worker:** https://tappd-in-catalog.rerun-cost-xbox.workers.dev (`GET /resolve`, `POST /resolve-batch`)  
**Updated:** 2026-10-12

## What changed (0.6.2)

- **Match clarity:** rows use linked (green) / pick (amber) / miss (red) / queued states with a status pip + “Open in Untappd” vs “No Untappd match”
- **Titles:** strip Untappd `| Photos` chrome; show canonical beer name from Untappd, not the raw search title
- **Brewery chip/header:** normalize to Untappd brewery casing/name after a successful match (e.g. `North park` → `North Park Beer Co`)
- **Single hit:** auto-accept when Search returns one candidate (no “pick one” with a lone option)
- **Layout:** compact Add + Find links on one row; Fix/Retry/Search sit on an actions row so they don’t overlap **Had**
- **Flow copy:** numbered “queue → Find links” hint; session summary as `linked · need a pick · missed · queued`

## What changed (0.6.1)

- Cartoon beer-plush app icon; cache-busted icon/manifest URLs + SW bump
- Labeled **Recent** brewery chips (removed native datalist autofocus popup)
- Pages deploy skips `icons/src`

## What changed (0.6.0)

- No-match recovery: candidates + numbered-series picker; per-row Retry
- Brewery chip; swipe/× remove; list→Find links product

## Resolve spot-checks

| Query | Result | Notes |
|-------|--------|--------|
| Finback / Something Mosaic | `/…-something-mosaic/2706030` | Confident |
| Ballast Point / Sculpin | `/…-sculpin/5558` | Confident |
| North Park / X-Raying Rakau | `/…-x-raying-rakau/6899298` | Title cleaned; brewery normalized |
| North Park / Lupulin | May miss on batch (1 query/beer) | Use **Retry** (multi-variant) or Search Untappd |
| Mortalis / Strange Philosophies | Numbered variants | Pick UI when ≥2 series hits |

## Known limits

- Batch (2+ beers): 1 query/beer; single Retry uses full multi-variant — explains mobile vs desktop hit differences
- Untappd has no public search deep-link; beer pages use `untappd://beer/{id}` on touch
- iOS Add to Home Screen may keep a cached icon until the bookmark is removed and re-added

## Assumption conflicts

- Score-0 look-alikes are not shown as primary links
- Public Untappd profiles ≠ structured friends/check-in API; Search stays for beer→URL only

## Suggested next

- Optional soft-typo expansion in batch path for near-misses like Lupulin
- Show providerCalls live per row
- Redeploy Worker when `resolve-core` title cleaning should apply server-side to all clients
