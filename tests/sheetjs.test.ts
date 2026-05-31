// Regression tests for `parseXlsxToSheets` — Wave 5/post-demo-verify.
//
// SheetJS's default `sheet_to_csv` emits each cell's FORMATTED display
// string ("830,706" with thousand separators, "254%" with percent sign,
// "01/07/25" via locale). DuckDB's CSV sniffer then types those columns
// as VARCHAR; numeric/date detectors miss them; Wave 4 templates fail
// to surface. The fix passes `rawNumbers: true` (+ `dateNF: 'yyyy-mm-dd'`)
// to keep numbers as raw decimals and proper date cells as ISO.
//
// We construct the xlsx in-memory with sheetjs's own writer to avoid
// shipping a fixture file. The test asserts on the CSV bytes, which is
// what the engine downstream feeds to DuckDB.

import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseXlsxToSheets } from '../src/lazy/sheetjs.ts';

function buildXlsx(rows: Array<Array<unknown>>, opts?: { sheetName?: string }): File {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  // Apply a thousands-separator format to the second column so SheetJS's
  // formatted-string path WOULD emit "1,234" without the fix.
  // Column B in row 2+: A1 is header so start at B2 which is XLSX `B2`.
  for (let r = 1; r < rows.length; r++) {
    const cellAddr = XLSX.utils.encode_cell({ r, c: 1 });
    const cell = ws[cellAddr];
    if (cell && typeof cell.v === 'number') {
      cell.t = 'n';
      cell.z = '#,##0'; // thousands grouped
    }
  }
  // Column C: format as percent. SheetJS stores percents as the underlying
  // decimal (0.55 for 55%), formatted with a `%` suffix. Default
  // `sheet_to_csv` emits "55%"; rawNumbers emits "0.55".
  for (let r = 1; r < rows.length; r++) {
    const cellAddr = XLSX.utils.encode_cell({ r, c: 2 });
    const cell = ws[cellAddr];
    if (cell && typeof cell.v === 'number') {
      cell.t = 'n';
      cell.z = '0%';
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, opts?.sheetName ?? 'Sheet1');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new File([buf], 'test.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

describe('parseXlsxToSheets', () => {
  it('emits raw numbers (not thousands-formatted) for numeric cells', async () => {
    const file = buildXlsx([
      ['name', 'amount', 'rate'],
      ['Acme', 830706, 0.55],
      ['Globex', 1234567, 0.07],
    ]);
    const sheets = await parseXlsxToSheets(file);
    expect(sheets).toHaveLength(1);
    const csv = sheets[0]?.csv ?? '';
    // The bug-fix proof: bare numerics, no commas, no '%' suffix.
    expect(csv).toContain('830706');
    expect(csv).toContain('1234567');
    expect(csv).toContain('0.55');
    expect(csv).toContain('0.07');
    // Negative proof: the formatted forms must NOT be present.
    expect(csv).not.toMatch(/"?830,706"?/);
    expect(csv).not.toContain('55%');
  });

  it('skips empty sheets', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), 'empty');
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['n', 'x'],
        [1, 'a'],
      ]),
      'real',
    );
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const file = new File([buf], 'twoSheets.xlsx');
    const sheets = await parseXlsxToSheets(file);
    expect(sheets.map((s) => s.name)).toEqual(['real']);
  });

  it('preserves text columns verbatim', async () => {
    const file = buildXlsx([
      ['vendor', 'amount'],
      ['Acme', 100],
    ]);
    const sheets = await parseXlsxToSheets(file);
    expect(sheets[0]?.csv).toContain('Acme');
  });
});
