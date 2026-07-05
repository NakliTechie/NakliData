#!/usr/bin/env node
// Postinstall hook: vendor Pyodide 0.27.7 + the pandas/pyarrow package set
// into `public/pyodide/` so the Python cell (Polyglot-Workbench Fork 2) loads
// its runtime SAME-ORIGIN — no CDN reach at runtime (sovereign posture, same
// as the DuckDB extensions / sql.js / SheetJS vendoring).
//
// Why 0.27.7 specifically: `pyarrow` ships ONLY in Pyodide 0.27.x — not 0.26,
// not 0.28 (verified against the lockfiles; DECISIONS CE). pyarrow is the
// clean DuckDB<->pandas Arrow interchange, so the version pin is load-bearing.
//
// Skip when:
//  - SKIP_PYODIDE_FETCH=1 is set
//  - The destination already has every expected file AND integrity.json (whose
//    pinned hashes are then re-verified against the bytes on disk).
//
// Bytes are gitignored (~45 MB); only integrity.json is committed. Mirrors the
// pin-is-source-of-truth model of fetch-duckdb-extensions.mjs (forward-pass H6)
// so a compromised CDN during `npm install` is detected, not ratified.

import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const VERSION = 'v0.27.7';
const BASE = `https://cdn.jsdelivr.net/pyodide/${VERSION}/full`;
const DEST = resolve('public/pyodide');

// Core runtime files + the pandas/pyarrow wheel closure (numpy, pandas,
// pyarrow, + their deps — computed from the lockfile's dependency graph).
const FILES = [
  'pyodide.mjs',
  'pyodide.asm.js',
  'pyodide.asm.wasm',
  'python_stdlib.zip',
  'pyodide-lock.json',
  'numpy-2.0.2-cp312-cp312-pyodide_2024_0_wasm32.whl',
  'pandas-2.2.3-cp312-cp312-pyodide_2024_0_wasm32.whl',
  'pyarrow-18.1.0-cp312-cp312-pyodide_2024_0_wasm32.whl',
  'pyodide_unix_timezones-1.0.0-py3-none-any.whl',
  'python_dateutil-2.9.0.post0-py2.py3-none-any.whl',
  'pytz-2024.1-py2.py3-none-any.whl',
  'six-1.16.0-py2.py3-none-any.whl',
];

async function fileExists(p) {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

function sha384(bytes) {
  return `sha384-${createHash('sha384').update(bytes).digest('base64')}`;
}

async function fetchBytes(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function loadPinned() {
  const p = resolve(DEST, 'integrity.json');
  if (!(await fileExists(p))) return null;
  try {
    const parsed = JSON.parse(await readFile(p, 'utf8'));
    if (parsed?.files && typeof parsed.files === 'object') return parsed.files;
  } catch (err) {
    console.warn(`[naklidata] could not read pinned pyodide hashes: ${err.message}`);
  }
  return null;
}

async function alreadyVendored(pinned) {
  if (!(await fileExists(resolve(DEST, 'integrity.json')))) return false;
  for (const f of FILES) {
    if (!(await fileExists(resolve(DEST, f)))) return false;
  }
  // Re-verify on-disk bytes against the pin (closes the in-place tamper window).
  if (pinned) {
    for (const f of FILES) {
      const expected = pinned[f];
      if (!expected) continue;
      const onDisk = new Uint8Array(await readFile(resolve(DEST, f)));
      if (sha384(onDisk) !== expected) {
        throw new Error(
          `on-disk hash mismatch for pyodide/${f}\n  expected: ${expected}\n  got:      ${sha384(onDisk)}\nvendored byte was tampered with — supply-chain alert.`,
        );
      }
    }
  }
  return true;
}

async function main() {
  if (process.env.SKIP_PYODIDE_FETCH === '1') {
    console.log('[naklidata] SKIP_PYODIDE_FETCH=1 — skipping vendored Pyodide');
    return;
  }
  await mkdir(DEST, { recursive: true });
  const pinned = await loadPinned();
  const bootstrapping = pinned === null;
  if (bootstrapping) {
    console.warn(
      '[naklidata] no pinned pyodide hashes — bootstrapping; commit public/pyodide/integrity.json to lock these bytes.',
    );
  }
  if (await alreadyVendored(pinned)) {
    console.log(`[naklidata] vendored Pyodide already present (${VERSION})`);
    return;
  }
  console.log(`[naklidata] vendoring Pyodide ${VERSION} + pandas/pyarrow (~45 MB)`);
  const integrity = {
    version: VERSION,
    generated: bootstrapping ? new Date().toISOString() : 'pinned',
    files: {},
  };
  for (const f of FILES) {
    const bytes = await fetchBytes(`${BASE}/${f}`);
    const hash = sha384(bytes);
    if (!bootstrapping) {
      const expected = pinned[f];
      if (!expected) {
        throw new Error(
          `pinned integrity.json has no entry for ${f} — refusing to silently widen (update the pin on purpose)`,
        );
      }
      if (expected !== hash) {
        throw new Error(
          `hash mismatch for ${f}\n  expected: ${expected}\n  got:      ${hash}\nbytes from ${BASE}/${f} do not match the pin — supply-chain alert; investigate, do NOT just regenerate.`,
        );
      }
    }
    await writeFile(resolve(DEST, f), bytes);
    integrity.files[f] = hash;
    console.log(`  ✓ ${f} (${(bytes.byteLength / 1048576).toFixed(1)} MB)`);
  }
  if (bootstrapping) {
    await writeFile(resolve(DEST, 'integrity.json'), JSON.stringify(integrity, null, 2));
    console.log(
      `  ✓ integrity.json (${Object.keys(integrity.files).length} hashes — bootstrap; please commit)`,
    );
  } else {
    console.log('  ✓ all hashes match the checked-in pin');
  }
}

main().catch((err) => {
  console.error(`[naklidata] pyodide vendoring failed: ${err.message}`);
  process.exit(1);
});
