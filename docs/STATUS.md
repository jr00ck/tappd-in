# Tappd In — status

**Version:** 0.6.1-beta  
**Live:** https://jr00ck.github.io/tappd-in/  
**Worker:** https://tappd-in-catalog.rerun-cost-xbox.workers.dev (`GET /resolve`, `POST /resolve-batch`)  
**Updated:** 2026-10-12

## What changed (0.6.1)

- App icon: cartoon of the Untappd profile beer-plush (replaces auto-generated pint); cache-busted icon/manifest URLs + SW cache bump so Add to Home Screen / PTR pick up the new assets
- Brewery entry: removed native `<datalist>` + autofocus (was popping a mystery 2-brewery dropdown on open/PTR). Replaced with a labeled **Recent** chip row under the brewery field
- Pages deploy copies only public `icons/*` PNGs/SVG — not `icons/src` reference photos

## What changed (0.6.0)

- No-match recovery: top non-zero candidates + numbered-series picker; pick → cache `picked`
- Per-row Retry (single-beer multi-variant, bypass cache, ≤2 provider calls); inline rename
- Brewery chip; swipe/× remove pending beers; saved vs searched badges; find summary line
- README rewritten for list→Find links product (no OCR). Demo is a tiny GIF in `docs/` (not on Pages video storage)

## Resolve spot-checks

| Query | Result | Notes |
|-------|--------|--------|
| Finback / Something Mosaic | `/…-something-mosaic/2706030` | Confident |
| Ballast Point / Sculpin | `/…-sculpin/5558` | Confident |
| North Park / X-Raying Rakau | `/…-x-raying-rakau/6899298` | Confident when spelled correctly |
| North Park / x-raying racau | Often no page in Search | Use Retry / Search / Fix; soft-typo helps only if Rakau URL is returned |
| Mortalis / Strange Philosophies | May surface numbered variants | 0.6 lists variants instead of auto-picking |

## Known limits

- Untappd has no public search deep-link; beer pages use `untappd://beer/{id}` on touch
- Multi-query `max_results` is a shared budget across queries
- Provider may omit the true beer for typos/obscure releases (≤2 calls/beer on Retry)
- iOS Add to Home Screen may keep a cached icon until the bookmark is removed and re-added after deploy

## Assumption conflicts

- Batch (2+ beers): 1 query/beer per call; single beer uses full multi-variant
- Score-0 look-alikes are not shown as primary links
- Public Untappd profiles ≠ structured friends/check-in API; Search stays for beer→URL only

## Suggested next

- Richer series queries (X-Raying *); show providerCalls live per row
- Optional Agent→Planner webhook reading this file
