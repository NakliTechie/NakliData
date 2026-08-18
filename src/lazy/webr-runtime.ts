// Lazy chunk — the in-browser R runtime for the `r` cell (Polyglot-Workbench
// Fork 2). Loads WebR from the SAME-ORIGIN vendored copy (public/webr/ →
// dist/webr/), never a CDN — sovereign posture (runtime *code* is fetched +
// surfaced; *data* never leaves the tab).
//
// WebR needs SharedArrayBuffer → cross-origin isolation (COOP/COEP; DECISIONS
// CG), and must load same-origin (the CDN build threw `ASM_CONSTS` when its
// worker + wasm were fetched cross-origin under credentialless).
//
// Interchange is CSV over WebR's virtual filesystem: DuckDB writes the input as
// CSV, R reads it with base `read.csv` (no package, no cross-origin package
// install), the user's R mutates a data.frame `df`, and base `write.csv` hands
// it back for DuckDB's `read_csv_auto`. Types are inferred both ways. (Parquet
// isn't usable here — base R can't read it and the `arrow` R package isn't in
// WebR's repo; CSV keeps it sovereign + dependency-free.)

import type { Engine } from '../core/engine.ts';

/** Rows handed to an R cell are capped like the Python cell (memory guard). */
export const R_MAX_ROWS = 2_000_000;

/** Head-snapshot of an R cell's result, for the cell preview. */
export interface RPreview {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
}

interface WebRProxy {
  toString(): Promise<string> | string;
}
interface WebRFS {
  writeFile(path: string, data: Uint8Array): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  unlink(path: string): Promise<void>;
}
interface WebRAPI {
  init(): Promise<void>;
  interrupt(): void;
  close(): void;
  evalRVoid(code: string): Promise<void>;
  evalR(code: string): Promise<WebRProxy>;
  FS: WebRFS;
}

let _rPromise: Promise<WebRAPI> | null = null;

/**
 * Load WebR once per chunk load, from the vendored same-origin path. WebR spins
 * up its own Web Worker (SAB channel — requires cross-origin isolation).
 */
export function loadRRuntime(onProgress?: (phase: string) => void): Promise<WebRAPI> {
  if (!_rPromise) {
    _rPromise = (async () => {
      const base = new URL('./webr/', document.baseURI).href;
      onProgress?.('Loading R runtime…');
      const mod = (await import(`${base}webr.js`)) as {
        WebR: new (opts: { baseUrl: string }) => WebRAPI;
      };
      const webR = new mod.WebR({ baseUrl: base });
      await webR.init();
      onProgress?.('Ready');
      return webR;
    })();
    // M5: don't cache a rejected init forever (retry re-loads).
    _rPromise.catch(() => {
      _rPromise = null;
    });
  }
  return _rPromise;
}

/** True once the R runtime has started loading (for UI state). */
export function isRRuntimeLoaded(): boolean {
  return _rPromise !== null;
}

/** An R error surfaced to the cell, carrying the R condition message. */
export class RRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RRunError';
  }
}

/**
 * Run an R cell end-to-end: export the input table to CSV, load it into a
 * data.frame `df`, run the user's R, write `df` back, and re-register it as
 * `cell_<cellId>`. Returns a head-snapshot preview. Throws on R error or when
 * the input exceeds R_MAX_ROWS.
 */
// M27: WebR runs share the VFS files `/nd_r_in.csv` + `/nd_r_out.csv` and the
// R global `df`, and the critical section spans ~6 awaits. Two concurrent runs
// would interleave and silently corrupt each other. Serialize every run through
// a promise queue (in-chunk, not relying on UI discipline).
let _rLock: Promise<unknown> = Promise.resolve();

export function runRCell(
  engine: Engine,
  opts: {
    cellId: string;
    inputTable: string;
    code: string;
    signal?: AbortSignal;
    onProgress?: (phase: string) => void;
  },
): Promise<RPreview> {
  const run = _rLock.then(() => runRCellImpl(engine, opts));
  // Keep the chain alive across failures without leaking the rejection to the
  // NEXT queued run (each caller still gets its own rejection via `run`).
  _rLock = run.catch(() => {});
  return run;
}

