// Lazy chunk — the in-browser Python runtime for the `python` cell
// (Polyglot-Workbench Fork 2). Loads Pyodide 0.27.7 + pandas + pyarrow from
// the SAME-ORIGIN vendored copy (public/pyodide/ → dist/pyodide/), never a
// CDN — sovereign posture (runtime *code* is fetched + surfaced; *data* never
// leaves the tab).
//
// Interchange is PARQUET (columnar + typed, spec's "one data plane" idea): the
// engine hands the cell a Parquet buffer (DuckDB `COPY … TO … (FORMAT parquet)`
// + copyFileToBuffer — no apache-arrow on the JS side, which sidesteps the
// main-bundle-vs-chunk Arrow-instance identity problem), the user's Python
// mutates a pandas `df`, and the result goes back as a Parquet buffer the
// engine re-registers via `read_parquet`. pyarrow reads/writes the Parquet
// inside Python.
//
// Version pin is load-bearing: pyarrow ships ONLY in Pyodide 0.27.x
// (DECISIONS CE). The vendoring (scripts/fetch-pyodide.mjs) pins 0.27.7.

import type { Engine } from '../core/engine.ts';

/**
 * Upper bound on input rows handed to a Python cell. The spike (DECISIONS CE)
 * showed ~300 MB Pyodide heap per 1M rows; past a few million the tab risks
 * OOM. We refuse above this with a clear message rather than crash.
 */
export const PYTHON_MAX_ROWS = 2_000_000;

/** Head-snapshot of a Python cell's result, for the cell preview. */
export interface PythonPreview {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
}

// Pyodide's own type isn't bundled; model the slice we use.
interface PyProxy {
  toJs(opts?: unknown): unknown;
  destroy?(): void;
}
interface PyodideAPI {
  runPython(code: string): unknown;
  loadPackage(names: string[]): Promise<void>;
  globals: { set(name: string, value: unknown): void };
}

/** A Python error surfaced to the cell, carrying the Python traceback. */
export class PythonRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PythonRunError';
  }
}

let _pyPromise: Promise<PyodideAPI> | null = null;

/**
 * Load Pyodide + pandas + pyarrow once per chunk load, from the vendored
 * same-origin path. Pre-warms the imports (~1.2s JIT) so the first Run is fast.
 * `onProgress` reports coarse phases for the "Downloading Python…" UX.
 */
export function loadPythonRuntime(onProgress?: (phase: string) => void): Promise<PyodideAPI> {
  if (!_pyPromise) {
    _pyPromise = (async () => {
      const base = new URL('./pyodide/', document.baseURI).href;
      onProgress?.('Loading Python runtime…');
      // Runtime dynamic import of the vendored loader — esbuild leaves a
      // computed-URL import alone (same trick as loadChunk); the module is
      // served same-origin so it passes script-src 'self'.
      const loaderUrl = `${base}pyodide.mjs`;
      const mod = (await import(loaderUrl)) as {
        loadPyodide: (opts: { indexURL: string }) => Promise<PyodideAPI>;
      };
      const py = await mod.loadPyodide({ indexURL: base });
      onProgress?.('Loading pandas + pyarrow…');
      await py.loadPackage(['pandas', 'pyarrow']);
      onProgress?.('Warming up…');
      // Pre-warm: import + first JIT so the first cell Run doesn't pay it.
      py.runPython('import pandas as pd, pyarrow as pa, numpy as np');
      onProgress?.('Ready');
      return py;
    })();
    // M5: a rejected init (transient fetch failure) must not be cached forever
    // — clear it so the next Run retries instead of re-awaiting the rejection.
    _pyPromise.catch(() => {
      _pyPromise = null;
    });
  }
  return _pyPromise;
}

/** True once the runtime has finished loading (for UI state). */
export function isRuntimeLoaded(): boolean {
  return _pyPromise !== null;
}

/**
 * Run the user's Python against a Parquet buffer and return a Parquet buffer.
 * The input table is pre-loaded into a pandas DataFrame named `df`; the user
 * mutates `df` in place (or reassigns it); the final `df` is serialized back.
 * Throws PythonRunError with the Python traceback on failure.
 */
