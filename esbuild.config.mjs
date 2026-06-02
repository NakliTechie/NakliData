import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve as absResolve, extname, join } from 'node:path';
import { build, context } from 'esbuild';

const DEV = process.argv.includes('--dev');
const OUT_DIR = 'dist';
const LAZY_DIR = 'src/lazy';
const CHUNKS_OUT = `${OUT_DIR}/chunks`;

const COMMON = {
  bundle: true,
  target: 'es2022',
  format: 'esm',
  platform: 'browser',
  sourcemap: DEV,
  minify: !DEV,
  legalComments: 'none',
  loader: { '.svg': 'text', '.css': 'text' },
  define: {
    'process.env.NODE_ENV': DEV ? '"development"' : '"production"',
  },
};

/**
 * Build each `src/lazy/<name>.ts` into `dist/chunks/<name>.js` as a
 * standalone ESM module. The main bundle uses `loadChunk(name)` from
 * `src/core/lazy-loader.ts` to dynamically import these at runtime —
 * keeping heavy deps (CodeMirror 6 in a future push, Apache Arrow JS
 * if we ever need it, Observable Plot, etc.) out of the inlined shell.
 */
async function buildLazyChunks() {
  if (!existsSync(LAZY_DIR)) return;
  const files = (await readdir(LAZY_DIR)).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.d.ts') && !f.endsWith('.test.ts'),
  );
  if (files.length === 0) return;
  await mkdir(CHUNKS_OUT, { recursive: true });
  await build({
    ...COMMON,
    entryPoints: files.map((f) => `${LAZY_DIR}/${f}`),
    outdir: CHUNKS_OUT,
    splitting: false, // each entry is its own self-contained chunk
  });
}

