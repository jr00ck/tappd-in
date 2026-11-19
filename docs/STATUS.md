# Tappd In — status

**Version:** 0.9.6-beta  
**Live:** https://jr00ck.github.io/tappd-in/  
**Worker:** https://tappd-in-catalog.rerun-cost-xbox.workers.dev (`GET /resolve`, `POST /resolve-batch`, `GET /checkins?user=`)  
**Updated:** 2026-11-18

## What changed (0.9.6)

- **Find links** — if Untappd search has one beer, that beer is linked. Typos and missing words no longer have to pass a separate name score.
- **Update check-ins** — saves a profile URL on this device and asks the resolver to read the public profile. Untappd may only return the few check-ins shown before sign-in, or block the fetch. The capture bookmark is the signed-in path.

## What changed (0.9.5)

- **Find links** — the app runs the same Untappd beer search as the Search Untappd link and auto-links one exact hit. A miss shows “Untappd search: N results” so you can see whether the search itself was empty.
- **Check-in CSV** — re-import merges by check-in id: new rows are added, changed ratings and notes are updated, duplicates are skipped, and check-ins that exist only on this device stay.
- **Profile paste** — a bookmarklet copies the check-ins loaded on your Untappd profile (you have to be signed in there). The app cannot read an Untappd login inside its own window.

## What changed (0.9.4)

- **Find links** — Untappd’s own Algolia beer search first (same index as Search Untappd); auto-links exact / single hits. Perplexity is fallback for typos. Algolia keys refresh from untappd.com/search HTML if they rotate.
- **Search Untappd** — opens the filled search outside the in-app browser (Safari / Android Untappd intent). Untappd has no Search deep link.

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
- CSV re-import updates fields from the file (ratings, notes, place). Check-ins that are not in the file are kept. A profile paste only fills the fields it could see.
