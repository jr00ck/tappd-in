/* Tappd In — quick brewery/beer entry → exact Untappd URLs (vanilla PWA) */

const SETTINGS_KEY = 'tappd-in.settings';
const LAST_SEEN_KEY = 'tappd-in.lastSeenVersion';
const CACHE_KEY = 'tappd-in.resolveCache';
const HISTORY_KEY = 'tappd-in.breweryHistory';
const SESSION_KEY = 'tappd-in.session';

const APP_VERSION = '0.4.2-beta';
// Short build id while iterating — set e.g. 'a1', clear before tagging a release.
// Never shown on the live Pages host even if forgotten.
const PREVIEW_BUILD = '';
const PRODUCTION_HOST = 'jr00ck.github.io';
const RELEASE_NOTES = [
  'Pull-to-refresh installs updates (same flow as Gassy); network-first service worker',
  'Resolver hit-rate: multi-query Perplexity + exact beer scoring / URL normalize',
  'Untappd URL resolver via Perplexity Search (Catalog.beer path parked)',
];

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function versionLabel() {
  const onProd = location.hostname === PRODUCTION_HOST;
  if (!onProd && PREVIEW_BUILD) return `v${APP_VERSION} · ${PREVIEW_BUILD}`;
  return `v${APP_VERSION}`;
}

const DEFAULT_RESOLVE_URL =
  'https://tappd-in-catalog.rerun-cost-xbox.workers.dev/resolve';

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
  };
}

function saveSettings(settings) {
  saveJson(SETTINGS_KEY, {
    resolveUrl: String(settings.resolveUrl || '').trim(),
  });
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

async function resolveBeer(brewery, beer, settings) {
  const cached = getCachedResolve(brewery, beer);
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
  untappdSearchWebUrl,
  resolveBeer,
  DEFAULT_RESOLVE_URL,
  BEER_URL_RE,
};

// --- DOM ---

const settingsToggle = document.getElementById('settings-toggle');
const settingsPanel = document.getElementById('settings-panel');
const resolveUrlInput = document.getElementById('resolve-url');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const clearSessionBtn = document.getElementById('clear-session-btn');
const settingsStatus = document.getElementById('settings-status');
const breweryField = document.getElementById('brewery-field');
const beerField = document.getElementById('beer-field');
const brewerySuggestions = document.getElementById('brewery-suggestions');
const newBrewerBtn = document.getElementById('new-brewer-btn');
const entryStatus = document.getElementById('entry-status');
const sessionPanel = document.getElementById('session-panel');
const sessionGroups = document.getElementById('session-groups');
const appVersionEl = document.getElementById('app-version');
const updatedBadge = document.getElementById('updated-badge');
const whatsNew = document.getElementById('whats-new');

let session = loadSession();
let activeBrewery = '';

function setHint(el, msg, kind) {
  if (!el) return;
  el.hidden = !msg;
  el.textContent = msg || '';
  el.classList.toggle('hint-error', kind === 'error');
  el.classList.toggle('hint-ok', kind === 'ok');
}

function refreshBrewerySuggestions() {
  const hist = loadBreweryHistory()
    .slice()
    .sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0) || (b.count || 0) - (a.count || 0));
  brewerySuggestions.innerHTML = hist
    .map((h) => `<option value="${escapeHtml(h.name)}"></option>`)
    .join('');
}

function ensureGroup(brewery) {
  const name = brewery.trim();
  let group = session.groups.find((g) => normalizeMatchText(g.brewery) === normalizeMatchText(name));
  if (!group) {
    group = { id: `g-${Date.now()}`, brewery: name, collapsed: false, beers: [] };
    session.groups.unshift(group);
  } else {
    // Move to top
    session.groups = [group, ...session.groups.filter((g) => g !== group)];
  }
  saveSession(session);
  return group;
}

