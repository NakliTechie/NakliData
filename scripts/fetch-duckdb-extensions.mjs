#!/usr/bin/env node
// Postinstall hook (Theme 1 wave 3): vendor a handful of DuckDB
// extensions into `public/duckdb-extensions/<revision>/<platform>/` so
// the offline-first user (or `?offline=1` boot) can mount JSONL +
// SQLite + spatial sources without reaching `extensions.duckdb.org`.
//
// URL pattern at extensions.duckdb.org:
//   ${REPO}/${REVISION}/${PLATFORM}/${NAME}.duckdb_extension.wasm
//
// For DuckDB-wasm 1.29.0 (our pin), REVISION = v1.1.1 and the wasm_eh
// PLATFORM is what our engine boots into. See DECISIONS 2026-05-23 for
// scope (we vendor only the extensions that (a) actually exist for
// wasm_eh @ v1.1.1 and (b) unblock smoke). `excel` + `read_stat` are
// deferred — see DECISIONS for the rationale.
//
// Skip when:
//  - SKIP_DUCKDB_EXT_FETCH=1 is set
//  - The destination already has every expected file AND integrity.json

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Bundled DuckDB-core revision that duckdb-wasm 1.29.0 ships. Probed
// empirically against extensions.duckdb.org — keep in sync with
// fetch-duckdb-fallback.mjs's PINNED if the wasm package bumps.
const REVISION = 'v1.1.1';
const PLATFORM = 'wasm_eh';

const DEST = resolve('public/duckdb-extensions');
const SUB_DIR = `${REVISION}/${PLATFORM}`;
const REMOTE_BASE = `https://extensions.duckdb.org/${REVISION}/${PLATFORM}`;

// Extensions vendored for offline smoke. Names must match what the
// engine's `ensureExtension(name)` calls or what DuckDB's INSTALL
// resolves to (e.g., `INSTALL sqlite` resolves to `sqlite_scanner`).
//
// `aliasFrom` lists the LOAD-side aliases that should also point at
// this extension's file. The fetcher writes the bytes under each
// alias name so DuckDB-wasm's URL construction finds the file
// regardless of which alias the runtime picks.
const EXTENSIONS = [
  { name: 'json', aliasFrom: [] },
  { name: 'sqlite_scanner', aliasFrom: ['sqlite'] },
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
  if (!(await fileExists(resolve(DEST, SUB_DIR, 'integrity.json')))) return false;
  for (const ext of EXTENSIONS) {
    if (!(await fileExists(resolve(DEST, SUB_DIR, `${ext.name}.duckdb_extension.wasm`)))) {
      return false;
    }
    for (const alias of ext.aliasFrom) {
      if (!(await fileExists(resolve(DEST, SUB_DIR, `${alias}.duckdb_extension.wasm`)))) {
        return false;
      }
    }
  }
  return true;
}

function sha384(bytes) {
  return `sha384-${createHash('sha384').update(bytes).digest('base64')}`;
}

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Load the checked-in `integrity.json` if it exists, returning the
 * expected file→hash map. When present, this becomes the SOURCE OF
 * TRUTH for the vendored bytes — downloaded files are verified
 * against it and the script exits non-zero on mismatch.
 *
 * Forward-pass H6 (2026-06-02): without a checked-in hash, the
 * original flow built `integrity.json` from whatever bytes the network
 * happened to deliver. A MITM / DNS hijack / compromised CDN during
 * `npm install` substituted attacker bytes and the recorded hash
 * "ratified" the swap. With the pinned table, drift is detected.
 */
