/* Tappd In — beer can photo → Untappd beer page (vanilla PWA) */

const SETTINGS_KEY = 'tappd-in.settings';
const LAST_SEEN_KEY = 'tappd-in.lastSeenVersion';

const APP_VERSION = '0.1.0';
const RELEASE_NOTES = [
  'Photograph or pick a beer can label, run on-device OCR, and open the matched Untappd beer',
  'Untappd search via optional self-hosted proxy (official API) — never invents beer URLs',
];

const BEER_URL_RE = /^https:\/\/(?:www\.)?untappd\.com\/b\/([a-z0-9-]+)\/(\d+)\/?(?:[?#].*)?$/i;

// --- Pure helpers (also exposed on window.TappdIn for tests) ---

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeWhitespace(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * Parse a public Untappd beer URL. Returns { slug, beerId, url } or null.
 * Never fabricates a URL — only accepts a real /b/{slug}/{id} form.
 */
function parseBeerUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const m = BEER_URL_RE.exec(url.href);
  if (!m) return null;
  const slug = m[1];
  const beerId = m[2];
  return {
    slug,
    beerId,
    url: `https://untappd.com/b/${slug}/${beerId}`,
  };
}

/**
 * Turn OCR text into a best-effort { brewery, beer, details }.
 * Heuristic only — the UI always lets the user correct fields.
 */
function parseLabelText(ocrText) {
  const text = normalizeWhitespace(ocrText);
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const noise = /^(est\.?|establis|since|ale|lager|ipa|neipa|dipa|stout|porter|sour|pils|pilsner|abv|ibu|vol\.?|%|ml|oz\.?|can|brewed|imperial|india pale)/i;
  const breweryHint = /\b(brew(?:ery|ing|co|company)|bière|bier|brasserie|brewpub)\b/i;

  let brewery = '';
  let beer = '';
  const detailLines = [];

  for (const line of lines) {
    if (noise.test(line) && line.length < 28) {
      detailLines.push(line);
      continue;
    }
    if (!brewery && (breweryHint.test(line) || /brew/i.test(line))) {
      brewery = line.replace(/\s+brew(?:ery|ing|co\.?|company)\s*$/i, '').trim() || line;
      continue;
    }
    if (!beer && line.length >= 3 && line.length <= 60 && !/^\d/.test(line)) {
      beer = line;
      continue;
    }
    detailLines.push(line);
  }

  // If brewery wasn't tagged, use first substantial line as brewery and second as beer.
  if (!brewery && lines.length) {
    brewery = lines[0];
    if (!beer && lines[1]) beer = lines[1];
  }
  if (!beer && lines.length > 1) {
    beer = lines.find((l) => l !== brewery && l.length >= 3) || '';
  }

  return {
    brewery: brewery.replace(/\s+/g, ' ').trim(),
    beer: beer.replace(/\s+/g, ' ').trim(),
    details: detailLines.join('\n').trim(),
    raw: text,
  };
}

function buildSearchQuery(brewery, beer) {
  return [brewery, beer].map((s) => String(s || '').trim()).filter(Boolean).join(' ').trim();
}

function untappdSearchWebUrl(brewery, beer) {
  const q = buildSearchQuery(brewery, beer);
  const url = new URL('https://untappd.com/search');
  url.searchParams.set('q', q || '');
  url.searchParams.set('type', 'beer');
  return url.href;
}

/**
 * Map an Untappd API beer item into a safe candidate. URL is built only from
 * API-provided beer_slug + bid (same fields Untappd uses publicly).
 */
function candidateFromApiItem(item) {
  if (!item || item.bid == null) return null;
  const bid = String(item.bid);
  if (!/^\d+$/.test(bid)) return null;
  const slug = String(item.beer_slug || '').trim();
  if (!slug || !/^[a-z0-9-]+$/i.test(slug)) return null;
  const brewery = item.brewery && item.brewery.brewery_name
    ? String(item.brewery.brewery_name)
    : '';
  return {
    beerId: bid,
    slug,
    url: `https://untappd.com/b/${slug}/${bid}`,
    beerName: String(item.beer_name || ''),
    breweryName: brewery,
    style: String(item.beer_style || ''),
    abv: item.beer_abv != null ? Number(item.beer_abv) : null,
  };
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { proxyUrl: '' };
    const parsed = JSON.parse(raw);
    return { proxyUrl: String(parsed.proxyUrl || '').trim() };
  } catch {
    return { proxyUrl: '' };
  }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    proxyUrl: String(settings.proxyUrl || '').trim(),
  }));
}

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function setCollapsibleOpen(panel, open) {
  if (!panel) return;
  if (open) {
    panel.hidden = false;
    if (prefersReducedMotion()) {
      panel.classList.add('is-open');
      return;
    }
    // Force reflow so the 0fr → 1fr transition runs.
    panel.classList.remove('is-open');
    void panel.offsetHeight;
    panel.classList.add('is-open');
  } else {
    panel.classList.remove('is-open');
    if (prefersReducedMotion()) {
      panel.hidden = true;
      return;
    }
    const done = () => {
      panel.hidden = true;
      panel.removeEventListener('transitionend', done);
    };
    panel.addEventListener('transitionend', done);
    setTimeout(done, 280);
  }
}

