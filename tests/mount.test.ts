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
    registerArrowBuffer: vi.fn().mockResolvedValue(['arrow_buffer_table']),
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
    expect(engine.registerUrl).toHaveBeenCalledWith(expect.objectContaining({ format: expected }));
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
    await expect(mountUrl(engine as never, { url: 'file:///tmp/x.parquet' })).rejects.toThrow(
      /must start with http/,
    );
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

// ---- mountS3Endpoint (Wave 2 slice 2) ------------------------------------

import { mountS3Endpoint } from '../src/core/mount.ts';

function s3MockEngine() {
  return {
    configureS3: vi.fn().mockResolvedValue(undefined),
    registerS3Url: vi.fn().mockResolvedValue(undefined),
    ensureExtension: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue([{ n: 7n }]),
  };
}

const validS3Input = {
  label: 'My bucket',
  endpoint: 'https://s3.amazonaws.com',
  region: 'us-east-1',
  bucket: 'my-bucket',
  pathPrefix: 'data/vendors.parquet',
  urlStyle: 'vhost' as const,
  accessKeyId: 'AKIA-EXAMPLE',
  secretAccessKey: 'secret-example',
};

describe('mountS3Endpoint (Wave 2 slice 2)', () => {
  it('configures S3 + registers a parquet view and returns kind="s3-endpoint"', async () => {
    const engine = s3MockEngine();
    const src = await mountS3Endpoint(engine as never, validS3Input);
    expect(engine.configureS3).toHaveBeenCalledWith({
      endpoint: 's3.amazonaws.com', // scheme stripped
      region: 'us-east-1',
      accessKeyId: 'AKIA-EXAMPLE',
      secretAccessKey: 'secret-example',
      urlStyle: 'vhost',
    });
    expect(engine.registerS3Url).toHaveBeenCalledWith({
      tableName: 'vendors',
      s3Url: 's3://my-bucket/data/vendors.parquet',
      format: 'parquet',
    });
    expect(src.kind).toBe('s3-endpoint');
    expect(src.s3?.bucket).toBe('my-bucket');
    expect(src.s3?.urlStyle).toBe('vhost');
    expect(src.tables[0]?.format).toBe('parquet');
  });

  it('strips http:// and trailing slashes from the endpoint', async () => {
    const engine = s3MockEngine();
    await mountS3Endpoint(engine as never, {
      ...validS3Input,
      endpoint: 'https://minio.example.com:9000///',
    });
    expect(engine.configureS3).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'minio.example.com:9000' }),
    );
  });

  it('strips leading slashes from the path prefix', async () => {
    const engine = s3MockEngine();
    const src = await mountS3Endpoint(engine as never, {
      ...validS3Input,
      pathPrefix: '///data/vendors.parquet',
    });
    expect(src.s3?.pathPrefix).toBe('data/vendors.parquet');
  });

  it('defaults the region to us-east-1 when blank', async () => {
    const engine = s3MockEngine();
    await mountS3Endpoint(engine as never, { ...validS3Input, region: '' });
    expect(engine.configureS3).toHaveBeenCalledWith(
      expect.objectContaining({ region: 'us-east-1' }),
    );
  });

  it.each([
    ['data/x.csv', 'csv'],
    ['data/x.tsv', 'tsv'],
    ['data/x.jsonl', 'jsonl'],
    ['data/x.parquet', 'parquet'],
  ] as const)('accepts %s (format %s)', async (pathPrefix, expected) => {
    const engine = s3MockEngine();
    await mountS3Endpoint(engine as never, { ...validS3Input, pathPrefix });
    expect(engine.registerS3Url).toHaveBeenCalledWith(
      expect.objectContaining({ format: expected }),
    );
  });

  it('rejects empty endpoint / bucket / access key / secret', async () => {
    const engine = s3MockEngine();
    await expect(
      mountS3Endpoint(engine as never, { ...validS3Input, endpoint: '' }),
    ).rejects.toThrow(/S3 endpoint is required/);
    await expect(mountS3Endpoint(engine as never, { ...validS3Input, bucket: '' })).rejects.toThrow(
      /Bucket is required/,
    );
    await expect(
      mountS3Endpoint(engine as never, { ...validS3Input, accessKeyId: '' }),
    ).rejects.toThrow(/Access key/);
    await expect(
      mountS3Endpoint(engine as never, { ...validS3Input, secretAccessKey: '' }),
    ).rejects.toThrow(/Access key/);
  });

  it('rejects unsupported extensions with a helpful pointer', async () => {
    const engine = s3MockEngine();
    await expect(
      mountS3Endpoint(engine as never, {
        ...validS3Input,
        pathPrefix: 'data/file.unknown',
      }),
    ).rejects.toThrow(/Could not infer a supported format/);
    expect(engine.configureS3).not.toHaveBeenCalled();
  });

  it('rejects formats that need extensions (e.g. .xlsx) on slice 2', async () => {
    const engine = s3MockEngine();
    await expect(
      mountS3Endpoint(engine as never, {
        ...validS3Input,
        pathPrefix: 'data/file.xlsx',
      }),
    ).rejects.toThrow(/can be mounted from disk but not yet via an S3 endpoint/);
  });
});

