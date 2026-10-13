# Tappd In — status

**Version:** 0.7.0-beta  
**Live:** https://jr00ck.github.io/tappd-in/  
**Worker:** https://tappd-in-catalog.rerun-cost-xbox.workers.dev (`GET /resolve`, `POST /resolve-batch`)  
**Updated:** 2026-10-13

## What changed (0.7.0)

- **Short brewery names:** display/Recent use colloquial labels (`North Park`), not `North Park Beer Company`; history migrates so those are one chip
- **Import Untappd export:** Settings → import `untappd-checkins.csv` (+ optional `untappd-account.json`). Builds an on-device beer library with Had, your rating, global rating, and `bid` / `beer_url`
- **Find links uses export first:** known check-ins link via `untappd.com/beer/{bid}` with **no** Perplexity call (e.g. Lupulin Collider Batch 6)
- **Gassy-style detail:** main list is queue → status → Open; tap the beer name for edit / retry / paste link / remove. No Retry/Fix/Had clutter on the list
- **Had badge** on the list comes from the export (rating when present), not a checkbox

## What changed (0.6.x)

- Match clarity, `| Photos` title cleanup, compact Add+Find, cartoon icon, Recent chips

## Resolve / library spot-checks

| Query | Expected |
|-------|----------|
| North Park / Lupulin Collider Batch 6 | After CSV import → linked from export (`bid` 6628541), Had ~4.4 |
| North Park / X-Raying Rakau | Search/resolve; brewery chip shows **North Park** |
| Collab-ish brewery strings (`Casey Brewing & Blending`) | Short name keeps `& Blending`; match still brewery+beer keyed |

## Known limits

- Export `beer_url` is `/beer/{id}` (not `/b/slug/id`); app accepts both; deep link uses `untappd://beer/{id}`
- Batch Search still 1 query/beer for beers **not** in the export
- Brewer collabs: Untappd usually attributes one primary brewery on the beer page; export matches that primary name
- Account JSON wish-list items are noted; Had is driven by check-ins CSV

## Perplexity Search vs ratings (no code change)

- Search returns titles, URLs, snippets — not a structured Untappd rating field
- Snippets sometimes mention scores, but that’s unreliable for product UI
- **Prefer export** (`global_rating_score`, `rating_score`) or a future official Untappd API for ratings

## Assumption conflicts

- Public profile pages ≠ friends graph API
- Library lives in `localStorage` on device (re-import after clearing site data)

## Suggested next

- Collab beer name heuristics (secondary brewery in beer title)
- Optional “only show new-to-me” filter when queueing under a frequent brewery
- Redeploy Worker when server-side title cleaning should apply to all clients
