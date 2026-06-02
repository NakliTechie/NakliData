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

/**
 * Load the checked-in `integrity.json` if it exists, returning the
 * expected file→hash map. Forward-pass H6 (2026-06-02): see
 * fetch-duckdb-extensions.mjs for the rationale — pinned hashes turn
 * the postinstall fetch from a "trust the bytes that arrived" flow
 * into a "verify they match the committed pin" flow.
 */
async function loadPinnedHashes() {
  const p = resolve(DEST, 'integrity.json');
  if (!(await fileExists(p))) return null;
  try {
    const raw = await readFile(p, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.files && typeof parsed.files === 'object') {
      return parsed.files;
    }
  } catch (err) {
    console.warn(`[naklidata] could not read pinned hashes from ${p}: ${err.message}`);
  }
  return null;
}

async function main() {
  if (process.env.SKIP_DUCKDB_FETCH === '1') {
    console.log('[naklidata] SKIP_DUCKDB_FETCH=1 — skipping vendored DuckDB fetch');
    return;
  }
  if (!existsSync('public')) await mkdir('public', { recursive: true });
  await mkdir(DEST, { recursive: true });
  const pinned = await loadPinnedHashes();
  const bootstrapping = pinned === null;
  if (bootstrapping) {
    console.warn(
      `[naklidata] no pinned hashes for DuckDB-wasm ${PINNED} — bootstrapping; commit integrity.json to lock these bytes.`,
    );
  }
  if (await alreadyVendored()) {
    // Code-review of v1.2.1..HEAD: even when files are already present,
    // verify their hashes against the pinned table BEFORE shortcutting.
    // Without this, on-disk tampering between installs (e.g., editing a
    // .wasm file in place) bypasses the H6 protection entirely.
    if (!bootstrapping) {
      for (const f of FILES) {
        const onDisk = new Uint8Array(await readFile(resolve(DEST, f)));
        const actualHash = sha384(onDisk);
        const expected = pinned[f];
        if (expected && expected !== actualHash) {
          throw new Error(
            `on-disk hash mismatch for ${f}\n  expected: ${expected}\n  got:      ${actualHash}\nvendored byte was tampered with after install. This is a supply-chain alert.`,
          );
        }
      }
    }
    console.log('[naklidata] vendored DuckDB-wasm already present');
    return;
  }
  console.log(`[naklidata] vendoring DuckDB-wasm ${PINNED} into ${DEST}`);
  const integrity = {
    version: PINNED,
    generated: bootstrapping ? new Date().toISOString() : 'pinned',
    files: {},
  };
  for (const f of FILES) {
    const bytes = await sourceBytes(f);
    const actualHash = sha384(bytes);
    if (!bootstrapping) {
      const expected = pinned[f];
      if (!expected) {
        throw new Error(
          `pinned integrity.json has no entry for ${f} — refusing to silently widen the bundle (update integrity.json on purpose)`,
        );
      }
      if (expected !== actualHash) {
        throw new Error(
          `hash mismatch for ${f}\n  expected: ${expected}\n  got:      ${actualHash}\nbytes do not match the checked-in pin. This is a supply-chain alert.`,
        );
      }
    }
    await writeFile(resolve(DEST, f), bytes);
    integrity.files[f] = actualHash;
    console.log(
      `  ✓ ${f} (${(bytes.byteLength / 1024).toFixed(1)} KB) ${actualHash.slice(0, 24)}…`,
    );
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

// Forward-pass M15 (2026-06-02): exit non-zero on real failure
// instead of silently swallowing into exit(0). Partial files left
// from a mid-write disk-full crash now visibly fail the build.
main().catch((err) => {
  console.error(`[naklidata] vendoring failed: ${err.message}`);
  process.exit(1);
});