// ---- mountIcebergTable (Wave 2 slice 3a) ---------------------------------

import { mountIcebergTable } from '../src/core/mount.ts';

function icebergMockEngine() {
  return {
    configureIceberg: vi.fn().mockResolvedValue(undefined),
    registerIcebergTable: vi.fn().mockResolvedValue(undefined),
    ensureExtension: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue([{ n: 42n }]),
  };
}

describe('mountIcebergTable (Wave 2 slice 3a)', () => {
  it('configures Iceberg + registers a view and returns kind="iceberg-table"', async () => {
    const engine = icebergMockEngine();
    const src = await mountIcebergTable(engine as never, {
      label: 'Sales table',
      metadataUrl: 'https://my-bucket.s3.amazonaws.com/warehouse/sales/metadata/v3.metadata.json',
      bearerToken: null,
    });
    expect(engine.configureIceberg).toHaveBeenCalledWith({ bearerToken: null });
    expect(engine.registerIcebergTable).toHaveBeenCalledWith({
      tableName: 'sales',
      metadataUrl: 'https://my-bucket.s3.amazonaws.com/warehouse/sales/metadata/v3.metadata.json',
    });
    expect(src.kind).toBe('iceberg-table');
    expect(src.iceberg?.metadataUrl).toBe(
      'https://my-bucket.s3.amazonaws.com/warehouse/sales/metadata/v3.metadata.json',
    );
    expect(src.iceberg?.requiresBearer).toBe(false);
    expect(src.tables[0]?.format).toBe('parquet');
  });

  it('passes through a Bearer token when supplied', async () => {
    const engine = icebergMockEngine();
    const src = await mountIcebergTable(engine as never, {
      label: '',
      metadataUrl: 'https://example.com/table/metadata.json',
      bearerToken: 'eyJhbGc-EXAMPLE',
    });
    expect(engine.configureIceberg).toHaveBeenCalledWith({ bearerToken: 'eyJhbGc-EXAMPLE' });
    expect(src.iceberg?.requiresBearer).toBe(true);
  });

  it('treats whitespace-only bearer as no bearer (null)', async () => {
    const engine = icebergMockEngine();
    const src = await mountIcebergTable(engine as never, {
      label: '',
      metadataUrl: 'https://example.com/table/metadata.json',
      bearerToken: '   \t  ',
    });
    expect(engine.configureIceberg).toHaveBeenCalledWith({ bearerToken: null });
    expect(src.iceberg?.requiresBearer).toBe(false);
  });

  it('falls back to the parent directory name for metadata.json files', async () => {
    const engine = icebergMockEngine();
    const src = await mountIcebergTable(engine as never, {
      label: '',
      metadataUrl: 'https://example.com/warehouse/customers/metadata.json',
      bearerToken: null,
    });
    expect(engine.registerIcebergTable).toHaveBeenCalledWith(
      expect.objectContaining({ tableName: 'customers' }),
    );
    expect(src.label).toBe('customers');
  });

  it('handles the canonical .../<table>/metadata/v<N>.metadata.json layout by walking up two levels', async () => {
    const engine = icebergMockEngine();
    const src = await mountIcebergTable(engine as never, {
      label: '',
      metadataUrl: 'https://example.com/sales/metadata/v17.metadata.json',
      bearerToken: null,
    });
    expect(engine.registerIcebergTable).toHaveBeenCalledWith(
      expect.objectContaining({ tableName: 'sales' }),
    );
    expect(src.label).toBe('sales');
  });

  it('accepts s3:// URLs (relies on prior S3 configuration)', async () => {
    const engine = icebergMockEngine();
    const src = await mountIcebergTable(engine as never, {
      label: 'S3 Iceberg',
      metadataUrl: 's3://my-bucket/warehouse/sales/metadata.json',
      bearerToken: null,
    });
    expect(src.kind).toBe('iceberg-table');
  });

  it('rejects URLs that are not http(s) or s3', async () => {
    const engine = icebergMockEngine();
    await expect(
      mountIcebergTable(engine as never, {
        label: '',
        metadataUrl: 'file:///tmp/metadata.json',
        bearerToken: null,
      }),
    ).rejects.toThrow(/must start with https/);
    expect(engine.configureIceberg).not.toHaveBeenCalled();
  });

  it('rejects empty metadata URL', async () => {
    const engine = icebergMockEngine();
    await expect(
      mountIcebergTable(engine as never, {
        label: '',
        metadataUrl: '   ',
        bearerToken: null,
      }),
    ).rejects.toThrow(/Iceberg metadata URL is required/);
  });
});

