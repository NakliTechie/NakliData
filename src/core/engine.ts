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
import { assertSafeBearerToken } from './bearer-token.ts';
import { loadChunk } from './lazy-loader.ts';

export type EngineStatus = 'idle' | 'booting' | 'ready' | 'error';

export interface EngineBootOptions {
  /** If true, load DuckDB-wasm from `public/duckdb-fallback/` instead of the CDN. */
  offline?: boolean;
  /** Pinned CDN base. */
  cdnBase?: string;
  /**
   * Optional base URL for the vendored bundle (overrides both
   * `offline`-page-relative AND `cdnBase`). Used by deploys that can't
   * host the 75 MB locally (e.g., Cloudflare Workers Static Assets,
   * 25 MiB per-file limit) — they cross-fetch from the canonical
   * GitHub Pages mirror at `https://naklitechie.github.io/NakliData/duckdb-fallback/`.
   *
   * Trade-off (spec amendment A14): cross-origin fetches mean we drop
   * pre-fetch SRI verification. Trust boundary = version-pin in the URL
   * + build-time SHA-384 verify against `integrity.json` when bytes are
   * vendored (`scripts/fetch-duckdb-fallback.mjs`). The official
   * duckdb-wasm `importScripts(<url>)` blob-bootstrap pattern handles
   * the cross-origin Worker spawn.
   */
  fallbackBase?: string;
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

/**
 * Absolute URL of a same-origin asset relative to the page. Used for
 * the vendored DuckDB fallback bundles + the local extension repo:
 * the DuckDB worker is created from a blob: URL whose base is opaque
 * (importScripts can't resolve a root-relative path), AND the
 * deploy may sit under a path prefix (e.g., GitHub Pages serves us at
 * `/NakliData/`). Resolving against `document.baseURI` covers both.
 */
function pageAsset(relative: string): string {
  if (typeof document !== 'undefined' && document.baseURI) {
    return new URL(relative, document.baseURI).href;
  }
  // SSR / test environment fallback. The only practical scenario is
  // vitest, where these URLs are never actually fetched.
  return relative;
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

      // Worker spawn strategy depends on the worker URL's origin:
      //
      // (a) **same-origin** — spawn the Worker directly from the URL.
      //     Used for vendored deploys (page-relative `./duckdb-fallback/`).
      //     db.instantiate hands the WASM URL to the worker, which
      //     fetches it via plain HTTP.
      //
      // (b) **cross-origin** — same-origin policy blocks
      //     `new Worker(<cross-origin-url>)`. Use the official
      //     duckdb-wasm pattern: spawn from a same-origin blob whose
      //     content is `importScripts("<cross-origin-url>")`. The
      //     imported script can be cross-origin as long as it serves
      //     CORS (jsDelivr + GitHub Pages both do). db.instantiate
      //     then passes the WASM URL straight to the worker, which
      //     fetches it directly (also CORS-permitting).
      //
      // History: an earlier version (commit 5b10b93) SRI-fetched the
      // worker + WASM bytes and blob-wrapped both before passing to
      // db.instantiate. That broke in current Chrome because a Worker
      // spawned from one blob can't fetch sibling blobs from the
      // parent's blob registry. SRI was dropped in W1.8.2 + spec
      // amendment A14 to restore the working pattern; trust is at the
      // version-pin level + build-time vendor verification.
      let worker: Worker;
      let bootstrapToRevoke: string | null = null;
      if (isCrossOriginWorkerUrl(bundle.mainWorker)) {
        bootstrapToRevoke = URL.createObjectURL(
          new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' }),
        );
        worker = new Worker(bootstrapToRevoke);
      } else {
        worker = new Worker(bundle.mainWorker);
      }
      // Forward-pass L1 (2026-06-02): try/finally + outer-catch cleanup
      // so a failed instantiate doesn't leak the blob URL or the Worker.
      // Pre-fix, retries on flaky networks compounded the leaks.
      const logger = new duckdb.ConsoleLogger();
      const db = new duckdb.AsyncDuckDB(logger, worker);
      try {
        await db.instantiate(bundle.mainModule, bundle.pthreadWorker ?? null);
      } catch (instErr) {
        if (bootstrapToRevoke) URL.revokeObjectURL(bootstrapToRevoke);
        try {
          worker.terminate();
        } catch {
          /* ignore — worker may already be in an error state */
        }
        throw instErr;
      }
      if (bootstrapToRevoke) URL.revokeObjectURL(bootstrapToRevoke);

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
        // Drop the trailing slash — DuckDB appends its own
        // `/${VERSION}/${PLATFORM}/${NAME}.duckdb_extension.wasm`.
        const localRepo = pageAsset('./duckdb-extensions').replace(/\/$/, '');
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
   * Register a remote URL as a table. DuckDB-wasm fetches the bytes
   * directly via the browser's fetch (no httpfs extension needed for
   * plain HTTPS reads). The view is created over read_<format>('<url>'),
   * so subsequent SELECTs against the table re-fetch ranges on demand.
   * Wave 2 slice 1 supports csv / tsv / jsonl / parquet — formats whose
   * readers ship in core DuckDB without an extension load. Other formats
   * are surfaced by mountUrl with a friendly "not supported via URL"
   * error rather than reaching here.
   */
  async registerUrl({
    tableName,
    url,
    format,
  }: {
    tableName: string;
    url: string;
    format: 'csv' | 'tsv' | 'jsonl' | 'parquet';
  }): Promise<void> {
    const safeTable = sanitizeIdent(tableName);
    const lit = escapeLiteral(url);
    const reader: Record<typeof format, string> = {
      csv: `read_csv_auto('${lit}', header=true, sample_size=2048)`,
      tsv: `read_csv_auto('${lit}', delim='\t', header=true, sample_size=2048)`,
      jsonl: `read_json_auto('${lit}', format='newline_delimited')`,
      parquet: `read_parquet('${lit}')`,
    };
    await this.exec(
      `CREATE OR REPLACE VIEW ${quoteIdent(safeTable)} AS SELECT * FROM ${reader[format]}`,
    );
  }

