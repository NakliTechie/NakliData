// DuckDB-wasm engine client. Lives on the main thread; the engine itself
// runs in a worker (the official @duckdb/duckdb-wasm worker). The rest of
// the app talks to DuckDB only through this module.
//
// Spec refs:
//   §1.2 — three pinned runtime bundles, DuckDB CDN load
//   §2.2 — worker topology (DuckDB worker off main thread)
//   §3.2 — sampling for classification (USING SAMPLE)
//   §3.7 — CSP allows wasm-unsafe-eval and the jsdelivr CDN origin

import * as duckdb from '@duckdb/duckdb-wasm';
// Subresource-integrity hashes for the DuckDB-wasm CDN bundle, generated
// at install time from the same bytes the vendored fallback contains.
// Spec §7.1 gate: "DuckDB-wasm boots from CDN with SRI; vendored fallback
// verified offline." When the CDN serves different bytes (mirror swap,
// cache corruption, MITM), the fetch fails closed and we fall back to
// the vendored copy.
import duckdbIntegrity from '../../public/duckdb-fallback/integrity.json';

export type EngineStatus = 'idle' | 'booting' | 'ready' | 'error';

export interface EngineBootOptions {
  /** If true, load DuckDB-wasm from `public/duckdb-fallback/` instead of the CDN. */
  offline?: boolean;
  /** Pinned CDN base. */
  cdnBase?: string;
}

export interface EngineEvents {
  status: { status: EngineStatus; message?: string };
}

export type EngineEventName = keyof EngineEvents;

export interface RegisterFileOptions {
  /** Logical table name DuckDB will see. */
  tableName: string;
  /** The source File object (from FSA / input). */
  file: File;
}

export interface QueryOptions {
  /** AbortSignal — calling abort triggers DuckDB interrupt + rejects the promise. */
  signal?: AbortSignal;
}

const DEFAULT_CDN_BASE = 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/dist/';
const FALLBACK_BASE = '/duckdb-fallback/';

function fallbackOrigin(): string {
  // The worker is created from a blob: URL whose base is opaque, so
  // importScripts can't resolve a root-relative path. Resolve it against
  // the page's origin instead.
  if (typeof location !== 'undefined' && location.origin) return location.origin;
  return '';
}

export class EngineError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

/** Source repository for an extension install. */
export type ExtensionSource = 'core' | 'community';

export class ExtensionLoadError extends Error {
  constructor(
    public readonly extensionName: string,
    cause: unknown,
  ) {
    super(
      `Could not load DuckDB extension "${extensionName}": ${cause instanceof Error ? cause.message : cause}`,
    );
    this.name = 'ExtensionLoadError';
  }
}

export class Engine {
  private db: duckdb.AsyncDuckDB | null = null;
  private conn: duckdb.AsyncDuckDBConnection | null = null;
  private worker: Worker | null = null;
  private status: EngineStatus = 'idle';
  private listeners = new Map<EngineEventName, Set<(payload: unknown) => void>>();
  private loadedExtensions = new Set<string>();

  on<E extends EngineEventName>(event: E, fn: (payload: EngineEvents[E]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as (p: unknown) => void);
    return () => set?.delete(fn as (p: unknown) => void);
  }

