# Tappd In — status

**Version:** 0.8.0-beta  
**Live:** https://jr00ck.github.io/tappd-in/  
**Worker:** https://tappd-in-catalog.rerun-cost-xbox.workers.dev (`GET /resolve`, `POST /resolve-batch`)  
**Updated:** 2026-10-15

## What changed (0.8.0)

- **Had log:** imported check-ins sit under the queue, grouped by month (newest open). Tap a row to edit.
- **Everyday fields:** date, beer, brewery, your rating, serving, venue, note. The gear holds style, ABV/IBU, IDs, place details, and read-only export facts.
- **CSV vs JSON:** the check-ins CSV is the dated log and the Had lookup. The account JSON is wish lists, in a collapsed Saved group.
- Re-importing the CSV replaces the check-in log. Edits stay on this device until the next CSV import.

## Still true from 0.7.0

- Short brewery names (`North Park`). Find links uses an export `bid` before Search.
- Tap a queued beer to edit, retry, or paste a link. The Had badge comes from the export.

## Resolve / library spot-checks

| Query | Expected |
|-------|----------|
| North Park / Lupulin Collider Batch 6 | After CSV import → export link (`bid` 6628541), Had ~4.4, listed in its check-in month |
| North Park / X-Raying Rakau | Search/resolve; brewery chip shows **North Park** |
| Account JSON wish list | Saved group only; a beer you've also checked in stays in the month log |

## Known limits

- Export `beer_url` is `/beer/{id}` (not `/b/slug/id`); deep link uses `untappd://beer/{id}`
- Batch Search is still 1 query per beer that is not in the export
- Collabs: Untappd attributes one primary brewery; the export matches that name
- Library is in `localStorage`. A CSV re-import overwrites local check-in edits.
- Ratings come from the export. Search snippets are not a ratings source.

## Suggested next

- Collab beer name heuristics (secondary brewery in the beer title)
- Optional “only show new-to-me” filter when queueing under a frequent brewery