  /**
   * Wave 2 slice 2 — apply S3 credentials + endpoint config to the
   * connection so subsequent reads of `s3://...` URLs authenticate. The
   * config is connection-wide; mounting a SECOND s3-endpoint source
   * with different credentials would clobber the first. Documented
   * limitation; a future enhancement can move to DuckDB's `CREATE SECRET`
   * once we bump to a version that supports it on wasm.
   */
  async configureS3({
    endpoint,
    region,
    accessKeyId,
    secretAccessKey,
    urlStyle,
  }: {
    endpoint: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    urlStyle: 'vhost' | 'path';
  }): Promise<void> {
    await this.ensureExtension('httpfs');
    await this.exec(`SET s3_endpoint = '${escapeLiteral(endpoint)}'`);
    await this.exec(`SET s3_region = '${escapeLiteral(region)}'`);
    await this.exec(`SET s3_access_key_id = '${escapeLiteral(accessKeyId)}'`);
    await this.exec(`SET s3_secret_access_key = '${escapeLiteral(secretAccessKey)}'`);
    await this.exec(`SET s3_url_style = '${urlStyle}'`);
  }

  /**
   * Register a view backed by an `s3://...` URL. Assumes `configureS3()`
   * has already been called this session — otherwise the SELECT fails
   * with an auth/region error from DuckDB.
   */
  async registerS3Url({
    tableName,
    s3Url,
    format,
  }: {
    tableName: string;
    s3Url: string;
    format: 'csv' | 'tsv' | 'jsonl' | 'parquet';
  }): Promise<void> {
    const safeTable = sanitizeIdent(tableName);
    const lit = escapeLiteral(s3Url);
    const reader: Record<typeof format, string> = {
      csv: `read_csv_auto('${lit}', header=true, sample_size=2048)`,
      tsv: `read_csv_auto('${lit}', delim='\t', header=true, sample_size=2048)`,
      jsonl: `read_json_auto('${lit}', format='newline_delimited')`,
      parquet: `read_parquet('${lit}')`,
    };
    await this.exec(
      `CREATE OR REPLACE VIEW ${quoteIdent(safeTable)} AS SELECT * FROM ${reader[format]}`,
    );
  }

