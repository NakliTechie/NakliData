#!/usr/bin/env node
// Postinstall hook — vendor sql.js's WebAssembly binary into
// `public/sqlite-wasm/sql-wasm.wasm` so the SQLite mount path works
// offline / same-origin, with no CDN reach at runtime (sovereign posture).
//
// Why sql.js at all? DuckDB-wasm's `sqlite_scanner` extension cannot open a
// browser-*registered* file: its SQLite VFS is not wired to DuckDB's
// WebFileSystem, so `ATTACH '<registered>' (TYPE sqlite)` "succeeds" but the
// first read fails with "unable to open database file" — confirmed across
// every registration protocol (buffer / FILEREADER / FSACCESS) AND across
// DuckDB cores v1.1.1 and v1.3.2. It is an architectural limitation, not a
// version bug. So we read the SQLite file in JS via sql.js (SQLite compiled
// to wasm), extract each table, and load it into DuckDB as NDJSON. See
// DECISIONS 2026-07-04 and `src/lazy/sqlite-reader.ts`.
//
// The 48 KB JS glue is bundled into the lazy `sqlite-reader` chunk by
// esbuild; only the ~640 KB .wasm needs to be an on-disk asset (fetched by
// sql.js's `locateFile` at runtime). It's small enough to ride Cloudflare's
// per-file limit, so — unlike duckdb-fallback — it's always served
// same-origin.
//
// Skip when SKIP_SQL_WASM_VENDOR=1, or when the destination already matches.

import { existsSync } from 'node:fs';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

if (process.env.SKIP_SQL_WASM_VENDOR === '1') {
  console.log('[vendor-sql-wasm] SKIP_SQL_WASM_VENDOR=1 — skipping');
  process.exit(0);
}

const SRC = resolve('node_modules/sql.js/dist/sql-wasm.wasm');
const DEST_DIR = resolve('public/sqlite-wasm');
const DEST = resolve(DEST_DIR, 'sql-wasm.wasm');

if (!existsSync(SRC)) {
  // sql.js not installed yet (e.g. `--ignore-scripts` on a partial install).
  // Non-fatal: the SQLite mount surfaces a clear error if the wasm is absent.
  console.warn(`[vendor-sql-wasm] source not found (${SRC}); skipping — run after \`npm i sql.js\``);
  process.exit(0);
}

// Idempotent: if the destination already has the exact same byte length, skip.
if (existsSync(DEST)) {
  const [s, d] = await Promise.all([stat(SRC), stat(DEST)]);
  if (s.size === d.size) {
    console.log('[vendor-sql-wasm] up to date');
    process.exit(0);
  }
}

await mkdir(DEST_DIR, { recursive: true });
await copyFile(SRC, DEST);
console.log(`[vendor-sql-wasm] vendored → public/sqlite-wasm/sql-wasm.wasm`);
