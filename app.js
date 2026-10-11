/* Tappd In — voice / photo → beer details → Untappd (vanilla PWA) */

const SETTINGS_KEY = 'tappd-in.settings';
const LAST_SEEN_KEY = 'tappd-in.lastSeenVersion';
const AICHE_TRANSCRIBE_URL = 'https://api.aiche.app/v1/transcribe';

const APP_VERSION = '0.3.0-beta';
const RELEASE_NOTES = [
  'Catalog.beer search from typed brewery + beer (primary MVP path)',
  'Optional Cloudflare proxy for Catalog.beer CORS; Untappd search handoff',
  'Voice / OCR kept as optional panels',
];

const CATALOG_API_SEARCH = 'https://api.catalog.beer/beer/search';

// --- Public Untappd URL shapes (https only; never invent IDs/slugs) ---

const UNTAPPD_HOST = 'untappd.com';
const BEER_URL_RE = /^https:\/\/(?:www\.)?untappd\.com\/b\/([a-z0-9-]+)\/(\d+)\/?(?:[?#].*)?$/i;
const BREWERY_URL_RE = /^https:\/\/(?:www\.)?untappd\.com\/w\/([a-z0-9-]+)\/(\d+)\/?(?:[?#].*)?$/i;
const VENUE_URL_RE = /^https:\/\/(?:www\.)?untappd\.com\/v\/([a-z0-9-]+)\/(\d+)\/?(?:[?#].*)?$/i;
const USER_URL_RE = /^https:\/\/(?:www\.)?untappd\.com\/user\/([A-Za-z0-9._-]+)\/?(?:[?#].*)?$/i;
const CHECKIN_URL_RE = /^https:\/\/(?:www\.)?untappd\.com\/user\/([A-Za-z0-9._-]+)\/checkin\/(\d+)\/?(?:[?#].*)?$/i;
const VENUE_RSS_RE = /^https:\/\/(?:www\.)?untappd\.com\/rss\/venue\/(\d+)\/?(?:[?#].*)?$/i;

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

/** Canonical HTTPS beer page — only from known slug + numeric id. */
function beerUrl(slug, beerId) {
  const s = String(slug || '').trim();
  const id = String(beerId || '').trim();
  if (!/^[a-z0-9-]+$/i.test(s) || !/^\d+$/.test(id)) return null;
  return `https://${UNTAPPD_HOST}/b/${s}/${id}`;
}

function breweryUrl(slug, breweryId) {
  const s = String(slug || '').trim();
  const id = String(breweryId || '').trim();
  if (!/^[a-z0-9-]+$/i.test(s) || !/^\d+$/.test(id)) return null;
  return `https://${UNTAPPD_HOST}/w/${s}/${id}`;
}

function venueUrl(slug, venueId) {
  const s = String(slug || '').trim();
  const id = String(venueId || '').trim();
  if (!/^[a-z0-9-]+$/i.test(s) || !/^\d+$/.test(id)) return null;
  return `https://${UNTAPPD_HOST}/v/${s}/${id}`;
}

function userUrl(username) {
  const u = String(username || '').trim();
  if (!/^[A-Za-z0-9._-]+$/.test(u)) return null;
  return `https://${UNTAPPD_HOST}/user/${u}`;
}

function checkinUrl(username, checkinId) {
  const u = String(username || '').trim();
  const id = String(checkinId || '').trim();
  if (!/^[A-Za-z0-9._-]+$/.test(u) || !/^\d+$/.test(id)) return null;
  return `https://${UNTAPPD_HOST}/user/${u}/checkin/${id}`;
}

function venueRssUrl(venueId) {
  const id = String(venueId || '').trim();
  if (!/^\d+$/.test(id)) return null;
  return `https://${UNTAPPD_HOST}/rss/venue/${id}`;
}

function untappdSearchWebUrl(brewery, beer) {
  const q = buildSearchQuery(brewery, beer);
  const url = new URL(`https://${UNTAPPD_HOST}/search`);
  url.searchParams.set('q', q || '');
  url.searchParams.set('type', 'beer');
  return url.href;
}

/**
 * Parse any supported public Untappd URL.
 * Returns { type, ...fields, url } or null. Never fabricates missing parts.
 */
function parseUntappdUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  let href;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return null;
    href = u.href;
  } catch {
    return null;
  }

  let m = CHECKIN_URL_RE.exec(href);
  if (m) {
    const url = checkinUrl(m[1], m[2]);
    return url ? { type: 'checkin', username: m[1], checkinId: m[2], url } : null;
  }
  m = BEER_URL_RE.exec(href);
  if (m) {
    const url = beerUrl(m[1], m[2]);
    return url ? { type: 'beer', slug: m[1], beerId: m[2], url } : null;
  }
  m = BREWERY_URL_RE.exec(href);
  if (m) {
    const url = breweryUrl(m[1], m[2]);
    return url ? { type: 'brewery', slug: m[1], breweryId: m[2], url } : null;
  }
  m = VENUE_URL_RE.exec(href);
  if (m) {
    const url = venueUrl(m[1], m[2]);
    return url ? { type: 'venue', slug: m[1], venueId: m[2], url } : null;
  }
  m = VENUE_RSS_RE.exec(href);
  if (m) {
    const url = venueRssUrl(m[1]);
    return url ? { type: 'venue_rss', venueId: m[1], url } : null;
  }
  m = USER_URL_RE.exec(href);
  if (m) {
    const url = userUrl(m[1]);
    return url ? { type: 'user', username: m[1], url } : null;
  }
  return null;
}

/** @deprecated use parseUntappdUrl — kept for beer-only callers/tests */
function parseBeerUrl(input) {
  const parsed = parseUntappdUrl(input);
  if (!parsed || parsed.type !== 'beer') return null;
  return { slug: parsed.slug, beerId: parsed.beerId, url: parsed.url };
}

/**
 * Turn OCR text into a best-effort { brewery, beer, details }.
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

/**
 * Parse spoken dictation into brewery / beer fields.
 * Supports: "brewery X beer Y", "X, Y", or a single phrase.
 */
function parseVoiceBeerText(spoken) {
  const text = normalizeWhitespace(spoken).replace(/\s+/g, ' ').trim();
  if (!text) return { brewery: '', beer: '', raw: '' };

  const labeled = text.match(
    /^(?:brewery\s+)?(.+?)\s*[,\-–—]\s*(?:beer\s+)?(.+)$/i
  ) || text.match(/^brewery\s+(.+?)\s+beer\s+(.+)$/i);

  if (labeled) {
    return {
      brewery: labeled[1].replace(/^brewery\s+/i, '').trim(),
      beer: labeled[2].replace(/^beer\s+/i, '').trim(),
      raw: text,
    };
  }

  return { brewery: '', beer: text, raw: text };
}

function buildSearchQuery(brewery, beer) {
  return [brewery, beer].map((s) => String(s || '').trim()).filter(Boolean).join(' ').trim();
}

function candidateFromApiItem(item) {
  if (!item || item.bid == null) return null;
  const bid = String(item.bid);
  if (!/^\d+$/.test(bid)) return null;
  const slug = String(item.beer_slug || '').trim();
  const url = beerUrl(slug, bid);
  if (!url) return null;
  const brewery = item.brewery && item.brewery.brewery_name
    ? String(item.brewery.brewery_name)
    : '';
  return {
    source: 'untappd',
    beerId: bid,
    slug,
    url,
    beerName: String(item.beer_name || ''),
    breweryName: brewery,
    style: String(item.beer_style || ''),
    abv: item.beer_abv != null ? Number(item.beer_abv) : null,
  };
}

/** Catalog.beer public beer page — only from a real UUID returned by the API. */
function catalogBeerPageUrl(id) {
  const uuid = String(id || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
    return null;
  }
  return `https://catalog.beer/beer/${uuid}`;
}

/**
 * Map a Catalog.beer beer object (or our proxy compact shape) into a UI candidate.
 * Never invents Untappd URLs — those stay a separate search handoff.
 */
function candidateFromCatalogItem(item) {
  if (!item || !item.id) return null;
  const catalogUrl = item.catalogUrl || catalogBeerPageUrl(item.id);
  if (!catalogUrl) return null;
  const brewer = item.brewer || {};
  return {
    source: 'catalog',
    id: String(item.id),
    beerName: String(item.name || ''),
    breweryName: String(brewer.name || ''),
    style: String(item.style || ''),
    abv: item.abv != null ? Number(item.abv) : null,
    ibu: item.ibu != null ? Number(item.ibu) : null,
    description: String(item.description || ''),
    match: String(item.match || ''),
    catalogUrl,
    url: catalogUrl,
  };
}

function catalogBasicAuthHeader(apiKey) {
  // btoa is fine for typical API key charset; Catalog.beer keys are ASCII.
  return `Basic ${btoa(`${apiKey}:`)}`;
}

function emptySettings() {
  return {
    proxyUrl: '',
    aicheApiKey: '',
    catalogApiKey: '',
    catalogProxyUrl: '',
  };
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return emptySettings();
    const parsed = JSON.parse(raw);
    return {
      proxyUrl: String(parsed.proxyUrl || '').trim(),
      aicheApiKey: String(parsed.aicheApiKey || '').trim(),
      catalogApiKey: String(parsed.catalogApiKey || '').trim(),
      catalogProxyUrl: String(parsed.catalogProxyUrl || '').trim(),
    };
  } catch {
    return emptySettings();
  }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    proxyUrl: String(settings.proxyUrl || '').trim(),
    aicheApiKey: String(settings.aicheApiKey || '').trim(),
    catalogApiKey: String(settings.catalogApiKey || '').trim(),
    catalogProxyUrl: String(settings.catalogProxyUrl || '').trim(),
  }));
}

/**
 * Batch AICHE transcription: multipart audio upload.
 * Key must come from on-device settings — never hardcode.
 */
async function transcribeWithAiche(blob, apiKey, onStatus) {
  if (!apiKey) throw new Error('Add your AICHE API key in Settings (stored on this device only).');
  if (!blob || !blob.size) throw new Error('No audio captured.');

  const form = new FormData();
  const ext = (blob.type && blob.type.includes('mp4')) ? 'm4a'
    : (blob.type && blob.type.includes('ogg')) ? 'ogg'
      : 'webm';
  form.append('audio', blob, `tappd-in.${ext}`);
  form.append('language', 'auto');
  form.append('message_ready', 'true');

  if (onStatus) onStatus('Sending to AICHE…');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  let res;
  try {
    res = await fetch(AICHE_TRANSCRIBE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: ctrl.signal,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error('AICHE request timed out.');
    // Likely CORS or network — browser blocks cross-origin without Allow-Origin.
    throw new Error(
      'Could not reach AICHE from the browser (network or CORS). '
      + 'Try again, or dictate with the AICHE app/hotkey into the fields below.'
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) {
      throw new Error('AICHE rejected the API key. Check Settings.');
    }
    throw new Error(`AICHE error ${res.status}${body ? `: ${body.slice(0, 140)}` : ''}`);
  }

  const data = await res.json();
  const text = String((data && data.text) || '').trim();
  if (!text) throw new Error('AICHE returned empty text.');
  return text;
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
  parseUntappdUrl,
  parseLabelText,
  parseVoiceBeerText,
  buildSearchQuery,
  untappdSearchWebUrl,
  beerUrl,
  breweryUrl,
  venueUrl,
  userUrl,
  checkinUrl,
  venueRssUrl,
  catalogBeerPageUrl,
  candidateFromApiItem,
  candidateFromCatalogItem,
  normalizeWhitespace,
  escapeHtml,
  transcribeWithAiche,
  BEER_URL_RE,
  AICHE_TRANSCRIBE_URL,
  CATALOG_API_SEARCH,
};

// --- DOM wiring ---

const voiceBtn = document.getElementById('voice-btn');
const voiceStatus = document.getElementById('voice-status');
const cameraBtn = document.getElementById('camera-btn');
const libraryBtn = document.getElementById('library-btn');
const cameraInput = document.getElementById('camera-input');
const libraryInput = document.getElementById('library-input');
const previewWrap = document.getElementById('preview-wrap');
const preview = document.getElementById('preview');
const clearPhotoBtn = document.getElementById('clear-photo-btn');
const ocrStatus = document.getElementById('ocr-status');
const recognizeBtn = document.getElementById('recognize-btn');
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
const openCatalogBtn = document.getElementById('open-catalog-btn');
const openUntappdBtn = document.getElementById('open-untappd-btn');
const pasteUrl = document.getElementById('paste-url');
const applyPasteBtn = document.getElementById('apply-paste-btn');
const pasteStatus = document.getElementById('paste-status');
const manualSearchLink = document.getElementById('manual-search-link');
const settingsToggle = document.getElementById('settings-toggle');
const settingsPanel = document.getElementById('settings-panel');
const proxyUrlInput = document.getElementById('proxy-url');
const aicheKeyInput = document.getElementById('aiche-key');
const catalogKeyInput = document.getElementById('catalog-key');
const catalogProxyUrlInput = document.getElementById('catalog-proxy-url');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const settingsStatus = document.getElementById('settings-status');

let currentObjectUrl = null;
let currentFile = null;
let tesseractWorker = null;
let mediaRecorder = null;
let mediaStream = null;
let audioChunks = [];
let recording = false;

function setHint(el, message, kind) {
  if (!el) return;
  el.hidden = !message;
  el.textContent = message || '';
  el.classList.toggle('error', kind === 'error');
  el.classList.toggle('ok', kind === 'ok');
}

function applyParsedFields(parsed, sourceLabel) {
  if (parsed.brewery) breweryField.value = parsed.brewery;
  if (parsed.beer) beerField.value = parsed.beer;
  if (parsed.details != null && parsed.details !== '') detailsField.value = parsed.details;
  if (parsed.raw && rawOcrEl) {
    rawOcrEl.textContent = `${sourceLabel}:\n${parsed.raw}`;
  }
  updateManualSearchLink();
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
  setHint(ocrStatus, 'Photo ready — tap Run OCR.');
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

// --- Voice (batch AICHE) ---

function pickRecorderMime() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  if (typeof MediaRecorder === 'undefined') return '';
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

async function startRecording() {
  if (recording) return;
  const settings = loadSettings();
  if (!settings.aicheApiKey) {
    setHint(voiceStatus, 'Add your AICHE API key in Settings first.', 'error');
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setHint(voiceStatus, 'This browser has no microphone API.', 'error');
    return;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  } catch {
    setHint(voiceStatus, 'Microphone permission denied.', 'error');
    return;
  }

  audioChunks = [];
  const mime = pickRecorderMime();
  mediaRecorder = mime
    ? new MediaRecorder(mediaStream, { mimeType: mime })
    : new MediaRecorder(mediaStream);

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size) audioChunks.push(e.data);
  };

  mediaRecorder.start();
  recording = true;
  voiceBtn.classList.add('is-recording');
  voiceBtn.setAttribute('aria-pressed', 'true');
  voiceBtn.textContent = 'Listening… tap to stop';
  setHint(voiceStatus, 'Listening… tap again when finished.');
}

async function stopRecordingAndTranscribe() {
  if (!recording || !mediaRecorder) return;
  recording = false;
  voiceBtn.classList.remove('is-recording');
  voiceBtn.setAttribute('aria-pressed', 'false');
  voiceBtn.textContent = 'Tap to speak';
  voiceBtn.disabled = true;

  const blob = await new Promise((resolve) => {
    mediaRecorder.onstop = () => {
      const type = mediaRecorder.mimeType || 'audio/webm';
      resolve(new Blob(audioChunks, { type }));
    };
    mediaRecorder.stop();
  });

  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
  mediaRecorder = null;

  const settings = loadSettings();
  try {
    const text = await transcribeWithAiche(blob, settings.aicheApiKey, (msg) => {
      setHint(voiceStatus, msg);
    });
    const parsed = parseVoiceBeerText(text);
    applyParsedFields(parsed, 'AICHE');
    setHint(
      voiceStatus,
      parsed.brewery || parsed.beer
        ? 'Transcribed — check brewery & beer, then Find beer.'
        : 'Got text — split brewery / beer if needed.',
      'ok'
    );
  } catch (err) {
    setHint(voiceStatus, err && err.message ? err.message : 'Transcription failed.', 'error');
  } finally {
    voiceBtn.disabled = false;
  }
}

function onVoicePress(e) {
  e.preventDefault();
  if (recording) stopRecordingAndTranscribe();
  else startRecording();
}

voiceBtn.addEventListener('click', onVoicePress);

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
    applyParsedFields(parsed, engine);
    setHint(
      ocrStatus,
      parsed.raw
        ? `OCR via ${engine}. Check fields — OCR is often weak on can art.`
        : 'No text found — use voice instead.',
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
  if (candidate.source === 'catalog' || candidate.catalogUrl) {
    const catalogUrl = candidate.catalogUrl || catalogBeerPageUrl(candidate.id);
    if (!catalogUrl) {
      setHint(searchStatus, 'Refusing an invalid Catalog.beer id.', 'error');
      return;
    }
    const title = titleOverride
      || [candidate.breweryName, candidate.beerName].filter(Boolean).join(' — ')
      || candidate.beerName;
    matchTitle.textContent = title;
    const bits = [];
    if (candidate.style) bits.push(candidate.style);
    if (candidate.abv != null && !Number.isNaN(candidate.abv)) bits.push(`${candidate.abv}% ABV`);
    if (candidate.ibu != null && !Number.isNaN(candidate.ibu)) bits.push(`${candidate.ibu} IBU`);
    matchMeta.textContent = bits.join(' · ');
    matchUrl.href = catalogUrl;
    matchUrl.textContent = catalogUrl;
    if (openCatalogBtn) {
      openCatalogBtn.href = catalogUrl;
      openCatalogBtn.hidden = false;
    }
    openUntappdBtn.href = untappdSearchWebUrl(candidate.breweryName, candidate.beerName);
    openUntappdBtn.textContent = 'Search on Untappd';
    matchPanel.hidden = false;
    matchPanel.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
    return;
  }

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
  if (openCatalogBtn) openCatalogBtn.hidden = true;
  openUntappdBtn.href = parsed.url;
  openUntappdBtn.textContent = 'Open in Untappd';
  matchPanel.hidden = false;
  matchPanel.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
}

window.TappdIn.selectMatch = selectMatch;

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

async function searchCatalogBeer(query, settings) {
  const count = 10;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let res;

  try {
    if (settings.catalogProxyUrl) {
      const endpoint = new URL(settings.catalogProxyUrl);
      endpoint.searchParams.set('q', query);
      endpoint.searchParams.set('count', String(count));
      const headers = { Accept: 'application/json' };
      if (settings.catalogApiKey) {
        headers.Authorization = catalogBasicAuthHeader(settings.catalogApiKey);
      }
      res = await fetch(endpoint.href, { method: 'GET', headers, signal: ctrl.signal });
    } else if (settings.catalogApiKey) {
      const endpoint = new URL(CATALOG_API_SEARCH);
      endpoint.searchParams.set('q', query);
      endpoint.searchParams.set('count', String(count));
      res = await fetch(endpoint.href, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: catalogBasicAuthHeader(settings.catalogApiKey),
        },
        signal: ctrl.signal,
      });
    } else {
      throw new Error(
        'Add a Catalog.beer API key in Settings (and a proxy URL if the browser blocks CORS).'
      );
    }
  } catch (err) {
    if (err && err.message && err.message.startsWith('Add a Catalog')) throw err;
    if (err && err.name === 'AbortError') throw err;
    throw new Error(
      'Could not reach Catalog.beer (network or CORS). '
      + 'Deploy proxy/catalog-worker.js and set Catalog.beer proxy URL in Settings.'
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) {
      throw new Error('Catalog.beer rejected the API key. Check Settings.');
    }
    throw new Error(`Catalog.beer error ${res.status}${body ? `: ${body.slice(0, 120)}` : ''}`);
  }

  const data = await res.json();
  let items = [];
  if (Array.isArray(data.beers)) {
    items = data.beers;
  } else if (Array.isArray(data.data)) {
    items = data.data;
  }

  return items.map(candidateFromCatalogItem).filter(Boolean);
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
  searchBtn.disabled = true;
  setHint(searchStatus, 'Searching Catalog.beer…');
  try {
    const candidates = await searchCatalogBeer(query, settings);
    if (!candidates.length) {
      renderResults([]);
      setHint(searchStatus, 'No matches. Try fewer words or different spelling.', 'error');
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

function assertOptionalHttpsUrl(value, label) {
  if (!value) return true;
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
      setHint(settingsStatus, `${label} must be https:// (or localhost for dev).`, 'error');
      return false;
    }
  } catch {
    setHint(settingsStatus, `${label} doesn’t look like a valid URL.`, 'error');
    return false;
  }
  return true;
}

// Settings
const initialSettings = loadSettings();
proxyUrlInput.value = initialSettings.proxyUrl;
aicheKeyInput.value = initialSettings.aicheApiKey;
catalogKeyInput.value = initialSettings.catalogApiKey;
catalogProxyUrlInput.value = initialSettings.catalogProxyUrl;

settingsToggle.addEventListener('click', () => {
  const opening = settingsToggle.getAttribute('aria-expanded') !== 'true';
  setCollapsibleOpen(settingsPanel, opening);
  settingsToggle.setAttribute('aria-expanded', opening ? 'true' : 'false');
});

saveSettingsBtn.addEventListener('click', () => {
  const proxyUrl = proxyUrlInput.value.trim();
  const aicheApiKey = aicheKeyInput.value.trim();
  const catalogApiKey = catalogKeyInput.value.trim();
  const catalogProxyUrl = catalogProxyUrlInput.value.trim();

  if (!assertOptionalHttpsUrl(proxyUrl, 'Untappd proxy URL')) return;
  if (!assertOptionalHttpsUrl(catalogProxyUrl, 'Catalog.beer proxy URL')) return;
  if (aicheApiKey && !/^sk_/i.test(aicheApiKey)) {
    setHint(settingsStatus, 'AICHE keys usually start with sk_ — double-check before saving.', 'error');
    return;
  }
  saveSettings({ proxyUrl, aicheApiKey, catalogApiKey, catalogProxyUrl });
  setHint(settingsStatus, 'Saved on this device only.', 'ok');
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
    // fall through
  }
  window.location.reload();
}
