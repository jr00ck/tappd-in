const CACHE = 'tappd-in-v0.3.1-beta';
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
  // Activate ASAP so hard-reload isn't stuck behind a waiting worker (Safari PWAs).
  self.skipWaiting();
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

const NETWORK_TIMEOUT_MS = 8000;

function fetchWithTimeout(request) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), NETWORK_TIMEOUT_MS);
  return fetch(request, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;

  // Navigations: network first, no AbortController timeout. Safari hard-reload in a
  // Dock PWA was aborting HTML fetches and falling back to a sparse/odd first paint
  // (often with Safari's own Summarize chrome) until a second reload.
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const networkRes = await fetch(event.request);
        if (networkRes.ok) {
          const cache = await caches.open(CACHE);
          // Normalize so offline fallback always has index.html.
          cache.put('./index.html', networkRes.clone()).catch(() => {});
          cache.put(event.request, networkRes.clone()).catch(() => {});
        }
        return networkRes;
      } catch {
        return (await caches.match('./index.html'))
          || (await caches.match(event.request))
          || Response.error();
      }
    })());
    return;
  }

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
      return Response.error();
    }
  })());
});
