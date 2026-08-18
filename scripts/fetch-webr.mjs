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
// We COPY from the pinned `webr` dev-dependency (like vendor-sql-wasm.mjs)
// rather than fetch: the runtime is ~49 MB across ~170 files (the R base
// library VFS is lazy-fetched by R at runtime, so all of it must be present),
// and npm already downloaded + integrity-checked the package via the lockfile.
// Bytes are gitignored; the pin is the dev-dependency version + package-lock.
//
// Skip when SKIP_WEBR_FETCH=1, or when the copy is already present.

import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const DEST = resolve('public/webr');
const VERSION_FILE = resolve(DEST, 'naklidata-runtime.json');

// The runtime subset WebR loads: glue + worker + R wasm/VFS image + BLAS/LAPACK
// + the lazy-fetched `vfs/` base-library tree. We skip source maps, the CLI
// `repl`/`tests` dirs, and the `.cjs`/type shims — none are used at runtime.
const FILES = [
  // The package's `import` entry is Node-oriented. Self-host the browser
  // export so a direct dynamic import never resolves Node built-ins.
  'webr.js',
  'webr-worker.js',
  'R.wasm',
  'R.js',
  'libRblas.so',
  'libRlapack.so',
];
const ROOT_FILES = ['LICENSE.md'];
const DIRS = ['vfs'];

async function packageDetails() {
  // Read the direct package path because its exports field does not expose
  // package.json. The lockfile supplies the package integrity boundary.
  const packageRoot = resolve('node_modules/webr');
  const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
  const dir = resolve(packageRoot, 'dist');
  if (!existsSync(resolve(dir, 'webr.js'))) throw new Error('dist not found');
  return { dir, packageRoot, version: manifest.version };
}

async function vendoredVersion() {
  try {
    const marker = JSON.parse(await readFile(VERSION_FILE, 'utf8'));
    return marker.package === 'webr' && typeof marker.version === 'string'
      ? marker.version
      : null;
  } catch {
    return null;
  }
}

async function main() {
  if (process.env.SKIP_WEBR_FETCH === '1') {
    console.log('[naklidata] SKIP_WEBR_FETCH=1 — skipping vendored WebR');
    return;
  }
  let details;
  try {
    details = await packageDetails();
  } catch {
    console.error('[naklidata] webr is not installed — run `npm install` (it is a devDependency).');
    process.exit(1);
  }

  // Idempotent only for the exact package version and required runtime layout.
  const complete = [...FILES, ...ROOT_FILES, ...DIRS].every((entry) =>
    existsSync(resolve(DEST, entry)),
  );
  if (complete && (await vendoredVersion()) === details.version) {
    console.log(`[naklidata] vendored WebR ${details.version} already present`);
    return;
  }

  console.log(`[naklidata] vendoring WebR ${details.version} from webr (incl. the R VFS)`);
  await rm(DEST, { recursive: true, force: true });
  await mkdir(DEST, { recursive: true });
  for (const f of FILES) {
    await cp(resolve(details.dir, f), resolve(DEST, f));
  }
  for (const f of ROOT_FILES) {
    await cp(resolve(details.packageRoot, f), resolve(DEST, f));
  }
  for (const d of DIRS) {
    await cp(resolve(details.dir, d), resolve(DEST, d), { recursive: true });
  }
  await writeFile(
    VERSION_FILE,
    `${JSON.stringify({ package: 'webr', version: details.version }, null, 2)}\n`,
  );
  const vfsCount = existsSync(resolve(DEST, 'vfs'))
    ? (await readdir(resolve(DEST, 'vfs'), { recursive: true })).length
    : 0;
  console.log(
    `  ✓ ${FILES.length} core files + ${ROOT_FILES.length} license file + vfs/ (${vfsCount} entries)`,
  );
}

main().catch((err) => {
  console.error(`[naklidata] webr vendoring failed: ${err.message}`);
  process.exit(1);
});
