#!/usr/bin/env node
// Postinstall hook: vendor DuckDB-wasm into public/duckdb-fallback/ so the
// offline-first user (or `?offline=1` URL) has a local copy. Also writes
// integrity.json with SHA-384 of each file so the runtime engine can
// verify CDN-loaded bytes match (spec §7.1 gate: "DuckDB-wasm boots from
// CDN with SRI").
//
// Source order:
//  1. node_modules/@duckdb/duckdb-wasm/dist/ (always present after
//     `npm install`; bit-for-bit identical to the CDN's pinned version)
//  2. CDN fallback (only if node_modules is missing — uncommon)
//
// Skip when:
//  - SKIP_DUCKDB_FETCH=1 is set
//  - The destination already has the expected files AND integrity.json

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const DEST = resolve('public/duckdb-fallback');
const NPM_SRC = resolve('node_modules/@duckdb/duckdb-wasm/dist');
const PINNED = '1.29.0';
const CDN = `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${PINNED}/dist`;

const FILES = [
  'duckdb-mvp.wasm',
  'duckdb-eh.wasm',
  'duckdb-browser-mvp.worker.js',
  'duckdb-browser-eh.worker.js',
];

async function fileExists(p) {
  try {
    const s = await stat(p);
    return s.isFile();
  } catch {
    return false;
  }
}

async function alreadyVendored() {
  for (const f of FILES) {
    if (!(await fileExists(resolve(DEST, f)))) return false;
  }
  return await fileExists(resolve(DEST, 'integrity.json'));
}

async function sourceBytes(name) {
  const npmPath = resolve(NPM_SRC, name);
  if (await fileExists(npmPath)) {
    return new Uint8Array(await readFile(npmPath));
  }
  const url = `${CDN}/${name}`;
  console.log(`[naklidata]   ${name}: fetching from CDN (node_modules copy missing)`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function sha384(bytes) {
  return `sha384-${createHash('sha384').update(bytes).digest('base64')}`;
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
  const integrity = { version: PINNED, generated: new Date().toISOString(), files: {} };
  try {
    for (const f of FILES) {
      const bytes = await sourceBytes(f);
      await writeFile(resolve(DEST, f), bytes);
      integrity.files[f] = sha384(bytes);
      console.log(
        `  ✓ ${f} (${(bytes.byteLength / 1024).toFixed(1)} KB) ${integrity.files[f].slice(0, 24)}…`,
      );
    }
    await writeFile(resolve(DEST, 'integrity.json'), JSON.stringify(integrity, null, 2));
    console.log(`  ✓ integrity.json (${Object.keys(integrity.files).length} hashes)`);
  } catch (err) {
    console.warn(`[naklidata] could not vendor DuckDB fallback (continuing): ${err.message}`);
    console.warn('         Re-run `npm run postinstall` after restoring network.');
  }
}

main().catch((err) => {
  console.warn(`[naklidata] vendoring failed: ${err.message}`);
  process.exit(0);
});
