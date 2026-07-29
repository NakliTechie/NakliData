import { describe, expect, it, vi } from 'vitest';
import {
  buildFormulaSafeCsvProjection,
  csvEscape,
  encodeFormulaSafeCsv,
  isTextualCsvType,
  neutralizeCsvFormula,
} from '../src/core/csv-safety.ts';
import type { Engine } from '../src/core/engine.ts';
import { SinkError, csvBytes } from '../src/lazy/sink-execution.ts';

describe('CSV formula safety', () => {
  it.each(['=1+1', '+cmd', '-cmd', '@sum', '\tformula', '\rformula'])(
    'neutralizes a dangerous textual prefix: %j',
    (value) => {
      expect(neutralizeCsvFormula(value)).toBe(`'${value}`);
      expect(csvEscape(value)).toContain(`'${value}`);
    },
  );

  it('neutralizes headers and text while preserving legitimate negative numbers', () => {
    const csv = new TextDecoder().decode(
      encodeFormulaSafeCsv(
        ['=header', 'label', 'amount'],
        [{ '=header': '=payload', label: '-text', amount: -42 }],
        [
          { name: '=header', type: 'VARCHAR' },
          { name: 'label', type: 'VARCHAR' },
          { name: 'amount', type: 'DOUBLE' },
        ],
      ),
    );
    expect(csv).toBe("'=header,label,amount\n'=payload,'-text,-42\n");
  });

  it('recognizes DuckDB text families without treating numeric types as text', () => {
    expect(isTextualCsvType('VARCHAR')).toBe(true);
    expect(isTextualCsvType("ENUM('a', 'b')")).toBe(true);
    expect(isTextualCsvType('DECIMAL(18,2)')).toBe(false);
    expect(isTextualCsvType('INTEGER')).toBe(false);
  });

  it('builds a quoted COPY projection for hostile headers and textual values', () => {
    const sql = buildFormulaSafeCsvProjection([
      { name: '=formula', type: 'VARCHAR' },
      { name: 'a"b', type: 'INTEGER' },
    ]);
    expect(sql).toContain(`AS "'=formula"`);
    expect(sql).toContain(`LEFT(CAST("=formula" AS VARCHAR), 1)`);
    expect(sql).toContain(`"a""b" AS "a""b"`);
  });
});

describe('CSV 5,000/5,001-row boundary', () => {
  function engine(overrides: Partial<Engine> = {}): Engine {
    return {
      describeColumns: vi.fn().mockResolvedValue([
        { name: '=header', type: 'VARCHAR' },
        { name: 'amount', type: 'INTEGER' },
      ]),
      exec: vi.fn().mockResolvedValue(undefined),
      exportFileBytes: vi.fn().mockResolvedValue(new TextEncoder().encode('copied')),
      removeFile: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    } as unknown as Engine;
  }

  it('uses the JS writer at exactly 5,000 rows with the same formula policy', async () => {
    const e = engine();
    const bytes = await csvBytes(e, 'safe', {
      columns: ['=header', 'amount'],
      rows: [{ '=header': '=payload', amount: -2 }],
      rowCount: 5_000,
      elapsedMs: 1,
    });
    expect(new TextDecoder().decode(bytes)).toBe("'=header,amount\n'=payload,-2\n");
    expect(e.exec).not.toHaveBeenCalled();
  });

  it('uses a formula-safe DuckDB COPY above 5,000 rows', async () => {
    const e = engine();
    await csvBytes(e, 'safe', {
      columns: ['=header', 'amount'],
      rows: [],
      rowCount: 5_001,
      elapsedMs: 1,
    });
    expect(e.exec).toHaveBeenCalledWith(
      expect.stringContaining(`LEFT(CAST("=header" AS VARCHAR), 1)`),
    );
    expect(e.exec).toHaveBeenCalledWith(expect.stringContaining(`AS "'=header"`));
    expect(e.removeFile).toHaveBeenCalledWith('tmp_export_safe.csv');
  });

  it('removes the DuckDB temp file even when reading it fails', async () => {
    const removeFile = vi.fn().mockResolvedValue(undefined);
    const e = engine({
      exportFileBytes: vi.fn().mockRejectedValue(new Error('read failed')),
      removeFile,
    });
    await expect(
      csvBytes(e, 'failed', {
        columns: ['=header', 'amount'],
        rows: [],
        rowCount: 5_001,
        elapsedMs: 1,
      }),
    ).rejects.toBeInstanceOf(SinkError);
    expect(removeFile).toHaveBeenCalledWith('tmp_export_failed.csv');
  });
});