window.TappdIn = {
  parseBeerUrl,
  parseLabelText,
  buildSearchQuery,
  untappdSearchWebUrl,
  candidateFromApiItem,
  normalizeWhitespace,
  escapeHtml,
  BEER_URL_RE,
};

// --- DOM wiring ---

const cameraBtn = document.getElementById('camera-btn');
const libraryBtn = document.getElementById('library-btn');
const cameraInput = document.getElementById('camera-input');
const libraryInput = document.getElementById('library-input');
const previewWrap = document.getElementById('preview-wrap');
const preview = document.getElementById('preview');
const clearPhotoBtn = document.getElementById('clear-photo-btn');
const ocrStatus = document.getElementById('ocr-status');
const recognizeBtn = document.getElementById('recognize-btn');
const identifyPanel = document.getElementById('identify-panel');
const breweryField = document.getElementById('brewery-field');
const beerField = document.getElementById('beer-field');
const detailsField = document.getElementById('details-field');
const rawOcrEl = document.getElementById('raw-ocr');
const searchBtn = document.getElementById('search-btn');
const searchStatus = document.getElementById('search-status');
const resultsPanel = document.getElementById('results-panel');
const resultsList = document.getElementById('results-list');
const matchPanel = document.getElementById('match-panel');
const matchTitle = document.getElementById('match-title');
const matchMeta = document.getElementById('match-meta');
const matchUrl = document.getElementById('match-url');
const openUntappdBtn = document.getElementById('open-untappd-btn');
const pasteUrl = document.getElementById('paste-url');
const applyPasteBtn = document.getElementById('apply-paste-btn');
const pasteStatus = document.getElementById('paste-status');
const manualSearchLink = document.getElementById('manual-search-link');
const settingsToggle = document.getElementById('settings-toggle');
const settingsPanel = document.getElementById('settings-panel');
const proxyUrlInput = document.getElementById('proxy-url');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const settingsStatus = document.getElementById('settings-status');

let currentObjectUrl = null;
let currentFile = null;
let tesseractWorker = null;

function setHint(el, message, kind) {
  if (!el) return;
  el.hidden = !message;
  el.textContent = message || '';
  el.classList.toggle('error', kind === 'error');
  el.classList.toggle('ok', kind === 'ok');
}

function revokePreview() {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
}

function setPhoto(file) {
  if (!file || !file.type.startsWith('image/')) {
    setHint(ocrStatus, 'Please choose an image file.', 'error');
    return;
  }
  revokePreview();
  currentFile = file;
  currentObjectUrl = URL.createObjectURL(file);
  preview.src = currentObjectUrl;
  previewWrap.hidden = false;
  recognizeBtn.hidden = false;
  setHint(ocrStatus, 'Photo ready — tap Identify beer.');
}

function clearPhoto() {
  revokePreview();
  currentFile = null;
  preview.removeAttribute('src');
  previewWrap.hidden = true;
  recognizeBtn.hidden = true;
  setHint(ocrStatus, '');
  cameraInput.value = '';
  libraryInput.value = '';
}

cameraBtn.addEventListener('click', () => cameraInput.click());
libraryBtn.addEventListener('click', () => libraryInput.click());
cameraInput.addEventListener('change', () => {
  const file = cameraInput.files && cameraInput.files[0];
  if (file) setPhoto(file);
});
libraryInput.addEventListener('change', () => {
  const file = libraryInput.files && libraryInput.files[0];
  if (file) setPhoto(file);
});
clearPhotoBtn.addEventListener('click', clearPhoto);

async function recognizeWithTextDetector(bitmap) {
  if (typeof TextDetector !== 'function') return null;
  try {
    const detector = new TextDetector();
    const results = await detector.detect(bitmap);
    if (!results || !results.length) return null;
    const text = results.map((r) => (r.rawValue || '').trim()).filter(Boolean).join('\n');
    return text || null;
  } catch {
    return null;
  }
}

async function recognizeWithTesseract(file, onProgress) {
  if (typeof Tesseract === 'undefined' || !Tesseract.createWorker) {
    throw new Error('Tesseract.js failed to load. Check your network and try again.');
  }
  if (!tesseractWorker) {
    tesseractWorker = await Tesseract.createWorker('eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text' && typeof m.progress === 'number') {
          onProgress(`Reading label… ${Math.round(m.progress * 100)}%`);
        } else if (m.status) {
          onProgress(String(m.status).replace(/_/g, ' ') + '…');
        }
      },
    });
  }
  const result = await tesseractWorker.recognize(file);
  return (result && result.data && result.data.text) || '';
}

