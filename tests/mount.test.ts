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
    ['shape.geojson', 'geojson'],
    ['shape.geo.json', 'geojson'],
    ['MAP.KML', 'kml'],
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

// ---- mountUrl (Wave 2 slice 1) -------------------------------------------

import { mountUrl } from '../src/core/mount.ts';

function urlMockEngine() {
  return {
    registerUrl: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue([{ n: 100n }]),
  };
}

describe('mountUrl (Wave 2 slice 1)', () => {
  it('mounts a parquet URL and returns a source with kind="http"', async () => {
    const engine = urlMockEngine();
    const src = await mountUrl(engine as never, {
      url: 'https://example.com/data/vendors.parquet',
    });
    expect(engine.registerUrl).toHaveBeenCalledWith({
      tableName: 'vendors',
      url: 'https://example.com/data/vendors.parquet',
      format: 'parquet',
    });
    expect(src.kind).toBe('http');
    expect(src.ref).toBe('https://example.com/data/vendors.parquet');
    expect(src.tables).toHaveLength(1);
    expect(src.tables[0]?.format).toBe('parquet');
    expect(src.tables[0]?.name).toBe('vendors');
  });

  it.each([
    ['.csv', 'csv'],
    ['.tsv', 'tsv'],
    ['.jsonl', 'jsonl'],
    ['.parquet', 'parquet'],
  ] as const)('accepts %s URLs (format %s)', async (ext, expected) => {
    const engine = urlMockEngine();
    await mountUrl(engine as never, { url: `https://example.com/x${ext}` });
    expect(engine.registerUrl).toHaveBeenCalledWith(
      expect.objectContaining({ format: expected }),
    );
  });

  it('uses the provided label when given', async () => {
    const engine = urlMockEngine();
    const src = await mountUrl(engine as never, {
      url: 'https://example.com/data/x.csv',
      label: 'My remote data',
    });
    expect(src.label).toBe('My remote data');
  });

  it('defaults the label to the filename', async () => {
    const engine = urlMockEngine();
    const src = await mountUrl(engine as never, {
      url: 'https://example.com/data/vendors.parquet',
    });
    expect(src.label).toBe('vendors.parquet');
  });

  it('strips query string + fragment when detecting format', async () => {
    const engine = urlMockEngine();
    const src = await mountUrl(engine as never, {
      url: 'https://example.com/x.parquet?token=abc#frag',
    });
    expect(src.tables[0]?.format).toBe('parquet');
  });

  it('rejects non-http(s) URLs', async () => {
    const engine = urlMockEngine();
    await expect(
      mountUrl(engine as never, { url: 'file:///tmp/x.parquet' }),
    ).rejects.toThrow(/must start with http/);
    expect(engine.registerUrl).not.toHaveBeenCalled();
  });

  it('rejects unsupported extensions with a helpful message', async () => {
    const engine = urlMockEngine();
    await expect(
      mountUrl(engine as never, { url: 'https://example.com/data.txt' }),
    ).rejects.toThrow(/Could not infer a supported format/);
  });

  it('rejects formats that need extensions (e.g. .xlsx) on slice 1', async () => {
    const engine = urlMockEngine();
    await expect(
      mountUrl(engine as never, { url: 'https://example.com/data.xlsx' }),
    ).rejects.toThrow(/can be mounted from disk but not yet via a public URL/);
    expect(engine.registerUrl).not.toHaveBeenCalled();
  });
});
