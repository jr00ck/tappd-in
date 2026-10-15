/* Tappd In — quick brewery/beer entry → exact Untappd URLs (vanilla PWA) */

const SETTINGS_KEY = 'tappd-in.settings';
const LAST_SEEN_KEY = 'tappd-in.lastSeenVersion';
const CACHE_KEY = 'tappd-in.resolveCache';
const HISTORY_KEY = 'tappd-in.breweryHistory';
const SESSION_KEY = 'tappd-in.session';
const LIBRARY_KEY = 'tappd-in.beerLibrary';

const APP_VERSION = '0.9.0-beta';
// Short build id while iterating — set e.g. 'a1', clear before tagging a release.
// Never shown on the live Pages host even if forgotten.
const PREVIEW_BUILD = '';
const PRODUCTION_HOST = 'jr00ck.github.io';
const RELEASE_NOTES = [
  'Log and Trends tabs with check-in, rating, and brewery charts',
  'Typeahead pills for brewery and beer from your Had list',
  'See if a beer is new — your rating and the brewery average',
  'Select a brewery to skim every beer you’ve had there',
];

const BREWERY_SUFFIXES = [
  'Brewing Company',
  'Brewing Co.',
  'Brewing Co',
  'Beer Company',
  'Beer Co.',
  'Beer Co',
  'Brewery',
  'Brewing',
  'Company',
  'Co.',
  'Co',
];

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function versionLabel() {
  const onProd = location.hostname === PRODUCTION_HOST;
  if (!onProd && PREVIEW_BUILD) return `v${APP_VERSION} · ${PREVIEW_BUILD}`;
  return `v${APP_VERSION}`;
}

function setCollapsibleOpen(panel, open) {
  if (!panel) return;
  if (open) {
    panel.hidden = false;
    if (prefersReducedMotion()) {
      panel.classList.add('is-open');
      return;
    }
    // Double-rAF so the 0fr → 1fr transition runs after display flips on.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => panel.classList.add('is-open'));
    });
    return;
  }

  if (prefersReducedMotion() || !panel.classList.contains('is-open') || panel.hidden) {
    panel.classList.remove('is-open');
    panel.hidden = true;
    return;
  }

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    panel.hidden = true;
    panel.removeEventListener('transitionend', onEnd);
  };
  const onEnd = (e) => {
    if (e.target !== panel) return;
    finish();
  };
  panel.addEventListener('transitionend', onEnd);
  panel.classList.remove('is-open');
  setTimeout(finish, 280);
}

const DEFAULT_RESOLVE_URL =
  'https://tappd-in-catalog.rerun-cost-xbox.workers.dev/resolve';
const DEFAULT_BATCH_URL =
  'https://tappd-in-catalog.rerun-cost-xbox.workers.dev/resolve-batch';

const BEER_PATH_RE = /^\/b\/([a-z0-9-]+)\/(\d+)(?:\/|$)/i;
const BEER_URL_RE = /^https:\/\/(?:www\.)?untappd\.com\/b\/([a-z0-9-]+)\/(\d+)(?:\/[^?#]*)?(?:[?#].*)?$/i;

// --- Pure helpers ---

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripDiacritics(s) {
  return String(s || '').normalize('NFD').replace(/\p{M}/gu, '');
}

function normalizeMatchText(s) {
  let t = stripDiacritics(s).toLowerCase();
  t = t.replace(/&/g, ' and ');
  t = t.replace(/\b(the|brewing|brewery|brew|co|company|llc|inc)\b/g, ' ');
  t = t.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t;
}

/** Brewery-only key: also drop trailing “beer” so “North Park” ≡ “North Park Beer Co”. */
function normalizeBreweryText(s) {
  return normalizeMatchText(s).replace(/\bbeer\b/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Colloquial display name — strip Brewing/Beer Co suffixes. */
function shortBreweryName(name) {
  let t = String(name || '').trim();
  if (!t) return '';
  t = t.replace(/\s*\([^)]*\)\s*$/g, '').trim();
  for (const suffix of BREWERY_SUFFIXES) {
    const esc = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\s+${esc}$`, 'i');
    if (re.test(t)) {
      t = t.replace(re, '').trim();
      break;
    }
  }
  return t || String(name || '').trim();
}

function cacheKey(brewery, beer) {
  return `${normalizeBreweryText(brewery)}|${normalizeMatchText(beer)}`;
}

function parseUntappdBeerUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  if (host !== 'untappd.com') return null;
  if (/^\/user\//i.test(url.pathname) || /^\/v\//i.test(url.pathname) || /^\/w\//i.test(url.pathname)) {
    return null;
  }
  const idOnly = url.pathname.match(/^\/beer\/(\d+)\/?$/i);
  if (idOnly) {
    const id = idOnly[1];
    return {
      slug: '',
      id,
      beerId: id,
      url: `https://untappd.com/beer/${id}`,
    };
  }
  const m = BEER_PATH_RE.exec(url.pathname) || BEER_URL_RE.exec(url.href);
  if (!m) return null;
  const slug = (m[1] || '').toLowerCase();
  const id = m[2];
  if (!slug || !id) return null;
  return {
    slug,
    id,
    beerId: id,
    url: `https://untappd.com/b/${slug}/${id}`,
  };
}

function parseBeerUrl(input) {
  return parseUntappdBeerUrl(input);
}

function untappdSearchWebUrl(brewery, beer) {
  const q = [brewery, beer].map((s) => String(s || '').trim()).filter(Boolean).join(' ');
  const url = new URL('https://untappd.com/search');
  url.searchParams.set('q', q);
  url.searchParams.set('type', 'beer');
  return url.href;
}

function preferUntappdApp() {
  const s = loadSettings();
  if (s.openInApp === false) return false;
  return 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;
}

/** Matched beers: deep-link into the Untappd app on phones; https elsewhere. */
function beerOpenHref(httpsUrl, beerId) {
  if (preferUntappdApp() && beerId) return `untappd://beer/${beerId}`;
  return httpsUrl;
}

/**
 * Untappd has no reliable public search:// deep link. Use https search —
 * on iOS, users can still "Open in Untappd" from the sheet when available.
 */
function untappdSearchHref(brewery, beer) {
  return untappdSearchWebUrl(brewery, beer);
}

const U_MARK = '<span class="u-mark" aria-hidden="true">U</span>';

function slugToWords(slug) {
  return normalizeMatchText(String(slug || '').replace(/-/g, ' '));
}

function tokenSet(s) {
  return new Set(normalizeMatchText(s).split(' ').filter((w) => w.length > 1));
}

function scoreCandidate(brewery, beer, parsed, title) {
  const query = normalizeMatchText(`${brewery} ${beer}`);
  const qTokens = [...tokenSet(query)];
  if (!qTokens.length) return 0;
  const slugWords = slugToWords(parsed.slug);
  const titleWords = normalizeMatchText(title || '');
  const hay = `${slugWords} ${titleWords}`;
  let hit = 0;
  for (const t of qTokens) {
    if (hay.split(' ').some((w) => w === t || w.startsWith(t) || t.startsWith(w))) hit += 1;
  }
  let score = hit / qTokens.length;
  if (slugWords.includes(normalizeMatchText(beer)) || normalizeMatchText(beer).includes(slugWords)) {
    score += 0.15;
  }
  return Math.min(score, 1.25);
}

function isConfident(best, second) {
  if (!best || best.score < 0.72) return false;
  if (!second) return true;
  return best.score - second.score >= 0.08 || best.score >= 0.9;
}

// --- Storage ---

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function loadSettings() {
  const parsed = loadJson(SETTINGS_KEY, {});
  return {
    resolveUrl: String(parsed.resolveUrl || '').trim(),
    openInApp: parsed.openInApp !== false,
  };
}

function saveSettings(settings) {
  saveJson(SETTINGS_KEY, {
    resolveUrl: String(settings.resolveUrl || '').trim(),
    openInApp: settings.openInApp !== false,
  });
}

function clearResolveCache() {
  saveCache({});
}

function loadCache() {
  const raw = loadJson(CACHE_KEY, {});
  return raw && typeof raw === 'object' ? raw : {};
}

function saveCache(cache) {
  saveJson(CACHE_KEY, cache);
}

function getCachedResolve(brewery, beer) {
  const key = cacheKey(brewery, beer);
  const entry = loadCache()[key];
  if (!entry || !entry.url) return null;
  const parsed = parseUntappdBeerUrl(entry.url);
  if (!parsed) return null;
  return { key, ...entry, ...parsed };
}

function putCacheResolve(brewery, beer, data) {
  const key = cacheKey(brewery, beer);
  const cache = loadCache();
  cache[key] = {
    url: data.url,
    id: data.id,
    title: data.title || '',
    resolvedAt: data.resolvedAt || new Date().toISOString(),
    source: data.source || 'search',
  };
  saveCache(cache);
  return key;
}

function loadBreweryHistory() {
  const list = loadJson(HISTORY_KEY, []);
  return Array.isArray(list) ? list : [];
}

function touchBreweryHistory(name) {
  const n = shortBreweryName(name);
  if (!n) return;
  const key = normalizeBreweryText(n);
  const all = loadBreweryHistory();
  const prior = all.find((x) => normalizeBreweryText(x.name) === key);
  const prev = all.filter((x) => normalizeBreweryText(x.name) !== key);
  prev.unshift({
    name: n,
    count: (prior?.count || 0) + 1,
    lastUsed: Date.now(),
  });
  saveJson(HISTORY_KEY, prev.slice(0, 40));
}

/** Collapse “North park” + “North Park Beer Company” → one short Recent chip. */
function migrateBreweryHistory() {
  const all = loadBreweryHistory();
  if (!all.length) return;
  const byKey = new Map();
  for (const item of all) {
    const short = shortBreweryName(item.name);
    const key = normalizeBreweryText(short);
    if (!key) continue;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, {
        name: short,
        count: item.count || 1,
        lastUsed: item.lastUsed || 0,
      });
    } else {
      prev.count = (prev.count || 0) + (item.count || 0);
      prev.lastUsed = Math.max(prev.lastUsed || 0, item.lastUsed || 0);
      // Prefer the shorter colloquial label when both map to the same brewery.
      if (short.length < prev.name.length) prev.name = short;
    }
  }
  const merged = [...byKey.values()]
    .sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0) || (b.count || 0) - (a.count || 0))
    .slice(0, 40);
  saveJson(HISTORY_KEY, merged);
}

function emptyLibrary() {
  return {
    version: 2,
    importedAt: null,
    checkinCount: 0,
    beers: {},
    checkins: [],
    wishlist: [],
    wishBids: {},
    venues: {},
  };
}

function loadLibrary() {
  const raw = loadJson(LIBRARY_KEY, null);
  if (!raw || typeof raw !== 'object' || !raw.beers) return emptyLibrary();
  const needsMigration = !Array.isArray(raw.checkins);
  const lib = ensureLibraryShape(raw);
  if (needsMigration) saveLibrary(lib);
  return lib;
}

function saveLibrary(lib) {
  saveJson(LIBRARY_KEY, lib);
}

function libraryLookup(brewery, beer) {
  const lib = loadLibrary();
  const key = cacheKey(brewery, beer);
  if (lib.beers[key]) return lib.beers[key];
  // Soft: same beer name under a brewery key that normalizes equal after shorting.
  const beerKey = normalizeMatchText(beer);
  for (const entry of Object.values(lib.beers)) {
    if (normalizeMatchText(entry.beer) !== beerKey) continue;
    if (normalizeBreweryText(entry.brewery) === normalizeBreweryText(brewery)) return entry;
  }
  return null;
}

function attachLibraryMeta(row, brewery) {
  const hit = libraryLookup(brewery, row.beer);
  if (!hit) return row;
  const had = (hit.checkins || 0) > 0 || !!hit.lastHad;
  if (!had) return row;
  row.had = true;
  row.rating = hit.rating || null;
  row.globalRating = hit.globalRating || null;
  row.exportBid = hit.bid || null;
  row.lastHad = hit.lastHad || null;
  if (hit.bid && (!row.url || row.status === 'pending')) {
    row.exportUrl = hit.beerUrl || `https://untappd.com/beer/${hit.bid}`;
  }
  return row;
}

function parseCsv(text) {
  const s = String(text || '').replace(/^\uFEFF/, '');
  const lines = [];
  let cur = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else inQuotes = false;
      } else cur += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(cur);
      cur = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i += 1;
      row.push(cur);
      cur = '';
      if (row.some((x) => x !== '')) lines.push(row);
      row = [];
    } else cur += c;
  }
  if (cur !== '' || row.length) {
    row.push(cur);
    if (row.some((x) => x !== '')) lines.push(row);
  }
  if (lines.length < 2) return [];
  const headers = lines[0].map((h) => String(h || '').trim());
  return lines.slice(1).map((cols) => {
    const o = {};
    headers.forEach((h, idx) => {
      o[h] = cols[idx] != null ? String(cols[idx]) : '';
    });
    return o;
  });
}

function optionalNum(value, { zeroIsEmpty = false } = {}) {
  if (value == null || String(value).trim() === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (zeroIsEmpty && n === 0) return null;
  return n;
}

/** Untappd CSV datetimes are local wall time: "2025-06-29 14:18:28". */
function parseCheckinDate(raw) {
  const m = String(raw || '').trim().match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/
  );
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}

function checkinTime(checkin) {
  const d = parseCheckinDate(checkin?.createdAt);
  return d ? d.getTime() : 0;
}