// ---- mountIcebergCatalog (Wave 2 slice 3b) -------------------------------

import { mountIcebergCatalog } from '../src/core/mount.ts';

describe('mountIcebergCatalog (Wave 2 slice 3b)', () => {
  it('resolves metadata-location via REST + mounts via iceberg_scan', async () => {
    const engine = icebergMockEngine();
    const fetchImpl: typeof fetch = async (url) => {
      // Just one endpoint matters here: GET .../v1/namespaces/{ns}/tables/{tbl}
      expect(String(url)).toContain('/v1/namespaces/analytics/tables/sales');
      return new Response(
        JSON.stringify({
          'metadata-location': 's3://bucket/warehouse/sales/metadata/v3.metadata.json',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const src = await mountIcebergCatalog(engine as never, {
      label: '',
      catalogUrl: 'https://catalog.example.com',
      namespace: 'analytics',
      table: 'sales',
      bearerToken: null,
      fetchImpl,
    });
    expect(engine.configureIceberg).toHaveBeenCalledWith({ bearerToken: null });
    expect(engine.registerIcebergTable).toHaveBeenCalledWith({
      tableName: 'sales',
      metadataUrl: 's3://bucket/warehouse/sales/metadata/v3.metadata.json',
    });
    expect(src.kind).toBe('iceberg-catalog');
    expect(src.icebergCatalog?.catalogUrl).toBe('https://catalog.example.com');
    expect(src.icebergCatalog?.namespace).toBe('analytics');
    expect(src.icebergCatalog?.table).toBe('sales');
    expect(src.icebergCatalog?.requiresBearer).toBe(false);
    expect(src.label).toBe('analytics.sales');
    expect(src.tables[0]?.format).toBe('parquet');
  });

  it('passes Bearer to the catalog + the engine config', async () => {
    const engine = icebergMockEngine();
    let sawAuth: string | undefined;
    const fetchImpl: typeof fetch = async (_url, init) => {
      sawAuth = new Headers(init?.headers).get('authorization') ?? undefined;
      return new Response(JSON.stringify({ 'metadata-location': 'https://example.com/m.json' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    await mountIcebergCatalog(engine as never, {
      label: '',
      catalogUrl: 'https://catalog.example.com',
      namespace: 'ns',
      table: 'tbl',
      bearerToken: 'token-abc',
      fetchImpl,
    });
    expect(sawAuth).toBe('Bearer token-abc');
    expect(engine.configureIceberg).toHaveBeenCalledWith({ bearerToken: 'token-abc' });
  });

  it('wraps REST errors in MountError with a helpful prefix', async () => {
    const engine = icebergMockEngine();
    const fetchImpl: typeof fetch = async () =>
      new Response('Forbidden', {
        status: 403,
        headers: { 'content-type': 'text/plain' },
      });
    await expect(
      mountIcebergCatalog(engine as never, {
        label: '',
        catalogUrl: 'https://catalog.example.com',
        namespace: 'ns',
        table: 'tbl',
        bearerToken: null,
        fetchImpl,
      }),
    ).rejects.toThrow(/Iceberg catalog:.*403/);
    expect(engine.configureIceberg).not.toHaveBeenCalled();
  });

  it('rejects empty catalog URL / namespace / table', async () => {
    const engine = icebergMockEngine();
    const fetchImpl: typeof fetch = async () =>
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    const base = {
      label: '',
      catalogUrl: 'https://catalog.example.com',
      namespace: 'ns',
      table: 'tbl',
      bearerToken: null,
      fetchImpl,
    };
    await expect(mountIcebergCatalog(engine as never, { ...base, catalogUrl: '' })).rejects.toThrow(
      /Catalog URL is required/,
    );
    await expect(mountIcebergCatalog(engine as never, { ...base, namespace: '' })).rejects.toThrow(
      /Namespace is required/,
    );
    await expect(mountIcebergCatalog(engine as never, { ...base, table: '' })).rejects.toThrow(
      /Table is required/,
    );
  });
});

// ---- mountComputeBridge (Wave 3 W3.4a) -----------------------------------

import { mountComputeBridge } from '../src/core/mount.ts';

function bridgeMockEngine() {
  return {
    registerArrowBuffer: vi.fn().mockResolvedValue(['result_table']),
    query: vi.fn().mockResolvedValue([{ n: 17n }]),
  };
}

describe('mountComputeBridge (Wave 3 W3.4a)', () => {
  const fakeArrowBytes = new Uint8Array([0x41, 0x52, 0x52, 0x4f, 0x57]);

  it('health-checks + queries the bridge + registers the Arrow result', async () => {
    const engine = bridgeMockEngine();
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const u = String(url);
      calls.push(`${init?.method ?? 'GET'} ${u}`);
      if (u.endsWith('/v1/health')) {
        return new Response(
          JSON.stringify({
            name: 'nakli-compute',
            version: '0.1',
            auth: 'bearer',
            single_tenant: true,
            capabilities: ['query'],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (u.endsWith('/v1/query')) {
        return new Response(fakeArrowBytes.buffer as ArrayBuffer, {
          status: 200,
          headers: { 'content-type': 'application/vnd.apache.arrow.stream' },
        });
      }
      throw new Error(`unexpected URL ${u}`);
    };
    const src = await mountComputeBridge(engine as never, {
      label: '',
      bridgeUrl: 'https://bridge.example.com:8088',
      sql: 'SELECT * FROM lakehouse.sales LIMIT 100',
      tableName: 'sales',
      bearerToken: 'tok',
      fetchImpl,
    });
    expect(calls[0]).toBe('GET https://bridge.example.com:8088/v1/health');
    expect(calls[1]).toBe('POST https://bridge.example.com:8088/v1/query');
    expect(engine.registerArrowBuffer).toHaveBeenCalledWith({
      tableName: 'sales',
      bytes: fakeArrowBytes,
    });
    expect(src.kind).toBe('compute-bridge');
    expect(src.bridge?.bridgeUrl).toBe('https://bridge.example.com:8088');
    expect(src.bridge?.sql).toBe('SELECT * FROM lakehouse.sales LIMIT 100');
    expect(src.bridge?.requiresBearer).toBe(true);
    expect(src.tables[0]?.format).toBe('arrow');
    expect(src.label).toBe('sales (bridge)');
  });

  it('omits Bearer when no token is supplied', async () => {
    const engine = bridgeMockEngine();
    let sawAuth: string | undefined;
    const fetchImpl: typeof fetch = async (url, init) => {
      sawAuth = new Headers(init?.headers).get('authorization') ?? undefined;
      const u = String(url);
      if (u.endsWith('/v1/health')) {
        return new Response(
          JSON.stringify({ name: 'x', version: '0', auth: 'none', capabilities: [] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(fakeArrowBytes.buffer as ArrayBuffer, {
        status: 200,
        headers: { 'content-type': 'application/vnd.apache.arrow.stream' },
      });
    };
    const src = await mountComputeBridge(engine as never, {
      label: '',
      bridgeUrl: 'https://bridge.example.com',
      sql: 'SELECT 1',
      tableName: 't',
      bearerToken: null,
      fetchImpl,
    });
    expect(sawAuth).toBeUndefined();
    expect(src.bridge?.requiresBearer).toBe(false);
  });

  it('wraps health-check failures as MountError', async () => {
    const engine = bridgeMockEngine();
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'bad token' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    await expect(
      mountComputeBridge(engine as never, {
        label: '',
        bridgeUrl: 'https://bridge.example.com',
        sql: 'SELECT 1',
        tableName: 't',
        bearerToken: 'bad',
        fetchImpl,
      }),
    ).rejects.toThrow(/Compute Bridge: .*401/);
    expect(engine.registerArrowBuffer).not.toHaveBeenCalled();
  });

  it('wraps query failures as MountError (separate message from health)', async () => {
    const engine = bridgeMockEngine();
    const fetchImpl: typeof fetch = async (url) => {
      const u = String(url);
      if (u.endsWith('/v1/health')) {
        return new Response(
          JSON.stringify({ name: 'x', version: '0', auth: 'none', capabilities: [] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      // Query path errors.
      return new Response(JSON.stringify({ error: { code: 'query_error', message: 'syntax' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    };
    await expect(
      mountComputeBridge(engine as never, {
        label: '',
        bridgeUrl: 'https://bridge.example.com',
        sql: 'SELEKT *',
        tableName: 't',
        bearerToken: null,
        fetchImpl,
      }),
    ).rejects.toThrow(/Compute Bridge query failed:.*400/);
    expect(engine.registerArrowBuffer).not.toHaveBeenCalled();
  });

  it('rejects empty URL / SQL / table name + non-http(s) URLs before any fetch', async () => {
    const engine = bridgeMockEngine();
    const fetchImpl: typeof fetch = async () => new Response('{}', { status: 200 });
    const base = {
      label: '',
      bridgeUrl: 'https://bridge.example.com',
      sql: 'SELECT 1',
      tableName: 't',
      bearerToken: null,
      fetchImpl,
    };
    await expect(mountComputeBridge(engine as never, { ...base, bridgeUrl: '' })).rejects.toThrow(
      /Compute Bridge URL is required/,
    );
    await expect(mountComputeBridge(engine as never, { ...base, sql: '   ' })).rejects.toThrow(
      /SQL is required/,
    );
    await expect(mountComputeBridge(engine as never, { ...base, tableName: '' })).rejects.toThrow(
      /Local table name is required/,
    );
    await expect(
      mountComputeBridge(engine as never, { ...base, bridgeUrl: 'file:///tmp/bridge' }),
    ).rejects.toThrow(/must start with https/);
  });
});

// ---- mountComputeBridgeCatalog (Wave 3 W3.4b) ---------------------------

import { BRIDGE_CATALOG_ROW_CAP_DEFAULT, mountComputeBridgeCatalog } from '../src/core/mount.ts';

function bridgeCatalogMockEngine() {
  // Each registerArrowBuffer call returns the registered table name.
  return {
    registerArrowBuffer: vi
      .fn()
      .mockImplementation(async ({ tableName }: { tableName: string }) => [tableName]),
    query: vi.fn().mockResolvedValue([{ n: 42n }]),
  };
}

describe('mountComputeBridgeCatalog (Wave 3 W3.4b)', () => {
  const fakeArrowBytes = new Uint8Array([0x41, 0x52, 0x52, 0x4f, 0x57]);

  function arrowResponse(): Response {
    return new Response(fakeArrowBytes.buffer as ArrayBuffer, {
      status: 200,
      headers: { 'content-type': 'application/vnd.apache.arrow.stream' },
    });
  }

  function healthResponse(): Response {
    return new Response(
      JSON.stringify({
        name: 'nakli-compute',
        version: '0.1',
        auth: 'bearer',
        single_tenant: true,
        capabilities: ['query'],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  it('health-checks then mounts each picked table via SELECT * LIMIT <cap>', async () => {
    const engine = bridgeCatalogMockEngine();
    const queryBodies: string[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const u = String(url);
      if (u.endsWith('/v1/health')) return healthResponse();
      if (u.endsWith('/v1/query')) {
        // The bridge accepts a JSON body with { sql }.
        const body =
          typeof init?.body === 'string'
            ? init.body
            : new TextDecoder().decode(init?.body as Uint8Array);
        try {
          const parsed = JSON.parse(body) as { sql: string };
          queryBodies.push(parsed.sql);
        } catch {
          queryBodies.push(body);
        }
        return arrowResponse();
      }
      throw new Error(`unexpected URL ${u}`);
    };
    const src = await mountComputeBridgeCatalog(engine as never, {
      label: '',
      bridgeUrl: 'https://bridge.example.com:8088',
      bearerToken: 'tok',
      tables: [
        { name: 'sales', rowCap: 25000 },
        { name: 'customers', rowCap: 5000 },
      ],
      fetchImpl,
    });
    // One health check + two queries.
    expect(engine.registerArrowBuffer).toHaveBeenCalledTimes(2);
    expect(queryBodies).toEqual([
      'SELECT * FROM "sales" LIMIT 25000',
      'SELECT * FROM "customers" LIMIT 5000',
    ]);
    expect(src.kind).toBe('compute-bridge-catalog');
    expect(src.bridgeCatalog?.tables).toEqual([
      { name: 'sales', localName: 'sales', rowCap: 25000 },
      { name: 'customers', localName: 'customers', rowCap: 5000 },
    ]);
    expect(src.bridgeCatalog?.requiresBearer).toBe(true);
    expect(src.tables).toHaveLength(2);
    expect(src.tables.map((t) => t.name)).toEqual(['sales', 'customers']);
    // Auto-label derives from the host.
    expect(src.label).toBe('bridge.example.com (bridge catalog)');
  });

  it('falls back to the default cap when rowCap is missing', async () => {
    const engine = bridgeCatalogMockEngine();
    const queryBodies: string[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const u = String(url);
      if (u.endsWith('/v1/health')) return healthResponse();
      const body = typeof init?.body === 'string' ? init.body : '';
      try {
        queryBodies.push((JSON.parse(body) as { sql: string }).sql);
      } catch {
        // ignore
      }
      return arrowResponse();
    };
    await mountComputeBridgeCatalog(engine as never, {
      label: '',
      bridgeUrl: 'https://bridge.example.com',
      bearerToken: null,
      tables: [{ name: 'sales' }],
      fetchImpl,
    });
    expect(queryBodies[0]).toBe(`SELECT * FROM "sales" LIMIT ${BRIDGE_CATALOG_ROW_CAP_DEFAULT}`);
  });

  it('escapes internal double-quotes in table names so the SELECT stays valid', async () => {
    const engine = bridgeCatalogMockEngine();
    const queryBodies: string[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const u = String(url);
      if (u.endsWith('/v1/health')) return healthResponse();
      const body = typeof init?.body === 'string' ? init.body : '';
      try {
        queryBodies.push((JSON.parse(body) as { sql: string }).sql);
      } catch {
        // ignore
      }
      return arrowResponse();
    };
    await mountComputeBridgeCatalog(engine as never, {
      label: '',
      bridgeUrl: 'https://bridge.example.com',
      bearerToken: null,
      tables: [{ name: 'has"quote', rowCap: 100 }],
      fetchImpl,
    });
    expect(queryBodies[0]).toBe('SELECT * FROM "has""quote" LIMIT 100');
  });

  it('records partial failures but still mounts the successful tables', async () => {
    const engine = bridgeCatalogMockEngine();
    let queryCount = 0;
    const fetchImpl: typeof fetch = async (url) => {
      const u = String(url);
      if (u.endsWith('/v1/health')) return healthResponse();
      queryCount++;
      // Second query fails with a bridge-side error.
      if (queryCount === 2) {
        return new Response(
          JSON.stringify({ error: { code: 'query_error', message: 'no such table' } }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        );
      }
      return arrowResponse();
    };
    const src = await mountComputeBridgeCatalog(engine as never, {
      label: 'demo',
      bridgeUrl: 'https://bridge.example.com',
      bearerToken: null,
      tables: [
        { name: 'sales', rowCap: 1000 },
        { name: 'missing', rowCap: 1000 },
        { name: 'customers', rowCap: 1000 },
      ],
      fetchImpl,
    });
    expect(src.tables).toHaveLength(2);
    expect(src.tables.map((t) => t.name)).toEqual(['sales', 'customers']);
    expect(src.bridgeCatalog?.tables).toHaveLength(2);
  });

  it('throws MountError when all picked tables fail', async () => {
    const engine = bridgeCatalogMockEngine();
    const fetchImpl: typeof fetch = async (url) => {
      const u = String(url);
      if (u.endsWith('/v1/health')) return healthResponse();
      return new Response(JSON.stringify({ error: { code: 'query_error', message: 'oops' } }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    };
    await expect(
      mountComputeBridgeCatalog(engine as never, {
        label: '',
        bridgeUrl: 'https://bridge.example.com',
        bearerToken: null,
        tables: [{ name: 'a' }, { name: 'b' }],
        fetchImpl,
      }),
    ).rejects.toThrow(/No tables mounted/);
    expect(engine.registerArrowBuffer).not.toHaveBeenCalled();
  });

  it('rejects empty inputs + non-http(s) URLs before any fetch', async () => {
    const engine = bridgeCatalogMockEngine();
    const fetchImpl: typeof fetch = async () => new Response('{}', { status: 200 });
    const base = {
      label: '',
      bridgeUrl: 'https://bridge.example.com',
      bearerToken: null,
      tables: [{ name: 'sales' }],
      fetchImpl,
    };
    await expect(
      mountComputeBridgeCatalog(engine as never, { ...base, bridgeUrl: '' }),
    ).rejects.toThrow(/Compute Bridge URL is required/);
    await expect(
      mountComputeBridgeCatalog(engine as never, { ...base, bridgeUrl: 'ftp://nope' }),
    ).rejects.toThrow(/must start with https/);
    await expect(
      mountComputeBridgeCatalog(engine as never, { ...base, tables: [] }),
    ).rejects.toThrow(/Pick at least one table/);
  });
});