async function buildShell() {
  await mkdir(OUT_DIR, { recursive: true });

  const main = await build({
    ...COMMON,
    entryPoints: ['src/main.ts'],
    outfile: `${OUT_DIR}/main.js`,
    write: !DEV ? false : true,
    metafile: true,
  });

  // Note: DuckDB's own worker is loaded from the @duckdb/duckdb-wasm bundle
  // via createObjectURL/importScripts at runtime — we don't bundle it.
  // The taxonomy worker entry below is bundled to its own file (the main
  // bundle will spawn it via `new Worker('./taxonomy.worker.js', {type:'module'})`).
  const taxonomyWorker = await build({
    ...COMMON,
    entryPoints: ['src/workers/taxonomy.worker.ts'],
    outfile: `${OUT_DIR}/taxonomy.worker.js`,
  });

  // Lazy chunks: standalone ESM modules dynamically imported at runtime.
  await buildLazyChunks();

  if (!DEV) {
    // Inline main.js + CSS into a single dist/index.html. Compute an SHA-256
    // of the script body so we can include it in the CSP script-src and
    // avoid needing 'unsafe-inline'.
    const jsBundle = main.outputFiles.find((f) => f.path.endsWith('main.js'));
    const cssBundle = main.outputFiles.find((f) => f.path.endsWith('main.css'));
    const scriptBody = jsBundle ? jsBundle.text : '';
    const scriptHash = createHash('sha256').update(scriptBody, 'utf8').digest('base64');
    // connect-src: 'self' + https: (Wave 2 unlocks user-configured S3 /
    // Iceberg / public-URL mounts; explicit-host whitelist is no longer
    // feasible). script-src stays tight — that's the primary XSS defence.
    // See DECISIONS 2026-05-24 for the trade-off rationale.
    // img-src includes https://tile.openstreetmap.org — the only host
    // we allow tile fetches to. Opt-in per A13 (mapBasemap === 'osm'); a
    // user with the setting off issues no requests despite the policy.
    // Keep this an explicit-host carve-out, NOT a blanket `https:` (img
    // requests don't run scripts, but they still reveal area-of-interest
    // to whichever host serves them; explicit-only preserves intent).
    const csp = [
      "default-src 'self'",
      // `blob:` is required so the DuckDB worker can `importScripts(blob:…)`
      // — the engine spawns a same-origin blob worker that imports the
      // actual duckdb-wasm worker JS. The SHA-256 hash pins the
      // INLINED main script; blob: + the cross-origin hosts below
      // only unlock worker-internal script loading.
      //
      // Cross-origin hosts (spec amendment A14, three-tier bundle source):
      //   - naklitechie.github.io serves the canonical vendored bundle
      //     (used when the same-origin probe 404s — e.g., Cloudflare).
      //   - cdn.jsdelivr.net is the `?cdn=1` escape hatch.
      `script-src 'self' 'wasm-unsafe-eval' 'sha256-${scriptHash}' blob: https://naklitechie.github.io https://cdn.jsdelivr.net`,
      "worker-src 'self' blob:",
      "connect-src 'self' https:",
      "img-src 'self' data: blob: https://tile.openstreetmap.org",
      "style-src 'self' 'unsafe-inline'",
      // Defence-in-depth hardening (forward-pass H7, 2026-06-02):
      //   - base-uri 'self'  — pins relative-URL resolution; an injected
      //     <base href> can't redirect chunk loads / SW / duckdb-fallback
      //     to an attacker origin (CSP script-src doesn't cover <base>).
      //   - object-src 'none' — blocks <object> / <embed> / Flash-style
      //     vectors; we never use them.
      //   - form-action 'self' — blocks injected forms from POSTing to a
      //     foreign origin (would otherwise be the easy exfil channel
      //     for any XSS that escapes our DOM hardening).
      //   - frame-ancestors 'none' — clickjacking guard. NOTE: per CSP
      //     L3, frame-ancestors is IGNORED when delivered via <meta>; we
      //     ship it for documentation and for any future deploy that
      //     speaks real HTTP headers. GitHub Pages doesn't, so the meta
      //     entry is currently aspirational there.
      "base-uri 'self'",
      "object-src 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ');
    const shellHtml = await readFile('src/index.html', 'utf8');
    // NB: use function-form replacers when inserting bundle output —
    // string-form replacement treats `$&` / `$$` / `` $` `` in the
    // *replacement* as special tokens, and minified JS/CSS routinely
    // contains those sequences. A latent bug from the original build
    // that bit once the bundle grew to contain `$&`.
    const inlined = shellHtml
      .replace(
        /<meta[^>]+http-equiv="Content-Security-Policy"[^>]*>/i,
        () => `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
      )
      .replace('<!-- INLINE_CSS -->', () => (cssBundle ? `<style>${cssBundle.text}</style>` : ''))
      .replace('<!-- INLINE_JS -->', () =>
        scriptBody ? `<script type="module">${scriptBody}</script>` : '',
      );
    await writeFile(`${OUT_DIR}/index.html`, inlined);

    // Copy public assets
    if (existsSync('public')) {
      await cp('public', OUT_DIR, { recursive: true });
    }
    // Forward-pass M12 (2026-06-02): inject the inline-script hash
    // into the service worker's CACHE_VERSION so any change to main.js
    // invalidates the SW's precached `index.html`. Without this, a
    // returning user with a stale SW could be served HTML whose
    // CSP whitelists an OLD inline-script hash — the new bundle's
    // hash won't match and the page won't boot.
    if (existsSync(`${OUT_DIR}/sw.js`)) {
      // Use a short prefix of the hash (urlsafe — strip /=+).
      const cacheVersion = scriptHash.replace(/[/+=]/g, '').slice(0, 12);
      const swPath = `${OUT_DIR}/sw.js`;
      const swSrc = await readFile(swPath, 'utf8');
      const swOut = swSrc.replace(
        /const CACHE_VERSION = ['"][^'"]*['"];/,
        `const CACHE_VERSION = 'b${cacheVersion}';`,
      );
      await writeFile(swPath, swOut);
    }
    // Copy taxonomy bundle so the runtime loader can fetch /taxonomy/v0.1/*
    if (existsSync('taxonomy')) {
      await cp('taxonomy', `${OUT_DIR}/taxonomy`, { recursive: true });
    }
  } else {
    const shellHtml = await readFile('src/index.html', 'utf8');
    const inlined = shellHtml
      .replace('<!-- INLINE_CSS -->', '<link rel="stylesheet" href="/main.css">')
      .replace('<!-- INLINE_JS -->', '<script type="module" src="/main.js"></script>');
    await writeFile(`${OUT_DIR}/index.html`, inlined);
  }

  void taxonomyWorker;
}

async function serve() {
  const ctx = await context({
    ...COMMON,
    entryPoints: ['src/main.ts'],
    outfile: `${OUT_DIR}/main.js`,
  });
  await ctx.watch();
  await buildShell();
  await buildLazyChunks();
  const port = 5173;
  // Forward-pass M14 (2026-06-02): reject any path that escapes the
  // intended document roots. `join()` happily resolves `..` segments
  // and would otherwise serve `/etc/passwd` if dev mode was ever
  // exposed via `--host`. Build resolved absolute roots once; for each
  // request, build the candidate and check it stays under one of them.
  const ALLOWED_ROOTS = [absResolve(OUT_DIR), absResolve('public'), absResolve('taxonomy')];
  const isUnderAllowedRoot = (p) => {
    const a = absResolve(p);
    return ALLOWED_ROOTS.some(
      (root) => a === root || a.startsWith(`${root}${process.platform === 'win32' ? '\\' : '/'}`),
    );
  };
  createServer(async (req, res) => {
    const url = req.url === '/' ? '/index.html' : req.url;
    const path = url ?? '/index.html';
    // First-pass syntactic filter: any decoded `..` segment is
    // an intent-to-escape signal — reject before resolving.
    let decoded;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      res.writeHead(400);
      res.end('bad request');
      return;
    }
    if (decoded.split('/').includes('..')) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    const candidates = [
      join(OUT_DIR, decoded),
      join('public', decoded),
      // Dev: also serve repo-root taxonomy/ at /taxonomy/...
      decoded.startsWith('/taxonomy/') ? decoded.slice(1) : null,
    ].filter(Boolean);
    for (const filePath of candidates) {
      // Second-pass containment check: ensure the candidate resolves
      // INSIDE one of the allowed roots even after symlink resolution
      // and any tricky joins.
      if (!isUnderAllowedRoot(filePath)) continue;
      try {
        const st = await stat(filePath);
        if (st.isFile()) {
          const body = await readFile(filePath);
          const ext = extname(filePath);
          const type =
            ext === '.html'
              ? 'text/html'
              : ext === '.js'
                ? 'application/javascript'
                : ext === '.css'
                  ? 'text/css'
                  : ext === '.json'
                    ? 'application/json'
                    : ext === '.jsonl'
                      ? 'application/x-ndjson'
                      : ext === '.csv'
                        ? 'text/csv'
                        : ext === '.parquet'
                          ? 'application/octet-stream'
                          : 'application/octet-stream';
          res.writeHead(200, { 'content-type': type });
          res.end(body);
          return;
        }
      } catch {
        // try next
      }
    }
    res.writeHead(404);
    res.end('not found');
  }).listen(port, () => {
    console.log(`naklios dev server: http://localhost:${port}`);
  });
}

if (DEV) {
  await serve();
} else {
  await buildShell();
  console.log(`built → ${OUT_DIR}/index.html`);
}