function monthKeyFromCheckin(raw) {
  const d = parseCheckinDate(raw);
  if (!d) return 'unknown';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabelFromKey(key) {
  if (key === 'unknown') return 'Unknown date';
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

function fmtRating(n) {
  if (n == null || !Number.isFinite(Number(n)) || Number(n) <= 0) return '';
  const rounded = Math.round(Number(n) * 100) / 100;
  return String(rounded);
}

function fmtAvg(n) {
  if (n == null || !Number.isFinite(Number(n)) || Number(n) <= 0) return '';
  const tenths = Math.round(Number((Number(n) * 10).toFixed(8)));
  const whole = Math.trunc(tenths / 10);
  const frac = Math.abs(tenths % 10);
  return frac ? `${whole}.${frac}` : String(whole);
}

function fmtCheckinWhen(raw) {
  const d = parseCheckinDate(raw);
  if (!d) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function toDatetimeLocalValue(raw) {
  const d = parseCheckinDate(raw);
  if (!d) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fromDatetimeLocalValue(value) {
  const m = String(value || '').match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (!m) return '';
  return `${m[1]} ${m[2]}:00`;
}

function checkinFromCsvRow(row, index) {
  const beer = String(row.beer_name || '').trim();
  const breweryFull = String(row.brewery_name || '').trim();
  if (!beer || !breweryFull) return null;
  const bid = String(row.bid || '').trim();
  const checkinId = String(row.checkin_id || '').trim();
  const brewery = shortBreweryName(breweryFull);
  return {
    id: checkinId || `row-${index}-${bid || cacheKey(brewery, beer)}`,
    checkinId,
    beer,
    brewery,
    breweryFull,
    style: String(row.beer_type || '').trim(),
    abv: optionalNum(row.beer_abv, { zeroIsEmpty: true }),
    ibu: optionalNum(row.beer_ibu, { zeroIsEmpty: true }),
    comment: String(row.comment || '').trim(),
    venue: String(row.venue_name || '').trim(),
    venueCity: String(row.venue_city || '').trim(),
    venueState: String(row.venue_state || '').trim(),
    venueCountry: String(row.venue_country || '').trim(),
    venueLat: optionalNum(row.venue_lat),
    venueLng: optionalNum(row.venue_lng),
    rating: optionalNum(row.rating_score, { zeroIsEmpty: true }),
    createdAt: String(row.created_at || '').trim(),
    bid,
    breweryId: String(row.brewery_id || '').trim(),
    breweryCountry: String(row.brewery_country || '').trim(),
    breweryCity: String(row.brewery_city || '').trim(),
    breweryState: String(row.brewery_state || '').trim(),
    flavors: String(row.flavor_profiles || '').trim(),
    purchaseVenue: String(row.purchase_venue || '').trim(),
    serving: String(row.serving_type || '').trim(),
    photoUrl: String(row.photo_url || '').trim(),
    globalRating: optionalNum(row.global_rating_score, { zeroIsEmpty: true }),
    globalWeighted: optionalNum(row.global_weighted_rating_score, { zeroIsEmpty: true }),
    friends: String(row.tagged_friends || '').trim(),
    toasts: optionalNum(row.total_toasts),
    commentsCount: optionalNum(row.total_comments),
    checkinUrl: String(row.checkin_url || '').trim(),
    beerUrl: String(row.beer_url || '').trim() || (bid ? `https://untappd.com/beer/${bid}` : ''),
    breweryUrl: String(row.brewery_url || '').trim(),
  };
}

function checkinFromAggregate(entry) {
  const brewery = entry.brewery || shortBreweryName(entry.breweryFull || '');
  return {
    id: `legacy-${cacheKey(brewery, entry.beer)}`,
    checkinId: '',
    beer: entry.beer || '',
    brewery,
    breweryFull: entry.breweryFull || brewery,
    style: '',
    abv: null,
    ibu: null,
    comment: '',
    venue: '',
    venueCity: '',
    venueState: '',
    venueCountry: '',
    venueLat: null,
    venueLng: null,
    rating: entry.rating ?? null,
    createdAt: entry.lastHad || '',
    bid: entry.bid || '',
    breweryId: '',
    breweryCountry: '',
    breweryCity: '',
    breweryState: '',
    flavors: '',
    purchaseVenue: '',
    serving: '',
    photoUrl: '',
    globalRating: entry.globalRating ?? null,
    globalWeighted: null,
    friends: '',
    toasts: null,
    commentsCount: null,
    checkinUrl: '',
    beerUrl: entry.beerUrl || (entry.bid ? `https://untappd.com/beer/${entry.bid}` : ''),
    breweryUrl: '',
  };
}

function wishlistItem(bid, beer, breweryFull, listName, beerUrl) {
  const brewery = shortBreweryName(breweryFull || '');
  return {
    bid: bid || '',
    beer: beer || '',
    brewery,
    breweryFull: breweryFull || brewery,
    listName: listName || 'Saved',
    beerUrl: beerUrl || (bid ? `https://untappd.com/beer/${bid}` : ''),
    lists: listName ? [listName] : [],
  };
}

function dedupeWishlist(items) {
  const byKey = new Map();
  for (const item of items) {
    if (!item || (!item.beer && !item.bid)) continue;
    const key = item.bid || cacheKey(item.brewery || item.breweryFull, item.beer);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, {
        ...item,
        lists: [...(item.lists || (item.listName ? [item.listName] : []))],
      });
      continue;
    }
    const name = item.listName;
    if (name && !prev.lists.includes(name)) prev.lists.push(name);
    if (!prev.beer && item.beer) prev.beer = item.beer;
    if (!prev.breweryFull && item.breweryFull) {
      prev.breweryFull = item.breweryFull;
      prev.brewery = item.brewery || shortBreweryName(item.breweryFull);
    }
    if (!prev.beerUrl && item.beerUrl) prev.beerUrl = item.beerUrl;
  }
  return [...byKey.values()];
}

function rebuildBeerIndex(lib) {
  const beers = {};
  const sorted = [...(lib.checkins || [])].sort((a, b) => checkinTime(a) - checkinTime(b));
  for (const checkin of sorted) {
    if (!checkin?.beer) continue;
    const brewery = shortBreweryName(checkin.brewery || checkin.breweryFull || '');
    const key = cacheKey(brewery, checkin.beer);
    const prev = beers[key];
    const bid = checkin.bid || prev?.bid || '';
    beers[key] = {
      beer: checkin.beer,
      brewery,
      breweryFull: checkin.breweryFull || brewery,
      bid,
      beerUrl: checkin.beerUrl || (bid ? `https://untappd.com/beer/${bid}` : '') || prev?.beerUrl || '',
      rating: checkin.rating != null ? checkin.rating : prev?.rating ?? null,
      globalRating: checkin.globalRating != null ? checkin.globalRating : prev?.globalRating ?? null,
      lastHad: checkin.createdAt || prev?.lastHad || null,
      checkins: (prev?.checkins || 0) + 1,
      wishlist: false,
    };
  }
  lib.wishBids = {};
  for (const item of lib.wishlist || []) {
    if (item.bid) lib.wishBids[item.bid] = true;
    if (!item.beer) continue;
    const brewery = shortBreweryName(item.brewery || item.breweryFull || '');
    const key = cacheKey(brewery, item.beer);
    if (beers[key]) beers[key].wishlist = true;
  }
  lib.beers = beers;
  lib.checkinCount = (lib.checkins || []).length;
  rebuildVenueIndex(lib);
  lib.version = 2;
  return lib;
}

function ensureLibraryShape(lib) {
  lib.wishBids = lib.wishBids && typeof lib.wishBids === 'object' ? lib.wishBids : {};
  if (!Array.isArray(lib.wishlist)) lib.wishlist = [];
  if (!Array.isArray(lib.checkins)) {
    lib.checkins = [];
    const carried = [];
    for (const entry of Object.values(lib.beers || {})) {
      if (!entry || !entry.beer) continue;
      const had = (entry.checkins || 0) > 0 || !!entry.lastHad;
      if (had) lib.checkins.push(checkinFromAggregate(entry));
      if (entry.wishlist || !had) {
        carried.push(wishlistItem(
          entry.bid,
          entry.beer,
          entry.breweryFull || entry.brewery,
          'Saved',
          entry.beerUrl
        ));
      }
    }
    lib.wishlist = dedupeWishlist([...lib.wishlist, ...carried]);
    rebuildBeerIndex(lib);
  }
  return lib;
}

/** Saved beers that are not already in the dated check-in log. */
function wishlistOnly(lib) {
  const hadBids = new Set((lib.checkins || []).map((c) => c.bid).filter(Boolean));
  const hadKeys = new Set(
    (lib.checkins || []).map((c) => cacheKey(c.brewery || c.breweryFull, c.beer))
  );
  return (lib.wishlist || []).filter((item) => {
    if (!item || (!item.beer && !item.bid)) return false;
    if (item.bid && hadBids.has(String(item.bid))) return false;
    if (item.beer && hadKeys.has(cacheKey(item.brewery || item.breweryFull, item.beer))) return false;
    return true;
  });
}

function groupCheckinsByMonth(checkins) {
  const sorted = [...(checkins || [])].sort((a, b) => checkinTime(b) - checkinTime(a));
  const groups = [];
  const byKey = new Map();
  for (const checkin of sorted) {
    const key = monthKeyFromCheckin(checkin.createdAt);
    let group = byKey.get(key);
    if (!group) {
      group = { key, checkins: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.checkins.push(checkin);
  }
  return groups;
}

function normalizeVenueKey(name) {
  return normalizeMatchText(name);
}

function summarizeCheckins(checkins) {
  const ratings = (checkins || [])
    .map((c) => Number(c.rating))
    .filter((n) => Number.isFinite(n) && n > 0);
  const avg = ratings.length
    ? ratings.reduce((sum, n) => sum + n, 0) / ratings.length
    : null;
  const beers = new Set((checkins || []).map((c) => cacheKey(c.brewery || c.breweryFull, c.beer)));
  const breweries = new Set(
    (checkins || []).map((c) => normalizeBreweryText(c.brewery || c.breweryFull)).filter(Boolean)
  );
  const venues = new Set(
    (checkins || []).map((c) => normalizeVenueKey(c.venue)).filter(Boolean)
  );
  return {
    count: (checkins || []).length,
    avg,
    beers: beers.size,
    breweries: breweries.size,
    venues: venues.size,
  };
}

function rememberVenueFromCheckin(lib, checkin) {
  if (!checkin?.venue) return;
  lib.venues = lib.venues && typeof lib.venues === 'object' ? lib.venues : {};
  const key = normalizeVenueKey(checkin.venue);
  if (!key) return;
  const brewery = shortBreweryName(checkin.brewery || checkin.breweryFull || '');
  const prev = lib.venues[key] || {
    name: checkin.venue,
    lat: null,
    lng: null,
    city: '',
    state: '',
    breweryCounts: {},
    lastUsed: 0,
  };
  prev.name = checkin.venue || prev.name;
  if (checkin.venueLat != null) prev.lat = checkin.venueLat;
  if (checkin.venueLng != null) prev.lng = checkin.venueLng;
  if (checkin.venueCity) prev.city = checkin.venueCity;
  if (checkin.venueState) prev.state = checkin.venueState;
  if (brewery) {
    const bKey = normalizeBreweryText(brewery);
    prev.breweryCounts[bKey] = (prev.breweryCounts[bKey] || 0) + 1;
    prev.breweryNames = prev.breweryNames || {};
    prev.breweryNames[bKey] = brewery;
  }
  prev.lastUsed = Math.max(prev.lastUsed || 0, checkinTime(checkin) || Date.now());
  lib.venues[key] = prev;
}

function rebuildVenueIndex(lib) {
  lib.venues = {};
  for (const checkin of lib.checkins || []) rememberVenueFromCheckin(lib, checkin);
}

function topBreweryForVenue(venueRecord) {
  if (!venueRecord?.breweryCounts) return '';
  let bestKey = '';
  let bestCount = 0;
  for (const [key, count] of Object.entries(venueRecord.breweryCounts)) {
    if (count > bestCount) {
      bestCount = count;
      bestKey = key;
    }
  }
  if (!bestKey || bestCount < 1) return '';
  return venueRecord.breweryNames?.[bestKey] || bestKey;
}

function findVenueRecord(name, lat, lng) {
  const lib = loadLibrary();
  const venues = Object.values(lib.venues || {});
  const key = normalizeVenueKey(name);
  if (key && lib.venues?.[key]) return lib.venues[key];
  if (lat == null || lng == null) return null;
  let best = null;
  let bestDist = Infinity;
  for (const venue of venues) {
    if (venue.lat == null || venue.lng == null) continue;
    const dist = distanceMeters(lat, lng, venue.lat, venue.lng);
    if (dist < 250 && dist < bestDist) {
      best = venue;
      bestDist = dist;
    }
  }
  return best;
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const r = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

function fmtDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function importCheckinsCsv(text) {
  const rows = parseCsv(text);
  const lib = loadLibrary();
  const byId = new Map();
  const brewCounts = new Map();
  rows.forEach((row, index) => {
    const checkin = checkinFromCsvRow(row, index);
    if (!checkin) return;
    byId.set(checkin.id, checkin);
    const brewery = checkin.brewery;
    const brewKey = normalizeBreweryText(brewery);
    brewCounts.set(brewKey, {
      name: brewery,
      count: (brewCounts.get(brewKey)?.count || 0) + 1,
    });
  });
  lib.checkins = [...byId.values()];
  rebuildBeerIndex(lib);
  lib.importedAt = new Date().toISOString();
  saveLibrary(lib);

  const top = [...brewCounts.values()].sort((a, b) => b.count - a.count).slice(0, 20);
  for (const b of top.reverse()) touchBreweryHistory(b.name);
  migrateBreweryHistory();
  return { beers: Object.keys(lib.beers).length, rows: lib.checkins.length };
}

function importAccountJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Account file is not valid JSON.');
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.custom_lists)) {
    throw new Error('This JSON has no Untappd lists. Check-ins live in the CSV.');
  }
  const lib = loadLibrary();
  const items = [];
  for (const list of data.custom_lists) {
    if (!list || !Array.isArray(list.items)) continue;
    const listName = String(list.name || list.list_name || 'Saved').trim() || 'Saved';
    for (const item of list.items) {
      if (item.item_type && item.item_type !== 'beer') continue;
      const bid = String(item.item_id || item.bid || '').trim();
      const beer = String(item.beer_name || '').trim();
      const breweryFull = String(item.beer_brewery_name || item.brewery_name || '').trim();
      if (!bid && !beer) continue;
      items.push(wishlistItem(
        bid,
        beer,
        breweryFull,
        listName,
        bid ? `https://untappd.com/beer/${bid}` : ''
      ));
    }
  }
  lib.wishlist = dedupeWishlist(items);
  rebuildBeerIndex(lib);
  lib.importedAt = new Date().toISOString();
  saveLibrary(lib);
  return { wish: lib.wishlist.length };
}

function librarySummaryText() {
  const lib = loadLibrary();
  const n = (lib.checkins || []).length;
  const saved = wishlistOnly(lib).length;
  if (!n && !saved) return 'No check-ins imported yet.';
  const when = lib.importedAt ? new Date(lib.importedAt).toLocaleDateString() : '';
  const bits = [];
  if (n) bits.push(`${n} check-in${n === 1 ? '' : 's'}`);
  if (saved) bits.push(`${saved} saved`);
  return bits.join(' · ') + (when ? ` · imported ${when}` : '');
}

function loadSession() {
  const s = loadJson(SESSION_KEY, { groups: [] });
  return { groups: Array.isArray(s.groups) ? s.groups : [] };
}

function saveSession(session) {
  saveJson(SESSION_KEY, { groups: session.groups || [] });
}

function clearSessionKeepCache() {
  saveSession({ groups: [] });
}

// --- Resolve ---

async function resolveBeer(brewery, beer, settings, opts = {}) {
  const cached = opts.bypassCache ? null : getCachedResolve(brewery, beer);
  if (cached) {
    return {
      fromCache: true,
      best: {
        url: cached.url,
        id: cached.id,
        slug: cached.slug,
        title: cached.title || beer,
        score: 1,
      },
      candidates: [],
      confident: true,
      untappdSearchUrl: untappdSearchWebUrl(brewery, beer),
      source: cached.source || 'search',
    };
  }

  const base = settings.resolveUrl || DEFAULT_RESOLVE_URL;
  const endpoint = new URL(base);
  endpoint.searchParams.set('brewery', brewery);
  endpoint.searchParams.set('beer', beer);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  let res;
  try {
    res = await fetch(endpoint.href, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 429) throw new Error('Rate limit — wait a minute and try again.');
    throw new Error(`Resolve failed (${res.status})${body ? `: ${body.slice(0, 100)}` : ''}`);
  }

  const data = await res.json();
  if (data.confident && data.best?.url) {
    putCacheResolve(brewery, beer, {
      url: data.best.url,
      id: data.best.id,
      title: data.best.title || beer,
      source: 'search',
    });
  }
  return { fromCache: false, ...data, source: 'search' };
}

async function resolveBeerBatch(items, settings) {
  const pending = [];
  const cachedResults = [];
  for (const it of items) {
    const cached = getCachedResolve(it.brewery, it.beer);
    if (cached) {
      cachedResults.push({
        brewery: it.brewery,
        beer: it.beer,
        fromCache: true,
        best: {
          url: cached.url,
          id: cached.id,
          slug: cached.slug,
          title: cached.title || it.beer,
          score: 1,
        },
        candidates: [],
        confident: true,
        untappdSearchUrl: untappdSearchWebUrl(it.brewery, it.beer),
        source: cached.source || 'cache',
      });
    } else {
      pending.push(it);
    }
  }

  if (!pending.length) {
    return { results: cachedResults, providerCalls: 0, fromCacheOnly: true };
  }

  const batchUrl = (settings.resolveUrl || DEFAULT_RESOLVE_URL).replace(/\/resolve\/?$/, '/resolve-batch');
  const endpoint = batchUrl.includes('resolve-batch') ? batchUrl : DEFAULT_BATCH_URL;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: pending }),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 429) throw new Error('Rate limit — wait a minute and try again.');
    throw new Error(`Resolve failed (${res.status})${body ? `: ${body.slice(0, 100)}` : ''}`);
  }

  const data = await res.json();
  const remote = Array.isArray(data.results) ? data.results : [];
  for (const row of remote) {
    if (row.confident && row.best?.url) {
      putCacheResolve(row.brewery, row.beer, {
        url: row.best.url,
        id: row.best.id,
        title: row.best.title || row.beer,
        source: 'search',
      });
    }
  }
  return {
    results: [...cachedResults, ...remote.map((r) => ({ ...r, fromCache: false, source: 'search' }))],
    providerCalls: data.providerCalls || 0,
  };
}


window.TappdIn = {
  APP_VERSION,
  parseBeerUrl,
  parseUntappdBeerUrl,
  normalizeMatchText,
  cacheKey,
  scoreCandidate,
  isConfident,
  getCachedResolve,
  putCacheResolve,
  loadCache,
  saveCache,
  clearSessionKeepCache,
  clearResolveCache,
  untappdSearchWebUrl,
  beerOpenHref,
  resolveBeer,
  resolveBeerBatch,
  slugSeriesBase,
  cleanUntappdTitle,
  parseTitleParts,
  displayBeerName,
  candidateLabel,
  listDisplayCandidates,
  rowSourceBadge,
  rowKind,
  shortBreweryName,
  normalizeBreweryText,
  parseCsv,
  importCheckinsCsv,
  importAccountJson,
  libraryLookup,
  breweryStats,
  beerMatchState,
  groupCheckinsByMonth,
  migrateBreweryHistory,
  DEFAULT_RESOLVE_URL,
  DEFAULT_BATCH_URL,
  BEER_URL_RE,
};


