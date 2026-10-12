const CACHE = 'tappd-in-v0.4.3-beta';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// Network-first for same-origin files. Cache-first served the previous
// app.js on pull-to-refresh: sw.js rarely changes, so registration.update()
// often found no new worker, and the reload still read the old cache.
// Offline or a hung request falls back to whatever was cached last time.
const NETWORK_TIMEOUT_MS = 8000;

function fetchWithTimeout(request) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), NETWORK_TIMEOUT_MS);
  return fetch(request, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;

  event.respondWith((async () => {
    try {
      const networkRes = await fetchWithTimeout(event.request);
      if (networkRes.ok && networkRes.type === 'basic') {
        const clone = networkRes.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, clone)).catch(() => {});
      }
      return networkRes;
    } catch {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      if (event.request.mode === 'navigate') {
        const fallback = await caches.match('./index.html');
        if (fallback) return fallback;
      }
      return Response.error();
    }
  })());
});
