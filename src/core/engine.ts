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

export class EngineError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

export class Engine {
  private db: duckdb.AsyncDuckDB | null = null;
  private conn: duckdb.AsyncDuckDBConnection | null = null;
  private worker: Worker | null = null;
  private status: EngineStatus = 'idle';
  private listeners = new Map<EngineEventName, Set<(payload: unknown) => void>>();

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
      const workerUrl = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' }),
      );
      const worker = new Worker(workerUrl);
      const logger = new duckdb.ConsoleLogger();
      const db = new duckdb.AsyncDuckDB(logger, worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker ?? null);
      URL.revokeObjectURL(workerUrl);

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

  /** Drop a previously registered table/view. */
  async drop(tableName: string): Promise<void> {
    const safe = sanitizeIdent(tableName);
    await this.exec(`DROP VIEW IF EXISTS ${quoteIdent(safe)}`);
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

function bundlesFor(opts: EngineBootOptions): duckdb.DuckDBBundles {
  if (opts.offline) {
    return {
      mvp: {
        mainModule: `${FALLBACK_BASE}duckdb-mvp.wasm`,
        mainWorker: `${FALLBACK_BASE}duckdb-browser-mvp.worker.js`,
      },
      eh: {
        mainModule: `${FALLBACK_BASE}duckdb-eh.wasm`,
        mainWorker: `${FALLBACK_BASE}duckdb-browser-eh.worker.js`,
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