// --- Candidate / series helpers (exported on TappdIn) ---

function slugSeriesBase(slug) {
  return String(slug || '').toLowerCase().replace(/-\d+$/, '');
}

function cleanUntappdTitle(title) {
  let t = String(title || '').trim();
  if (!t) return '';
  t = t.replace(/\s*[|·•]\s*Photos?\b/gi, '');
  t = t.replace(/\s*[|·•]\s*Untappd\b/gi, '');
  t = t.replace(/\s+on\s+Untappd\s*$/i, '');
  return t.replace(/\s{2,}/g, ' ').trim();
}

function parseTitleParts(title) {
  const t = cleanUntappdTitle(title);
  if (t.includes(' - ')) {
    const beer = t.split(' - ')[0].trim();
    let brewery = t.slice(t.indexOf(' - ') + 3).trim();
    brewery = brewery.replace(/\s*[|·•].*$/, '').replace(/\s*-\s*Untappd\s*$/i, '').trim();
    return { beer, brewery };
  }
  return { beer: t, brewery: '' };
}

function displayBeerName(rowOrTitle, fallback = '') {
  if (rowOrTitle && typeof rowOrTitle === 'object') {
    const parts = parseTitleParts(rowOrTitle.title || '');
    return parts.beer || rowOrTitle.beer || fallback || 'Beer';
  }
  const parts = parseTitleParts(rowOrTitle);
  return parts.beer || fallback || String(rowOrTitle || 'Beer');
}

function candidateLabel(c) {
  const parts = parseTitleParts(c.title || '');
  const beer = parts.beer || displayBeerName(c.slug?.replace(/-/g, ' ') || '', 'Beer');
  const scorePct = typeof c.score === 'number' ? ` · ${Math.round(Math.min(c.score, 1.35) / 1.35 * 100)}%` : '';
  if (parts.brewery) return `${beer} · ${parts.brewery}${scorePct}`;
  return `${beer}${scorePct}`;
}

/** Prefer numbered series picker when ≥2 share a trailing-number base; else top 3 non-zero. */
function listDisplayCandidates(candidates) {
  const nonzero = (candidates || []).filter((c) => c && c.url && (c.score || 0) > 0);
  if (!nonzero.length) return { mode: 'none', items: [] };

  const withNum = nonzero.filter((c) => /-\d+$/.test(c.slug || ''));
  const byBase = new Map();
  for (const c of withNum) {
    const base = slugSeriesBase(c.slug);
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(c);
  }
  let series = null;
  for (const group of byBase.values()) {
    if (group.length >= 2 && (!series || group.length > series.length)) series = group;
  }
  if (series) {
    series = series.slice().sort((a, b) => String(a.slug).localeCompare(String(b.slug)));
    return { mode: 'series', items: series.slice(0, 5) };
  }
  return {
    mode: 'top',
    items: nonzero.slice().sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 3),
  };
}

function rowSourceBadge(row) {
  if (!row || (row.status || '') === 'pending' || row.status === 'loading') return '';
  if (row.source === 'export') return 'export';
  if (row.fromCache || row.source === 'cache') return 'saved';
  if (row.source === 'picked' || row.source === 'manual' || row.source === 'search') return 'searched';
  return row.confident ? 'searched' : '';
}

// --- DOM ---

const settingsToggle = document.getElementById('settings-toggle');
const settingsPanel = document.getElementById('settings-panel');
const openInAppInput = document.getElementById('open-in-app');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const clearCacheBtn = document.getElementById('clear-cache-btn');
const clearSessionBtn = document.getElementById('clear-session-btn');
const settingsStatus = document.getElementById('settings-status');
const breweryField = document.getElementById('brewery-field');
const breweryFieldWrap = document.getElementById('brewery-field-wrap');
const breweryChipRow = document.getElementById('brewery-chip-row');
const breweryChip = document.getElementById('brewery-chip');
const brewerySuggest = document.getElementById('brewery-suggest');
const brewerySuggestChips = document.getElementById('brewery-suggest-chips');
const breweryShelf = document.getElementById('brewery-shelf');
const breweryShelfToggle = document.getElementById('brewery-shelf-toggle');
const breweryShelfSummary = document.getElementById('brewery-shelf-summary');
const breweryShelfPanel = document.getElementById('brewery-shelf-panel');
const breweryShelfList = document.getElementById('brewery-shelf-list');
const beerField = document.getElementById('beer-field');
const beerMatchHint = document.getElementById('beer-match-hint');
const beerSuggest = document.getElementById('beer-suggest');
const beerSuggestChips = document.getElementById('beer-suggest-chips');
/** Brewery shelf open state while a brewery chip is selected. */
let breweryShelfOpen = false;
const pageLog = document.getElementById('page-log');
const pageTrends = document.getElementById('page-trends');
const navLog = document.getElementById('nav-log');
const navTrends = document.getElementById('nav-trends');
const trendsEmpty = document.getElementById('trends-empty');
const trendsContent = document.getElementById('trends-content');
const chartCheckinsEl = document.getElementById('chart-checkins');
const chartCheckinsAvgEl = document.getElementById('chart-checkins-avg');
const chartCheckinsBodyEl = document.getElementById('chart-checkins-body');
const chartRatingEl = document.getElementById('chart-rating');
const chartRatingAvgEl = document.getElementById('chart-rating-avg');
const chartRatingBodyEl = document.getElementById('chart-rating-body');
const chartBeersEl = document.getElementById('chart-beers');
const chartBeersAvgEl = document.getElementById('chart-beers-avg');
const chartBeersBodyEl = document.getElementById('chart-beers-body');
const chartBreweriesEl = document.getElementById('chart-breweries');
const chartBreweriesAvgEl = document.getElementById('chart-breweries-avg');
const chartBreweriesBodyEl = document.getElementById('chart-breweries-body');
const chartVenuesEl = document.getElementById('chart-venues');
const chartVenuesAvgEl = document.getElementById('chart-venues-avg');
const chartVenuesBodyEl = document.getElementById('chart-venues-body');
const addBeerBtn = document.getElementById('add-beer-btn');
const findLinksBtn = document.getElementById('find-links-btn');
const newBrewerBtn = document.getElementById('new-brewer-btn');
const entryStatus = document.getElementById('entry-status');
const entryCard = document.getElementById('entry-card');
const sessionPanel = document.getElementById('session-panel');
const sessionGroups = document.getElementById('session-groups');
const findStatsEl = document.getElementById('find-stats');
const appVersionEl = document.getElementById('app-version');
const updatedBadge = document.getElementById('updated-badge');
const whatsNew = document.getElementById('whats-new');
const beerDetail = document.getElementById('beer-detail');
const detailBannerText = document.getElementById('detail-banner-text');
const detailDoneBtn = document.getElementById('detail-done-btn');
const detailBeer = document.getElementById('detail-beer');
const detailBrewery = document.getElementById('detail-brewery');
const detailHadLine = document.getElementById('detail-had-line');
const detailStatusLine = document.getElementById('detail-status-line');
const detailCandidates = document.getElementById('detail-candidates');
const detailFixWrap = document.getElementById('detail-fix-wrap');
const detailFixUrl = document.getElementById('detail-fix-url');
const detailFixSave = document.getElementById('detail-fix-save');
const detailOpen = document.getElementById('detail-open');
const detailSearch = document.getElementById('detail-search');
const detailRetryBtn = document.getElementById('detail-retry-btn');
const detailFixBtn = document.getElementById('detail-fix-btn');
const detailRemoveBtn = document.getElementById('detail-remove-btn');
const detailStatus = document.getElementById('detail-status');
const importExportBtn = document.getElementById('import-export-btn');
const importExportInput = document.getElementById('import-export-input');
const libraryStatus = document.getElementById('library-status');
const hadPanel = document.getElementById('had-panel');
const hadCount = document.getElementById('had-count');
const hadSummary = document.getElementById('had-summary');
const hadList = document.getElementById('had-list');
const checkinEditor = document.getElementById('checkin-editor');
const checkinBannerText = document.getElementById('checkin-banner-text');
const checkinDoneBtn = document.getElementById('checkin-done-btn');
const checkinAdvancedToggle = document.getElementById('checkin-advanced-toggle');
const checkinAdvanced = document.getElementById('checkin-advanced');
const checkinIdField = document.getElementById('checkin-id-field');
const checkinStyle = document.getElementById('checkin-style');
const checkinAbv = document.getElementById('checkin-abv');
const checkinIbu = document.getElementById('checkin-ibu');
const checkinBid = document.getElementById('checkin-bid');
const checkinBreweryId = document.getElementById('checkin-brewery-id');
const checkinCity = document.getElementById('checkin-city');
const checkinState = document.getElementById('checkin-state');
const checkinPurchase = document.getElementById('checkin-purchase');
const checkinLat = document.getElementById('checkin-lat');
const checkinLng = document.getElementById('checkin-lng');
const checkinFacts = document.getElementById('checkin-facts');
const checkinWhen = document.getElementById('checkin-when');
const checkinBeer = document.getElementById('checkin-beer');
const checkinBrewery = document.getElementById('checkin-brewery');
const checkinRating = document.getElementById('checkin-rating');
const checkinServing = document.getElementById('checkin-serving');
const checkinVenue = document.getElementById('checkin-venue');
const checkinLocateBtn = document.getElementById('checkin-locate-btn');
const checkinLocationStatus = document.getElementById('checkin-location-status');
const checkinNearbyVenues = document.getElementById('checkin-nearby-venues');
const checkinNote = document.getElementById('checkin-note');
const checkinDeleteBtn = document.getElementById('checkin-delete-btn');

const SERVING_OPTIONS = ['Draft', 'Can', 'Bottle', 'Taster', 'Crowler', 'Growler', 'Cask', 'Nitro'];
/** Month keys the user has opened or closed. Missing → newest month open. */
const hadMonthOpen = new Map();
let editingCheckinId = null;

let session = loadSession();
let activeBrewery = '';
let lastFindStats = null;
/** @type {{ gid: string, bidx: number } | null} */
let editingDetail = null;

function setHint(el, msg, kind) {
  if (!el) return;
  el.hidden = !msg;
  el.textContent = msg || '';
  el.classList.toggle('hint-error', kind === 'error');
  el.classList.toggle('hint-ok', kind === 'ok');
}

function breweryCatalog() {
  const byKey = new Map();
  const push = (name, count = 1) => {
    const short = shortBreweryName(name);
    if (!short) return;
    const key = normalizeBreweryText(short);
    const prev = byKey.get(key);
    if (!prev) byKey.set(key, { name: short, count });
    else {
      prev.count += count;
      if (short.length < prev.name.length) prev.name = short;
    }
  };
  for (const h of loadBreweryHistory()) push(h.name, h.count || 1);
  const lib = loadLibrary();
  for (const checkin of lib.checkins || []) push(checkin.brewery || checkin.breweryFull, 1);
  for (const entry of Object.values(lib.beers || {})) push(entry.brewery || entry.breweryFull, entry.checkins || 1);
  return [...byKey.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function beerCatalog(breweryFilter = '') {
  const brewKey = breweryFilter ? normalizeBreweryText(breweryFilter) : '';
  const byKey = new Map();
  for (const checkin of loadLibrary().checkins || []) {
    const brewery = shortBreweryName(checkin.brewery || checkin.breweryFull || '');
    if (brewKey && normalizeBreweryText(brewery) !== brewKey) continue;
    const beer = String(checkin.beer || '').trim();
    if (!beer) continue;
    const key = cacheKey(brewery, beer);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, {
        beer,
        brewery,
        count: 1,
        lastHad: checkin.createdAt || '',
        rating: checkin.rating ?? null,
      });
    } else {
      prev.count += 1;
      if (checkinTime(checkin) >= checkinTime({ createdAt: prev.lastHad })) {
        prev.lastHad = checkin.createdAt || prev.lastHad;
        if (checkin.rating != null) prev.rating = checkin.rating;
      }
    }
  }
  return [...byKey.values()].sort((a, b) => (
    checkinTime({ createdAt: b.lastHad }) - checkinTime({ createdAt: a.lastHad })
    || b.count - a.count
    || a.beer.localeCompare(b.beer)
  ));
}

/** Unique beers for a brewery + avg of those beers' ratings (not re-weighted by check-ins). */
function breweryStats(brewery) {
  const name = shortBreweryName(brewery || '');
  const brewKey = normalizeBreweryText(name);
  if (!brewKey) {
    return { name: '', checkins: 0, beers: [], beerCount: 0, avg: null, ratedCount: 0 };
  }
  const byBeer = new Map();
  let checkinCount = 0;
  for (const checkin of loadLibrary().checkins || []) {
    if (normalizeBreweryText(checkin.brewery || checkin.breweryFull) !== brewKey) continue;
    checkinCount += 1;
    const beer = String(checkin.beer || '').trim();
    if (!beer) continue;
    const key = normalizeMatchText(beer);
    const prev = byBeer.get(key);
    if (!prev) {
      byBeer.set(key, {
        beer,
        brewery: name,
        rating: checkin.rating ?? null,
        lastHad: checkin.createdAt || '',
        checkins: 1,
      });
    } else {
      prev.checkins += 1;
      if (checkinTime(checkin) >= checkinTime({ createdAt: prev.lastHad })) {
        prev.lastHad = checkin.createdAt || prev.lastHad;
        if (checkin.rating != null) prev.rating = checkin.rating;
      }
    }
  }
  const beers = [...byBeer.values()].sort((a, b) => (
    checkinTime({ createdAt: b.lastHad }) - checkinTime({ createdAt: a.lastHad })
    || a.beer.localeCompare(b.beer)
  ));
  const rated = beers
    .map((b) => Number(b.rating))
    .filter((n) => Number.isFinite(n) && n > 0);
  const avg = rated.length
    ? rated.reduce((sum, n) => sum + n, 0) / rated.length
    : null;
  return {
    name,
    checkins: checkinCount,
    beers,
    beerCount: beers.length,
    avg,
    ratedCount: rated.length,
  };
}

function beerMatchState(brewery, beer) {
  const brew = shortBreweryName(brewery || '');
  const name = String(beer || '').trim();
  if (!name) return { kind: 'empty' };
  const hit = libraryLookup(brew, name);
  const had = hit && ((hit.checkins || 0) > 0 || !!hit.lastHad);
  if (!had) return { kind: 'new', brewery: brew, beer: name };
  const stats = breweryStats(hit.brewery || brew);
  return {
    kind: 'had',
    brewery: hit.brewery || brew,
    beer: hit.beer || name,
    rating: hit.rating ?? null,
    breweryAvg: stats.avg,
    breweryBeers: stats.beerCount,
  };
}

function filterCatalog(items, query, getText) {
  const q = normalizeMatchText(query);
  if (!q) return [];
  return items.filter((item) => {
    const text = normalizeMatchText(getText(item));
    return text.startsWith(q) || text.includes(` ${q}`) || text.includes(q);
  });
}

function shouldShowSuggest(query, matches) {
  const q = String(query || '').trim();
  if (!matches.length) return false;
  if (q.length >= 3) return true;
  return matches.length > 0 && matches.length <= 8 && q.length >= 1;
}

function hideSuggest(panel) {
  if (!panel) return;
  panel.hidden = true;
}

function renderSuggestChips(panel, chipsEl, matches, { label, sub, meta, dataAttr }) {
  if (!panel || !chipsEl) return;
  if (!matches.length) {
    hideSuggest(panel);
    chipsEl.innerHTML = '';
    return;
  }
  chipsEl.innerHTML = matches.slice(0, 8).map((item) => {
    const main = label(item);
    const secondary = sub ? sub(item) : '';
    const metaText = meta ? meta(item) : '';
    const value = dataAttr(item);
    return (
      `<button type="button" class="suggest-chip" role="option" data-value="${escapeHtml(value)}">` +
        `<span class="suggest-chip-main">${escapeHtml(main)}` +
          (secondary ? ` <span class="suggest-chip-sub">${escapeHtml(secondary)}</span>` : '') +
        `</span>` +
        (metaText ? `<span class="suggest-chip-meta">${escapeHtml(metaText)}</span>` : '') +
      `</button>`
    );
  }).join('');
  panel.hidden = false;
}