async function downscaleForOcr(file) {
  // Keep OCR snappy on phones — max edge 1600px.
  try {
    const bitmap = await createImageBitmap(file);
    const maxEdge = 1600;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1) return { blob: file, bitmap };
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    const small = await createImageBitmap(blob);
    bitmap.close();
    return { blob: blob || file, bitmap: small };
  } catch {
    return { blob: file, bitmap: null };
  }
}

recognizeBtn.addEventListener('click', async () => {
  if (!currentFile) return;
  recognizeBtn.disabled = true;
  setHint(ocrStatus, 'Preparing image…');

  try {
    const { blob, bitmap } = await downscaleForOcr(currentFile);
    let text = null;
    let engine = '';

    if (bitmap && typeof TextDetector === 'function') {
      setHint(ocrStatus, 'Trying on-device TextDetector…');
      text = await recognizeWithTextDetector(bitmap);
      if (text) engine = 'TextDetector';
    }

    if (!text) {
      setHint(ocrStatus, 'Running Tesseract OCR on-device…');
      text = await recognizeWithTesseract(blob, (msg) => setHint(ocrStatus, msg));
      engine = 'Tesseract.js';
    }

    if (bitmap && typeof bitmap.close === 'function') bitmap.close();

    const parsed = parseLabelText(text);
    breweryField.value = parsed.brewery;
    beerField.value = parsed.beer;
    detailsField.value = parsed.details;
    rawOcrEl.textContent = parsed.raw || '(no text detected)';
    identifyPanel.hidden = false;
    updateManualSearchLink();
    setHint(
      ocrStatus,
      parsed.raw
        ? `Identified with ${engine}. Check brewery & beer, then Find on Untappd.`
        : 'No text found — type the brewery and beer name manually.',
      parsed.raw ? 'ok' : 'error'
    );
  } catch (err) {
    setHint(ocrStatus, err && err.message ? err.message : 'Recognition failed.', 'error');
  } finally {
    recognizeBtn.disabled = false;
  }
});

function updateManualSearchLink() {
  manualSearchLink.href = untappdSearchWebUrl(breweryField.value, beerField.value);
}

breweryField.addEventListener('input', updateManualSearchLink);
beerField.addEventListener('input', updateManualSearchLink);

function selectMatch(candidate, titleOverride) {
  const parsed = parseBeerUrl(candidate.url);
  if (!parsed) {
    setHint(searchStatus, 'Refusing an invalid Untappd URL.', 'error');
    return;
  }
  const title = titleOverride
    || [candidate.breweryName, candidate.beerName].filter(Boolean).join(' — ')
    || parsed.slug;
  matchTitle.textContent = title;
  const bits = [];
  if (candidate.style) bits.push(candidate.style);
  if (candidate.abv != null && !Number.isNaN(candidate.abv)) bits.push(`${candidate.abv}% ABV`);
  bits.push(`Beer ID ${parsed.beerId}`);
  matchMeta.textContent = bits.join(' · ');
  matchUrl.href = parsed.url;
  matchUrl.textContent = parsed.url;
  openUntappdBtn.href = parsed.url;
  matchPanel.hidden = false;
  matchPanel.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
}

function renderResults(candidates) {
  resultsList.innerHTML = '';
  if (!candidates.length) {
    resultsPanel.hidden = true;
    return;
  }
  resultsPanel.hidden = false;
  for (const c of candidates) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'result-btn';
    btn.innerHTML = `
      <span class="beer-name">${escapeHtml(c.beerName || c.slug)}</span>
      <span class="brewery-name">${escapeHtml(c.breweryName || '')}</span>
      ${c.style ? `<span class="style-line">${escapeHtml(c.style)}${c.abv != null ? ` · ${c.abv}%` : ''}</span>` : ''}
    `;
    btn.addEventListener('click', () => selectMatch(c));
    li.appendChild(btn);
    resultsList.appendChild(li);
  }
}

async function searchUntappdViaProxy(query, proxyUrl) {
  const endpoint = new URL(proxyUrl);
  endpoint.searchParams.set('q', query);
  endpoint.searchParams.set('limit', '10');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
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
    throw new Error(`Proxy returned ${res.status}${body ? `: ${body.slice(0, 120)}` : ''}`);
  }

  const data = await res.json();
  // Support either our worker shape { beers: [...] } or raw Untappd { response: { beers: { items } } }.
  let items = [];
  if (Array.isArray(data.beers)) {
    items = data.beers;
  } else if (data.response && data.response.beers && Array.isArray(data.response.beers.items)) {
    items = data.response.beers.items.map((row) => row.beer
      ? { ...row.beer, brewery: row.brewery || row.beer.brewery }
      : row);
  }

  return items.map(candidateFromApiItem).filter(Boolean);
}

