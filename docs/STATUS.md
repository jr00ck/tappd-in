# Tappd In — status

**Version:** 0.9.3-beta  
**Live:** https://jr00ck.github.io/tappd-in/  
**Worker:** https://tappd-in-catalog.rerun-cost-xbox.workers.dev (`GET /resolve`, `POST /resolve-batch`)  
**Updated:** 2026-10-28

## What changed (0.9.3)

- **Breweries tab** — search filter + sort by A–Z, rating, or beer count
- **Beer details** — brewery is editable; fixing a mistype keeps the beer and clears the old miss for Retry
- **Open in Untappd** — uses https Universal Links / App Links so an already-open Untappd app still navigates to the beer

## What changed (0.9.2)

- **Find links** — keeps full brewery names (“Brewing Company”, etc.) for Untappd search while the UI stays short
- **Bare brewery queries** — resolve also tries common suffixes when you only typed the short name
- **Search Untappd** — prefers the Untappd app (Android intent / iOS copy + open) instead of an in-app browser

## What changed (0.9.1)

- **Brewery typeahead** — tapping a suggestion no longer leaves the partial typed text
- **Breweries tab** — list every logged brewery; tap for beers + stats; Queue beers jumps back to Log
- **Batch resolve** — per-query Perplexity groups (multi-brewery Find links no longer starve later beers); empty misses get a multi-variant fallback

## What changed (0.9.0)

- **Log / Trends tabs** — check-ins, avg rating, unique beers, breweries, venues
- **Typeahead pills** for brewery/beer from Had (no always-on Recent strip)
- **New vs had:** match hint shows your beer rating and the brewery average
- **Brewery shelf** under the selected brewery chip — expand to see every beer you've had there
- **Venue 📍** on check-in edit; Had rows put brewery left / time right

## Versioning

Stay on `0.x.y-beta` until an explicit **1.0** launch. Do not tag `1.x` before that.

## Spot-checks

| Action | Expected |
|--------|----------|
| Import sample CSV + select North Park | Shelf: 3 beers + avg; expand lists Lupulin 4.4 |
| Type “Nort” then tap North Park | Chip shows North Park (not Nort) |
| Breweries tab → North Park | Beers + avg; Queue beers selects chip on Log |
| Type Lupulin under North Park | Hint: Had · 4.4 · North Park avg … |
| Trends tab | Check-ins + brewery charts |

## Known limits

- Brewery avg = mean of unique beers you’ve rated there (not re-weighted by re-checkins)
- Locate uses Nominatim; never auto-runs on open
- CSV re-import overwrites local check-in edits