function refreshBrewerySuggest() {
  if (!brewerySuggest || !brewerySuggestChips || activeBrewery || breweryFieldWrap.hidden) {
    hideSuggest(brewerySuggest);
    return;
  }
  const query = breweryField.value;
  const matches = filterCatalog(breweryCatalog(), query, (item) => item.name);
  if (!shouldShowSuggest(query, matches)) {
    hideSuggest(brewerySuggest);
    brewerySuggestChips.innerHTML = '';
    return;
  }
  renderSuggestChips(brewerySuggest, brewerySuggestChips, matches, {
    label: (item) => item.name,
    meta: (item) => {
      const stats = breweryStats(item.name);
      if (stats.avg == null) return stats.beerCount ? `${stats.beerCount}` : '';
      return `${fmtAvg(stats.avg) || fmtRating(stats.avg)} avg`;
    },
    dataAttr: (item) => item.name,
  });
}

function updateBeerMatchHint() {
  if (!beerMatchHint) return;
  const brewery = activeBrewery || breweryField.value;
  const beer = beerField.value;
  const state = beerMatchState(brewery, beer);
  if (state.kind === 'empty') {
    beerMatchHint.hidden = true;
    beerMatchHint.textContent = '';
    beerMatchHint.classList.remove('is-had', 'is-new');
    return;
  }
  if (state.kind === 'had') {
    const bits = ['Had'];
    if (state.rating != null) bits.push(fmtRating(state.rating));
    if (state.breweryAvg != null) {
      bits.push(`${state.brewery || 'Brewery'} avg ${fmtAvg(state.breweryAvg) || fmtRating(state.breweryAvg)}`);
    }
    beerMatchHint.textContent = bits.join(' · ');
    beerMatchHint.classList.add('is-had');
    beerMatchHint.classList.remove('is-new');
    beerMatchHint.hidden = false;
    return;
  }
  // Only call a beer "new" once there's enough typed text to be meaningful.
  if (String(beer || '').trim().length < 3) {
    beerMatchHint.hidden = true;
    beerMatchHint.textContent = '';
    beerMatchHint.classList.remove('is-had', 'is-new');
    return;
  }
  beerMatchHint.textContent = brewery ? 'New to you' : 'New to you — pick a brewery first';
  beerMatchHint.classList.add('is-new');
  beerMatchHint.classList.remove('is-had');
  beerMatchHint.hidden = false;
}

function refreshBeerSuggest() {
  if (!beerSuggest || !beerSuggestChips) return;
  const brewery = activeBrewery || breweryField.value;
  const query = beerField.value;
  const matches = filterCatalog(beerCatalog(brewery), query, (item) => item.beer);
  updateBeerMatchHint();
  if (!shouldShowSuggest(query, matches)) {
    hideSuggest(beerSuggest);
    beerSuggestChips.innerHTML = '';
    return;
  }
  renderSuggestChips(beerSuggest, beerSuggestChips, matches, {
    label: (item) => item.beer,
    sub: (item) => (brewery ? '' : item.brewery),
    meta: (item) => (item.rating != null ? fmtRating(item.rating) : 'Had'),
    dataAttr: (item) => JSON.stringify({ beer: item.beer, brewery: item.brewery }),
  });
}

function renderBreweryShelf() {
  if (!breweryShelf || !breweryShelfSummary || !breweryShelfList) return;
  const name = (activeBrewery || '').trim();
  if (!name || breweryChipRow?.hidden) {
    breweryShelf.hidden = true;
    breweryShelfList.innerHTML = '';
    if (breweryShelfPanel) breweryShelfPanel.hidden = true;
    breweryShelfToggle?.setAttribute('aria-expanded', 'false');
    return;
  }
  const stats = breweryStats(name);
  if (!stats.beerCount) {
    breweryShelf.hidden = true;
    breweryShelfList.innerHTML = '';
    return;
  }
  const bits = [`${stats.beerCount} beer${stats.beerCount === 1 ? '' : 's'} you've had`];
  if (stats.avg != null) bits.push(`avg ${fmtAvg(stats.avg) || fmtRating(stats.avg)}`);
  breweryShelfSummary.textContent = bits.join(' · ');
  breweryShelfList.innerHTML = stats.beers.map((item) => {
    const rating = item.rating != null ? fmtRating(item.rating) : '';
    const when = fmtCheckinWhen(item.lastHad);
    return (
      `<li>` +
        `<button type="button" class="brewery-shelf-beer" data-beer="${escapeHtml(item.beer)}">` +
          `<span class="brewery-shelf-beer-name">${escapeHtml(item.beer)}</span>` +
          `<span class="brewery-shelf-beer-meta">` +
            (rating ? `<span class="brewery-shelf-rating">${escapeHtml(rating)}</span>` : '') +
            (when ? `<span class="brewery-shelf-when">${escapeHtml(when)}</span>` : '') +
          `</span>` +
        `</button>` +
      `</li>`
    );
  }).join('');
  breweryShelf.hidden = false;
  const open = breweryShelfOpen;
  if (breweryShelfPanel) breweryShelfPanel.hidden = !open;
  breweryShelfToggle?.setAttribute('aria-expanded', open ? 'true' : 'false');
  breweryShelf.classList.toggle('is-open', open);
}

function pickBrewerySuggest(name) {
  const brewery = shortBreweryName(name);
  if (!brewery) return;
  breweryField.value = brewery;
  activeBrewery = brewery;
  breweryShelfOpen = false;
  hideSuggest(brewerySuggest);
  syncBreweryChip();
  beerField.focus();
  refreshBeerSuggest();
}

function pickBeerSuggest(raw) {
  let payload = raw;
  try { payload = JSON.parse(raw); } catch { /* plain string */ }
  const beer = typeof payload === 'object' ? String(payload.beer || '') : String(payload || '');
  const brewery = typeof payload === 'object' ? String(payload.brewery || '') : '';
  if (!beer) return;
  if (brewery && !activeBrewery) {
    breweryField.value = shortBreweryName(brewery);
    activeBrewery = shortBreweryName(brewery);
    syncBreweryChip();
  }
  beerField.value = beer;
  hideSuggest(beerSuggest);
  updateBeerMatchHint();
  tryAddFromFields();
}

function syncBreweryChip() {
  const name = (activeBrewery || breweryField.value || '').trim();
  if (name) {
    activeBrewery = name;
    breweryChip.textContent = name;
    breweryChipRow.hidden = false;
    breweryFieldWrap.hidden = true;
    hideSuggest(brewerySuggest);
    renderBreweryShelf();
  } else {
    breweryChipRow.hidden = true;
    breweryFieldWrap.hidden = false;
    breweryShelfOpen = false;
    renderBreweryShelf();
    refreshBrewerySuggest();
  }
  updateBeerMatchHint();
}

function ensureGroup(brewery) {
  const name = shortBreweryName(brewery.trim());
  let group = session.groups.find((g) => normalizeBreweryText(g.brewery) === normalizeBreweryText(name));
  if (!group) {
    group = { id: `g-${Date.now()}`, brewery: name, collapsed: false, beers: [] };
    session.groups.unshift(group);
  } else {
    session.groups = [group, ...session.groups.filter((g) => g !== group)];
  }
  saveSession(session);
  return group;
}

function countPending() {
  let n = 0;
  for (const g of session.groups) {
    for (const row of g.beers) {
      if ((row.status || 'pending') === 'pending') n += 1;
    }
  }
  return n;
}

function updateFindButton() {
  const n = countPending();
  findLinksBtn.disabled = n === 0;
  findLinksBtn.textContent = n ? `Find links (${n})` : 'Find links';
}

function sessionOutcomeCounts() {
  let linked = 0;
  let needsPick = 0;
  let missed = 0;
  let pending = 0;
  for (const g of session.groups) {
    for (const row of g.beers) {
      const status = row.status || 'pending';
      if (status === 'pending' || status === 'loading') pending += 1;
      else if (status === 'error') missed += 1;
      else if (row.url && row.confident && !row.forceVariantPick) linked += 1;
      else if ((row.candidates || []).length) needsPick += 1;
      else missed += 1;
    }
  }
  return { linked, needsPick, missed, pending };
}

function updateFindStats() {
  if (!findStatsEl) return;
  const { linked, needsPick, missed, pending } = sessionOutcomeCounts();
  const parts = [];
  if (linked) parts.push(`${linked} linked`);
  if (needsPick) parts.push(`${needsPick} need a pick`);
  if (missed) parts.push(`${missed} missed`);
  if (pending) parts.push(`${pending} queued`);
  if (lastFindStats?.fromExport) parts.push(`${lastFindStats.fromExport} from export`);
  if (lastFindStats?.providerCalls) {
    const n = lastFindStats.providerCalls;
    parts.push(`${n} provider call${n === 1 ? '' : 's'}`);
  }
  if (!parts.length) {
    findStatsEl.hidden = true;
    findStatsEl.textContent = '';
    return;
  }
  findStatsEl.hidden = false;
  findStatsEl.textContent = parts.join(' · ');
}

function searchLinkHtml(brewery, beer) {
  const href = escapeHtml(untappdSearchHref(brewery, beer));
  return `<a class="untappd-search-link" href="${href}" target="_blank" rel="noopener noreferrer">${U_MARK}<span>Search Untappd</span></a>`;
}

function fixPanelHtml(groupId, idx) {
  return `
    <div class="fix-panel" hidden>
      <label class="hint" for="fix-${groupId}-${idx}">Paste the correct Untappd beer link</label>
      <div class="fix-row">
        <input type="url" id="fix-${groupId}-${idx}" class="fix-url" data-g="${escapeHtml(groupId)}" data-b="${idx}"
          placeholder="https://untappd.com/b/…" autocomplete="off">
        <button type="button" class="secondary-outline-btn fix-save" data-g="${escapeHtml(groupId)}" data-b="${idx}">Save</button>
      </div>
    </div>`;
}

function rowActionsHtml(group, row, idx, opts = {}) {
  const bits = [];
  if (opts.search) bits.push(searchLinkHtml(group.brewery, row.beer));
  if (opts.retry) {
    bits.push(`<button type="button" class="retry-btn" data-g="${escapeHtml(group.id)}" data-b="${idx}">Retry</button>`);
  }
  if (opts.fix) {
    bits.push(`<button type="button" class="fix-inline" data-g="${escapeHtml(group.id)}" data-b="${idx}">Fix</button>`);
  }
  if (!bits.length) return '';
  return `<div class="beer-row-actions">${bits.join('')}</div>`;
}

function candidatesHtml(group, row, idx) {
  const display = listDisplayCandidates(row.candidates || []);
  if (display.mode === 'none') {
    return `<p class="row-status row-status-miss">No Untappd match</p>`;
  }
  const heading = display.mode === 'series'
    ? 'Numbered releases — choose one'
    : (display.items.length === 1 ? 'Best match' : 'Choose a match');
  const items = display.items.map((c, cidx) => `
    <li>
      <button type="button" class="cand-btn" data-g="${escapeHtml(group.id)}" data-b="${idx}" data-c="${cidx}"
        data-url="${escapeHtml(c.url)}">
        <span class="cand-main">${escapeHtml(candidateLabel(c))}</span>
      </button>
    </li>`).join('');
  return `<p class="row-status row-status-pick">${heading}</p><ul class="cand-list">${items}</ul>`;
}

function rowKind(row) {
  const status = row.status || 'pending';
  if (status === 'pending') return 'pending';
  if (status === 'loading') return 'loading';
  if (status === 'error') return 'miss';
  if (row.url && row.confident && !row.forceVariantPick) return 'linked';
  if ((row.candidates || []).length) return 'pick';
  return 'miss';
}

function applyCanonicalBrewery(group, title) {
  const parts = parseTitleParts(title || '');
  const full = (parts.brewery || '').trim();
  if (!full) return;
  const canonical = shortBreweryName(full);
  const oldName = group.brewery;
  group.breweryFull = full;
  if (normalizeBreweryText(oldName) === normalizeBreweryText(canonical) && oldName === canonical) {
    touchBreweryHistory(canonical);
    return;
  }

  const other = session.groups.find(
    (g) => g !== group && normalizeBreweryText(g.brewery) === normalizeBreweryText(canonical)
  );
  if (other) {
    for (const beer of group.beers) other.beers.push(beer);
    session.groups = session.groups.filter((g) => g !== group);
    other.brewery = canonical;
    other.breweryFull = full;
    if (normalizeBreweryText(activeBrewery) === normalizeBreweryText(oldName)) activeBrewery = canonical;
    touchBreweryHistory(canonical);
    return other;
  }

  group.brewery = canonical;
  if (normalizeBreweryText(activeBrewery) === normalizeBreweryText(oldName)) {
    activeBrewery = canonical;
  }
  touchBreweryHistory(canonical);
  return group;
}

function normalizeSessionBreweries() {
  // Re-apply Untappd brewery names for already-linked rows (e.g. after upgrade).
  let changed = false;
  const before = JSON.stringify(session.groups.map((g) => g.brewery));
  for (const group of [...session.groups]) {
    for (const row of group.beers) {
      if (row.url && row.confident && row.title) applyCanonicalBrewery(group, row.title);
    }
  }
  const after = JSON.stringify(session.groups.map((g) => g.brewery));
  if (before !== after) {
    changed = true;
    saveSession(session);
  }
  return changed;
}

function hadBadgeHtml(row) {
  attachLibraryMeta(row, row._breweryHint || '');
  if (!row.had && !row.rating) return '';
  const rating = row.rating != null && row.rating !== '' ? Number(row.rating) : null;
  const label = Number.isFinite(rating)
    ? `Had ${rating % 1 ? rating.toFixed(1) : rating}`
    : 'Had';
  return `<span class="had-badge" title="From your Untappd check-ins">${escapeHtml(label)}</span>`;
}

function renderSession() {
  normalizeSessionBreweries();
  const has = session.groups.length > 0;
  sessionPanel.hidden = !has || !!editingDetail;
  updateFindButton();
  updateFindStats();
  syncBreweryChip();
  if (!has) {
    sessionGroups.innerHTML = '';
    return;
  }

  sessionGroups.innerHTML = session.groups.map((group) => {
    const beersHtml = group.beers.map((row, idx) => {
      const kind = rowKind(row);
      row._breweryHint = group.brewery;
      attachLibraryMeta(row, group.brewery);
      const titleName = kind === 'linked'
        ? displayBeerName(row, row.beer)
        : row.beer;
      let openBlock = '';
      if (kind === 'linked') {
        const href = escapeHtml(beerOpenHref(row.url, row.beerId || row.id || row.exportBid));
        openBlock = `
          <a class="beer-open" href="${href}" target="_blank" rel="noopener noreferrer">
            <span class="beer-open-label">Open in Untappd</span>
          </a>`;
      } else if (kind === 'pending') {
        openBlock = `<p class="row-status row-status-pending">${row.exportBid ? 'In your check-ins — Find links will use that' : 'Queued — tap Find links'}</p>`;
      } else if (kind === 'loading') {
        openBlock = `<p class="row-status">Finding link…</p>`;
      } else if (kind === 'pick') {
        openBlock = `<p class="row-status row-status-pick">Needs a pick — tap beer to choose</p>`;
      } else {
        openBlock = `<p class="row-status row-status-miss">${escapeHtml(row.error || 'No Untappd match')}</p>`;
      }

      const swipeClass = kind === 'pending' ? ' beer-row-pending' : '';
      const active = editingDetail && editingDetail.gid === group.id && String(editingDetail.bidx) === String(idx)
        ? ' is-editing'
        : '';
      return `
        <li class="beer-row beer-row--${kind}${swipeClass}${active}" data-g="${escapeHtml(group.id)}" data-b="${idx}">
          <div class="beer-row-top">
            <button type="button" class="beer-row-main" data-open-detail data-g="${escapeHtml(group.id)}" data-b="${idx}">
              <span class="status-pip" aria-hidden="true"></span>
              <strong class="beer-row-name">${escapeHtml(titleName)}</strong>
            </button>
            ${hadBadgeHtml(row)}
          </div>
          ${openBlock}
        </li>`;
    }).join('');

    const stats = breweryStats(group.brewery);
    const brewMeta = [
      String(group.beers.length),
      stats.avg != null ? `avg ${fmtAvg(stats.avg) || fmtRating(stats.avg)}` : '',
    ].filter(Boolean).join(' · ');
    return `
      <details class="brewer-group" data-gid="${escapeHtml(group.id)}" ${group.collapsed ? '' : 'open'}>
        <summary class="brewer-summary">${escapeHtml(shortBreweryName(group.brewery))}
          <span class="hint">${escapeHtml(brewMeta)}</span>
        </summary>
        <ul class="beer-list">${beersHtml || '<li class="hint">No beers yet</li>'}</ul>
      </details>`;
  }).join('');
}

