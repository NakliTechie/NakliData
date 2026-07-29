// NakliData service worker — lite PWA caching.
//
// Two caches, two strategies:
//   * SHELL (naklidata-shell-<CACHE_VERSION>) — the app shell + code chunks.
//     Stale-while-revalidate; rotated every deploy (esbuild rewrites
//     CACHE_VERSION to the inline-script hash, M12), so a new bundle self-heals.
//   * RUNTIME (naklidata-runtime-<RUNTIME_VERSION>) — the large, IMMUTABLE
//     vendored language/engine runtimes (Pyodide ~33 MB, WebR ~66 MB, ReadStat,
//     DuckDB extensions). Cache-FIRST with NO background revalidation, and keyed
//     by its OWN version so it SURVIVES shell redeploys. Previously these lived
//     in the shell cache, so every deploy's `activate` evicted ~100 MB that
//     hadn't changed → a full re-download of Python/R on the next run; and SWR
//     re-fetched the whole 66 MB in the background on every single load. This
//     separate cache-first bucket is the "OPFS caching" of the runtime bytes —
//     the SW's Cache API is the right home since these are same-origin HTTP
//     fetches (Pyodide/WebR drive their own sub-fetches, which OPFS can't cleanly
//     intercept). Bump RUNTIME_VERSION only when the vendored bytes change.
//
// On navigation when offline, fall back to the cached index.html so the
// app keeps booting (engine boot will then either use the CDN if back
// online, or surface its own error). See DECISIONS 2026-05-17 11:50.

const CACHE_VERSION = 'v1';
// Policy version deliberately rotates the cache when eligibility rules change,
// even if the inlined application hash stays the same.
const CACHE_POLICY_VERSION = 'p2';
const CACHE_NAME = `naklidata-shell-${CACHE_VERSION}-${CACHE_POLICY_VERSION}`;

// Bump ONLY when the vendored runtime bytes (public/pyodide, public/webr,
// public/readstat-wasm, public/duckdb-extensions) are re-vendored.
const RUNTIME_VERSION = 'v1';
const RUNTIME_CACHE = `naklidata-runtime-${RUNTIME_VERSION}`;

const SCOPE_PATH = new URL(self.registration.scope).pathname.replace(/\/$/, '');

// Path segments whose assets are large + immutable-per-runtime-version.
const RUNTIME_PREFIXES = ['/pyodide/', '/webr/', '/readstat-wasm/', '/duckdb-extensions/'];
const STATIC_PREFIXES = [
  '/chunks/',
  '/duckdb-fallback/',
  '/examples/',
  '/guide/',
  '/sqlite-wasm/',
  '/taxonomy/',
  ...RUNTIME_PREFIXES,
];
const STATIC_PATHS = new Set([
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/main.js',
  '/graph-metrics.worker.js',
  '/taxonomy.worker.js',
]);
const PRIVATE_PREFIXES = ['/api/', '/auth/', '/graphql/', '/oauth/', '/private/', '/.well-known/'];
const SENSITIVE_QUERY_KEY = /(?:^|_)(?:access_?token|api_?key|authorization|credential|password|secret|signature|x-amz-)/i;

/** Return a scope-relative pathname so the same allowlist works at `/` and a
 * deploy prefix such as `/NakliData/`. Null means the URL is outside this SW's
 * registered path. */
function scopedPath(url) {
  const pathname = url.pathname;
  if (SCOPE_PATH && pathname !== SCOPE_PATH && !pathname.startsWith(`${SCOPE_PATH}/`)) {
    return null;
  }
  const relative = SCOPE_PATH ? pathname.slice(SCOPE_PATH.length) : pathname;
  return relative === '' ? '/' : `/${relative.replace(/^\/+/, '')}`;
}

function isRuntimeAsset(pathname) {
  return RUNTIME_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isStaticAsset(pathname) {
  return STATIC_PATHS.has(pathname) || STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isPrivatePath(pathname) {
  return PRIVATE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function hasSensitiveQuery(url) {
  for (const key of url.searchParams.keys()) {
    if (SENSITIVE_QUERY_KEY.test(key)) return true;
  }
  return false;
}

/** Requests carrying authority or partial-response semantics never interact
 * with Cache Storage, even when their pathname looks like a static asset. */
function shouldBypassRequest(req, url, pathname) {
  if (!pathname || !isStaticAsset(pathname) || isPrivatePath(pathname)) return true;
  if (hasSensitiveQuery(url)) return true;
  if (req.headers.has('authorization') || req.headers.has('range')) return true;
  // Browser navigations use `include` even for the public app shell. That one
  // exact allowlisted path keeps its offline fallback; credentialed subresource
  // requests always bypass, and private/no-store navigation responses are
  // still excluded by responseCanBeCached.
  if ((req.credentials === 'include' && req.mode !== 'navigate') || req.cache === 'no-store') {
    return true;
  }
  const cacheControl = req.headers.get('cache-control')?.toLowerCase() ?? '';
  return cacheControl.includes('no-store') || cacheControl.includes('private');
}

function responseCanBeCached(res) {
  if (!res || res.status !== 200 || !res.ok || res.type === 'opaque') return false;
  if (res.headers.has('content-range')) return false;
  const cacheControl = res.headers.get('cache-control')?.toLowerCase() ?? '';
  return !cacheControl.includes('no-store') && !cacheControl.includes('private');
}

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
  // Keep BOTH the current shell cache and the current runtime cache; prune the
  // rest. This is what lets the runtime bytes survive a shell redeploy (the old
  // shell cache is dropped, the runtime cache — same name across deploys — stays).
  const keep = new Set([CACHE_NAME, RUNTIME_CACHE]);
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // pass through third-party
  const pathname = scopedPath(url);
  if (shouldBypassRequest(req, url, pathname)) return;

  // Only the allowlisted shell navigation reaches this branch. A same-origin
  // navigation to /api, /private, or another application path passes through.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(async (res) => {
          if (responseCanBeCached(res)) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put('./index.html', res.clone()).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r ?? Response.error())),
    );
    return;
  }

  // Immutable runtime bytes: cache-first, NO background revalidation, in the
  // deploy-independent runtime cache. First fetch fills it; every later load
  // (this session or after an app update) serves from cache with zero network —
  // no re-downloading tens of MB of Pyodide/WebR.
  if (isRuntimeAsset(pathname)) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const res = await fetch(req).catch(() => undefined);
        // Only cache a full 200 (a 206 partial or an error must not poison it).
        if (responseCanBeCached(res)) {
          cache.put(req, res.clone()).catch(() => {});
        }
        return res ?? Response.error();
      }),
    );
    return;
  }

  // Explicitly allowlisted static GET: stale-while-revalidate.
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req);
      const networkPromise = fetch(req)
        .then((res) => {
          if (responseCanBeCached(res)) {
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