export async function runPythonParquet(
  parquetIn: Uint8Array,
  userCode: string,
): Promise<Uint8Array> {
  const py = await loadPythonRuntime();

  // 1. Load the Parquet bytes into `df` (pd/pa/np already imported at warmup).
  py.globals.set('__nd_pq_in', parquetIn);
  // L23: release the (up to 2M-row) input buffer on EVERY exit, not just
  // success — a user-code throw used to leave it referenced in Pyodide globals.
  try {
    try {
      py.runPython(
        [
          'import pyarrow as pa, pyarrow.parquet as pq, pandas as pd, numpy as np, io as _io',
          'df = pq.read_table(_io.BytesIO(bytes(__nd_pq_in.to_py()))).to_pandas()',
        ].join('\n'),
      );
    } catch (err) {
      throw new PythonRunError(`Failed to load the input table into pandas: ${pyErr(err)}`);
    }

    // 2. Run the user's code (mutates the global `df`).
    try {
      py.runPython(userCode);
    } catch (err) {
      throw new PythonRunError(pyErr(err));
    }

    // 3. Serialize the final `df` back to a Parquet buffer.
    let proxy: PyProxy;
    try {
      proxy = py.runPython(
        [
          'if not isinstance(df, pd.DataFrame):',
          "    raise TypeError('the cell must leave a pandas DataFrame in `df` (got %s)' % type(df).__name__)",
          '_nd_sink = _io.BytesIO()',
          'pq.write_table(pa.Table.from_pandas(df, preserve_index=False), _nd_sink)',
          '_nd_sink.getvalue()',
        ].join('\n'),
      ) as PyProxy;
    } catch (err) {
      throw new PythonRunError(`Could not read the result back: ${pyErr(err)}`);
    }
    const out = proxy.toJs() as Uint8Array;
    proxy.destroy?.();
    return out;
  } finally {
    py.globals.set('__nd_pq_in', undefined);
  }
}

/**
 * Run a Python cell end-to-end: export the input table to Parquet, run the
 * user's Python, re-register the result as `cell_<cellId>`, and return a
 * head-snapshot preview. Throws on Python error or when the input exceeds
 * PYTHON_MAX_ROWS. Lives in the chunk (not the eager bundle) so none of the
 * orchestration touches the shell budget. `onProgress` reports runtime-load
 * phases for the "Downloading Python…" UX.
 */
export async function runPythonCell(
  engine: Engine,
  opts: { cellId: string; inputTable: string; code: string; onProgress?: (phase: string) => void },
): Promise<PythonPreview> {
  const inputView = `cell_${sanitizeId(opts.inputTable)}`;
  const outView = `cell_${sanitizeId(opts.cellId)}`;

  // Row cap — refuse rather than OOM the tab.
  const countRows = await engine.query<{ n: number | bigint }>(
    `SELECT count(*) AS n FROM ${quoteIdent(inputView)}`,
  );
  const n = Number(countRows[0]?.n ?? 0);
  if (n > PYTHON_MAX_ROWS) {
    throw new Error(
      `Input has ${n.toLocaleString()} rows — Python cells are capped at ${PYTHON_MAX_ROWS.toLocaleString()} to keep the tab within memory. Filter or aggregate upstream first.`,
    );
  }

  // Export input → Parquet, run Python, re-register the result Parquet.
  const parquetIn = await engine.queryToParquetBuffer(`SELECT * FROM ${quoteIdent(inputView)}`);
  await loadPythonRuntime(opts.onProgress);
  const parquetOut = await runPythonParquet(parquetIn, opts.code);
  await engine.registerParquetBuffer(outView, parquetOut);

  // Head snapshot for the preview.
  const rows = await engine.query<Record<string, unknown>>(
    `SELECT * FROM ${quoteIdent(outView)} LIMIT 50`,
  );
  const total = await engine.query<{ n: number | bigint }>(
    `SELECT count(*) AS n FROM ${quoteIdent(outView)}`,
  );
  const columns = rows.length > 0 ? Object.keys(rows[0] as object) : [];
  return { columns, rows, rowCount: Number(total[0]?.n ?? rows.length) };
}

// cell ids are `c_<base36>` (see notebook.ts); keep only ident-safe chars.
function sanitizeId(s: string): string {
  return s.replace(/[^A-Za-z0-9_]/g, '_');
}
function quoteIdent(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

/** Extract a readable message (last traceback line first) from a Pyodide error. */
function pyErr(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // Pyodide PythonError messages end with the exception line; surface a tight
  // form (last non-empty line) plus keep the fuller trace available in console.
  const lines = msg
    .split('\n')
    .map((l) => l.trimEnd())
    .filter(Boolean);
  const last = lines[lines.length - 1] ?? msg;
  if (typeof console !== 'undefined') console.error('[python-cell]', msg);
  return last;
}