searchBtn.addEventListener('click', async () => {
  const brewery = breweryField.value.trim();
  const beer = beerField.value.trim();
  const query = buildSearchQuery(brewery, beer);
  updateManualSearchLink();

  if (!query) {
    setHint(searchStatus, 'Enter a brewery and/or beer name first.', 'error');
    return;
  }

  const settings = loadSettings();
  if (!settings.proxyUrl) {
    resultsPanel.hidden = true;
    setHint(
      searchStatus,
      'No search proxy configured. Use “Search Untappd ↗”, then paste the beer URL below — or add a proxy in Settings.',
      'error'
    );
    return;
  }

  searchBtn.disabled = true;
  setHint(searchStatus, 'Searching Untappd…');
  try {
    const candidates = await searchUntappdViaProxy(query, settings.proxyUrl);
    if (!candidates.length) {
      renderResults([]);
      setHint(searchStatus, 'No matches returned. Try editing the names or paste a URL.', 'error');
      return;
    }
    renderResults(candidates);
    setHint(searchStatus, `${candidates.length} match${candidates.length === 1 ? '' : 'es'} — pick one.`, 'ok');
    if (candidates.length === 1) selectMatch(candidates[0]);
  } catch (err) {
    renderResults([]);
    setHint(
      searchStatus,
      err && err.name === 'AbortError'
        ? 'Search timed out.'
        : (err && err.message ? err.message : 'Search failed.'),
      'error'
    );
  } finally {
    searchBtn.disabled = false;
  }
});

applyPasteBtn.addEventListener('click', () => {
  const parsed = parseBeerUrl(pasteUrl.value);
  if (!parsed) {
    setHint(pasteStatus, 'Need a full HTTPS URL like https://untappd.com/b/brewery-beer/1234567', 'error');
    return;
  }
  setHint(pasteStatus, 'URL accepted.', 'ok');
  selectMatch({
    url: parsed.url,
    beerId: parsed.beerId,
    slug: parsed.slug,
    beerName: parsed.slug.replace(/-/g, ' '),
    breweryName: '',
    style: '',
    abv: null,
  }, parsed.slug.replace(/-/g, ' '));
});

// Settings
const initialSettings = loadSettings();
proxyUrlInput.value = initialSettings.proxyUrl;

settingsToggle.addEventListener('click', () => {
  const opening = settingsToggle.getAttribute('aria-expanded') !== 'true';
  setCollapsibleOpen(settingsPanel, opening);
  settingsToggle.setAttribute('aria-expanded', opening ? 'true' : 'false');
});

saveSettingsBtn.addEventListener('click', () => {
  const proxyUrl = proxyUrlInput.value.trim();
  if (proxyUrl) {
    try {
      const u = new URL(proxyUrl);
      if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
        setHint(settingsStatus, 'Proxy URL must be https:// (or localhost for dev).', 'error');
        return;
      }
    } catch {
      setHint(settingsStatus, 'That doesn’t look like a valid URL.', 'error');
      return;
    }
  }
  saveSettings({ proxyUrl });
  setHint(settingsStatus, 'Settings saved on this device.', 'ok');
});

// --- Version badge ---

document.getElementById('app-version').textContent = `v${APP_VERSION}`;

const updatedBadge = document.getElementById('updated-badge');
const whatsNewEl = document.getElementById('whats-new');

const lastSeenVersion = localStorage.getItem(LAST_SEEN_KEY);
if (lastSeenVersion && lastSeenVersion !== APP_VERSION) {
  updatedBadge.hidden = false;
}
localStorage.setItem(LAST_SEEN_KEY, APP_VERSION);

function renderWhatsNew() {
  const items = RELEASE_NOTES.map((note) => `<li>${escapeHtml(note)}</li>`).join('');
  whatsNewEl.innerHTML = `
    <div class="collapse-inner">
      <p class="whats-new-title">What's new in v${escapeHtml(APP_VERSION)}</p>
      <ul class="whats-new-list">${items}</ul>
    </div>
  `;
}

updatedBadge.addEventListener('click', () => {
  const opening = updatedBadge.getAttribute('aria-expanded') !== 'true';
  if (opening) renderWhatsNew();
  setCollapsibleOpen(whatsNewEl, opening);
  updatedBadge.setAttribute('aria-expanded', opening ? 'true' : 'false');
});

// --- Service worker ---

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// --- Pull-to-refresh ---

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
    // fall through to reload
  }
  window.location.reload();
}
