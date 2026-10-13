/* Tappd In — quick brewery/beer entry → exact Untappd URLs (vanilla PWA) */

const SETTINGS_KEY = 'tappd-in.settings';
const LAST_SEEN_KEY = 'tappd-in.lastSeenVersion';
const CACHE_KEY = 'tappd-in.resolveCache';
const HISTORY_KEY = 'tappd-in.breweryHistory';
const SESSION_KEY = 'tappd-in.session';
const LIBRARY_KEY = 'tappd-in.beerLibrary';

const APP_VERSION = '0.7.0-beta';
// Short build id while iterating — set e.g. 'a1', clear before tagging a release.
// Never shown on the live Pages host even if forgotten.
const PREVIEW_BUILD = '';
const PRODUCTION_HOST = 'jr00ck.github.io';
const RELEASE_NOTES = [
  'Import Untappd check-ins CSV — Had + your rating without Search',
  'Short brewery names (North Park) with no Recent duplicates',
  'Tap a beer to edit / retry / paste link (Gassy-style detail)',
  'Main list is search → view → open; edits stay in the detail card',
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
  return { version: 1, importedAt: null, checkinCount: 0, beers: {}, wishBids: {} };
}

function loadLibrary() {
  const lib = loadJson(LIBRARY_KEY, null);
  if (!lib || typeof lib !== 'object' || !lib.beers) return emptyLibrary();
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

function importCheckinsCsv(text) {
  const rows = parseCsv(text);
  const lib = loadLibrary();
  let added = 0;
  const brewCounts = new Map();
  for (const r of rows) {
    const beer = String(r.beer_name || '').trim();
    const breweryFull = String(r.brewery_name || '').trim();
    const bid = String(r.bid || '').trim();
    if (!beer || !breweryFull) continue;
    const brewery = shortBreweryName(breweryFull);
    const key = cacheKey(brewery, beer);
    const rating = r.rating_score !== '' && r.rating_score != null ? Number(r.rating_score) : null;
    const globalRating = r.global_rating_score !== '' && r.global_rating_score != null
      ? Number(r.global_rating_score)
      : null;
    const prev = lib.beers[key];
    lib.beers[key] = {
      beer,
      brewery,
      breweryFull,
      bid: bid || prev?.bid || '',
      beerUrl: String(r.beer_url || '').trim() || (bid ? `https://untappd.com/beer/${bid}` : ''),
      rating: Number.isFinite(rating) ? rating : prev?.rating ?? null,
      globalRating: Number.isFinite(globalRating) ? globalRating : prev?.globalRating ?? null,
      lastHad: String(r.created_at || '').trim() || prev?.lastHad || null,
      checkins: (prev?.checkins || 0) + 1,
    };
    added += 1;
    brewCounts.set(normalizeBreweryText(brewery), {
      name: brewery,
      count: (brewCounts.get(normalizeBreweryText(brewery))?.count || 0) + 1,
    });
  }
  lib.checkinCount = Object.values(lib.beers).reduce((n, b) => n + (b.checkins || 1), 0);
  lib.importedAt = new Date().toISOString();
  saveLibrary(lib);

  // Seed Recent with top exported breweries (short names, deduped).
  const top = [...brewCounts.values()].sort((a, b) => b.count - a.count).slice(0, 20);
  for (const b of top.reverse()) touchBreweryHistory(b.name);
  migrateBreweryHistory();
  return { beers: Object.keys(lib.beers).length, rows: added };
}

function importAccountJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Account file is not valid JSON.');
  }
  const lib = loadLibrary();
  lib.wishBids = lib.wishBids || {};
  let wish = 0;
  const lists = Array.isArray(data.custom_lists) ? data.custom_lists : [];
  for (const list of lists) {
    if (!list || !Array.isArray(list.items)) continue;
    for (const item of list.items) {
      if (item.item_type !== 'beer') continue;
      const bid = String(item.item_id || item.bid || '').trim();
      const beer = String(item.beer_name || '').trim();
      const breweryFull = String(item.beer_brewery_name || item.brewery_name || '').trim();
      if (!bid && !beer) continue;
      if (bid) lib.wishBids[bid] = true;
      if (beer && breweryFull) {
        const brewery = shortBreweryName(breweryFull);
        const key = cacheKey(brewery, beer);
        if (!lib.beers[key]) {
          lib.beers[key] = {
            beer,
            brewery,
            breweryFull,
            bid,
            beerUrl: bid ? `https://untappd.com/beer/${bid}` : '',
            rating: null,
            globalRating: null,
            lastHad: null,
            checkins: 0,
            wishlist: true,
          };
        } else {
          lib.beers[key].wishlist = true;
          if (bid && !lib.beers[key].bid) lib.beers[key].bid = bid;
        }
      }
      wish += 1;
    }
  }
  lib.importedAt = new Date().toISOString();
  saveLibrary(lib);
  return { wish };
}

