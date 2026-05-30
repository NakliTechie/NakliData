// Lazy chunk — SheetJS (xlsx) for Excel mounts.
//
// Loaded only when a user actually mounts an .xlsx (or .xlsm / .xls)
// file. Replaces the deferred DuckDB `excel` extension path: that
// extension isn't published for our DuckDB-wasm revision (v1.1.1/
// wasm_eh) so we can't vendor it, and waiting for upstream is an open
// blocker.
//
// SheetJS parses the file in-browser and emits CSV per sheet; we then
// feed each sheet through the existing CSV mount path. This keeps the
// shell free of the ~600 KB xlsx library when no one mounts an Excel
// file, and lets every other format keep using DuckDB's native readers.

import * as XLSX from 'xlsx';

export interface ParsedSheet {
  /** Sheet name as it appears in the workbook. */
  name: string;
  /** Sheet content rendered as a CSV string (RFC 4180-ish; SheetJS picks types). */
  csv: string;
}

/**
 * Read a file as an Excel workbook and return one ParsedSheet per
 * non-empty sheet. Empty sheets are dropped.
 */
export async function parseXlsxToSheets(file: File): Promise<ParsedSheet[]> {
  const buf = await file.arrayBuffer();
  // `cellDates: true` keeps dates parseable; `dense: true` is a perf
  // win for large sheets. `type: 'array'` matches the ArrayBuffer.
  const wb = XLSX.read(buf, { type: 'array', cellDates: true, dense: true });
  const out: ParsedSheet[] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    if (!csv.trim()) continue;
    out.push({ name, csv });
  }
  return out;
}
