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
  unlink?(path: string): Promise<void>;
}
interface WebRAPI {
  init(): Promise<void>;
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
      const mod = (await import(`${base}webr.mjs`)) as {
        WebR: new (opts: { baseUrl: string }) => WebRAPI;
      };
      const webR = new mod.WebR({ baseUrl: base });
      await webR.init();
      onProgress?.('Ready');
      return webR;
    })();
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
export async function runRCell(
  engine: Engine,
  opts: { cellId: string; inputTable: string; code: string; onProgress?: (phase: string) => void },
): Promise<RPreview> {
  const inputView = `cell_${sanitizeId(opts.inputTable)}`;
  const outView = `cell_${sanitizeId(opts.cellId)}`;

  const countRows = await engine.query<{ n: number | bigint }>(
    `SELECT count(*) AS n FROM ${quoteIdent(inputView)}`,
  );
  const n = Number(countRows[0]?.n ?? 0);
  if (n > R_MAX_ROWS) {
    throw new Error(
      `Input has ${n.toLocaleString()} rows — R cells are capped at ${R_MAX_ROWS.toLocaleString()} to keep the tab within memory. Filter or aggregate upstream first.`,
    );
  }

  const csvIn = await engine.queryToCsvBuffer(`SELECT * FROM ${quoteIdent(inputView)}`);
  const webR = await loadRRuntime(opts.onProgress);

  await webR.FS.writeFile('/nd_r_in.csv', csvIn);
  try {
    await webR.evalRVoid(
      "df <- read.csv('/nd_r_in.csv', stringsAsFactors=FALSE, check.names=FALSE)",
    );
  } catch (err) {
    throw new RRunError(`Failed to load the input table into R: ${rErr(err)}`);
  }
  try {
    await webR.evalRVoid(opts.code);
  } catch (err) {
    throw new RRunError(rErr(err));
  }
  try {
    await webR.evalRVoid(
      "if (!is.data.frame(df)) stop('the cell must leave a data.frame in `df`'); write.csv(df, '/nd_r_out.csv', row.names=FALSE)",
    );
  } catch (err) {
    throw new RRunError(`Could not read the result back: ${rErr(err)}`);
  }
  const csvOut = await webR.FS.readFile('/nd_r_out.csv');
  await engine.registerCsvBuffer(outView, csvOut);

  const rows = await engine.query<Record<string, unknown>>(
    `SELECT * FROM ${quoteIdent(outView)} LIMIT 50`,
  );
  const total = await engine.query<{ n: number | bigint }>(
    `SELECT count(*) AS n FROM ${quoteIdent(outView)}`,
  );
  const columns = rows.length > 0 ? Object.keys(rows[0] as object) : [];
  return { columns, rows, rowCount: Number(total[0]?.n ?? rows.length) };
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