function addBeerToList(brewery, beer) {
  const bName = shortBreweryName(brewery.trim());
  const beerName = beer.trim();
  if (!bName || !beerName) {
    setHint(entryStatus, 'Enter a brewery and beer name.', 'error');
    return false;
  }

  activeBrewery = bName;
  touchBreweryHistory(bName);
  const group = ensureGroup(bName);
  const dup = group.beers.find(
    (r) => normalizeMatchText(r.beer) === normalizeMatchText(beerName) && (r.status || 'pending') === 'pending'
  );
  if (dup) {
    setHint(entryStatus, 'Already on the list.', 'ok');
    syncBreweryChip();
    return true;
  }

  const row = {
    id: `b-${Date.now()}`,
    beer: beerName,
    status: 'pending',
    had: false,
  };
  attachLibraryMeta(row, bName);
  group.beers.unshift(row);
  saveSession(session);
  renderSession();
  const hadNote = row.had
    ? (row.rating != null ? ` · Had ${row.rating}` : ' · Had before')
    : '';
  setHint(entryStatus, `Queued ${beerName}${hadNote}. Add more or Find links.`, 'ok');
  return true;
}

function acceptMatch(row, match, source, group) {
  const title = cleanUntappdTitle(match.title || '') || row.beer;
  row.forceVariantPick = false;
  row.confident = true;
  row.url = match.url;
  row.title = title;
  row.beerId = match.id;
  row.slug = match.slug;
  row.source = source;
  if (parseTitleParts(title).beer) {
    row.displayBeer = parseTitleParts(title).beer;
  }
  if (group && match.url) {
    putCacheResolve(group.brewery, row.beer, {
      url: match.url,
      id: match.id,
      title,
      source: source === 'cache' ? 'cache' : source,
    });
  }
}

function applyResolvedRow(row, result, group) {
  row.status = 'done';
  row.fromCache = !!result.fromCache;
  row.source = result.fromCache ? 'cache' : (result.source || 'search');
  row.untappdSearchUrl = result.untappdSearchUrl || untappdSearchWebUrl(result.brewery, row.beer);
  row.error = '';

  const rawCands = (result.candidates || []).map((c) => ({
    ...c,
    title: cleanUntappdTitle(c.title || '') || c.title,
  }));
  if (result.best?.url && result.best.id) {
    const best = {
      ...result.best,
      title: cleanUntappdTitle(result.best.title || '') || result.best.title,
    };
    const hasBest = rawCands.some((c) => c.id === best.id);
    row.candidates = hasBest ? rawCands : [best, ...rawCands];
  } else {
    row.candidates = rawCands;
  }

  const display = listDisplayCandidates(row.candidates);
  if (display.mode === 'series' && display.items.length >= 2) {
    row.forceVariantPick = true;
    row.confident = false;
    row.url = null;
    row.title = null;
    row.beerId = null;
    row.slug = null;
    row.candidates = display.items;
    return;
  }

  // One clear hit → accept it. “Pick one” with a single option is noise.
  if (display.items.length === 1 && display.items[0]?.url) {
    acceptMatch(row, display.items[0], row.fromCache ? 'cache' : 'search', group);
    if (group) applyCanonicalBrewery(group, row.title);
    return;
  }

  row.forceVariantPick = false;
  if (result.confident && result.best?.url) {
    acceptMatch(row, {
      ...result.best,
      title: cleanUntappdTitle(result.best.title || '') || result.best.title,
    }, row.fromCache ? 'cache' : 'search', group);
    if (group) applyCanonicalBrewery(group, row.title);
    return;
  }

  row.confident = false;
  row.url = null;
  row.title = null;
  row.beerId = null;
  row.slug = null;
}

function pickCandidate(gid, bidx, url) {
  const found = findRow(gid, bidx);
  if (!found) return;
  const parsed = parseUntappdBeerUrl(url);
  if (!parsed) return;
  const c = (found.row.candidates || []).find((x) => x.url === url) || {};
  acceptMatch(found.row, {
    url: parsed.url,
    id: parsed.id,
    slug: parsed.slug,
    title: c.title || found.row.beer,
  }, 'picked', found.group);
  found.row.fromCache = false;
  found.row.status = 'done';
  applyCanonicalBrewery(found.group, found.row.title);
  saveSession(session);
  renderSession();
  renderDetailIfOpen();
  setHint(detailStatus || entryStatus, 'Saved your pick.', 'ok');
}

function removeBeer(gid, bidx) {
  const group = session.groups.find((g) => g.id === gid);
  if (!group) return;
  group.beers.splice(Number(bidx), 1);
  if (!group.beers.length) {
    session.groups = session.groups.filter((g) => g !== group);
  }
  saveSession(session);
  renderSession();
}

function resultFromLibrary(brewery, beer) {
  const hit = libraryLookup(brewery, beer);
  if (!hit?.bid && !hit?.beerUrl) return null;
  const url = hit.beerUrl || `https://untappd.com/beer/${hit.bid}`;
  const parsed = parseUntappdBeerUrl(url) || {
    url,
    id: hit.bid,
    beerId: hit.bid,
    slug: '',
  };
  return {
    fromCache: false,
    source: 'export',
    confident: true,
    best: {
      url: parsed.url,
      id: parsed.id || hit.bid,
      slug: parsed.slug || '',
      title: `${hit.beer} - ${hit.breweryFull || hit.brewery}`,
      score: 1.2,
    },
    candidates: [],
    untappdSearchUrl: untappdSearchWebUrl(brewery, beer),
    providerCalls: 0,
  };
}

async function findPendingLinks() {
  const jobs = [];
  for (const group of session.groups) {
    group.beers.forEach((row) => {
      if ((row.status || 'pending') === 'pending') jobs.push({ group, row });
    });
  }
  if (!jobs.length) {
    setHint(entryStatus, 'Add beers to the list first.', 'error');
    return;
  }

  for (const j of jobs) j.row.status = 'loading';
  saveSession(session);
  renderSession();
  setHint(entryStatus, `Finding ${jobs.length} link${jobs.length === 1 ? '' : 's'}…`);

  try {
    const needSearch = [];
    let saved = 0;
    let searched = 0;
    let fromExport = 0;
    for (const j of jobs) {
      attachLibraryMeta(j.row, j.group.brewery);
      const exported = resultFromLibrary(j.group.brewery, j.row.beer);
      if (exported) {
        applyResolvedRow(j.row, exported, j.group);
        j.row.source = 'export';
        j.row.had = true;
        fromExport += 1;
        continue;
      }
      needSearch.push(j);
    }

    if (needSearch.length) {
      const batch = await resolveBeerBatch(
        needSearch.map((j) => ({ brewery: j.group.brewery, beer: j.row.beer })),
        loadSettings()
      );
      const byKey = new Map(
        (batch.results || []).map((r) => [`${normalizeBreweryText(r.brewery)}|${normalizeMatchText(r.beer)}`, r])
      );
      for (const j of needSearch) {
        const key = `${normalizeBreweryText(j.group.brewery)}|${normalizeMatchText(j.row.beer)}`;
        const result = byKey.get(key);
        if (!result || result.error) {
          j.row.status = 'error';
          j.row.error = (result && result.error) || 'No result';
          searched += 1;
          continue;
        }
        applyResolvedRow(j.row, result, j.group);
        if (result.fromCache) saved += 1;
        else searched += 1;
      }
      lastFindStats = {
        searched,
        saved,
        fromExport,
        providerCalls: batch.providerCalls || 0,
      };
    } else {
      lastFindStats = {
        searched: 0,
        saved: 0,
        fromExport,
        providerCalls: 0,
      };
    }
    const outcome = sessionOutcomeCounts();
    const summary = [
      outcome.linked ? `${outcome.linked} linked` : '',
      fromExport ? `${fromExport} from export` : '',
      outcome.needsPick ? `${outcome.needsPick} need a pick` : '',
      outcome.missed ? `${outcome.missed} missed` : '',
    ].filter(Boolean).join(' · ') || 'Done';
    setHint(entryStatus, summary, outcome.linked && !outcome.missed ? 'ok' : outcome.missed ? 'error' : undefined);
  } catch (err) {
    for (const j of jobs) {
      if (j.row.status === 'loading') {
        j.row.status = 'error';
        j.row.error = err && err.message ? err.message : 'Resolve failed';
      }
    }
    setHint(entryStatus, err && err.message ? err.message : 'Resolve failed', 'error');
  }
  saveSession(session);
  renderSession();
}

async function retryBeer(gid, bidx) {
  const found = findRow(gid, bidx);
  if (!found) return;
  if (editingDetail && detailBeer?.value.trim()) {
    found.row.beer = detailBeer.value.trim();
  }
  found.row.status = 'loading';
  found.row.error = null;
  saveSession(session);
  renderSession();
  renderDetailIfOpen();
  setHint(detailStatus || entryStatus, `Retrying ${found.row.beer}…`);
  try {
    const exported = resultFromLibrary(found.group.brewery, found.row.beer);
    const result = exported
      || await resolveBeer(found.group.brewery, found.row.beer, loadSettings(), { bypassCache: true });
    applyResolvedRow(found.row, result, found.group);
    if (exported) {
      found.row.source = 'export';
      found.row.had = true;
    }
    const calls = result.providerCalls || (result.fromCache || exported ? 0 : 2);
    lastFindStats = {
      searched: exported ? 0 : 1,
      saved: result.fromCache ? 1 : 0,
      fromExport: exported ? 1 : 0,
      providerCalls: exported || result.fromCache ? 0 : calls,
    };
    const kind = rowKind(found.row);
    const msg = kind === 'linked'
      ? 'Linked.'
      : kind === 'pick'
        ? 'Still ambiguous — choose a match.'
        : 'No match — try Search Untappd or paste a link.';
    setHint(detailStatus || entryStatus, msg, kind === 'linked' ? 'ok' : kind === 'miss' ? 'error' : undefined);
  } catch (err) {
    found.row.status = 'error';
    found.row.error = err && err.message ? err.message : 'Retry failed';
    setHint(detailStatus || entryStatus, found.row.error, 'error');
  }
  saveSession(session);
  renderSession();
  renderDetailIfOpen();
}

function findRow(gid, bidx) {
  const group = session.groups.find((g) => g.id === gid);
  if (!group) return null;
  const row = group.beers[Number(bidx)];
  return group && row ? { group, row } : null;
}

function applyManualUrl(gid, bidx, urlInput) {
  const found = findRow(gid, bidx);
  if (!found) return;
  const parsed = parseUntappdBeerUrl(urlInput);
  if (!parsed) {
    setHint(entryStatus, 'Need an Untappd beer link (…/b/name/id).', 'error');
    return;
  }
  const { group, row } = found;
  row.url = parsed.url;
  row.beerId = parsed.id;
  row.slug = parsed.slug;
  row.title = row.beer;
  row.confident = true;
  row.forceVariantPick = false;
  row.status = 'done';
  row.source = 'manual';
  row.fromCache = false;
  row.candidates = [];
  putCacheResolve(group.brewery, row.beer, {
    url: parsed.url,
    id: parsed.id,
    title: row.beer,
    source: 'manual',
  });
  saveSession(session);
  renderSession();
  renderDetailIfOpen();
  setHint(detailStatus || entryStatus, 'Saved link.', 'ok');
}

function tryAddFromFields() {
  const brewery = shortBreweryName(activeBrewery || breweryField.value);
  const beer = beerField.value.trim();
  if (!brewery) {
    setHint(entryStatus, 'Set a brewery first.', 'error');
    breweryFieldWrap.hidden = false;
    breweryChipRow.hidden = true;
    breweryField.focus();
    return;
  }
  if (!beer) {
    setHint(entryStatus, 'Type a beer name.', 'error');
    beerField.focus();
    return;
  }
  breweryField.value = brewery;
  activeBrewery = brewery;
  if (addBeerToList(brewery, beer)) {
    beerField.value = '';
    beerField.focus();
  }
}

function closeBeerDetail() {
  if (editingDetail && detailBeer) {
    const found = findRow(editingDetail.gid, editingDetail.bidx);
    if (found && detailBeer.value.trim()) {
      found.row.beer = detailBeer.value.trim();
      saveSession(session);
    }
  }
  editingDetail = null;
  if (beerDetail) beerDetail.hidden = true;
  if (entryCard) entryCard.hidden = false;
  if (detailFixWrap) detailFixWrap.hidden = true;
  renderSession();
}

function openBeerDetail(gid, bidx) {
  const found = findRow(gid, bidx);
  if (!found || !beerDetail) return;
  editingDetail = { gid, bidx: Number(bidx) };
  const { group, row } = found;
  attachLibraryMeta(row, group.brewery);
  const kind = rowKind(row);
  detailBannerText.textContent = 'Beer details';
  detailBeer.value = row.beer;
  detailBrewery.textContent = shortBreweryName(group.brewery)
    + (group.breweryFull && shortBreweryName(group.breweryFull) !== shortBreweryName(group.brewery)
      ? ` · ${group.breweryFull}`
      : '');

  if (row.had || row.rating != null) {
    const bits = ['Had before'];
    if (row.rating != null && row.rating !== '') bits.push(`your rating ${row.rating}`);
    if (row.globalRating != null && row.globalRating !== '') bits.push(`Untappd ${row.globalRating}`);
    if (row.lastHad) bits.push(String(row.lastHad).slice(0, 10));
    detailHadLine.hidden = false;
    detailHadLine.textContent = bits.join(' · ');
  } else {
    detailHadLine.hidden = true;
    detailHadLine.textContent = '';
  }

  const statusMsg = {
    pending: 'Queued — not searched yet',
    loading: 'Finding link…',
    linked: 'Linked',
    pick: 'Choose a match below',
    miss: row.error || 'No Untappd match',
  }[kind] || kind;
  detailStatusLine.textContent = statusMsg;
  detailStatusLine.className = `hint row-status-${kind === 'linked' ? 'pending' : kind === 'miss' ? 'miss' : kind === 'pick' ? 'pick' : 'pending'}`;

  if (kind === 'pick') {
    detailCandidates.hidden = false;
    detailCandidates.innerHTML = candidatesHtml(group, row, Number(bidx));
  } else {
    detailCandidates.hidden = true;
    detailCandidates.innerHTML = '';
  }

  if (kind === 'linked' && row.url) {
    detailOpen.hidden = false;
    detailOpen.href = beerOpenHref(row.url, row.beerId || row.id || row.exportBid);
  } else {
    detailOpen.hidden = true;
    detailOpen.removeAttribute('href');
  }

  detailSearch.hidden = false;
  detailSearch.href = untappdSearchHref(group.brewery, row.beer);
  detailSearch.innerHTML = `${U_MARK}<span>Search Untappd</span>`;

  detailFixWrap.hidden = true;
  detailFixUrl.value = '';
  setHint(detailStatus, '');

  beerDetail.hidden = false;
  entryCard.hidden = true;
  sessionPanel.hidden = true;
  detailBeer.focus();
  detailBeer.select();
}

function renderDetailIfOpen() {
  if (!editingDetail) return;
  openBeerDetail(editingDetail.gid, editingDetail.bidx);
}

// Events

settingsToggle.addEventListener('click', () => {
  const opening = settingsPanel.hidden || !settingsPanel.classList.contains('is-open');
  setCollapsibleOpen(settingsPanel, opening);
  settingsToggle.setAttribute('aria-expanded', opening ? 'true' : 'false');
});

saveSettingsBtn.addEventListener('click', () => {
  const prev = loadSettings();
  saveSettings({
    resolveUrl: prev.resolveUrl,
    openInApp: !!openInAppInput.checked,
  });
  setHint(settingsStatus, 'Preferences saved on this device.', 'ok');
  renderSession();
});

clearCacheBtn.addEventListener('click', () => {
  clearResolveCache();
  setHint(settingsStatus, 'Saved links cleared.', 'ok');
});

clearSessionBtn.addEventListener('click', () => {
  clearSessionKeepCache();
  session = loadSession();
  lastFindStats = null;
  renderSession();
  setHint(settingsStatus, 'Session cleared (saved links kept).', 'ok');
});

addBeerBtn.addEventListener('click', () => tryAddFromFields());
findLinksBtn.addEventListener('click', () => { findPendingLinks(); });

newBrewerBtn.addEventListener('click', () => {
  activeBrewery = '';
  breweryShelfOpen = false;
  breweryField.value = '';
  beerField.value = '';
  syncBreweryChip();
  updateBeerMatchHint();
  breweryField.focus();
  setHint(entryStatus, 'New brewery — type a name.');
});