async function loadPinnedHashes() {
  const p = resolve(DEST, SUB_DIR, 'integrity.json');
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
  if (process.env.SKIP_DUCKDB_EXT_FETCH === '1') {
    console.log('[naklidata] SKIP_DUCKDB_EXT_FETCH=1 — skipping vendored extensions');
    return;
  }
  await mkdir(resolve(DEST, SUB_DIR), { recursive: true });
  // Read the checked-in pinned hashes (if any). Missing file =
  // first-time bootstrap of this revision/platform, where we accept
  // whatever the network returns and record it. Subsequent runs MUST
  // match.
  const pinned = await loadPinnedHashes();
  const bootstrapping = pinned === null;
  if (bootstrapping) {
    console.warn(
      `[naklidata] no pinned hashes for ${SUB_DIR} — bootstrapping; commit integrity.json to lock these bytes.`,
    );
  }
  if (await alreadyVendored()) {
    // Code-review of v1.2.1..HEAD: re-verify on-disk hashes against the
    // pin even on the alreadyVendored shortcut — closes the in-place
    // tamper window that bypassed H6 otherwise.
    if (!bootstrapping) {
      for (const ext of EXTENSIONS) {
        const filenames = [
          `${ext.name}.duckdb_extension.wasm`,
          ...ext.aliasFrom.map((a) => `${a}.duckdb_extension.wasm`),
        ];
        for (const filename of filenames) {
          const expected = pinned[filename];
          if (!expected) continue; // tolerate pin missing this alias
          const onDisk = new Uint8Array(await readFile(resolve(DEST, SUB_DIR, filename)));
          const actualHash = sha384(onDisk);
          if (expected !== actualHash) {
            throw new Error(
              `on-disk hash mismatch for ${filename}\n  expected: ${expected}\n  got:      ${actualHash}\nvendored byte was tampered with. This is a supply-chain alert.`,
            );
          }
        }
      }
    }
    console.log(`[naklidata] vendored DuckDB extensions already present (${SUB_DIR})`);
    return;
  }
  console.log(`[naklidata] vendoring DuckDB extensions for ${REVISION}/${PLATFORM}`);
  const integrity = {
    revision: REVISION,
    platform: PLATFORM,
    generated: bootstrapping ? new Date().toISOString() : 'pinned',
    files: {},
  };
  for (const ext of EXTENSIONS) {
    const remoteUrl = `${REMOTE_BASE}/${ext.name}.duckdb_extension.wasm`;
    const bytes = await fetchBytes(remoteUrl);
    const primary = `${ext.name}.duckdb_extension.wasm`;
    const actualHash = sha384(bytes);
    if (!bootstrapping) {
      const expected = pinned[primary];
      if (!expected) {
        throw new Error(
          `pinned integrity.json has no entry for ${primary} — refusing to silently widen the bundle (update integrity.json on purpose)`,
        );
      }
      if (expected !== actualHash) {
        throw new Error(
          `hash mismatch for ${primary}\n  expected: ${expected}\n  got:      ${actualHash}\nbytes from ${remoteUrl} do not match the checked-in pin. This is a supply-chain alert — DO NOT just regenerate integrity.json; investigate why the bytes changed.`,
        );
      }
    }
    await writeFile(resolve(DEST, SUB_DIR, primary), bytes);
    integrity.files[primary] = actualHash;
    console.log(
      `  ✓ ${primary} (${(bytes.byteLength / 1024).toFixed(0)} KB) ${actualHash.slice(0, 24)}…`,
    );
    // Write the same bytes under each alias name so an INSTALL that
    // routes through the alias finds the file too. (Cheap — costs a
    // few MB of identical bytes; the OS dedupes via inode if we ever
    // hardlink. We use plain copies here for portability.)
    for (const alias of ext.aliasFrom) {
      const aliasName = `${alias}.duckdb_extension.wasm`;
      await writeFile(resolve(DEST, SUB_DIR, aliasName), bytes);
      integrity.files[aliasName] = actualHash;
      console.log(`  ✓ ${aliasName} (alias of ${primary})`);
    }
  }
  if (bootstrapping) {
    await writeFile(resolve(DEST, SUB_DIR, 'integrity.json'), JSON.stringify(integrity, null, 2));
    console.log(
      `  ✓ integrity.json (${Object.keys(integrity.files).length} hashes — bootstrap; please commit)`,
    );
  } else {
    console.log('  ✓ all hashes match the checked-in pin');
  }
}

// Forward-pass M15 (2026-06-02): exit non-zero on real failure.
// Previously `process.exit(0)` swallowed network outages, hash
// mismatches, and disk-full mid-write — leaving the build looking
// "fine" until smoke failed later. Real errors now propagate.
main().catch((err) => {
  console.error(`[naklidata] extension vendoring failed: ${err.message}`);
  process.exit(1);
});