function librarySummaryText() {
  const lib = loadLibrary();
  const n = Object.keys(lib.beers || {}).length;
  if (!n) return 'No check-ins imported yet.';
  const when = lib.importedAt ? new Date(lib.importedAt).toLocaleDateString() : '';
  return `${n} beers in library${when ? ` · imported ${when}` : ''}`;
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
  libraryLookup,
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
const breweryRecent = document.getElementById('brewery-recent');
const breweryRecentChips = document.getElementById('brewery-recent-chips');
const beerField = document.getElementById('beer-field');
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

function refreshBrewerySuggestions() {
  if (!breweryRecent || !breweryRecentChips) return;
  const hist = loadBreweryHistory()
    .slice()
    .sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0) || (b.count || 0) - (a.count || 0))
    .slice(0, 6);
  if (!hist.length || activeBrewery) {
    breweryRecent.hidden = true;
    breweryRecentChips.innerHTML = '';
    return;
  }
  breweryRecentChips.innerHTML = hist
    .map((h) => (
      `<button type="button" class="brewery-recent-chip" data-brewery="${escapeHtml(h.name)}">${escapeHtml(h.name)}</button>`
    ))
    .join('');
  breweryRecent.hidden = false;
}

function pickRecentBrewery(name) {
  const brewery = String(name || '').trim();
  if (!brewery) return;
  breweryField.value = brewery;
  activeBrewery = brewery;
  syncBreweryChip();
  beerField.focus();
}

function syncBreweryChip() {
  const name = (activeBrewery || breweryField.value || '').trim();
  if (name) {
    activeBrewery = name;
    breweryChip.textContent = name;
    breweryChipRow.hidden = false;
    breweryFieldWrap.hidden = true;
  } else {
    breweryChipRow.hidden = true;
    breweryFieldWrap.hidden = false;
  }
  refreshBrewerySuggestions();
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

    return `
      <details class="brewer-group" data-gid="${escapeHtml(group.id)}" ${group.collapsed ? '' : 'open'}>
        <summary class="brewer-summary">${escapeHtml(shortBreweryName(group.brewery))}
          <span class="hint">${group.beers.length}</span>
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
  breweryField.value = '';
  beerField.value = '';
  syncBreweryChip();
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

breweryField.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
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

beerField.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
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
// Don't autofocus brewery on open — mobile browsers used to pop a native
// suggestion list over the first paint. Focus beer only when a brewery is set.
if (activeBrewery) beerField.focus();

breweryRecentChips?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-brewery]');
  if (!btn) return;
  pickRecentBrewery(shortBreweryName(btn.getAttribute('data-brewery')));
});

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

importExportBtn?.addEventListener('click', () => importExportInput?.click());
importExportInput?.addEventListener('change', async () => {
  const files = [...(importExportInput.files || [])];
  if (!files.length) return;
  let csvN = 0;
  let wishN = 0;
  try {
    for (const file of files) {
      const text = await file.text();
      if (/\.json$/i.test(file.name) || text.trim().startsWith('{')) {
        const r = importAccountJson(text);
        wishN += r.wish || 0;
      } else {
        const r = importCheckinsCsv(text);
        csvN = r.beers;
      }
    }
    migrateBreweryHistory();
    syncBreweryChip();
    renderSession();
    if (libraryStatus) {
      libraryStatus.hidden = false;
      libraryStatus.textContent = librarySummaryText()
        + (wishN ? ` · ${wishN} wish-list items noted` : '');
    }
    setHint(settingsStatus, `Imported ${csvN || 'check-in'} beers into your on-device library.`, 'ok');
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
