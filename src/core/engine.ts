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

/**
 * Full-table column profile produced by `Engine.profileColumn`. Used by
 * the schema-panel column-profile pane (Theme 4 wave 1).
 */
export interface ColumnProfile {
  totalRows: number;
  nullCount: number;
  distinctCount: number;
  /** Min/Max length of `col::VARCHAR` over non-null values. `null` if all values are null. */
  lengthMin: number | null;
  lengthMax: number | null;
  /** Mean length over non-null values. `null` if all values are null. */
  lengthAvg: number | null;
  /** Top 5 values by count (descending). Values are stringified. */
  topK: Array<{ value: string; count: number }>;
}

/**
 * Output of `Engine.compareTables`. Theme 4 wave 2 (B2). All counts are
 * exact; the differing-row sample is capped via the caller's
 * `sampleLimit`. Common-column comparison happens on the columns
 * present in both tables — exact case-sensitive name match.
 */
export interface TableComparison {
  /** Total rows in A. */
  rowsA: number;
  /** Total rows in B. */
  rowsB: number;
  /** Distinct join-key values present only in A (left anti). */
  onlyInA: number;
  /** Distinct join-key values present only in B (right anti). */
  onlyInB: number;
  /** Join-key values present in both, all common columns equal. */
  matched: number;
  /** Join-key values present in both, at least one common column differs. */
  differing: number;
  /** Columns compared (intersection of A and B columns, minus the keys). */
  comparedColumns: string[];
  /**
   * Up to `sampleLimit` differing rows. For each, the key value + a
   * `diffs` array of {column, valueA, valueB} for every differing
   * column on that row. Non-differing columns are omitted.
   */
  differingSample: Array<{
    key: string;
    diffs: Array<{ column: string; valueA: string | null; valueB: string | null }>;
  }>;
}

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
      // Theme 1 wave 3: when booting offline (?offline=1 or
      // opts.offline: true), point INSTALL at the vendored extensions
      // under public/duckdb-extensions/. Without this, an INSTALL
      // would still try to reach extensions.duckdb.org and fail in
      // sandboxed / air-gapped environments (the smoke runner is one).
      // For online boots we leave the default so the runtime can
      // fetch any extension on demand. The path is form-required:
      // DuckDB appends `${REVISION}/${PLATFORM}/${NAME}.duckdb_extension.wasm`.
      if (opts.offline && typeof location !== 'undefined' && location.origin) {
        const localRepo = `${location.origin}/duckdb-extensions`;
        try {
          await this.conn.query(
            `SET custom_extension_repository = '${localRepo.replace(/'/g, "''")}'`,
          );
          await this.conn.query(
            `SET autoinstall_extension_repository = '${localRepo.replace(/'/g, "''")}'`,
          );
        } catch (err) {
          // Non-fatal: extensions will fail later with a clearer
          // ExtensionLoadError; we don't want a setting error to block
          // the boot entirely.
          console.warn('[engine] failed to set custom_extension_repository', err);
        }
      }
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
   * Full-table profile of a single column. Used by the schema panel's
   * column-profile panel (Theme 4 wave 1). Unlike `sampleColumn` (which
   * samples for the classifier), this scans the whole table so the
   * counts are exact. Returns:
   *   - totalRows, nullCount, distinctCount (exact, over the table)
   *   - lengthMin/Max/Avg (computed on the VARCHAR-cast value; for
   *     numeric columns these are digit-counts, still useful as a proxy)
   *   - topK: the 5 most common values with their counts
   *
   * For very large tables this is more expensive than `sampleColumn`;
   * the panel only runs it on demand (user clicks Profile).
   */
  async profileColumn(tableName: string, columnName: string): Promise<ColumnProfile> {
    const safeTable = quoteIdent(sanitizeIdent(tableName));
    const safeCol = quoteIdent(columnName.replace(/"/g, '""'));
    const summaryRows = await this.query<{
      total: number | bigint;
      null_count: number | bigint;
      distinct_count: number | bigint;
      len_min: number | bigint | null;
      len_max: number | bigint | null;
      len_avg: number | null;
    }>(
      `SELECT
        COUNT(*) AS total,
        COUNT(*) - COUNT(${safeCol}) AS null_count,
        COUNT(DISTINCT ${safeCol}) AS distinct_count,
        MIN(LENGTH(${safeCol}::VARCHAR)) AS len_min,
        MAX(LENGTH(${safeCol}::VARCHAR)) AS len_max,
        AVG(LENGTH(${safeCol}::VARCHAR)) AS len_avg
       FROM ${safeTable}`,
    );
    const summary = summaryRows[0] ?? {
      total: 0,
      null_count: 0,
      distinct_count: 0,
      len_min: null,
      len_max: null,
      len_avg: null,
    };
    const topRaw = await this.query<{ value: unknown; cnt: number | bigint }>(
      `SELECT ${safeCol}::VARCHAR AS value, COUNT(*) AS cnt
       FROM ${safeTable}
       WHERE ${safeCol} IS NOT NULL
       GROUP BY ${safeCol}
       ORDER BY cnt DESC
       LIMIT 5`,
    );
    const topK = topRaw.map((r) => ({
      value: r.value === null || r.value === undefined ? '∅' : String(r.value),
      count: Number(r.cnt),
    }));
    return {
      totalRows: Number(summary.total),
      nullCount: Number(summary.null_count),
      distinctCount: Number(summary.distinct_count),
      lengthMin: summary.len_min === null ? null : Number(summary.len_min),
      lengthMax: summary.len_max === null ? null : Number(summary.len_max),
      lengthAvg: summary.len_avg === null ? null : Number(summary.len_avg),
      topK,
    };
  }

  /**
   * Side-by-side comparison of two tables on a chosen join key. Theme 4
   * wave 2 (B2). For each row in the symmetric difference + the matched
   * subset, classify into one of four buckets — onlyInA, onlyInB,
   * matched (all common non-key columns equal), differing (≥1 common
   * column differs). For "differing" rows, return up to `sampleLimit`
   * with a column-level diff so the UI can render a useful preview.
   *
   * Columns compared = the set-intersection of A's and B's columns by
   * name (case-sensitive), minus the two join columns. If a column
   * exists in only one table, it isn't compared (the user should
   * project before comparing if that matters).
   *
   * Caveats:
   * - DuckDB's NULL semantics: NULL = NULL is FALSE, so a row with NULL
   *   on the same column on both sides counts as "differing" by the
   *   raw IS DISTINCT FROM check. We use IS DISTINCT FROM so NULL/NULL
   *   counts as NOT differing — which matches user expectation.
   * - Cast both sides to VARCHAR for the diff to avoid type-coercion
   *   surprises (e.g., DOUBLE vs BIGINT for a numeric column).
   */
  async compareTables(
    tableAName: string,
    tableBName: string,
    joinColA: string,
    joinColB: string,
    sampleLimit = 25,
  ): Promise<TableComparison> {
    const safeA = quoteIdent(sanitizeIdent(tableAName));
    const safeB = quoteIdent(sanitizeIdent(tableBName));
    const safeKeyA = quoteIdent(joinColA.replace(/"/g, '""'));
    const safeKeyB = quoteIdent(joinColB.replace(/"/g, '""'));

    // Discover columns on each side via DESCRIBE.
    const colsA = await this.query<{ column_name: string }>(`DESCRIBE ${safeA}`);
    const colsB = await this.query<{ column_name: string }>(`DESCRIBE ${safeB}`);
    const namesA = new Set(colsA.map((c) => c.column_name));
    const namesB = new Set(colsB.map((c) => c.column_name));
    // Intersection minus the two join columns.
    const common: string[] = [];
    for (const n of namesA) {
      if (namesB.has(n) && n !== joinColA && n !== joinColB) common.push(n);
    }

    // Counts of total rows on each side — cheap sanity for the summary.
    const [aRow] = await this.query<{ n: bigint | number }>(`SELECT COUNT(*) AS n FROM ${safeA}`);
    const [bRow] = await this.query<{ n: bigint | number }>(`SELECT COUNT(*) AS n FROM ${safeB}`);
    const rowsA = Number(aRow?.n ?? 0);
    const rowsB = Number(bRow?.n ?? 0);

    // Bucket the symmetric outer join into four counts.
    const diffPredicate =
      common.length === 0
        ? '0' // no common columns → never "differing"
        : common
            .map(
              (c) =>
                `(a.${quoteIdent(c.replace(/"/g, '""'))} IS DISTINCT FROM b.${quoteIdent(c.replace(/"/g, '""'))})::INT`,
            )
            .join(' + ');
    const bucketsSql = `
      WITH joined AS (
        SELECT
          a.${safeKeyA} AS key_a,
          b.${safeKeyB} AS key_b,
          ${common.length === 0 ? '0' : diffPredicate} AS n_diffs
        FROM ${safeA} a
        FULL OUTER JOIN ${safeB} b ON a.${safeKeyA} = b.${safeKeyB}
      )
      SELECT
        COUNT(*) FILTER (WHERE key_b IS NULL) AS only_a,
        COUNT(*) FILTER (WHERE key_a IS NULL) AS only_b,
        COUNT(*) FILTER (WHERE key_a IS NOT NULL AND key_b IS NOT NULL AND n_diffs = 0) AS matched,
        COUNT(*) FILTER (WHERE key_a IS NOT NULL AND key_b IS NOT NULL AND n_diffs > 0) AS differing
      FROM joined
    `;
    const [buckets] = await this.query<{
      only_a: bigint | number;
      only_b: bigint | number;
      matched: bigint | number;
      differing: bigint | number;
    }>(bucketsSql);

    // Sample a small set of differing rows with per-column projection.
    // We project each common column from both sides side-by-side so we
    // can re-derive the per-row diff list in JS.
    const projections =
      common.length === 0
        ? ''
        : common
            .map((c) => {
              const safeC = quoteIdent(c.replace(/"/g, '""'));
              return `a.${safeC} AS a_${sanitizeIdent(c)}, b.${safeC} AS b_${sanitizeIdent(c)}`;
            })
            .join(', ');
    let differingSample: TableComparison['differingSample'] = [];
    if (common.length > 0 && (buckets?.differing ?? 0) !== 0) {
      const sampleSql = `
        SELECT
          a.${safeKeyA}::VARCHAR AS join_key,
          ${projections}
        FROM ${safeA} a
        JOIN ${safeB} b ON a.${safeKeyA} = b.${safeKeyB}
        WHERE ${diffPredicate} > 0
        LIMIT ${sampleLimit}
      `;
      const rows = await this.query<Record<string, unknown>>(sampleSql);
      differingSample = rows.map((r) => {
        const diffs: TableComparison['differingSample'][number]['diffs'] = [];
        for (const c of common) {
          const aKey = `a_${sanitizeIdent(c)}`;
          const bKey = `b_${sanitizeIdent(c)}`;
          const va = r[aKey];
          const vb = r[bKey];
          // Match DuckDB IS DISTINCT FROM semantics: NULL/NULL not distinct.
          const distinct =
            va === null || va === undefined
              ? !(vb === null || vb === undefined)
              : vb === null || vb === undefined
                ? true
                : String(va) !== String(vb);
          if (distinct) {
            diffs.push({
              column: c,
              valueA: va === null || va === undefined ? null : String(va),
              valueB: vb === null || vb === undefined ? null : String(vb),
            });
          }
        }
        return {
          key: r.join_key === null || r.join_key === undefined ? '' : String(r.join_key),
          diffs,
        };
      });
    }

    return {
      rowsA,
      rowsB,
      onlyInA: Number(buckets?.only_a ?? 0),
      onlyInB: Number(buckets?.only_b ?? 0),
      matched: Number(buckets?.matched ?? 0),
      differing: Number(buckets?.differing ?? 0),
      comparedColumns: common,
      differingSample,
    };
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
