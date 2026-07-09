// Lazy chunk — read a statistical-format file (SPSS `.sav`/`.zsav`/`.por`,
// Stata `.dta`, SAS `.sas7bdat`/`.xpt`) in the browser via ReadStat compiled
// to wasm.
//
// Why this exists (DECISIONS: F3 reopen, Polyglot-Workbench Fork 1): DuckDB's
// `read_stat` community extension is NOT published for the wasm platform, so
// it can never load in-browser (F3 dropped the formats on that basis). Rather
// than wait for a DuckDB-wasm ext bump, we own the reader: ReadStat (the small
// C lib that R's `haven` and the dead DuckDB ext both wrap) is compiled to a
// vendored, same-origin wasm (see `src/vendor/readstat/` — build.sh +
// rs_wrapper.c + README with the pinned upstream commit + emcc version).
//
// The wrapper parses the file from an in-memory buffer and emits NDJSON (one
// JSON object per row, keyed by variable name) which the engine loads via
// `read_json_auto` — the exact shape the sql.js SQLite reader and the SheetJS
// xlsx path already use. Sovereign: the wasm is fetched same-origin, never
// from a CDN; data never leaves the tab.

import createReadStat, { type ReadStatModule } from '../vendor/readstat/readstat-glue.js';

/** Statistical file formats ReadStat can read. */
export type StatFormat = 'dta' | 'sav' | 'por' | 'sas7bdat' | 'xpt';

// Format → the integer code the C wrapper's `rs_read` switches on.
const FORMAT_CODE: Record<StatFormat, number> = {
  dta: 0,
  sav: 1,
  por: 2,
  sas7bdat: 3,
  xpt: 4,
};

/** One extracted table, ready for the engine to load into DuckDB. */
export interface StatTable {
  /** Rows as newline-delimited JSON (one object per line). Empty when rowCount === 0. */
  ndjson: Uint8Array;
  /** Row count. */
  rowCount: number;
  /** Column (variable) names, in file order — shapes an empty table. */
  columns: string[];
}

// The wasm module is instantiated once per chunk load; `locateFile` points at
// the same-origin vendored copy (public/readstat-wasm/ → dist/readstat-wasm/),
// resolved against document.baseURI so subpath deploys work. No CDN reach.
let _modPromise: Promise<ReadStatModule> | null = null;
function getModule(): Promise<ReadStatModule> {
  if (!_modPromise) {
    _modPromise = createReadStat({
      locateFile: (file: string) => new URL(`./readstat-wasm/${file}`, document.baseURI).href,
    });
    // M5: don't cache a rejected wasm init forever (retry re-loads).
    _modPromise.catch(() => {
      _modPromise = null;
    });
  }
  return _modPromise;
}

/**
 * Parse a statistical file from its bytes into a single NDJSON table.
 * Throws with the ReadStat error message if the file can't be parsed.
 */
export async function readStatFile(bytes: Uint8Array, format: StatFormat): Promise<StatTable> {
  const mod = await getModule();

  const ptr = mod._malloc(bytes.length);
  let rc: number;
  try {
    mod.HEAPU8.set(bytes, ptr);
    rc = mod.ccall(
      'rs_read',
      'number',
      ['number', 'number', 'number'],
      [ptr, bytes.length, FORMAT_CODE[format]],
    );
  } finally {
    mod._free(ptr);
  }

  if (rc !== 0) {
    const msg = mod.ccall('rs_errmsg', 'string', ['number'], [rc]);
    throw new Error(`Could not read ${format.toUpperCase()} file: ${msg}`);
  }

  const columns = JSON.parse(mod.ccall('rs_columns', 'string', [], [])) as string[];

  // Copy the NDJSON straight out of the wasm heap (no intermediate JS string).
  // `.slice` detaches from the heap so a later memory-grow can't invalidate it.
  const ndjsonPtr = mod.ccall('rs_ndjson', 'number', [], []);
  const ndjsonLen = mod.ccall('rs_ndjson_len', 'number', [], []);
  const ndjson = mod.HEAPU8.slice(ndjsonPtr, ndjsonPtr + ndjsonLen);

  // Row count metadata is authoritative when present; some formats (SAS xport)
  // don't store it in the header and report -1, so fall back to a line count.
  const metaRows = mod.ccall('rs_rowcount', 'number', [], []);
  const rowCount = metaRows >= 0 ? metaRows : countLines(ndjson);

  return { ndjson, rowCount, columns };
}

/** Count newline-terminated JSON rows in an NDJSON buffer. */
function countLines(buf: Uint8Array): number {
  if (buf.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) n++;
  }
  return n;
}
