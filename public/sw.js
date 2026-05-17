// NakliData service worker — lite PWA caching.
//
// Strategy: precache the shell + critical chunks on install; serve
// same-origin GETs cache-first with background revalidation (SWR);
// pass through cross-origin (CDN, extensions). The 74 MB of
// duckdb-fallback bytes are NOT precached — they'd dominate quota and
// most users won't need offline DuckDB. They'll cache opportunistically
// the first time a `?offline=1` boot fetches them.
//
// On navigation when offline, fall back to the cached index.html so the
// app keeps booting (engine boot will then either use the CDN if back
// online, or surface its own error). See DECISIONS 2026-05-17 11:50.

const CACHE_VERSION = 'v1';
const CACHE_NAME = `naklidata-shell-${CACHE_VERSION}`;

const PRECACHE_PATHS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './taxonomy.worker.js',
  './chunks/codemirror.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache
        .addAll(PRECACHE_PATHS.map((p) => new Request(p, { cache: 'reload' })))
        .catch((err) => {
          // Partial precache (e.g., chunk missing in dev) shouldn't block
          // activation — we'd rather have a half-cached shell than no SW.
          console.warn('[naklidata-sw] precache partial failure', err);
        }),
    ),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // pass through third-party

  // Navigation request: network-first, fall back to cached index.html
  // when offline. Keeps the app launchable from the installed PWA icon.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match('./index.html').then((r) => r ?? Response.error()),
      ),
    );
    return;
  }

  // Same-origin GET: stale-while-revalidate.
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req);
      const networkPromise = fetch(req)
        .then((res) => {
          if (res.ok) {
            // Don't block the response on cache.put — fire-and-forget.
            cache.put(req, res.clone()).catch(() => {});
          }
          return res;
        })
        .catch(() => undefined);
      return cached ?? (await networkPromise) ?? Response.error();
    }),
  );
});