  private emit<E extends EngineEventName>(event: E, payload: EngineEvents[E]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(payload);
      } catch (err) {
        console.error('[engine] listener error', err);
      }
    }
  }

  getStatus(): EngineStatus {
    return this.status;
  }

  private setStatus(status: EngineStatus, message?: string): void {
    this.status = status;
    this.emit('status', message !== undefined ? { status, message } : { status });
  }

  async boot(opts: EngineBootOptions = {}): Promise<void> {
    if (this.status === 'ready' || this.status === 'booting') return;
    this.setStatus('booting');
    try {
      const bundles = bundlesFor(opts);
      const bundle = await duckdb.selectBundle(bundles);
      if (!bundle.mainWorker) {
        throw new EngineError('DuckDB bundle did not include a mainWorker URL');
      }

      // For the CDN path, SRI-verify the worker JS + wasm before letting
      // DuckDB load them. For the offline (vendored) path, the bytes
      // are already same-origin and trusted by transitive trust of the
      // build pipeline — skip the extra fetch.
      let workerScriptUrl = bundle.mainWorker;
      let mainModuleUrl = bundle.mainModule;
      if (!opts.offline) {
        const variant = (bundle.mainWorker.includes('-eh.worker') ? 'eh' : 'mvp') as 'eh' | 'mvp';
        const wasmFile = `duckdb-${variant}.wasm`;
        const workerFile = `duckdb-browser-${variant}.worker.js`;
        const integrityFiles = duckdbIntegrity.files as Record<string, string | undefined>;
        const workerHash = integrityFiles[workerFile];
        const wasmHash = integrityFiles[wasmFile];
        if (!workerHash || !wasmHash) {
          throw new EngineError(
            `Missing SRI hash for ${variant} bundle (expected ${workerFile} + ${wasmFile} in integrity.json)`,
          );
        }
        const [workerBytes, wasmBytes] = await Promise.all([
          fetchWithSri(bundle.mainWorker, workerHash),
          fetchWithSri(bundle.mainModule, wasmHash),
        ]);
        workerScriptUrl = URL.createObjectURL(
          new Blob([new Uint8Array(workerBytes)], { type: 'text/javascript' }),
        );
        mainModuleUrl = URL.createObjectURL(
          new Blob([new Uint8Array(wasmBytes)], { type: 'application/wasm' }),
        );
      }

      const workerBootstrapUrl = URL.createObjectURL(
        new Blob([`importScripts("${workerScriptUrl}");`], { type: 'text/javascript' }),
      );
      const worker = new Worker(workerBootstrapUrl);
      const logger = new duckdb.ConsoleLogger();
      const db = new duckdb.AsyncDuckDB(logger, worker);
      await db.instantiate(mainModuleUrl, bundle.pthreadWorker ?? null);
      URL.revokeObjectURL(workerBootstrapUrl);

      this.db = db;
      this.worker = worker;
      this.conn = await db.connect();
      this.setStatus('ready');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setStatus('error', msg);
      throw err instanceof EngineError ? err : new EngineError(`Engine boot failed: ${msg}`, err);
    }
  }

  private requireConn(): duckdb.AsyncDuckDBConnection {
    if (!this.conn) throw new EngineError('Engine not booted');
    return this.conn;
  }

  /** Execute a query and return all rows. */
  async query<Row = Record<string, unknown>>(sql: string, opts: QueryOptions = {}): Promise<Row[]> {
    const conn = this.requireConn();
    const { signal } = opts;
    if (signal?.aborted) throw new EngineError('Query aborted before start');

    const onAbort = () => {
      // DuckDB cancels the in-flight statement on this connection.
      void conn.cancelSent();
    };
    signal?.addEventListener('abort', onAbort);
    try {
      const result = await conn.query(sql);
      return result.toArray().map((r) => r.toJSON()) as Row[];
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /** Register a File as a DuckDB-readable file, optionally creating a view. */
  private async registerFile(name: string, file: File): Promise<void> {
    if (!this.db) throw new EngineError('Engine not booted');
    const buf = new Uint8Array(await file.arrayBuffer());
    await this.db.registerFileBuffer(name, buf);
  }

  /** Register a CSV file as a table via `read_csv_auto`. */
  async registerCsv({ tableName, file }: RegisterFileOptions): Promise<void> {
    const fname = sanitizeFileName(file.name);
    await this.registerFile(fname, file);
    const safeTable = sanitizeIdent(tableName);
    await this.exec(
      `CREATE OR REPLACE VIEW ${quoteIdent(safeTable)} AS
       SELECT * FROM read_csv_auto('${escapeLiteral(fname)}', header=true, sample_size=2048)`,
    );
  }

  /** Register a TSV (tab-delimited) file. */
  async registerTsv({ tableName, file }: RegisterFileOptions): Promise<void> {
    const fname = sanitizeFileName(file.name);
    await this.registerFile(fname, file);
    const safeTable = sanitizeIdent(tableName);
    await this.exec(
      `CREATE OR REPLACE VIEW ${quoteIdent(safeTable)} AS
       SELECT * FROM read_csv_auto('${escapeLiteral(fname)}', delim='\t', header=true, sample_size=2048)`,
    );
  }

  /** Register a JSONL (NDJSON) file. */
  async registerJsonl({ tableName, file }: RegisterFileOptions): Promise<void> {
    const fname = sanitizeFileName(file.name);
    await this.registerFile(fname, file);
    const safeTable = sanitizeIdent(tableName);
    await this.exec(
      `CREATE OR REPLACE VIEW ${quoteIdent(safeTable)} AS
       SELECT * FROM read_json_auto('${escapeLiteral(fname)}', format='newline_delimited')`,
    );
  }

  /** Register a Parquet file. */
  async registerParquet({ tableName, file }: RegisterFileOptions): Promise<void> {
    const fname = sanitizeFileName(file.name);
    await this.registerFile(fname, file);
    const safeTable = sanitizeIdent(tableName);
    await this.exec(
      `CREATE OR REPLACE VIEW ${quoteIdent(safeTable)} AS
       SELECT * FROM read_parquet('${escapeLiteral(fname)}')`,
    );
  }

  /**
   * Idempotently install + load a DuckDB extension. The first call to a
   * given extension fetches it from the DuckDB extension registry (core)
   * or the community-extensions registry; subsequent calls are no-ops.
   *
   * For community extensions we also flip `allow_unsigned_extensions`
   * (community extensions aren't signed by DuckDB Labs).
   *
   * Throws ExtensionLoadError if INSTALL or LOAD fail. Callers in the
   * mount layer wrap this and surface a useful message to the user
   * (e.g. when offline + extension not vendored).
   */
  async ensureExtension(name: string, source: ExtensionSource = 'core'): Promise<void> {
    if (this.loadedExtensions.has(name)) return;
    const safe = sanitizeIdent(name);
    try {
      if (source === 'community') {
        await this.exec('SET allow_unsigned_extensions = true');
        await this.exec(`INSTALL ${safe} FROM community`);
      } else {
        // INSTALL is idempotent in DuckDB; safe to call repeatedly.
        try {
          await this.exec(`INSTALL ${safe}`);
        } catch {
          // Some core extensions are statically linked into the wasm
          // bundle and INSTALL is a no-op / errors. LOAD will still work.
        }
      }
      await this.exec(`LOAD ${safe}`);
      this.loadedExtensions.add(name);
    } catch (err) {
      throw new ExtensionLoadError(name, err);
    }
  }

  /**
   * Mount a SQLite database file. ATTACHes the file as a virtual
   * database, then exposes each user table as its own NakliData view
   * named `<sourceLabel>__<tableName>`. Returns the list of view names
   * created — mount.ts iterates them to populate MountedSource.tables.
   */
  async registerSqlite({ tableName, file }: RegisterFileOptions): Promise<string[]> {
    await this.ensureExtension('sqlite');
    const fname = sanitizeFileName(file.name);
    await this.registerFile(fname, file);
    return await this.attachDatabase(fname, tableName, 'sqlite');
  }

  /** Mount a native DuckDB database file via ATTACH. Multi-table. */
  async registerDuckdb({ tableName, file }: RegisterFileOptions): Promise<string[]> {
    const fname = sanitizeFileName(file.name);
    await this.registerFile(fname, file);
    return await this.attachDatabase(fname, tableName, 'duckdb');
  }

  /**
   * Mount an Excel `.xlsx` file via DuckDB's `excel` core extension.
   * `read_xlsx` returns one table per sheet; we discover the sheets
   * and create one NakliData view per sheet.
   */
  async registerXlsx({ tableName, file }: RegisterFileOptions): Promise<string[]> {
    await this.ensureExtension('excel');
    const fname = sanitizeFileName(file.name);
    await this.registerFile(fname, file);
    // Probe sheet names; fall back to a single all_sheets=false call if probing fails.
    let sheets: string[] = [];
    try {
      const rows = await this.query<{ name: string }>(
        `SELECT name FROM excel_sheets('${escapeLiteral(fname)}')`,
      );
      sheets = rows.map((r) => r.name);
    } catch {
      sheets = [];
    }
    const created: string[] = [];
    if (sheets.length === 0) {
      // No sheets discovered — fall back to the default read_xlsx call.
      const view = sanitizeIdent(tableName);
      await this.exec(
        `CREATE OR REPLACE VIEW ${quoteIdent(view)} AS SELECT * FROM read_xlsx('${escapeLiteral(fname)}')`,
      );
      created.push(view);
    } else {
      for (const sheet of sheets) {
        const view = sanitizeIdent(sheets.length === 1 ? tableName : `${tableName}__${sheet}`);
        await this.exec(
          `CREATE OR REPLACE VIEW ${quoteIdent(view)} AS
           SELECT * FROM read_xlsx('${escapeLiteral(fname)}', sheet = '${escapeLiteral(sheet)}')`,
        );
        created.push(view);
      }
    }
    return created;
  }

  /**
   * Mount an Apache Arrow IPC file (`.arrow` / `.feather` v2). DuckDB-wasm's
   * `insertArrowFromIPCStream` reads the bytes directly into a DuckDB table —
   * no `apache-arrow` JS dep needed. Creates a TABLE (not a view), so
   * `drop()` is dual-mode: tries DROP VIEW, then DROP TABLE.
   */
  async registerArrow({ tableName, file }: RegisterFileOptions): Promise<string[]> {
    const conn = this.requireConn();
    const safeTable = sanitizeIdent(tableName);
    const bytes = new Uint8Array(await file.arrayBuffer());
    // create:true → CREATE TABLE; replaces if exists via prior DROP.
    await conn.query(`DROP TABLE IF EXISTS ${quoteIdent(safeTable)}`);
    await conn.insertArrowFromIPCStream(bytes, { name: safeTable, create: true });
    return [safeTable];
  }

  /**
   * Mount a statistical-format file (SPSS `.sav` / `.zsav` / `.por`,
   * Stata `.dta`, SAS `.sas7bdat` / `.xpt`) via the `read_stat`
   * community extension. Single-table per file.
   */
  async registerReadStat({ tableName, file }: RegisterFileOptions): Promise<string[]> {
    await this.ensureExtension('read_stat', 'community');
    const fname = sanitizeFileName(file.name);
    await this.registerFile(fname, file);
    const view = sanitizeIdent(tableName);
    await this.exec(
      `CREATE OR REPLACE VIEW ${quoteIdent(view)} AS SELECT * FROM read_stat('${escapeLiteral(fname)}')`,
    );
    return [view];
  }

  /**
   * Mount a spatial vector file (`.geojson` / `.kml`) via DuckDB's
   * `spatial` core extension's `ST_Read`. The geometry column is
   * converted to a GeoJSON string (`geometry`) so the JS side can
   * `JSON.parse` it directly — keeps the JS DuckDB-wasm binding free
   * of having to support the GEOMETRY logical type.
   */
  async registerSpatial({ tableName, file }: RegisterFileOptions): Promise<string[]> {
    await this.ensureExtension('spatial');
    const fname = sanitizeFileName(file.name);
    await this.registerFile(fname, file);
    const view = sanitizeIdent(tableName);
    await this.exec(
      `CREATE OR REPLACE VIEW ${quoteIdent(view)} AS
       SELECT ST_AsGeoJSON(geom) AS geometry, * EXCLUDE (geom)
       FROM ST_Read('${escapeLiteral(fname)}')`,
    );
    return [view];
  }

  /** Shared ATTACH path for SQLite + DuckDB file mounts. */
  private async attachDatabase(
    filename: string,
    tableLabel: string,
    type: 'sqlite' | 'duckdb',
  ): Promise<string[]> {
    const attachName = sanitizeIdent(`attached_${tableLabel}_${Date.now().toString(36)}`);
    const typeClause = type === 'sqlite' ? ' (TYPE sqlite, READ_ONLY)' : ' (READ_ONLY)';
    await this.exec(
      `ATTACH '${escapeLiteral(filename)}' AS ${quoteIdent(attachName)}${typeClause}`,
    );
    const tables = await this.query<{ table_name: string; schema_name: string }>(
      `SELECT table_name, schema_name
         FROM duckdb_tables()
        WHERE database_name = '${escapeLiteral(attachName)}'
          AND schema_name NOT IN ('information_schema', 'pg_catalog')`,
    );
    const created: string[] = [];
    for (const { table_name, schema_name } of tables) {
      const view = sanitizeIdent(tables.length === 1 ? tableLabel : `${tableLabel}__${table_name}`);
      const qualified = `${quoteIdent(attachName)}.${quoteIdent(schema_name)}.${quoteIdent(table_name)}`;
      await this.exec(`CREATE OR REPLACE VIEW ${quoteIdent(view)} AS SELECT * FROM ${qualified}`);
      created.push(view);
    }
    return created;
  }

  /** List the column names + DuckDB types for a registered table/view. */
  async describeColumns(tableName: string): Promise<Array<{ name: string; type: string }>> {
    const safe = sanitizeIdent(tableName);
    const rows = await this.query<{ column_name: string; column_type: string }>(
      `DESCRIBE ${quoteIdent(safe)}`,
    );
    return rows.map((r) => ({ name: r.column_name, type: r.column_type }));
  }

  /**
   * Sample up to `limit` non-null values from a single column. Returns
   * stringified values plus stats. Per spec §3.2 sampling = first 100 +
   * random 100; we approximate with a single sample call for simplicity
   * and bump default size to 200.
   */
  async sampleColumn(
    tableName: string,
    columnName: string,
    limit = 200,
  ): Promise<{
    values: string[];
    totalSampled: number;
    nullCount: number;
    distinctCount: number;
  }> {
    const safeTable = quoteIdent(sanitizeIdent(tableName));
    const safeCol = quoteIdent(columnName.replace(/"/g, '""'));
    const half = Math.max(1, Math.floor(limit / 2));
    const head = await this.query<{ v: unknown }>(
      `SELECT ${safeCol}::VARCHAR AS v FROM ${safeTable} LIMIT ${half}`,
    );
    const tail = await this.query<{ v: unknown }>(
      `SELECT ${safeCol}::VARCHAR AS v FROM ${safeTable} USING SAMPLE ${limit - half} ROWS`,
    );
    const all = [...head, ...tail];
    const values: string[] = [];
    let nullCount = 0;
    for (const row of all) {
      const v = row.v;
      if (v === null || v === undefined || v === '') nullCount++;
      else values.push(String(v));
    }
    const distinctCount = new Set(values).size;
    return { values, totalSampled: all.length, nullCount, distinctCount };
  }

  /**
   * Retrieve the bytes of a file in DuckDB's virtual filesystem. Used by
   * action sinks (CSV/Parquet) after `COPY ... TO 'name'`.
   */
  async exportFileBytes(filename: string): Promise<Uint8Array> {
    if (!this.db) throw new EngineError('Engine not booted');
    return await this.db.copyFileToBuffer(filename);
  }

  /** Remove a file from DuckDB's virtual filesystem (cleanup after export). */
  async removeFile(filename: string): Promise<void> {
    if (!this.db) return;
    try {
      // Some DuckDB-wasm versions expose dropFile; this is best-effort cleanup.
      const db = this.db as unknown as { dropFile?: (n: string) => Promise<void> };
      if (typeof db.dropFile === 'function') await db.dropFile(filename);
    } catch {
      // best effort
    }
  }

  /** Drop a previously registered table/view. Some register paths
   *  produce TABLEs (Arrow IPC via insertArrowFromIPCStream) and others
   *  produce VIEWs (the CSV/Parquet/Excel/SQLite paths); try both. */
  async drop(tableName: string): Promise<void> {
    const safe = sanitizeIdent(tableName);
    try {
      await this.exec(`DROP VIEW IF EXISTS ${quoteIdent(safe)}`);
    } catch {
      // VIEW with the name may not exist (it's a TABLE); fall through.
    }
    try {
      await this.exec(`DROP TABLE IF EXISTS ${quoteIdent(safe)}`);
    } catch {
      // best effort
    }
  }

  /** Execute a statement, discarding the result rows. */
  async exec(sql: string): Promise<void> {
    const conn = this.requireConn();
    await conn.query(sql);
  }

  async close(): Promise<void> {
    try {
      await this.conn?.close();
    } finally {
      this.conn = null;
      try {
        await this.db?.terminate();
      } finally {
        this.db = null;
        this.worker?.terminate();
        this.worker = null;
        this.setStatus('idle');
      }
    }
  }
}

/**
 * Fetch a URL with subresource-integrity verification. Returns the bytes
 * once the browser has confirmed the SHA-384 matches. Throws on hash
 * mismatch or HTTP error.
 */
async function fetchWithSri(url: string, integrity: string): Promise<Uint8Array> {
  const res = await fetch(url, { integrity, mode: 'cors' });
  if (!res.ok) {
    throw new EngineError(`SRI fetch failed: ${url} → HTTP ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

function bundlesFor(opts: EngineBootOptions): duckdb.DuckDBBundles {
  if (opts.offline) {
    const origin = fallbackOrigin();
    return {
      mvp: {
        mainModule: `${origin}${FALLBACK_BASE}duckdb-mvp.wasm`,
        mainWorker: `${origin}${FALLBACK_BASE}duckdb-browser-mvp.worker.js`,
      },
      eh: {
        mainModule: `${origin}${FALLBACK_BASE}duckdb-eh.wasm`,
        mainWorker: `${origin}${FALLBACK_BASE}duckdb-browser-eh.worker.js`,
      },
    };
  }
  const base = opts.cdnBase ?? DEFAULT_CDN_BASE;
  return {
    mvp: {
      mainModule: `${base}duckdb-mvp.wasm`,
      mainWorker: `${base}duckdb-browser-mvp.worker.js`,
    },
    eh: {
      mainModule: `${base}duckdb-eh.wasm`,
      mainWorker: `${base}duckdb-browser-eh.worker.js`,
    },
  };
}

const IDENT_OK = /^[A-Za-z_][A-Za-z0-9_]*$/;

function sanitizeIdent(s: string): string {
  if (IDENT_OK.test(s)) return s;
  const cleaned = s.replace(/[^A-Za-z0-9_]/g, '_').replace(/^([0-9])/, '_$1');
  return cleaned || '_t';
}

function quoteIdent(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

function escapeLiteral(s: string): string {
  return s.replace(/'/g, "''");
}

function sanitizeFileName(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, '_');
}

/** Process-wide singleton; one DuckDB engine per tab is enough. */
let _engine: Engine | null = null;
export function getEngine(): Engine {
  if (!_engine) _engine = new Engine();
  return _engine;
}
