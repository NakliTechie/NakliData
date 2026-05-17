import { describe, expect, it, vi } from 'vitest';
import { detectFormat, sanitizeTableName } from '../src/core/mount.ts';

describe('detectFormat', () => {
  it.each([
    ['data.csv', 'csv'],
    ['DATA.CSV', 'csv'],
    ['data.tsv', 'tsv'],
    ['data.jsonl', 'jsonl'],
    ['data.ndjson', 'jsonl'],
    ['data.parquet', 'parquet'],
    ['data.pq', 'parquet'],
    ['data.arrow', 'arrow'],
    ['data.feather', 'arrow'],
    ['data.duckdb', 'duckdb'],
    ['data.db', 'sqlite'],
    ['data.sqlite', 'sqlite'],
    ['data.sqlite3', 'sqlite'],
    ['data.xlsx', 'xlsx'],
    ['data.sav', 'sav'],
    ['data.zsav', 'sav'],
    ['data.por', 'sav'],
    ['data.dta', 'dta'],
    ['data.sas7bdat', 'sas7bdat'],
    ['data.xpt', 'xpt'],
  ])('classifies %s as %s', (filename, expected) => {
    expect(detectFormat(filename)).toBe(expected);
  });

  it.each([['data.txt'], ['no-extension'], ['data.exe'], ['data.numbers'], ['data.mdb']])(
    'returns null for unsupported %s',
    (filename) => {
      expect(detectFormat(filename)).toBeNull();
    },
  );
});

describe('sanitizeTableName', () => {
  it('strips extension and lowercases', () => {
    expect(sanitizeTableName('MyData.csv')).toBe('mydata');
  });

  it('replaces non-ident chars with underscore', () => {
    expect(sanitizeTableName('My-Data File!.csv')).toBe('my_data_file');
  });

  it('handles leading-digit by prefixing', () => {
    expect(sanitizeTableName('2024-sales.csv')).toBe('t_2024_sales');
  });

  it('collapses runs of separators', () => {
    expect(sanitizeTableName('foo___bar---baz.csv')).toBe('foo_bar_baz');
  });
});

// ---- routing tests against a mock engine ---------------------------------
//
// We import the internal `registerFileByFormat` via dynamic eval since it
// isn't exported; the easier alternative is to invoke mountFile against a
// mock engine and assert which engine method was called.

import { mountFile } from '../src/core/mount.ts';

function mockEngine(overrides: Record<string, unknown> = {}) {
  // Each register* method records the call and returns the table-name list
  // shape its real counterpart would.
  return {
    registerCsv: vi.fn().mockResolvedValue(undefined),
    registerTsv: vi.fn().mockResolvedValue(undefined),
    registerJsonl: vi.fn().mockResolvedValue(undefined),
    registerParquet: vi.fn().mockResolvedValue(undefined),
    registerSqlite: vi.fn().mockResolvedValue(['vendors', 'invoices']),
    registerDuckdb: vi.fn().mockResolvedValue(['t1', 't2']),
    registerXlsx: vi.fn().mockResolvedValue(['sheet1']),
    registerArrow: vi.fn().mockResolvedValue(['observations']),
    registerReadStat: vi.fn().mockResolvedValue(['data']),
    query: vi.fn().mockResolvedValue([{ n: 42n }]),
    ...overrides,
  };
}

function fakeFile(name: string, content = 'col\n1\n'): File {
  return new File([content], name, { type: 'application/octet-stream' });
}

describe('mountFile routes formats to the right engine method', () => {
  it('csv → registerCsv with the file', async () => {
    const engine = mockEngine();
    const src = await mountFile(engine as never, fakeFile('vendors.csv'));
    expect(engine.registerCsv).toHaveBeenCalledOnce();
    expect(src.tables).toHaveLength(1);
    expect(src.tables[0]?.name).toBe('vendors');
    expect(src.tables[0]?.format).toBe('csv');
  });

  it('sqlite → registerSqlite, producing multiple tables', async () => {
    const engine = mockEngine();
    const src = await mountFile(engine as never, fakeFile('khata.sqlite'));
    expect(engine.registerSqlite).toHaveBeenCalledOnce();
    expect(src.tables.map((t) => t.name)).toEqual(['vendors', 'invoices']);
  });

  it('duckdb file → registerDuckdb, multiple tables', async () => {
    const engine = mockEngine();
    const src = await mountFile(engine as never, fakeFile('analytics.duckdb'));
    expect(engine.registerDuckdb).toHaveBeenCalledOnce();
    expect(src.tables.map((t) => t.name)).toEqual(['t1', 't2']);
  });

  it('xlsx → registerXlsx', async () => {
    const engine = mockEngine();
    const src = await mountFile(engine as never, fakeFile('Q1.xlsx'));
    expect(engine.registerXlsx).toHaveBeenCalledOnce();
    expect(src.tables).toHaveLength(1);
  });

  it.each([
    ['data.arrow', 'arrow'],
    ['cohort.feather', 'arrow'],
  ])('arrow IPC %s → registerArrow', async (filename, expectedFormat) => {
    const engine = mockEngine();
    const src = await mountFile(engine as never, fakeFile(filename));
    expect(engine.registerArrow).toHaveBeenCalledOnce();
    expect(src.tables[0]?.format).toBe(expectedFormat);
    expect(src.tables[0]?.name).toBe('observations');
  });

  it.each([
    ['survey.sav', 'sav'],
    ['responses.dta', 'dta'],
    ['cohort.sas7bdat', 'sas7bdat'],
    ['extract.xpt', 'xpt'],
  ])('statistical format %s → registerReadStat (format=%s)', async (filename, expectedFormat) => {
    const engine = mockEngine();
    const src = await mountFile(engine as never, fakeFile(filename));
    expect(engine.registerReadStat).toHaveBeenCalledOnce();
    expect(src.tables[0]?.format).toBe(expectedFormat);
  });

  it('refuses unsupported extensions', async () => {
    const engine = mockEngine();
    await expect(mountFile(engine as never, fakeFile('notes.txt'))).rejects.toThrow(
      /Unsupported file extension/,
    );
  });
});
