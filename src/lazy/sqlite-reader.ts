// Lazy chunk — read a SQLite database file in the browser via sql.js.
//
// Loaded only when a user mounts a `.sqlite` / `.db` file. It exists
// because DuckDB-wasm's own `sqlite_scanner` extension CANNOT open a
// browser-registered file: its embedded SQLite VFS is not wired to
// DuckDB's WebFileSystem, so `ATTACH '<registered-file>' (TYPE sqlite)`
// reports success but the first read throws "unable to open database
// file". Verified exhaustively (real-data test, 2026-07-04): the failure
// is identical across every registration protocol (BUFFER / BROWSER_
// FILEREADER / BROWSER_FSACCESS) AND across DuckDB cores v1.1.1 and
// v1.3.2 — an architectural limitation of duckdb-wasm, not a version bug
// or a seekability issue (a `read_blob()` on the same registered file
// returns all bytes fine). See DECISIONS 2026-07-04.
//
// So we bypass DuckDB's SQLite path entirely: sql.js (SQLite compiled to
// wasm) opens the file from its raw bytes, we enumerate the user tables
// and stream each to NDJSON, and the engine loads them into DuckDB via
// `read_json_auto` (per-column type inference — SQLite date-text even
// comes back as TIMESTAMP). This mirrors the SheetJS xlsx path: a lazy,
// vendored, sovereign reader that hands DuckDB something it ingests
// natively.

import initSqlJs from 'sql.js';

/** One extracted table, ready for the engine to load into DuckDB. */
export interface SqliteTable {
  /** The table's name as it appears in the SQLite schema. */
  name: string;
  /** Rows serialised as newline-delimited JSON (one object per line). Empty when rowCount === 0. */
  ndjson: Uint8Array;
  /** Row count (0 for an empty table — the engine then creates a 0-row VARCHAR shell). */
  rowCount: number;
  /** Column names (from PRAGMA table_info) — used to shape empty tables. */
  columns: string[];
}

// sql.js is initialised once per chunk load; the factory resolves the
// wasm binary via `locateFile`. We point it at the same-origin vendored
// copy (public/sqlite-wasm/sql-wasm.wasm → dist/sqlite-wasm/…), resolved
// against document.baseURI so subpath deploys (e.g. GitHub Pages under
// /NakliData/) work. No CDN reach — sovereign posture.
let _sqlPromise: Promise<initSqlJs.SqlJsStatic> | null = null;
function getSqlJs(): Promise<initSqlJs.SqlJsStatic> {
  if (!_sqlPromise) {
    _sqlPromise = initSqlJs({
      locateFile: (file: string) => new URL(`./sqlite-wasm/${file}`, document.baseURI).href,
    });
  }
  return _sqlPromise;
}

/**
 * Open a SQLite database from its bytes and extract every user table.
 * `sqlite_%` internal tables are skipped. BLOB cells are coerced to null
 * (they aren't representable in NDJSON and aren't queried analytically).
 * Rows stream through a prepared statement so we never hold two full
 * copies of a large table in memory at once.
 */
export async function readSqliteTables(bytes: Uint8Array): Promise<SqliteTable[]> {
  const SQL = await getSqlJs();
  const db = new SQL.Database(bytes);
  try {
    const tableRes = db.exec(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    const names: string[] = tableRes[0] ? tableRes[0].values.map((r) => String(r[0])) : [];

    const out: SqliteTable[] = [];
    const encoder = new TextEncoder();
    for (const name of names) {
      const quoted = `"${name.replace(/"/g, '""')}"`;
      // Column names up front — lets us shape an empty table even when
      // there are no rows to infer them from.
      const info = db.exec(`PRAGMA table_info(${quoted})`);
      const columns: string[] = info[0] ? info[0].values.map((r) => String(r[1])) : [];

      const stmt = db.prepare(`SELECT * FROM ${quoted}`);
      const lines: string[] = [];
      while (stmt.step()) {
        const row = stmt.getAsObject();
        for (const key of Object.keys(row)) {
          if (row[key] instanceof Uint8Array) row[key] = null;
        }
        lines.push(JSON.stringify(row));
      }
      stmt.free();

      out.push({
        name,
        ndjson: lines.length ? encoder.encode(lines.join('\n')) : new Uint8Array(0),
        rowCount: lines.length,
        columns,
      });
    }
    return out;
  } finally {
    db.close();
  }
}