breweryChip.addEventListener('click', () => {
  breweryField.value = activeBrewery;
  breweryChipRow.hidden = true;
  breweryFieldWrap.hidden = false;
  breweryField.focus();
  breweryField.select();
});

breweryField.addEventListener('input', () => {
  activeBrewery = '';
  refreshBrewerySuggest();
});

breweryField.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const first = brewerySuggestChips?.querySelector('[data-value]');
    if (first && !brewerySuggest?.hidden) {
      pickBrewerySuggest(first.getAttribute('data-value'));
      return;
    }
    activeBrewery = shortBreweryName(breweryField.value);
    breweryField.value = activeBrewery;
    syncBreweryChip();
    beerField.focus();
  }
});

breweryField.addEventListener('change', () => {
  const v = shortBreweryName(breweryField.value);
  if (v) {
    breweryField.value = v;
    activeBrewery = v;
    syncBreweryChip();
  }
});

beerField.addEventListener('input', () => refreshBeerSuggest());

beerField.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const first = beerSuggestChips?.querySelector('[data-value]');
  if (first && !beerSuggest?.hidden) {
    pickBeerSuggest(first.getAttribute('data-value'));
    return;
  }
  tryAddFromFields();
});

sessionGroups.addEventListener('click', (e) => {
  const openBtn = e.target.closest('[data-open-detail]');
  if (openBtn) {
    // Don’t steal clicks on the Open in Untappd link inside the row.
    if (e.target.closest('a')) return;
    openBeerDetail(openBtn.dataset.g, openBtn.dataset.b);
  }
});

sessionGroups.addEventListener('toggle', (e) => {
  const details = e.target;
  if (!(details instanceof HTMLDetailsElement) || !details.classList.contains('brewer-group')) return;
  const g = session.groups.find((x) => x.id === details.dataset.gid);
  if (g) {
    g.collapsed = !details.open;
    saveSession(session);
  }
}, true);

// Swipe-to-remove pending beers
let swipeRow = null;
let swipeStartX = 0;
sessionGroups.addEventListener('touchstart', (e) => {
  const row = e.target.closest('.beer-row-pending');
  if (!row || e.target.closest('button, a, input')) return;
  swipeRow = row;
  swipeStartX = e.touches[0].clientX;
  row.style.transition = 'none';
}, { passive: true });
sessionGroups.addEventListener('touchmove', (e) => {
  if (!swipeRow) return;
  const dx = e.touches[0].clientX - swipeStartX;
  if (dx < 0) swipeRow.style.transform = `translateX(${Math.max(dx, -120)}px)`;
}, { passive: true });
sessionGroups.addEventListener('touchend', () => {
  if (!swipeRow) return;
  const row = swipeRow;
  swipeRow = null;
  const dx = parseFloat(String(row.style.transform).replace(/[^-\d.]/g, '')) || 0;
  row.style.transition = 'transform 0.2s ease';
  if (dx < -72) {
    removeBeer(row.dataset.g, row.dataset.b);
  } else {
    row.style.transform = '';
  }
});

// Version badge + what's new (same pattern as Gassy)
appVersionEl.textContent = versionLabel();
const lastSeenVersion = localStorage.getItem(LAST_SEEN_KEY);
if (lastSeenVersion && lastSeenVersion !== APP_VERSION) {
  updatedBadge.hidden = false;
}
localStorage.setItem(LAST_SEEN_KEY, APP_VERSION);

function renderWhatsNew() {
  const items = RELEASE_NOTES.map((note) => `<li>${escapeHtml(note)}</li>`).join('');
  whatsNew.innerHTML = `
    <div class="collapse-inner">
      <p class="whats-new-title">What's new in v${escapeHtml(APP_VERSION)}</p>
      <ul class="whats-new-list">${items}</ul>
    </div>
  `;
}

updatedBadge.addEventListener('click', () => {
  const opening = updatedBadge.getAttribute('aria-expanded') !== 'true';
  if (opening) renderWhatsNew();
  setCollapsibleOpen(whatsNew, opening);
  updatedBadge.setAttribute('aria-expanded', opening ? 'true' : 'false');
});

migrateBreweryHistory();
for (const g of session.groups) {
  g.brewery = shortBreweryName(g.brewery);
}
if (activeBrewery) activeBrewery = shortBreweryName(activeBrewery);
saveSession(session);
openInAppInput.checked = loadSettings().openInApp !== false;
if (libraryStatus) {
  libraryStatus.hidden = false;
  libraryStatus.textContent = librarySummaryText();
}
syncBreweryChip();
renderSession();
renderHadLog();
// Don't autofocus brewery on open — mobile browsers used to pop a native
// suggestion list over the first paint. Focus beer only when a brewery is set.
if (activeBrewery) beerField.focus();

brewerySuggestChips?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-value]');
  if (!btn) return;
  pickBrewerySuggest(btn.getAttribute('data-value'));
});
beerSuggestChips?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-value]');
  if (!btn) return;
  pickBeerSuggest(btn.getAttribute('data-value'));
});
breweryShelfToggle?.addEventListener('click', () => {
  breweryShelfOpen = !breweryShelfOpen;
  renderBreweryShelf();
});
breweryShelfList?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-beer]');
  if (!btn) return;
  beerField.value = btn.getAttribute('data-beer') || '';
  hideSuggest(beerSuggest);
  updateBeerMatchHint();
  beerField.focus();
});
navLog?.addEventListener('click', () => showPage('log'));
navTrends?.addEventListener('click', () => showPage('trends'));
checkinLocateBtn?.addEventListener('click', () => locateCheckinVenue());
checkinVenue?.addEventListener('change', () => maybeSuggestBreweryFromVenue());

detailDoneBtn?.addEventListener('click', () => closeBeerDetail());
detailRetryBtn?.addEventListener('click', () => {
  if (!editingDetail) return;
  retryBeer(editingDetail.gid, editingDetail.bidx);
});
detailFixBtn?.addEventListener('click', () => {
  if (!detailFixWrap) return;
  detailFixWrap.hidden = !detailFixWrap.hidden;
  if (!detailFixWrap.hidden) detailFixUrl?.focus();
});
detailFixSave?.addEventListener('click', () => {
  if (!editingDetail) return;
  applyManualUrl(editingDetail.gid, editingDetail.bidx, detailFixUrl?.value || '');
});
detailRemoveBtn?.addEventListener('click', () => {
  if (!editingDetail) return;
  const { gid, bidx } = editingDetail;
  editingDetail = null;
  if (beerDetail) beerDetail.hidden = true;
  if (entryCard) entryCard.hidden = false;
  removeBeer(gid, bidx);
});
detailBeer?.addEventListener('change', () => {
  if (!editingDetail) return;
  const found = findRow(editingDetail.gid, editingDetail.bidx);
  if (!found) return;
  found.row.beer = detailBeer.value.trim() || found.row.beer;
  saveSession(session);
});
detailCandidates?.addEventListener('click', (e) => {
  const cand = e.target.closest('.cand-btn');
  if (!cand) return;
  pickCandidate(cand.dataset.g, cand.dataset.b, cand.dataset.url);
});

function hadStatHtml(kind, value, label) {
  return (
    `<span class="stat stat-${kind}" role="listitem">` +
      `<span class="stat-value">${escapeHtml(value)}</span>` +
      `<span class="stat-label">${escapeHtml(label)}</span>` +
    `</span>`
  );
}

function checkinSummaryHtml(summary, { saved = 0 } = {}) {
  const bits = [];
  if (summary.avg != null) {
    const avgText = summary.count === 1 ? fmtRating(summary.avg) : fmtAvg(summary.avg);
    bits.push(hadStatHtml('rating', avgText, 'avg'));
  }
  // Unique beers only when they differ from the check-in count on the right.
  if (summary.beers && summary.beers !== summary.count) {
    bits.push(hadStatHtml('beers', String(summary.beers), summary.beers === 1 ? 'beer' : 'beers'));
  }
  if (summary.breweries) {
    bits.push(hadStatHtml(
      'breweries',
      String(summary.breweries),
      summary.breweries === 1 ? 'brewery' : 'breweries'
    ));
  }
  if (summary.venues) {
    bits.push(hadStatHtml(
      'venues',
      String(summary.venues),
      summary.venues === 1 ? 'venue' : 'venues'
    ));
  }
  if (saved) bits.push(hadStatHtml('saved', String(saved), 'saved'));
  return bits.join('');
}

function checkinCountLabel(count) {
  return `${count} check-in${count === 1 ? '' : 's'}`;
}

function isHadMonthOpen(key, groups) {
  if (hadMonthOpen.has(key)) return hadMonthOpen.get(key);
  if (key === 'saved') return groups.length === 0;
  return groups.length > 0 && groups[0].key === key;
}

function placeLine(checkin) {
  const city = checkin.venueCity
    ? [checkin.venueCity, checkin.venueState].filter(Boolean).join(', ')
    : '';
  return [checkin.venue, city].filter(Boolean).join(' · ');
}

function httpsLink(url, label) {
  if (!/^https?:/i.test(url || '')) return '';
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

function wishlistListsFor(checkin, lib) {
  return (lib.wishlist || []).filter((item) => {
    if (checkin.bid && item.bid && String(item.bid) === String(checkin.bid)) return true;
    return cacheKey(item.brewery || item.breweryFull, item.beer) === cacheKey(checkin.brewery, checkin.beer);
  }).flatMap((item) => item.lists || (item.listName ? [item.listName] : []));
}

function checkinFactsHtml(checkin, lib) {
  const lines = [];
  if (checkin.globalRating != null) {
    let text = `Untappd ${fmtRating(checkin.globalRating)}`;
    if (checkin.globalWeighted != null) text += ` · weighted ${fmtRating(checkin.globalWeighted)}`;
    lines.push(text);
  }
  if (checkin.flavors) lines.push(checkin.flavors);
  if (checkin.friends) lines.push(`With ${checkin.friends.split(',').map((name) => name.trim()).filter(Boolean).join(', ')}`);
  const breweryWhere = [checkin.breweryCity, checkin.breweryState].filter(Boolean).join(', ');
  if (breweryWhere) lines.push(`Brewery in ${breweryWhere}`);
  if (
    checkin.breweryFull
    && checkin.breweryFull !== checkin.brewery
    && normalizeBreweryText(checkin.breweryFull) === normalizeBreweryText(checkin.brewery)
  ) {
    lines.push(checkin.breweryFull);
  }
  const lists = [...new Set(wishlistListsFor(checkin, lib))];
  if (lists.length) lines.push(`Saved on ${lists.join(', ')}`);
  const toasts = Number(checkin.toasts) || 0;
  const comments = Number(checkin.commentsCount) || 0;
  if (toasts || comments) {
    const bits = [];
    if (toasts) bits.push(`${toasts} toast${toasts === 1 ? '' : 's'}`);
    if (comments) bits.push(`${comments} comment${comments === 1 ? '' : 's'}`);
    lines.push(bits.join(' · '));
  }
  const links = [
    httpsLink(checkin.photoUrl, 'Photo'),
    httpsLink(checkin.beerUrl, 'Beer page'),
    httpsLink(checkin.checkinUrl, 'Check-in'),
    httpsLink(checkin.breweryUrl, 'Brewery'),
  ].filter(Boolean);
  const body = lines.map((line) => `<p class="checkin-fact">${escapeHtml(line)}</p>`).join('');
  const linkRow = links.length ? `<p class="checkin-fact">${links.join(' · ')}</p>` : '';
  return body + linkRow;
}

function fillServingSelect(current) {
  const options = [...SERVING_OPTIONS];
  if (current && !options.includes(current)) options.unshift(current);
  checkinServing.innerHTML = '<option value="">—</option>'
    + options.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
  checkinServing.value = current || '';
}

function numField(value) {
  return value == null || value === '' ? '' : String(value);
}

function findCheckin(id) {
  return (loadLibrary().checkins || []).find((c) => String(c.id) === String(id)) || null;
}

function closeCheckinEditor() {
  editingCheckinId = null;
  if (checkinEditor) checkinEditor.hidden = true;
  setCollapsibleOpen(checkinAdvanced, false);
  checkinAdvancedToggle?.setAttribute('aria-expanded', 'false');
}

function openCheckinEditor(id) {
  const checkin = findCheckin(id);
  if (!checkin || !checkinEditor) return;
  editingCheckinId = String(checkin.id);
  const when = fmtCheckinWhen(checkin.createdAt);
  checkinBannerText.textContent = when || 'Check-in';
  checkinWhen.value = toDatetimeLocalValue(checkin.createdAt);
  checkinBeer.value = checkin.beer || '';
  checkinBrewery.value = checkin.brewery || checkin.breweryFull || '';
  checkinRating.value = fmtRating(checkin.rating);
  fillServingSelect(checkin.serving || '');
  checkinVenue.value = checkin.venue || '';
  if (checkinLocationStatus) checkinLocationStatus.textContent = '';
  if (checkinNearbyVenues) {
    checkinNearbyVenues.hidden = true;
    checkinNearbyVenues.innerHTML = '';
  }
  checkinNote.value = checkin.comment || '';
  checkinIdField.value = checkin.checkinId || '';
  checkinStyle.value = checkin.style || '';
  checkinAbv.value = numField(checkin.abv);
  checkinIbu.value = numField(checkin.ibu);
  checkinBid.value = checkin.bid || '';
  checkinBreweryId.value = checkin.breweryId || '';
  checkinCity.value = checkin.venueCity || '';
  checkinState.value = checkin.venueState || '';
  checkinPurchase.value = checkin.purchaseVenue || '';
  checkinLat.value = numField(checkin.venueLat);
  checkinLng.value = numField(checkin.venueLng);
  const facts = checkinFactsHtml(checkin, loadLibrary());
  checkinFacts.innerHTML = facts;
  checkinFacts.hidden = !facts;
  setCollapsibleOpen(checkinAdvanced, false);
  checkinAdvancedToggle.setAttribute('aria-expanded', 'false');
  checkinEditor.hidden = false;
  renderHadLog();
  checkinEditor.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
}

function parseBounded(raw, { min, max, zeroIsEmpty = false } = {}) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return undefined;
  if (zeroIsEmpty && n === 0) return null;
  if (min != null && n < min) return undefined;
  if (max != null && n > max) return undefined;
  return n;
}

function applyCheckinForm(existing) {
  const next = { ...existing };
  const beer = checkinBeer.value.trim();
  const typedBrewery = checkinBrewery.value.trim();
  if (beer) next.beer = beer;
  if (typedBrewery) {
    const unchanged = normalizeBreweryText(typedBrewery) === normalizeBreweryText(existing.brewery)
      || normalizeBreweryText(typedBrewery) === normalizeBreweryText(existing.breweryFull);
    next.brewery = shortBreweryName(typedBrewery);
    next.breweryFull = unchanged ? (existing.breweryFull || typedBrewery) : typedBrewery;
  }
  const createdAt = fromDatetimeLocalValue(checkinWhen.value);
  if (createdAt) next.createdAt = createdAt;
  const rating = parseBounded(checkinRating.value, { min: 0.25, max: 5, zeroIsEmpty: true });
  if (rating !== undefined) next.rating = rating;
  next.serving = checkinServing.value;
  next.venue = checkinVenue.value.trim();
  next.comment = checkinNote.value.trim();
  next.style = checkinStyle.value.trim();
  const abv = parseBounded(checkinAbv.value, { min: 0, max: 100, zeroIsEmpty: true });
  if (abv !== undefined) next.abv = abv;
  const ibu = parseBounded(checkinIbu.value, { min: 0, max: 5000, zeroIsEmpty: true });
  if (ibu !== undefined) next.ibu = ibu == null ? null : Math.round(ibu);
  const lat = parseBounded(checkinLat.value, { min: -90, max: 90 });
  if (lat !== undefined) next.venueLat = lat;
  const lng = parseBounded(checkinLng.value, { min: -180, max: 180 });
  if (lng !== undefined) next.venueLng = lng;
  next.venueCity = checkinCity.value.trim();
  next.venueState = checkinState.value.trim();
  next.purchaseVenue = checkinPurchase.value.trim();
  const bid = checkinBid.value.trim();
  if (bid !== String(existing.bid || '')) {
    next.bid = bid;
    if (bid) next.beerUrl = `https://untappd.com/beer/${bid}`;
  }
  return next;
}