  /**
   * Wave 2 slice 3a — install + load the iceberg extension and
   * optionally configure a Bearer Authorization header for the
   * subsequent httpfs reads. Like the S3 SET statements, this is
   * connection-wide; the most recently called configureIceberg wins.
   * Pass `bearerToken: null` to clear any previously-set header.
   */
  async configureIceberg({
    bearerToken,
  }: {
    bearerToken: string | null;
  }): Promise<void> {
    await this.ensureExtension('iceberg');
    if (bearerToken) {
      // Validate the bearer-token charset BEFORE building the SQL
      // literal — escapeLiteral only doubles `'`, so a CR/LF (or other
      // garbage) would otherwise survive SQL escaping and reach
      // DuckDB-wasm's httpfs layer. CRLF in particular enables HTTP
      // header injection if httpfs doesn't validate. (Forward-pass M1,
      // 2026-06-02.)
      assertSafeBearerToken(bearerToken);
      // DuckDB's httpfs respects `extra_http_headers` — a STRUCT of
      // header-name → value pairs applied to every outgoing httpfs
      // request. Bearer auth covers REST endpoints (slice 3b) and any
      // table-storage host that gates reads behind a token.
      await this.exec(
        `SET extra_http_headers = MAP { 'Authorization': 'Bearer ${escapeLiteral(bearerToken)}' }`,
      );
    } else {
      await this.exec('SET extra_http_headers = MAP {}');
    }
  }

