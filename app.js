/* Tappd In — quick brewery/beer entry → exact Untappd URLs (vanilla PWA) */

const SETTINGS_KEY = 'tappd-in.settings';
const LAST_SEEN_KEY = 'tappd-in.lastSeenVersion';
const CACHE_KEY = 'tappd-in.resolveCache';
const HISTORY_KEY = 'tappd-in.breweryHistory';
const SESSION_KEY = 'tappd-in.session';

const APP_VERSION = '0.6.1-beta';
// Short build id while iterating — set e.g. 'a1', clear before tagging a release.
// Never shown on the live Pages host even if forgotten.
const PREVIEW_BUILD = '';
const PRODUCTION_HOST = 'jr00ck.github.io';
const RELEASE_NOTES = [
  'Cartoon beer-plush app icon (replaces auto-generated pint)',
  'Recent breweries are labeled chips — no surprise browser dropdown',
  'No-match recovery: pick candidates or numbered variants; Retry one beer',
  'List → Find links (batched Search) with Untappd app open on phones',
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

function cacheKey(brewery, beer) {
  return `${normalizeMatchText(brewery)}|${normalizeMatchText(beer)}`;
}

function parseUntappdBeerUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  if (host !== 'untappd.com') return null;
  if (/^\/user\//i.test(url.pathname) || /^\/v\//i.test(url.pathname) || /^\/w\//i.test(url.pathname)) {
    return null;
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
  const n = String(name || '').trim();
  if (!n) return;
  const prev = loadBreweryHistory().filter(
    (x) => normalizeMatchText(x.name) !== normalizeMatchText(n)
  );
  prev.unshift({
    name: n,
    count: (loadBreweryHistory().find((x) => normalizeMatchText(x.name) === normalizeMatchText(n))?.count || 0) + 1,
    lastUsed: Date.now(),
  });
  saveJson(HISTORY_KEY, prev.slice(0, 40));
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
  parseTitleParts,
  candidateLabel,
  listDisplayCandidates,
  rowSourceBadge,
  DEFAULT_RESOLVE_URL,
  DEFAULT_BATCH_URL,
  BEER_URL_RE,
};


// --- Candidate / series helpers (exported on TappdIn) ---

function slugSeriesBase(slug) {
  return String(slug || '').toLowerCase().replace(/-\d+$/, '');
}

function parseTitleParts(title) {
  const t = String(title || '').trim();
  if (t.includes(' - ')) {
    const beer = t.split(' - ')[0].trim();
    let brewery = t.slice(t.indexOf(' - ') + 3).trim();
    brewery = brewery.replace(/\s*[|·].*$/, '').replace(/\s*-\s*Untappd\s*$/i, '').trim();
    return { beer, brewery };
  }
  return { beer: t, brewery: '' };
}

function candidateLabel(c) {
  const parts = parseTitleParts(c.title || c.slug || '');
  const scorePct = typeof c.score === 'number' ? ` · ${Math.round(Math.min(c.score, 1.35) / 1.35 * 100)}%` : '';
  if (parts.brewery) return `${parts.beer} · ${parts.brewery}${scorePct}`;
  return `${parts.beer || c.slug || 'Beer'}${scorePct}`;
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
const sessionPanel = document.getElementById('session-panel');
const sessionGroups = document.getElementById('session-groups');
const findStatsEl = document.getElementById('find-stats');
const appVersionEl = document.getElementById('app-version');
const updatedBadge = document.getElementById('updated-badge');
const whatsNew = document.getElementById('whats-new');

let session = loadSession();
let activeBrewery = '';
let lastFindStats = null;

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
  const name = brewery.trim();
  let group = session.groups.find((g) => normalizeMatchText(g.brewery) === normalizeMatchText(name));
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

function updateFindStats() {
  if (!findStatsEl) return;
  if (!lastFindStats) {
    findStatsEl.hidden = true;
    findStatsEl.textContent = '';
    return;
  }
  const { searched = 0, saved = 0, providerCalls = 0 } = lastFindStats;
  findStatsEl.hidden = false;
  findStatsEl.textContent = `${searched} searched · ${saved} saved · ${providerCalls} provider call${providerCalls === 1 ? '' : 's'}`;
}

function searchLinkHtml(brewery, beer) {
  const href = escapeHtml(untappdSearchHref(brewery, beer));
  return `<a class="untappd-search-link" href="${href}" target="_blank" rel="noopener noreferrer">${U_MARK}<span>Search in Untappd</span></a>`;
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

function candidatesHtml(group, row, idx) {
  const display = listDisplayCandidates(row.candidates || []);
  if (display.mode === 'none') {
    return `<p class="hint">No close Untappd matches from search.</p>`;
  }
  const heading = display.mode === 'series'
    ? 'Numbered variants — pick one:'
    : 'Not sure — pick one:';
  const items = display.items.map((c, cidx) => `
    <li>
      <button type="button" class="cand-btn" data-g="${escapeHtml(group.id)}" data-b="${idx}" data-c="${cidx}"
        data-url="${escapeHtml(c.url)}">
        <span class="cand-main">${escapeHtml(candidateLabel(c))}</span>
      </button>
    </li>`).join('');
  return `<p class="hint">${heading}</p><ul class="cand-list">${items}</ul>`;
}

function renderSession() {
  const has = session.groups.length > 0;
  sessionPanel.hidden = !has;
  updateFindButton();
  updateFindStats();
  syncBreweryChip();
  if (!has) {
    sessionGroups.innerHTML = '';
    return;
  }

  sessionGroups.innerHTML = session.groups.map((group) => {
    const beersHtml = group.beers.map((row, idx) => {
      const status = row.status || 'pending';
      const badge = rowSourceBadge(row);
      const badgeHtml = badge
        ? `<span class="source-badge source-badge-${badge}">${badge}</span>`
        : '';
      let body = '';
      if (status === 'pending') {
        body = `
          <p class="hint pending-hint">Ready — tap Find links</p>
          <div class="pending-actions">
            <button type="button" class="remove-beer" data-g="${escapeHtml(group.id)}" data-b="${idx}"
              aria-label="Remove ${escapeHtml(row.beer)}">×</button>
          </div>`;
      } else if (status === 'loading') {
        body = `<p class="hint">Finding…</p>`;
      } else if (status === 'error') {
        body = `<p class="hint hint-error">${escapeHtml(row.error || 'Failed')}</p>
          <div class="match-row match-row-actions">
            ${searchLinkHtml(group.brewery, row.beer)}
            <button type="button" class="retry-btn" data-g="${escapeHtml(group.id)}" data-b="${idx}">Retry</button>
            <button type="button" class="fix-inline" data-g="${escapeHtml(group.id)}" data-b="${idx}">Fix</button>
          </div>
          ${fixPanelHtml(group.id, idx)}`;
      } else if (row.url && row.confident && !row.forceVariantPick) {
        const href = escapeHtml(beerOpenHref(row.url, row.beerId || row.id));
        body = `
          <div class="match-row">
            <a class="beer-link" href="${href}" target="_blank" rel="noopener noreferrer">${escapeHtml(row.title || row.beer)}</a>
            <button type="button" class="retry-btn" data-g="${escapeHtml(group.id)}" data-b="${idx}">Retry</button>
            <button type="button" class="fix-inline" data-g="${escapeHtml(group.id)}" data-b="${idx}">Fix</button>
          </div>
          ${fixPanelHtml(group.id, idx)}`;
      } else {
        body = `
          ${candidatesHtml(group, row, idx)}
          <div class="beer-edit-row">
            <label class="visually-hidden" for="edit-${group.id}-${idx}">Edit beer name</label>
            <input type="text" id="edit-${group.id}-${idx}" class="beer-edit" data-g="${escapeHtml(group.id)}" data-b="${idx}"
              value="${escapeHtml(row.beer)}" autocomplete="off">
            <button type="button" class="retry-btn" data-g="${escapeHtml(group.id)}" data-b="${idx}">Retry</button>
          </div>
          <div class="match-row match-row-actions">
            ${searchLinkHtml(group.brewery, row.beer)}
            <button type="button" class="fix-inline" data-g="${escapeHtml(group.id)}" data-b="${idx}">Fix</button>
          </div>
          ${fixPanelHtml(group.id, idx)}`;
      }

      const swipeClass = status === 'pending' ? ' beer-row-pending' : '';
      return `
        <li class="beer-row${swipeClass}" data-g="${escapeHtml(group.id)}" data-b="${idx}">
          <div class="beer-row-top">
            <strong>${escapeHtml(row.beer)}</strong>
            <span class="beer-row-meta">
              ${badgeHtml}
              <label class="had-toggle">
                <input type="checkbox" class="had-check" data-g="${escapeHtml(group.id)}" data-b="${idx}"
                  ${row.had ? 'checked' : ''}> Had
              </label>
            </span>
          </div>
          ${body}
        </li>`;
    }).join('');

    return `
      <details class="brewer-group" data-gid="${escapeHtml(group.id)}" ${group.collapsed ? '' : 'open'}>
        <summary class="brewer-summary">${escapeHtml(group.brewery)}
          <span class="hint">${group.beers.length}</span>
        </summary>
        <ul class="beer-list">${beersHtml || '<li class="hint">No beers yet</li>'}</ul>
      </details>`;
  }).join('');
}

function addBeerToList(brewery, beer) {
  const bName = brewery.trim();
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

  group.beers.unshift({
    id: `b-${Date.now()}`,
    beer: beerName,
    status: 'pending',
    had: false,
  });
  saveSession(session);
  renderSession();
  setHint(entryStatus, `Added ${beerName}. Add more, then Find links.`, 'ok');
  return true;
}

function applyResolvedRow(row, result) {
  row.status = 'done';
  row.fromCache = !!result.fromCache;
  row.source = result.fromCache ? 'cache' : (result.source || 'search');
  row.untappdSearchUrl = result.untappdSearchUrl || untappdSearchWebUrl(result.brewery, row.beer);

  const rawCands = result.candidates || [];
  if (result.best?.url && result.best.id) {
    const hasBest = rawCands.some((c) => c.id === result.best.id);
    row.candidates = hasBest ? rawCands : [result.best, ...rawCands];
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

  row.forceVariantPick = false;
  row.confident = !!result.confident;
  if (result.confident && result.best?.url) {
    row.url = result.best.url;
    row.title = result.best.title || row.beer;
    row.beerId = result.best.id;
    row.slug = result.best.slug;
  } else {
    row.url = null;
    row.title = null;
    row.beerId = null;
    row.slug = null;
  }
}

function pickCandidate(gid, bidx, url) {
  const found = findRow(gid, bidx);
  if (!found) return;
  const parsed = parseUntappdBeerUrl(url);
  if (!parsed) return;
  const c = (found.row.candidates || []).find((x) => x.url === url) || {};
  found.row.url = parsed.url;
  found.row.beerId = parsed.id;
  found.row.slug = parsed.slug;
  found.row.title = c.title || found.row.beer;
  found.row.confident = true;
  found.row.forceVariantPick = false;
  found.row.fromCache = false;
  found.row.source = 'picked';
  found.row.status = 'done';
  putCacheResolve(found.group.brewery, found.row.beer, {
    url: parsed.url,
    id: parsed.id,
    title: found.row.title,
    source: 'picked',
  });
  saveSession(session);
  renderSession();
  setHint(entryStatus, 'Saved your pick.', 'ok');
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
    const batch = await resolveBeerBatch(
      jobs.map((j) => ({ brewery: j.group.brewery, beer: j.row.beer })),
      loadSettings()
    );
    const byKey = new Map(
      (batch.results || []).map((r) => [`${normalizeMatchText(r.brewery)}|${normalizeMatchText(r.beer)}`, r])
    );
    let saved = 0;
    let searched = 0;
    for (const j of jobs) {
      const key = `${normalizeMatchText(j.group.brewery)}|${normalizeMatchText(j.row.beer)}`;
      const result = byKey.get(key);
      if (!result || result.error) {
        j.row.status = 'error';
        j.row.error = (result && result.error) || 'No result';
        searched += 1;
        continue;
      }
      applyResolvedRow(j.row, result);
      if (result.fromCache) saved += 1;
      else searched += 1;
    }
    lastFindStats = {
      searched,
      saved,
      providerCalls: batch.providerCalls || 0,
    };
    setHint(entryStatus, 'Done.', 'ok');
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
  const edit = sessionGroups.querySelector(`.beer-edit[data-g="${gid}"][data-b="${bidx}"]`);
  if (edit && edit.value.trim()) {
    found.row.beer = edit.value.trim();
  }
  found.row.status = 'loading';
  found.row.error = null;
  saveSession(session);
  renderSession();
  setHint(entryStatus, `Retrying ${found.row.beer}…`);
  try {
    const result = await resolveBeer(found.group.brewery, found.row.beer, loadSettings(), { bypassCache: true });
    applyResolvedRow(found.row, result);
    const calls = result.providerCalls || (result.fromCache ? 0 : 2);
    lastFindStats = {
      searched: 1,
      saved: result.fromCache ? 1 : 0,
      providerCalls: result.fromCache ? 0 : calls,
    };
    setHint(entryStatus, result.confident ? 'Linked.' : 'Still not sure — pick a candidate.', result.confident ? 'ok' : undefined);
  } catch (err) {
    found.row.status = 'error';
    found.row.error = err && err.message ? err.message : 'Retry failed';
    setHint(entryStatus, found.row.error, 'error');
  }
  saveSession(session);
  renderSession();
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
  setHint(entryStatus, 'Saved link.', 'ok');
}

function tryAddFromFields() {
  const brewery = (activeBrewery || breweryField.value).trim();
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
    activeBrewery = breweryField.value.trim();
    syncBreweryChip();
    beerField.focus();
  }
});

breweryField.addEventListener('change', () => {
  const v = breweryField.value.trim();
  if (v) {
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
  const removeBtn = e.target.closest('.remove-beer');
  if (removeBtn) {
    removeBeer(removeBtn.dataset.g, removeBtn.dataset.b);
    return;
  }
  const retry = e.target.closest('.retry-btn');
  if (retry) {
    retryBeer(retry.dataset.g, retry.dataset.b);
    return;
  }
  const fixToggle = e.target.closest('.fix-inline');
  if (fixToggle) {
    const rowEl = fixToggle.closest('.beer-row');
    const panel = rowEl && rowEl.querySelector('.fix-panel');
    if (panel) {
      const open = panel.hidden;
      panel.hidden = !open;
      fixToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    return;
  }
  const cand = e.target.closest('.cand-btn');
  if (cand) {
    pickCandidate(cand.dataset.g, cand.dataset.b, cand.dataset.url);
    return;
  }
  const fix = e.target.closest('.fix-save');
  if (fix) {
    const input = sessionGroups.querySelector(
      `.fix-url[data-g="${fix.dataset.g}"][data-b="${fix.dataset.b}"]`
    );
    applyManualUrl(fix.dataset.g, fix.dataset.b, input ? input.value : '');
  }
});

sessionGroups.addEventListener('change', (e) => {
  if (e.target.classList.contains('had-check')) {
    const found = findRow(e.target.dataset.g, e.target.dataset.b);
    if (!found) return;
    found.row.had = !!e.target.checked;
    saveSession(session);
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

openInAppInput.checked = loadSettings().openInApp !== false;
syncBreweryChip();
renderSession();
// Don't autofocus brewery on open — mobile browsers used to pop a native
// suggestion list over the first paint. Focus beer only when a brewery is set.
if (activeBrewery) beerField.focus();

breweryRecentChips?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-brewery]');
  if (!btn) return;
  pickRecentBrewery(btn.getAttribute('data-brewery'));
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