function renderSession() {
  const has = session.groups.length > 0;
  sessionPanel.hidden = !has;
  if (!has) {
    sessionGroups.innerHTML = '';
    return;
  }

  sessionGroups.innerHTML = session.groups.map((group) => {
    const beersHtml = group.beers.map((row, idx) => {
      const status = row.status || 'idle';
      let body = '';
      if (status === 'loading') {
        body = `<p class="hint">Resolving…</p>`;
      } else if (status === 'error') {
        body = `<p class="hint hint-error">${escapeHtml(row.error || 'Failed')}</p>
          <a class="link-btn" href="${escapeHtml(untappdSearchWebUrl(group.brewery, row.beer))}"
            target="_blank" rel="noopener noreferrer">Search on Untappd ↗</a>`;
      } else if (row.url && row.confident) {
        body = `<a class="beer-link" href="${escapeHtml(row.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(row.title || row.beer)}</a>
          <span class="hint">${row.fromCache ? 'cached' : (row.source || 'search')}</span>`;
      } else {
        const cands = (row.candidates || []).slice(0, 3).map((c, cidx) => `
          <li>
            <button type="button" class="cand-btn" data-g="${escapeHtml(group.id)}" data-b="${idx}" data-c="${cidx}">
              ${escapeHtml(c.title || c.slug)} <span class="hint">${escapeHtml(c.url)}</span>
            </button>
          </li>`).join('');
        body = `
          <p class="hint">Not confident — pick one or search:</p>
          <ul class="cand-list">${cands}</ul>
          <a class="link-btn" href="${escapeHtml(row.untappdSearchUrl || untappdSearchWebUrl(group.brewery, row.beer))}"
            target="_blank" rel="noopener noreferrer">Search on Untappd ↗</a>`;
      }
      return `
        <li class="beer-row" data-g="${escapeHtml(group.id)}" data-b="${idx}">
          <div class="beer-row-top">
            <strong>${escapeHtml(row.beer)}</strong>
            <label class="had-toggle">
              <input type="checkbox" class="had-check" data-g="${escapeHtml(group.id)}" data-b="${idx}"
                ${row.had ? 'checked' : ''}> I've had this
            </label>
          </div>
          ${body}
          <details class="fix-link">
            <summary>Fix link</summary>
            <div class="field">
              <input type="url" class="fix-url" data-g="${escapeHtml(group.id)}" data-b="${idx}"
                placeholder="https://untappd.com/b/…" autocomplete="off">
            </div>
            <button type="button" class="secondary-outline-btn fix-save" data-g="${escapeHtml(group.id)}" data-b="${idx}">Save URL</button>
          </details>
        </li>`;
    }).join('');

    return `
      <details class="brewer-group" data-gid="${escapeHtml(group.id)}" ${group.collapsed ? '' : 'open'}>
        <summary class="brewer-summary">${escapeHtml(group.brewery)}
          <span class="hint">${group.beers.length} beer${group.beers.length === 1 ? '' : 's'}</span>
        </summary>
        <ul class="beer-list">${beersHtml || '<li class="hint">No beers yet</li>'}</ul>
      </details>`;
  }).join('');
}

async function addBeerAndResolve(brewery, beer) {
  const bName = brewery.trim();
  const beerName = beer.trim();
  if (!bName || !beerName) {
    setHint(entryStatus, 'Enter a brewery and beer name.', 'error');
    return;
  }

  activeBrewery = bName;
  touchBreweryHistory(bName);
  refreshBrewerySuggestions();
  const group = ensureGroup(bName);
  const row = {
    id: `b-${Date.now()}`,
    beer: beerName,
    status: 'loading',
    had: false,
  };
  group.beers.unshift(row);
  saveSession(session);
  renderSession();
  setHint(entryStatus, `Resolving ${beerName}…`);

  try {
    const result = await resolveBeer(bName, beerName, loadSettings());
    row.status = 'done';
    row.fromCache = !!result.fromCache;
    row.source = result.source;
    row.confident = !!result.confident;
    row.candidates = result.candidates || [];
    row.untappdSearchUrl = result.untappdSearchUrl;
    if (result.best?.url) {
      row.url = result.best.url;
      row.title = result.best.title || beerName;
      row.beerId = result.best.id;
      row.slug = result.best.slug;
    }
    if (!row.confident && !row.url && row.candidates[0]) {
      // keep candidates visible; no cache write
    }
    setHint(entryStatus, result.fromCache ? 'From cache.' : (row.confident ? 'Linked.' : 'Pick a candidate or Fix link.'), result.fromCache || row.confident ? 'ok' : undefined);
  } catch (err) {
    row.status = 'error';
    row.error = err && err.message ? err.message : 'Resolve failed';
    setHint(entryStatus, row.error, 'error');
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
    setHint(entryStatus, 'Need https://untappd.com/b/{slug}/{id}', 'error');
    return;
  }
  const { group, row } = found;
  row.url = parsed.url;
  row.beerId = parsed.id;
  row.slug = parsed.slug;
  row.title = row.beer;
  row.confident = true;
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
  setHint(entryStatus, 'Saved manual Untappd link.', 'ok');
}

