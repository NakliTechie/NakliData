import { readFile, writeFile, mkdir, cp, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { build, context } from 'esbuild';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';

const DEV = process.argv.includes('--dev');
const OUT_DIR = 'dist';

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

  if (!DEV) {
    // Inline main.js + CSS into a single dist/index.html. Compute an SHA-256
    // of the script body so we can include it in the CSP script-src and
    // avoid needing 'unsafe-inline'.
    const jsBundle = main.outputFiles.find((f) => f.path.endsWith('main.js'));
    const cssBundle = main.outputFiles.find((f) => f.path.endsWith('main.css'));
    const scriptBody = jsBundle ? jsBundle.text : '';
    const scriptHash = createHash('sha256').update(scriptBody, 'utf8').digest('base64');
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'wasm-unsafe-eval' 'sha256-${scriptHash}'`,
      "worker-src 'self' blob:",
      "connect-src 'self' https://cdn.jsdelivr.net https://extensions.duckdb.org https://*.naklitechie.com",
      "img-src 'self' data: blob:",
      "style-src 'self' 'unsafe-inline'",
    ].join('; ');
    const shellHtml = await readFile('src/index.html', 'utf8');
    const inlined = shellHtml
      .replace(/<meta[^>]+http-equiv="Content-Security-Policy"[^>]*>/i,
        `<meta http-equiv="Content-Security-Policy" content="${csp}">`)
      .replace('<!-- INLINE_CSS -->', cssBundle ? `<style>${cssBundle.text}</style>` : '')
      .replace(
        '<!-- INLINE_JS -->',
        scriptBody ? `<script type="module">${scriptBody}</script>` : '',
      );
    await writeFile(`${OUT_DIR}/index.html`, inlined);

    // Copy public assets
    if (existsSync('public')) {
      await cp('public', OUT_DIR, { recursive: true });
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
  const port = 5173;
  createServer(async (req, res) => {
    const url = req.url === '/' ? '/index.html' : req.url;
    const path = url ?? '/index.html';
    const candidates = [
      join(OUT_DIR, path),
      join('public', path),
      // Dev: also serve repo-root taxonomy/ at /taxonomy/...
      path.startsWith('/taxonomy/') ? path.slice(1) : null,
    ].filter(Boolean);
    for (const filePath of candidates) {
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