  /**
   * Register a view backed by an Iceberg table. `metadataUrl` is the
   * URL of the table's metadata.json (or a directory whose latest
   * snapshot DuckDB resolves). Assumes `configureIceberg()` has been
   * called this session.
   */
  async registerIcebergTable({
    tableName,
    metadataUrl,
  }: {
    tableName: string;
    metadataUrl: string;
  }): Promise<void> {
    const safeTable = sanitizeIdent(tableName);
    const lit = escapeLiteral(metadataUrl);
    await this.exec(
      `CREATE OR REPLACE VIEW ${quoteIdent(safeTable)} AS SELECT * FROM iceberg_scan('${lit}')`,
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
        // Community extensions aren't signed by DuckDB Labs; DuckDB
        // refuses to INSTALL them without `allow_unsigned_extensions`.
        // Forward-pass L2 (2026-06-02): scope the flag — restore the
        // prior value after LOAD succeeds so any subsequent core
        // INSTALL/LOAD in the same session runs with full signature
        // checks. The flag only needs to be true during INSTALL.
        await this.exec('SET allow_unsigned_extensions = true');
        try {
          await this.exec(`INSTALL ${safe} FROM community`);
          await this.exec(`LOAD ${safe}`);
        } finally {
          // Restore. Use a no-op-on-error catch since we don't want
          // a settings-restore failure to mask the original error.
          try {
            await this.exec('SET allow_unsigned_extensions = false');
          } catch {
            /* ignore */
          }
        }
        this.loadedExtensions.add(name);
      } else {
        // INSTALL is idempotent in DuckDB; safe to call repeatedly.
        try {
          await this.exec(`INSTALL ${safe}`);
        } catch {
          // Some core extensions are statically linked into the wasm
          // bundle and INSTALL is a no-op / errors. LOAD will still work.
        }
        await this.exec(`LOAD ${safe}`);
        this.loadedExtensions.add(name);
      }
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
   * Mount an Excel `.xlsx` file. Parses via SheetJS (a lazy chunk) and
   * feeds each sheet through the existing CSV mount path.
   *
   * Why not DuckDB's `excel` extension? It isn't published at
   * extensions.duckdb.org for our DuckDB-wasm revision (v1.1.1/
   * wasm_eh). The original spec called for it (see pending.md "Theme
   * 1") but the deferred-since-upstream-bump status meant Excel was a
   * dead surface for 90%+ of common cases. SheetJS is Apache-2,
   * loads only when the user actually mounts xlsx, and emits CSV
   * which we already ingest natively.
   *
   * Returns one view per non-empty sheet, named `<tableName>` (single
   * sheet) or `<tableName>__<sheetName>` (multi-sheet).
   */
  async registerXlsx({ tableName, file }: RegisterFileOptions): Promise<string[]> {
    const sheetjs = await loadChunk('sheetjs');
    const sheets = await sheetjs.parseXlsxToSheets(file);
    if (sheets.length === 0) {
      throw new Error(
        `No usable sheets in "${file.name}" — the workbook is empty or all sheets are blank.`,
      );
    }
    const created: string[] = [];
    for (const { name, csv } of sheets) {
      const view = sanitizeIdent(sheets.length === 1 ? tableName : `${tableName}__${name}`);
      // Wrap the CSV in a File so the existing registerCsv path can
      // pick it up — same code path used for any other CSV mount.
      const csvBlob = new File([csv], `${file.name}__${name}.csv`, { type: 'text/csv' });
      await this.registerCsv({ tableName: view, file: csvBlob });
      created.push(view);
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
   * Wave 3 W3.4a — like registerArrow but takes the IPC bytes as a
   * Uint8Array directly (e.g. from a Compute Bridge HTTP response,
   * where there's no File to wrap). Same DROP+CREATE semantics.
   */
  async registerArrowBuffer({
    tableName,
    bytes,
  }: {
    tableName: string;
    bytes: Uint8Array;
  }): Promise<string[]> {
    const conn = this.requireConn();
    const safeTable = sanitizeIdent(tableName);
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
    //
    // Forward-pass M2 (2026-06-02): aliases are now INDEX-based
    // (`a_0`, `b_0`, …) instead of `sanitizeIdent(name)`-based. The
    // sanitiser collapses every non-alphanumeric to `_`, so two
    // distinct columns like `"foo bar"` and `"foo-bar"` both aliased
    // to `a_foo_bar` — the second projection clobbered the first in
    // DuckDB's result map and the JS diff loop read missing/wrong
    // values. Index-based aliases never collide.
    const projections =
      common.length === 0
        ? ''
        : common
            .map((c, i) => {
              const safeC = quoteIdent(c.replace(/"/g, '""'));
              return `a.${safeC} AS a_${i}, b.${safeC} AS b_${i}`;
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
        for (let i = 0; i < common.length; i++) {
          const c = common[i] as string;
          const aKey = `a_${i}`;
          const bKey = `b_${i}`;
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

  /**
   * Run `EXPLAIN (FORMAT JSON) <sql>` and return the parsed plan
   * tree, or null if the SQL failed to plan (the cell will use the
   * regex fallback in that case — handoff §M2 spec).
   *
   * Used by the M2 Cell Lineage Tracker — pure read-only side-effect-
   * free planning, safe to run on every cell-run completion.
   */
  async explainPlan(sql: string): Promise<unknown | null> {
    const conn = this.requireConn();
    try {
      // DuckDB returns: explain_key | explain_value
      //   logical_plan | <JSON-string>
      // (older builds) or just one row with the JSON in column[0].
      const result = await conn.query(`EXPLAIN (FORMAT JSON) ${sql}`);
      const rows = result.toArray();
      for (const row of rows) {
        const obj = row.toJSON() as Record<string, unknown>;
        // Find the FIRST string value that parses as JSON.
        for (const v of Object.values(obj)) {
          if (typeof v !== 'string' || v.length === 0) continue;
          // trimStart first: some DuckDB builds prefix the plan JSON with
          // a newline, which would make the first-char check reject a
          // perfectly good plan and force the regex fallback (M26).
          const s = v.trimStart();
          const first = s.charCodeAt(0);
          // 0x5B = '[', 0x7B = '{' — quick reject for non-JSON values.
          if (first !== 0x5b && first !== 0x7b) continue;
          try {
            return JSON.parse(s);
          } catch {
            // try next column
          }
        }
      }
      return null;
    } catch {
      // EXPLAIN itself errored — the SQL didn't parse. Caller falls back to regex.
      return null;
    }
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

function bundlesFor(opts: EngineBootOptions): duckdb.DuckDBBundles {
  // Precedence:
  // 1. `fallbackBase` — explicit cross-origin mirror (e.g., GH Pages
  //    canonical for deploys that can't host the bytes).
  // 2. `offline` — same-origin `./duckdb-fallback/`.
  // 3. CDN — jsDelivr.
  if (opts.fallbackBase) {
    const base = opts.fallbackBase.endsWith('/') ? opts.fallbackBase : `${opts.fallbackBase}/`;
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
  if (opts.offline) {
    return {
      mvp: {
        mainModule: pageAsset('./duckdb-fallback/duckdb-mvp.wasm'),
        mainWorker: pageAsset('./duckdb-fallback/duckdb-browser-mvp.worker.js'),
      },
      eh: {
        mainModule: pageAsset('./duckdb-fallback/duckdb-eh.wasm'),
        mainWorker: pageAsset('./duckdb-fallback/duckdb-browser-eh.worker.js'),
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

/**
 * Detect whether a Worker URL is cross-origin to the page. When it is,
 * we can't pass the URL straight to `new Worker()` — same-origin policy
 * blocks it. The official duckdb-wasm workaround is a same-origin blob
 * containing `importScripts("<url>")`; the imported URL itself can be
 * cross-origin as long as it serves CORS (jsDelivr + GitHub Pages
 * both do).
 */
function isCrossOriginWorkerUrl(url: string): boolean {
  if (typeof location === 'undefined') return false;
  try {
    return new URL(url, location.href).origin !== location.origin;
  } catch {
    return false;
  }
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
