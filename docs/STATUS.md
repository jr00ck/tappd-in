# Tappd In — status

**Version:** 0.9.0-beta  
**Live:** https://jr00ck.github.io/tappd-in/  
**Worker:** https://tappd-in-catalog.rerun-cost-xbox.workers.dev (`GET /resolve`, `POST /resolve-batch`)  
**Updated:** 2026-10-15

## What changed (0.9.0)

- **Log / Trends tabs** — check-ins, avg rating, unique beers, breweries, venues
- **Typeahead pills** for brewery/beer from Had (no always-on Recent strip)
- **New vs had:** match hint shows your beer rating and the brewery average
- **Brewery shelf** under the selected brewery chip — expand to see every beer you've had there (no extra tab)
- **Venue 📍** on check-in edit; Had rows put brewery left / time right

## Versioning

Stay on `0.x.y-beta` until an explicit **1.0** launch. Do not tag `1.x` before that.

## Spot-checks

| Action | Expected |
|--------|----------|
| Import sample CSV + select North Park | Shelf: 3 beers + avg; expand lists Lupulin 4.4 |
| Type Lupulin under North Park | Hint: Had · 4.4 · North Park avg … |
| Trends tab | Check-ins + brewery charts |

## Known limits

- Brewery avg = mean of unique beers you’ve rated there (not re-weighted by re-checkins)
- Locate uses Nominatim; never auto-runs on open
- CSV re-import overwrites local check-in edits
