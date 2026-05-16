#!/usr/bin/env node
// Postinstall hook: vendor DuckDB-wasm into public/duckdb-fallback/ so the
// offline-first user (or `?offline=1` URL) has a local copy.
//
// Skip when:
//  - SKIP_DUCKDB_FETCH=1 is set
//  - The destination already has the expected files
//  - Network is unavailable (we don't fail the install; users can populate later)

import { mkdir, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DEST = resolve('public/duckdb-fallback');
const PINNED = '1.29.0';
const CDN = `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${PINNED}/dist`;

const FILES = [
  'duckdb-mvp.wasm',
  'duckdb-eh.wasm',
  'duckdb-browser-mvp.worker.js',
  'duckdb-browser-eh.worker.js',
];

async function alreadyVendored() {
  try {
    for (const f of FILES) {
      const s = await stat(resolve(DEST, f));
      if (!s.isFile()) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (process.env.SKIP_DUCKDB_FETCH === '1') {
    console.log('[naklidata] SKIP_DUCKDB_FETCH=1 — skipping vendored DuckDB fetch');
    return;
  }
  if (!existsSync('public')) await mkdir('public', { recursive: true });
  await mkdir(DEST, { recursive: true });
  if (await alreadyVendored()) {
    console.log('[naklidata] vendored DuckDB-wasm already present');
    return;
  }
  console.log(`[naklidata] vendoring DuckDB-wasm ${PINNED} into ${DEST}`);
  try {
    for (const f of FILES) {
      const url = `${CDN}/${f}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      await writeFile(resolve(DEST, f), buf);
      console.log(`  ✓ ${f} (${(buf.byteLength / 1024).toFixed(1)} KB)`);
    }
  } catch (err) {
    console.warn(`[naklidata] could not vendor DuckDB fallback (continuing): ${err.message}`);
    console.warn('         Re-run `npm run postinstall` after restoring network.');
  }
}

main().catch((err) => {
  console.warn(`[naklidata] vendoring failed: ${err.message}`);
  process.exit(0);
});