// Events

settingsToggle.addEventListener('click', () => {
  const open = settingsPanel.hidden;
  settingsPanel.hidden = !open;
  settingsToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
});

saveSettingsBtn.addEventListener('click', () => {
  const resolveUrl = resolveUrlInput.value.trim();
  if (resolveUrl) {
    try {
      const u = new URL(resolveUrl);
      if (u.protocol !== 'https:') throw new Error('https only');
    } catch {
      setHint(settingsStatus, 'Resolve URL must be https://…', 'error');
      return;
    }
  }
  saveSettings({ resolveUrl });
  setHint(settingsStatus, 'Saved on this device.', 'ok');
});

clearSessionBtn.addEventListener('click', () => {
  clearSessionKeepCache();
  session = loadSession();
  renderSession();
  setHint(settingsStatus, 'Session cleared (cache kept).', 'ok');
});

newBrewerBtn.addEventListener('click', () => {
  activeBrewery = '';
  breweryField.value = '';
  beerField.value = '';
  breweryField.focus();
  setHint(entryStatus, 'New brewer — type a brewery name.');
});

breweryField.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    activeBrewery = breweryField.value.trim();
    beerField.focus();
  }
});

beerField.addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const brewery = breweryField.value.trim() || activeBrewery;
  const beer = beerField.value.trim();
  if (!brewery) {
    setHint(entryStatus, 'Set a brewery first.', 'error');
    breweryField.focus();
    return;
  }
  breweryField.value = brewery;
  activeBrewery = brewery;
  beerField.value = '';
  await addBeerAndResolve(brewery, beer);
  beerField.focus();
});

sessionGroups.addEventListener('click', (e) => {
  const cand = e.target.closest('.cand-btn');
  if (cand) {
    const found = findRow(cand.dataset.g, cand.dataset.b);
    if (!found) return;
    const c = (found.row.candidates || [])[Number(cand.dataset.c)];
    if (!c?.url) return;
    const parsed = parseUntappdBeerUrl(c.url);
    if (!parsed) return;
    found.row.url = parsed.url;
    found.row.beerId = parsed.id;
    found.row.slug = parsed.slug;
    found.row.title = c.title || found.row.beer;
    found.row.confident = true;
    found.row.source = 'search';
    putCacheResolve(found.group.brewery, found.row.beer, {
      url: parsed.url,
      id: parsed.id,
      title: found.row.title,
      source: 'search',
    });
    saveSession(session);
    renderSession();
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
  const details = e.target.closest?.('details.brewer-group');
  if (e.target === details) {
    const g = session.groups.find((x) => x.id === details.dataset.gid);
    if (g) {
      g.collapsed = !details.open;
      saveSession(session);
    }
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
  whatsNew.hidden = !opening;
  updatedBadge.setAttribute('aria-expanded', opening ? 'true' : 'false');
});

resolveUrlInput.value = loadSettings().resolveUrl;
refreshBrewerySuggestions();
renderSession();
breweryField.focus();

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