function saveOpenCheckin() {
  if (!editingCheckinId) return false;
  const lib = loadLibrary();
  const idx = (lib.checkins || []).findIndex((c) => String(c.id) === editingCheckinId);
  if (idx < 0) return false;
  const beer = checkinBeer.value.trim();
  const brewery = checkinBrewery.value.trim();
  if (!beer || !brewery) return false;
  lib.checkins[idx] = applyCheckinForm(lib.checkins[idx]);
  rebuildBeerIndex(lib);
  saveLibrary(lib);
  hadMonthOpen.set(monthKeyFromCheckin(lib.checkins[idx].createdAt), true);
  return true;
}

function removeOpenCheckin() {
  if (!editingCheckinId) return;
  const lib = loadLibrary();
  lib.checkins = (lib.checkins || []).filter((c) => String(c.id) !== editingCheckinId);
  rebuildBeerIndex(lib);
  saveLibrary(lib);
}

function createCheckinElement(checkin) {
  const li = document.createElement('li');
  li.className = 'entry';
  if (String(checkin.id) === editingCheckinId) li.classList.add('is-editing');
  li.dataset.id = String(checkin.id);
  li.setAttribute('role', 'button');
  li.tabIndex = 0;
  const when = fmtCheckinWhen(checkin.createdAt);
  const rating = fmtRating(checkin.rating);
  const brewery = checkin.brewery || shortBreweryName(checkin.breweryFull || '');
  li.setAttribute(
    'aria-label',
    `Edit check-in, ${checkin.beer}${brewery ? `, ${brewery}` : ''}${rating ? `, rated ${rating}` : ''}${when ? `, ${when}` : ''}`
  );
  const where = placeLine(checkin);
  li.innerHTML = `
    <div class="entry-top">
      <span class="entry-name">${escapeHtml(checkin.beer)}</span>
      ${rating ? `<span class="entry-rating">${escapeHtml(rating)}</span>` : ''}
    </div>
    <div class="entry-meta">
      <span class="entry-brewery">${escapeHtml(brewery)}</span>
      ${when ? `<span class="entry-when">${escapeHtml(when)}</span>` : ''}
    </div>
    ${checkin.serving ? `<div class="entry-details">${escapeHtml(checkin.serving)}</div>` : ''}
    ${where ? `<div class="entry-location">📍 ${escapeHtml(where)}</div>` : ''}
    ${checkin.comment ? `<div class="entry-note">${escapeHtml(checkin.comment)}</div>` : ''}
    <span class="entry-chevron" aria-hidden="true">›</span>
  `;
  return li;
}

function createSavedElement(item) {
  const url = item.beerUrl || (item.bid ? `https://untappd.com/beer/${item.bid}` : '');
  const href = url ? beerOpenHref(url, item.bid) : '';
  const el = document.createElement(href ? 'a' : 'div');
  el.className = 'entry' + (href ? ' entry-link' : '');
  if (href) {
    el.href = href;
    if (!String(href).startsWith('untappd:')) {
      el.target = '_blank';
      el.rel = 'noopener noreferrer';
    }
  }
  const lists = (item.lists || []).filter(Boolean).join(', ');
  const brewery = item.brewery || shortBreweryName(item.breweryFull || '');
  el.innerHTML = `
    <div class="entry-top">
      <span class="entry-name">${escapeHtml(item.beer || 'Saved beer')}</span>
    </div>
    <div class="entry-details">${escapeHtml([brewery, lists].filter(Boolean).join(' · '))}</div>
    ${href ? '<span class="entry-chevron" aria-hidden="true">›</span>' : ''}
  `;
  return el;
}

function appendMonthGroup(parent, { key, label, countText, summaryHtml, spoken, open, fill }) {
  const monthLi = document.createElement('li');
  monthLi.className = 'month-group' + (open ? ' is-open' : '');
  monthLi.dataset.monthKey = key;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'month-toggle';
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  toggle.setAttribute(
    'aria-label',
    `${label}. ${spoken}. ${open ? 'Collapse' : 'Expand'}.`
  );
  toggle.innerHTML = `
    <span class="month-toggle-row">
      <span class="month-label">${escapeHtml(label)}</span>
      <span class="month-count">${escapeHtml(countText)}</span>
      <span class="month-chevron" aria-hidden="true">▾</span>
    </span>
    <span class="month-summary summary-stats">${summaryHtml}</span>
  `;
  toggle.addEventListener('click', () => {
    hadMonthOpen.set(key, !open);
    renderHadLog();
  });

  const panel = document.createElement('div');
  panel.className = 'month-panel';
  const inner = document.createElement('div');
  inner.className = 'collapse-inner';
  const list = document.createElement('ul');
  list.className = 'month-entries';
  if (open) fill(list);
  inner.appendChild(list);
  panel.appendChild(inner);
  monthLi.appendChild(toggle);
  monthLi.appendChild(panel);
  parent.appendChild(monthLi);
}

function renderHadLog() {
  if (!hadPanel || !hadList) return;
  const lib = loadLibrary();
  const groups = groupCheckinsByMonth(lib.checkins || []);
  const saved = wishlistOnly(lib).sort((a, b) => (
    normalizeBreweryText(a.brewery).localeCompare(normalizeBreweryText(b.brewery))
    || String(a.beer).localeCompare(String(b.beer))
  ));
  const hasLog = groups.length > 0 || saved.length > 0;
  hadPanel.hidden = !hasLog;
  if (libraryStatus) {
    libraryStatus.hidden = false;
    libraryStatus.textContent = librarySummaryText();
  }
  if (!hasLog) {
    hadList.replaceChildren();
    if (hadCount) hadCount.textContent = '';
    if (hadSummary) hadSummary.innerHTML = '';
    return;
  }

  const all = summarizeCheckins(lib.checkins || []);
  if (hadCount) {
    hadCount.textContent = groups.length ? String(all.count) : String(saved.length);
  }
  if (hadSummary) {
    hadSummary.innerHTML = checkinSummaryHtml(all, { saved: saved.length });
  }

  hadList.replaceChildren();
  for (const group of groups) {
    const open = isHadMonthOpen(group.key, groups);
    const summary = summarizeCheckins(group.checkins);
    const spoken = [
      checkinCountLabel(summary.count),
      summary.avg != null ? `${summary.count === 1 ? fmtRating(summary.avg) : fmtAvg(summary.avg)} average` : '',
      summary.breweries
        ? (summary.breweries === 1 ? '1 brewery' : `${summary.breweries} breweries`)
        : '',
    ].filter(Boolean).join(', ');
    appendMonthGroup(hadList, {
      key: group.key,
      label: monthLabelFromKey(group.key),
      countText: String(summary.count),
      summaryHtml: checkinSummaryHtml(summary),
      spoken,
      open,
      fill(list) {
        for (const checkin of group.checkins) list.appendChild(createCheckinElement(checkin));
      },
    });
  }

  if (saved.length) {
    const open = isHadMonthOpen('saved', groups);
    appendMonthGroup(hadList, {
      key: 'saved',
      label: 'Saved',
      countText: String(saved.length),
      summaryHtml: '<span class="month-note">Wish lists from your account file</span>',
      spoken: `${saved.length} saved beer${saved.length === 1 ? '' : 's'}`,
      open,
      fill(list) {
        for (const item of saved) list.appendChild(createSavedElement(item));
      },
    });
  }
}

window.TappdIn.renderHadLog = renderHadLog;

let locateGeneration = 0;
let isLocating = false;

function fetchWithTimeout(url, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, {
    signal: ctrl.signal,
    headers: { Accept: 'application/json', 'User-Agent': 'tappd-in/0.9 (local beer log)' },
  }).finally(() => clearTimeout(timer));
}

function beginLocating() {
  isLocating = true;
  checkinLocateBtn?.classList.add('is-locating');
  if (checkinLocateBtn) checkinLocateBtn.disabled = true;
  if (checkinLocationStatus) checkinLocationStatus.textContent = 'Finding location…';
}

function endLocating() {
  isLocating = false;
  checkinLocateBtn?.classList.remove('is-locating');
  if (checkinLocateBtn) checkinLocateBtn.disabled = false;
}

function cancelLocating() {
  locateGeneration += 1;
  endLocating();
}

function applyVenueBreweryHint(venueRecord) {
  const brewery = topBreweryForVenue(venueRecord);
  if (!brewery || !checkinBrewery) return;
  if (!checkinBrewery.value.trim()) {
    checkinBrewery.value = brewery;
    if (checkinLocationStatus) {
      checkinLocationStatus.textContent = `Usually ${brewery} here`;
    }
  }
}

function renderNearbyVenueChips(lat, lng) {
  if (!checkinNearbyVenues) return;
  const venues = Object.values(loadLibrary().venues || {})
    .filter((v) => v.lat != null && v.lng != null)
    .map((v) => ({ ...v, distance: distanceMeters(lat, lng, v.lat, v.lng) }))
    .filter((v) => v.distance <= 800)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5);
  checkinNearbyVenues.innerHTML = '';
  if (!venues.length) {
    checkinNearbyVenues.hidden = true;
    return;
  }
  checkinNearbyVenues.hidden = false;
  for (const venue of venues) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'venue-chip';
    chip.textContent = `${venue.name} · ${fmtDistance(venue.distance)}`;
    chip.addEventListener('click', () => {
      checkinVenue.value = venue.name;
      checkinCity.value = venue.city || '';
      checkinState.value = venue.state || '';
      checkinLat.value = numField(venue.lat);
      checkinLng.value = numField(venue.lng);
      applyVenueBreweryHint(venue);
      if (checkinLocationStatus) checkinLocationStatus.textContent = 'Saved venue nearby';
    });
    checkinNearbyVenues.appendChild(chip);
  }
}

async function reverseGeocodeVenue(latitude, longitude) {
  const generation = locateGeneration;
  beginLocating();
  checkinLat.value = String(latitude);
  checkinLng.value = String(longitude);
  renderNearbyVenueChips(latitude, longitude);
  try {
    const known = findVenueRecord('', latitude, longitude);
    if (known) {
      if (generation !== locateGeneration) return;
      checkinVenue.value = known.name;
      checkinCity.value = known.city || checkinCity.value;
      checkinState.value = known.state || checkinState.value;
      applyVenueBreweryHint(known);
      if (checkinLocationStatus) checkinLocationStatus.textContent = 'Matched a place you’ve checked in';
      return;
    }
    const res = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`
    );
    if (generation !== locateGeneration) return;
    if (!res.ok) throw new Error('geocode failed');
    const data = await res.json();
    const a = data.address || {};
    const place = data.name
      || a.amenity
      || a.shop
      || a.tourism
      || a.building
      || [a.road, a.neighbourhood].filter(Boolean).join(' ')
      || data.display_name?.split(',')[0]
      || '';
    if (place) checkinVenue.value = place;
    if (a.city || a.town || a.village) checkinCity.value = a.city || a.town || a.village;
    if (a.state) checkinState.value = a.state;
    const matched = findVenueRecord(place, latitude, longitude);
    if (matched) applyVenueBreweryHint(matched);
    if (checkinLocationStatus) {
      checkinLocationStatus.textContent = place ? 'Current location' : 'Coordinates saved — name the venue';
    }
  } catch {
    if (generation !== locateGeneration) return;
    if (!checkinVenue.value.trim()) {
      checkinVenue.value = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
    }
    if (checkinLocationStatus) checkinLocationStatus.textContent = 'Location offline — coordinates only';
  } finally {
    if (generation === locateGeneration) endLocating();
  }
}

function locateCheckinVenue() {
  if (isLocating) return;
  if (!('geolocation' in navigator)) {
    if (checkinLocationStatus) checkinLocationStatus.textContent = 'Geolocation not supported — enter manually';
    return;
  }
  if (editingCheckinId && checkinVenue.value.trim() && !checkinLat.value.trim()) {
    const ok = confirm('Replace this venue with your current location?');
    if (!ok) return;
  }
  const generation = ++locateGeneration;
  beginLocating();
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      if (generation !== locateGeneration) return;
      reverseGeocodeVenue(pos.coords.latitude, pos.coords.longitude);
    },
    () => {
      if (generation !== locateGeneration) return;
      cancelLocating();
      if (checkinLocationStatus) checkinLocationStatus.textContent = 'Location unavailable — enter manually';
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function maybeSuggestBreweryFromVenue() {
  const lat = parseBounded(checkinLat?.value, { min: -90, max: 90 });
  const lng = parseBounded(checkinLng?.value, { min: -180, max: 180 });
  const venue = findVenueRecord(
    checkinVenue?.value || '',
    lat === undefined ? null : lat,
    lng === undefined ? null : lng
  );
  if (venue) applyVenueBreweryHint(venue);
}

const MAX_CHART_POINTS = 16;
const GRAIN_PERIOD_UNIT = { week: '/wk', month: '/mo', quarter: '/qtr', year: '/yr' };
const GRAIN_ARIA = { week: 'week', month: 'month', quarter: 'quarter', year: 'year' };

function chooseTrendGrain(entriesOldestFirst) {
  const n = entriesOldestFirst.length;
  if (n < 1) return 'week';
  const t0 = checkinTime(entriesOldestFirst[0]);
  const t1 = checkinTime(entriesOldestFirst[n - 1]);
  if (!t0 || !t1) return 'month';
  const days = Math.max(1, (t1 - t0) / 86400000);
  const candidates = [
    { id: 'week', approx: days / 7 },
    { id: 'month', approx: days / 30.44 },
    { id: 'quarter', approx: days / 91.31 },
    { id: 'year', approx: days / 365.25 },
  ];
  for (const candidate of candidates) {
    if (candidate.approx <= MAX_CHART_POINTS) return candidate.id;
  }
  return 'year';
}

function isoWeekBucketKey(date) {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const year = utc.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function mondayOfIsoWeekKey(bucketKey) {
  const match = /^(\d{4})-W(\d{2})$/.exec(bucketKey);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (day - 1) + (week - 1) * 7);
  return new Date(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate());
}

function addLocalDays(date, n) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + n);
  return d;
}

function grainBucketKey(checkin, grain) {
  const d = parseCheckinDate(checkin.createdAt);
  if (!d) return 'unknown';
  const year = d.getFullYear();
  if (grain === 'week') return isoWeekBucketKey(d);
  if (grain === 'month') return `${year}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  if (grain === 'quarter') return `${year}-Q${Math.floor(d.getMonth() / 3) + 1}`;
  return String(year);
}

function seriesSpansYears(checkins) {
  const years = new Set();
  for (const checkin of checkins) {
    const d = parseCheckinDate(checkin.createdAt);
    if (d) years.add(d.getFullYear());
  }
  return years.size > 1;
}

function fmtChartBucketLabel(grain, bucketKey, sample, { includeYear = false } = {}) {
  if (bucketKey === 'unknown') return 'Unknown';
  if (grain === 'week') {
    const d = mondayOfIsoWeekKey(bucketKey) || (sample ? parseCheckinDate(sample.createdAt) : null);
    if (!d) return bucketKey;
    return d.toLocaleString(undefined, includeYear
      ? { month: 'short', day: 'numeric', year: '2-digit' }
      : { month: 'short', day: 'numeric' });
  }
  if (grain === 'month') {
    const [year, month] = bucketKey.split('-').map(Number);
    if (!year || !month) return bucketKey;
    const monthName = new Date(year, month - 1, 1).toLocaleString(undefined, { month: 'short' });
    return includeYear ? `${monthName} '${String(year).slice(2)}` : monthName;
  }
  if (grain === 'quarter') {
    const match = /^(\d{4})-Q([1-4])$/.exec(bucketKey);
    if (!match) return bucketKey;
    return includeYear ? `Q${match[2]} '${String(match[1]).slice(2)}` : `Q${match[2]}`;
  }
  return bucketKey;
}

function weekKeysSpanning(oldestFirst) {
  if (!oldestFirst.length) return [];
  const first = parseCheckinDate(oldestFirst[0].createdAt);
  const last = parseCheckinDate(oldestFirst[oldestFirst.length - 1].createdAt);
  if (!first || !last) return [];
  const keys = [];
  let cursor = mondayOfIsoWeekKey(isoWeekBucketKey(first));
  const endKey = isoWeekBucketKey(last);
  if (!cursor) return [];
  for (let i = 0; i < 400; i += 1) {
    const key = isoWeekBucketKey(cursor);
    keys.push(key);
    if (key === endKey) break;
    cursor = addLocalDays(cursor, 7);
  }
  return keys;
}

function collectBeerTrendSeries(checkinsNewestFirst) {
  const oldestFirst = [...checkinsNewestFirst].reverse();
  if (!oldestFirst.length) {
    return { checkins: [], ratings: [], beers: [], breweries: [], venues: [], grain: 'week' };
  }
  const grain = chooseTrendGrain(oldestFirst);
  const includeYear = seriesSpansYears(oldestFirst);
  const buckets = new Map();
  for (const checkin of oldestFirst) {
    const key = grainBucketKey(checkin, grain);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(checkin);
  }
  const bucketOrder = grain === 'week'
    ? weekKeysSpanning(oldestFirst)
    : [...buckets.keys()];
  const keys = bucketOrder.slice(-MAX_CHART_POINTS);
  const checkins = [];
  const ratings = [];
  const beers = [];
  const breweries = [];
  const venues = [];
  for (const key of keys) {
    const group = buckets.get(key) || [];
    const summary = summarizeCheckins(group);
    const label = fmtChartBucketLabel(grain, key, group[0], { includeYear });
    const point = (value) => ({ value, bucketKey: key, label });
    checkins.push(point(summary.count));
    beers.push(point(summary.beers));
    breweries.push(point(summary.breweries));
    venues.push(point(summary.venues));
    if (summary.avg != null) ratings.push(point(summary.avg));
  }
  return { checkins, ratings, beers, breweries, venues, grain };
}

function seriesStats(points) {
  if (!points.length) return null;
  const values = points.map((p) => p.value);
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    count: values.length,
    avg: sum / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    last: values[values.length - 1],
    first: values[0],
  };
}