async function runRCellImpl(
  engine: Engine,
  opts: {
    cellId: string;
    inputTable: string;
    code: string;
    signal?: AbortSignal;
    onProgress?: (phase: string) => void;
  },
): Promise<RPreview> {
  const inputView = `cell_${sanitizeId(opts.inputTable)}`;
  const outView = `cell_${sanitizeId(opts.cellId)}`;

  opts.onProgress?.('Preparing R input…');
  throwIfAborted(opts.signal);
  const countRows = await engine.query<{ n: number | bigint }>(
    `SELECT count(*) AS n FROM ${quoteIdent(inputView)}`,
  );
  throwIfAborted(opts.signal);
  const n = Number(countRows[0]?.n ?? 0);
  if (n > R_MAX_ROWS) {
    throw new Error(
      `Input has ${n.toLocaleString()} rows — R cells are capped at ${R_MAX_ROWS.toLocaleString()} to keep the tab within memory. Filter or aggregate upstream first.`,
    );
  }

  const csvIn = await engine.queryToCsvBuffer(`SELECT * FROM ${quoteIdent(inputView)}`);
  throwIfAborted(opts.signal);
  const webR = await loadRRuntime(opts.onProgress);
  throwIfAborted(opts.signal);
  let rejectAbort: ((reason: DOMException) => void) | null = null;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const waitForR = <T>(operation: Promise<T>): Promise<T> =>
    opts.signal ? Promise.race([operation, aborted]) : operation;
  const interrupt = () => {
    try {
      webR.interrupt();
    } finally {
      // WebR 0.6 can leave an eval promise pending after an interrupt. Closing
      // the worker releases its VFS/global state and lets the next run create a
      // fresh runtime instead of remaining behind a stranded queue entry.
      webR.close();
      _rPromise = null;
      rejectAbort?.(abortError());
    }
  };
  opts.signal?.addEventListener('abort', interrupt, { once: true });
  let registered = false;
  try {
    await waitForR(webR.FS.writeFile('/nd_r_in.csv', csvIn));
    throwIfAborted(opts.signal);
    try {
      await waitForR(
        webR.evalRVoid("df <- read.csv('/nd_r_in.csv', stringsAsFactors=FALSE, check.names=FALSE)"),
      );
    } catch (err) {
      if (opts.signal?.aborted) throw abortError();
      throw new RRunError(`Failed to load the input table into R: ${rErr(err)}`);
    }
    throwIfAborted(opts.signal);
    opts.onProgress?.('Running R…');
    try {
      await waitForR(webR.evalRVoid(opts.code));
    } catch (err) {
      if (opts.signal?.aborted) throw abortError();
      throw new RRunError(rErr(err));
    }
    throwIfAborted(opts.signal);
    opts.onProgress?.('Importing R result…');
    try {
      await waitForR(
        webR.evalRVoid(
          "if (!is.data.frame(df)) stop('the cell must leave a data.frame in `df`'); write.csv(df, '/nd_r_out.csv', row.names=FALSE)",
        ),
      );
    } catch (err) {
      if (opts.signal?.aborted) throw abortError();
      throw new RRunError(`Could not read the result back: ${rErr(err)}`);
    }
    throwIfAborted(opts.signal);
    const csvOut = await waitForR(webR.FS.readFile('/nd_r_out.csv'));
    throwIfAborted(opts.signal);
    await engine.registerCsvBuffer(outView, csvOut);
    registered = true;
    throwIfAborted(opts.signal);
  } catch (err) {
    if (registered && opts.signal?.aborted) await engine.drop(outView).catch(() => {});
    throw err;
  } finally {
    opts.signal?.removeEventListener('abort', interrupt);
    if (!opts.signal?.aborted) {
      await settle(() => webR.FS.unlink('/nd_r_in.csv'));
      await settle(() => webR.FS.unlink('/nd_r_out.csv'));
      await settle(() =>
        webR.evalRVoid("if (exists('df', envir=.GlobalEnv)) rm(df, envir=.GlobalEnv)"),
      );
    }
  }

  opts.onProgress?.('Building R preview…');
  const rows = await engine.query<Record<string, unknown>>(
    `SELECT * FROM ${quoteIdent(outView)} LIMIT 50`,
  );
  const total = await engine.query<{ n: number | bigint }>(
    `SELECT count(*) AS n FROM ${quoteIdent(outView)}`,
  );
  const columns = rows.length > 0 ? Object.keys(rows[0] as object) : [];
  return { columns, rows, rowCount: Number(total[0]?.n ?? rows.length) };
}

function abortError(): DOMException {
  return new DOMException('R run cancelled.', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

async function settle(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch {
    // Cleanup is best-effort and must not mask the run result.
  }
}

function sanitizeId(s: string): string {
  return s.replace(/[^A-Za-z0-9_]/g, '_');
}
function quoteIdent(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}
function rErr(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (typeof console !== 'undefined') console.error('[r-cell]', msg);
  const lines = msg
    .split('\n')
    .map((l) => l.trimEnd())
    .filter(Boolean);
  return lines[lines.length - 1] ?? msg;
}
