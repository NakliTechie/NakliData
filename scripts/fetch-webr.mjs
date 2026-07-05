#!/usr/bin/env node
// Postinstall hook: vendor the WebR runtime into `public/webr/` so the R cell
// (Polyglot-Workbench Fork 2) loads it SAME-ORIGIN — no CDN reach at runtime
// (sovereign posture, same as Pyodide / DuckDB exts / sql.js / ReadStat).
//
// WebR needs SharedArrayBuffer → cross-origin isolation (COOP/COEP; DECISIONS
// CG) AND must load same-origin (the CDN build fetched its worker + wasm
// cross-origin under `credentialless` and threw an internal `ASM_CONSTS` error;
// vendoring same-origin fixes it). Verified: vendored WebR inits on the SAB
// channel, runs R, and round-trips a data.frame back to JS.
//
// We COPY from the pinned `@r-wasm/webr` dev-dependency (like vendor-sql-wasm.mjs)
// rather than fetch: the runtime is ~66 MB across ~1,800 files (the R base
// library VFS is lazy-fetched by R at runtime, so all of it must be present),
// and npm already downloaded + integrity-checked the package via the lockfile.
// Bytes are gitignored; the pin is the dev-dependency version + package-lock.
//
// Skip when SKIP_WEBR_FETCH=1, or when the copy is already present.

import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const DEST = resolve('public/webr');

// The runtime subset WebR loads: glue + worker + R wasm/VFS image + BLAS/LAPACK
// + the lazy-fetched `vfs/` base-library tree. We skip source maps, the CLI
// `repl`/`tests` dirs, and the `.cjs`/type shims — none are used at runtime.
const FILES = [
  'webr.mjs',
  'webr-worker.js',
  'R.bin.wasm',
  'R.bin.js',
  'R.bin.data',
  'libRblas.so',
  'libRlapack.so',
];
const DIRS = ['vfs'];

function distDir() {
  // Direct top-level path — @r-wasm/webr is a direct devDependency, and its
  // `exports` field blocks `require.resolve('@r-wasm/webr/package.json')`.
  const dir = resolve('node_modules/@r-wasm/webr/dist');
  if (!existsSync(resolve(dir, 'webr.mjs'))) throw new Error('dist not found');
  return dir;
}

async function main() {
  if (process.env.SKIP_WEBR_FETCH === '1') {
    console.log('[naklidata] SKIP_WEBR_FETCH=1 — skipping vendored WebR');
    return;
  }
  let SRC;
  try {
    SRC = distDir();
  } catch {
    console.error(
      '[naklidata] @r-wasm/webr is not installed — run `npm install` (it is a devDependency).',
    );
    process.exit(1);
  }

  // Idempotent: if the copy looks complete, bail.
  if (existsSync(resolve(DEST, 'webr.mjs')) && existsSync(resolve(DEST, 'vfs'))) {
    console.log('[naklidata] vendored WebR already present');
    return;
  }

  console.log('[naklidata] vendoring WebR from @r-wasm/webr (~66 MB, incl. the R VFS)');
  await rm(DEST, { recursive: true, force: true });
  await mkdir(DEST, { recursive: true });
  for (const f of FILES) {
    await cp(resolve(SRC, f), resolve(DEST, f));
  }
  for (const d of DIRS) {
    await cp(resolve(SRC, d), resolve(DEST, d), { recursive: true });
  }
  const vfsCount = existsSync(resolve(DEST, 'vfs'))
    ? (await readdir(resolve(DEST, 'vfs'), { recursive: true })).length
    : 0;
  console.log(`  ✓ ${FILES.length} core files + vfs/ (${vfsCount} entries)`);
}

main().catch((err) => {
  console.error(`[naklidata] webr vendoring failed: ${err.message}`);
  process.exit(1);
});