function xAxisLabelIndexes(count) {
  if (count <= 1) return [0];
  if (count === 2) return [0, 1];
  if (count === 3) return [0, 1, 2];
  if (count <= 4) return [...Array(count).keys()];
  return [0, Math.round((count - 1) / 3), Math.round((2 * (count - 1)) / 3), count - 1];
}

function formatTrendDelta(delta, formatValue, avg) {
  const abs = Math.abs(delta);
  const threshold = Math.abs(avg) * 0.02 || 0.05;
  if (abs < threshold) return { text: '→', kind: 'flat' };
  return {
    text: `${delta > 0 ? '↑' : '↓'}${formatValue(abs)}`,
    kind: delta > 0 ? 'up' : 'down',
  };
}

function trendMetaChip(valueText, label, { kind = '' } = {}) {
  const kindClass = kind ? ` trend-chip-${kind}` : '';
  return (
    `<span class="trend-chip${kindClass}">` +
      `<span class="trend-chip-value">${escapeHtml(valueText)}</span>` +
      `<span class="trend-chip-label">${escapeHtml(label)}</span>` +
    `</span>`
  );
}

function trendChartY(value, min, max, height, padY) {
  const range = max - min || 1;
  return height - padY - ((value - min) / range) * (height - padY * 2);
}

function trendChartX(i, count, width) {
  return count === 1 ? width / 2 : (i / (count - 1)) * width;
}

function renderTrendChart(bodyEl, avgEl, {
  points,
  formatValue,
  unitLabel,
  stroke = 'rgba(232, 168, 56, 0.9)',
  fill = '#e8a838',
  ariaName,
  grain = 'month',
  mark = 'dotsLine',
}) {
  if (!bodyEl || !avgEl || !points || points.length < 1) {
    if (bodyEl) bodyEl.innerHTML = '';
    if (avgEl) avgEl.textContent = '';
    return false;
  }
  const recent = points.slice(-MAX_CHART_POINTS);
  const all = seriesStats(points);
  const windowStats = seriesStats(recent);
  const delta = windowStats.last - windowStats.first;
  const deltaInfo = formatTrendDelta(delta, formatValue, windowStats.avg);
  const grainWord = GRAIN_ARIA[grain] || 'period';
  const useColumns = mark === 'columns';
  avgEl.textContent = unitLabel
    ? `Avg ${formatValue(all.avg)} ${unitLabel}`
    : `Avg ${formatValue(all.avg)}`;

  const width = 280;
  const height = 88;
  const padY = 8;
  const min = useColumns ? 0 : windowStats.min;
  const max = useColumns ? Math.max(windowStats.max, 1) : windowStats.max;
  const avgY = trendChartY(windowStats.avg, min, max, height, padY);

  let svgMarks = '';
  if (useColumns) {
    const n = recent.length;
    const slot = width / n;
    const barW = Math.max(2, slot * 0.78);
    svgMarks = recent.map((point, i) => {
      const x = i * slot + (slot - barW) / 2;
      const y = trendChartY(point.value, min, max, height, padY);
      const h = point.value === 0 ? 0 : Math.max(1.5, height - padY - y);
      const opacity = point.value === 0 ? 0.22 : 0.9;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}"
        rx="2" fill="${fill}" opacity="${opacity}" />`;
    }).join('');
  } else {
    const coords = recent.map((point, i) => ({
      x: trendChartX(i, recent.length, width),
      y: trendChartY(point.value, min, max, height, padY),
    }));
    const pointsAttr = coords.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const dots = coords.map((c, i) => {
      const isLast = i === coords.length - 1;
      return `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${isLast ? 3.5 : 2.8}"
        fill="${fill}" opacity="${isLast ? 1 : 0.85}" />`;
    }).join('');
    svgMarks = `
      ${coords.length >= 2 ? `<polyline fill="none" stroke="${stroke}" stroke-width="1.75"
        stroke-linecap="round" stroke-linejoin="round" points="${pointsAttr}" opacity="0.85" />` : ''}
      ${dots}
    `;
  }

  const xLabels = xAxisLabelIndexes(recent.length).map((i) => {
    const pct = recent.length === 1 ? 50 : (i / (recent.length - 1)) * 100;
    return `<span style="left:${pct.toFixed(2)}%">${escapeHtml(recent[i].label)}</span>`;
  }).join('');

  const metaHtml = recent.length === 1
    ? trendMetaChip(formatValue(windowStats.last), 'now', { kind: 'now' })
    : [
      trendMetaChip(formatValue(windowStats.max), 'high', { kind: 'high' }),
      trendMetaChip(formatValue(windowStats.min), 'low', { kind: 'low' }),
      trendMetaChip(formatValue(windowStats.last), 'now', { kind: 'now' }),
      trendMetaChip(deltaInfo.text, 'change', { kind: deltaInfo.kind }),
    ].join('');

  bodyEl.setAttribute(
    'aria-label',
    `${ariaName} by ${grainWord} over ${recent.length} ${grainWord}${recent.length === 1 ? '' : 's'}. Latest ${formatValue(windowStats.last)}, average ${formatValue(windowStats.avg)}.`
  );
  bodyEl.innerHTML = `
    <div class="trend-chart-plot">
      <div class="trend-chart-scale" aria-hidden="true">
        <span>${escapeHtml(formatValue(max))}</span>
        <span>${escapeHtml(formatValue(windowStats.avg))}</span>
        <span>${escapeHtml(formatValue(min))}</span>
      </div>
      <div class="trend-chart-svg-wrap">
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <line x1="0" y1="${avgY.toFixed(1)}" x2="${width}" y2="${avgY.toFixed(1)}"
            stroke="rgba(168, 152, 128, 0.35)" stroke-width="1" stroke-dasharray="4 4" />
          ${svgMarks}
        </svg>
        <div class="trend-chart-x" aria-hidden="true">${xLabels}</div>
      </div>
    </div>
    <p class="trend-chart-meta">${metaHtml}</p>
  `;
  return true;
}

function renderTrends() {
  const checkins = [...(loadLibrary().checkins || [])].sort((a, b) => checkinTime(b) - checkinTime(a));
  const series = collectBeerTrendSeries(checkins);
  const period = GRAIN_PERIOD_UNIT[series.grain] || '/mo';
  const intFmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  const checkinsOk = renderTrendChart(chartCheckinsBodyEl, chartCheckinsAvgEl, {
    points: series.checkins,
    formatValue: intFmt,
    unitLabel: period,
    stroke: 'rgba(200, 160, 255, 0.95)',
    fill: '#c8a0ff',
    ariaName: 'Check-ins',
    grain: series.grain,
    mark: 'columns',
  });
  const ratingOk = renderTrendChart(chartRatingBodyEl, chartRatingAvgEl, {
    points: series.ratings,
    formatValue: (n) => fmtAvg(n) || fmtRating(n) || '0',
    unitLabel: '',
    stroke: 'rgba(232, 168, 56, 0.95)',
    fill: '#e8a838',
    ariaName: 'Average rating',
    grain: series.grain,
    mark: 'dotsLine',
  });
  const beersOk = renderTrendChart(chartBeersBodyEl, chartBeersAvgEl, {
    points: series.beers,
    formatValue: intFmt,
    unitLabel: period,
    stroke: 'rgba(120, 210, 160, 0.95)',
    fill: '#78d2a0',
    ariaName: 'Unique beers',
    grain: series.grain,
    mark: 'columns',
  });
  const breweriesOk = renderTrendChart(chartBreweriesBodyEl, chartBreweriesAvgEl, {
    points: series.breweries,
    formatValue: intFmt,
    unitLabel: period,
    stroke: 'rgba(110, 180, 255, 0.95)',
    fill: '#6eb4ff',
    ariaName: 'Breweries',
    grain: series.grain,
    mark: 'columns',
  });
  const venuesOk = series.venues.some((p) => p.value > 0) && renderTrendChart(chartVenuesBodyEl, chartVenuesAvgEl, {
    points: series.venues,
    formatValue: intFmt,
    unitLabel: period,
    stroke: 'rgba(255, 180, 70, 0.95)',
    fill: '#ffb446',
    ariaName: 'Venues',
    grain: series.grain,
    mark: 'columns',
  });

  if (chartCheckinsEl) chartCheckinsEl.hidden = !checkinsOk;
  if (chartRatingEl) chartRatingEl.hidden = !ratingOk;
  if (chartBeersEl) chartBeersEl.hidden = !beersOk;
  if (chartBreweriesEl) chartBreweriesEl.hidden = !breweriesOk;
  if (chartVenuesEl) chartVenuesEl.hidden = !venuesOk;

  const any = checkinsOk || ratingOk || beersOk || breweriesOk || venuesOk;
  if (trendsContent) trendsContent.hidden = !any;
  if (trendsEmpty) trendsEmpty.hidden = any;
}

function showPage(page) {
  const onTrends = page === 'trends';
  if (pageLog) pageLog.hidden = onTrends;
  if (pageTrends) pageTrends.hidden = !onTrends;
  navLog?.classList.toggle('is-active', !onTrends);
  navTrends?.classList.toggle('is-active', onTrends);
  if (onTrends) {
    navLog?.removeAttribute('aria-current');
    navTrends?.setAttribute('aria-current', 'page');
    renderTrends();
  } else {
    navTrends?.removeAttribute('aria-current');
    navLog?.setAttribute('aria-current', 'page');
  }
}

function refreshAfterLibraryChange() {
  closeCheckinEditor();
  migrateBreweryHistory();
  syncBreweryChip();
  renderSession();
  renderHadLog();
  if (!pageTrends?.hidden) renderTrends();
}

checkinAdvancedToggle?.addEventListener('click', () => {
  const opening = checkinAdvanced.hidden || !checkinAdvanced.classList.contains('is-open');
  setCollapsibleOpen(checkinAdvanced, opening);
  checkinAdvancedToggle.setAttribute('aria-expanded', opening ? 'true' : 'false');
});

checkinDoneBtn?.addEventListener('click', () => {
  closeCheckinEditor();
  renderHadLog();
});

checkinEditor?.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!saveOpenCheckin()) return;
  closeCheckinEditor();
  renderSession();
  renderHadLog();
});

checkinDeleteBtn?.addEventListener('click', () => {
  if (!editingCheckinId) return;
  if (!confirm('Remove this check-in from this device?')) return;
  removeOpenCheckin();
  closeCheckinEditor();
  renderSession();
  renderHadLog();
});

hadList?.addEventListener('click', (e) => {
  if (e.target.closest('.month-toggle, a')) return;
  const li = e.target.closest('.entry[data-id]');
  if (!li) return;
  openCheckinEditor(li.dataset.id);
});

hadList?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const li = e.target.closest?.('.entry[data-id]');
  if (!li || e.target !== li) return;
  e.preventDefault();
  openCheckinEditor(li.dataset.id);
});

importExportBtn?.addEventListener('click', () => importExportInput?.click());
importExportInput?.addEventListener('change', async () => {
  const files = [...(importExportInput.files || [])];
  if (!files.length) return;
  let csvRows = 0;
  let wishN = 0;
  try {
    for (const file of files) {
      const text = await file.text();
      if (/\.json$/i.test(file.name) || text.trim().startsWith('{')) {
        const r = importAccountJson(text);
        wishN += r.wish || 0;
      } else {
        const r = importCheckinsCsv(text);
        csvRows = r.rows;
      }
    }
    refreshAfterLibraryChange();
    const parts = [];
    if (csvRows) parts.push(`Imported ${csvRows} check-in${csvRows === 1 ? '' : 's'}`);
    if (wishN) parts.push(`Noted ${wishN} saved beer${wishN === 1 ? '' : 's'}`);
    const newest = groupCheckinsByMonth(loadLibrary().checkins || [])[0];
    if (newest) hadMonthOpen.set(newest.key, true);
    renderHadLog();
    setHint(settingsStatus, `${parts.join('. ')}.`, 'ok');
  } catch (err) {
    setHint(settingsStatus, err?.message || 'Import failed', 'error');
  }
  importExportInput.value = '';
});

// --- Service worker: offline caching only. Updates apply via pull-to-refresh. ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// --- Pull-to-refresh: check for + apply an update (Gassy-style) ---
const ptrIndicator = document.getElementById('ptr-indicator');
const appContent = document.getElementById('app-content');
const PTR_THRESHOLD = 70;
const PTR_MAX = 110;
let ptrStartY = null;
let ptrPulling = false;
let ptrReady = false;
let ptrRefreshing = false;

document.addEventListener('touchstart', (e) => {
  if (ptrRefreshing) return;
  if (window.scrollY <= 0) {
    ptrStartY = e.touches[0].clientY;
    ptrPulling = true;
  }
}, { passive: true });

document.addEventListener('touchmove', (e) => {
  if (!ptrPulling || ptrStartY == null) return;
  const delta = e.touches[0].clientY - ptrStartY;
  if (delta > 0 && window.scrollY <= 0) {
    e.preventDefault();
    const pull = Math.min(delta * 0.55, PTR_MAX);
    ptrReady = pull >= PTR_THRESHOLD;
    if (prefersReducedMotion()) {
      ptrIndicator.style.opacity = ptrReady ? '1' : '0.35';
      return;
    }
    appContent.classList.add('ptr-dragging');
    ptrIndicator.classList.add('ptr-dragging');
    appContent.style.transform = `translateY(${pull}px)`;
    ptrIndicator.style.transform = `translateY(${pull - 30}px)`;
    ptrIndicator.style.opacity = String(Math.min(pull / PTR_THRESHOLD, 1));
  } else {
    ptrPulling = false;
  }
}, { passive: false });

document.addEventListener('touchend', () => {
  if (!ptrPulling) return;
  ptrPulling = false;
  appContent.classList.remove('ptr-dragging');
  ptrIndicator.classList.remove('ptr-dragging');
  if (ptrReady) {
    triggerPullRefresh();
  } else {
    appContent.style.transform = '';
    ptrIndicator.style.transform = '';
    ptrIndicator.style.opacity = '';
  }
  ptrReady = false;
});

async function triggerPullRefresh() {
  ptrRefreshing = true;
  ptrIndicator.style.opacity = '1';
  if (!prefersReducedMotion()) {
    ptrIndicator.classList.add('ptr-spinning');
    appContent.style.transform = 'translateY(56px)';
    ptrIndicator.style.transform = 'translateY(24px)';
  }

  try {
    await Promise.allSettled([
      fetch('manifest.webmanifest', { cache: 'reload' }),
      fetch('index.html', { cache: 'reload' }),
      fetch('app.js', { cache: 'reload' }),
      fetch('style.css', { cache: 'reload' }),
      fetch('sw.js', { cache: 'reload' }),
      fetch('icons/icon-192.png', { cache: 'reload' }),
      fetch('icons/icon-512.png', { cache: 'reload' }),
      fetch('icons/apple-touch-icon.png', { cache: 'reload' }),
      fetch('icons/favicon-32.png', { cache: 'reload' }),
    ]);
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.update();
        const worker = reg.waiting || reg.installing;
        if (worker) {
          worker.postMessage('SKIP_WAITING');
          await new Promise((resolve) => {
            let done = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
              done = true;
              resolve();
            }, { once: true });
            setTimeout(() => { if (!done) resolve(); }, 1500);
          });
        }
      }
    }
  } catch {
    // Network or SW issue — fall through to a plain reload.
  }
  window.location.reload();
}
