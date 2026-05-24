import { describe, expect, it, vi } from 'vitest';
import { IcebergCatalogClient, IcebergCatalogError } from '../src/core/iceberg/rest-client.ts';

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain' },
  });
}

describe('IcebergCatalogClient (Wave 2 slice 3b)', () => {
  it('config() hits /v1/config with Bearer header when token supplied', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({
        url: String(url),
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
      });
      return jsonResponse({ defaults: {}, overrides: {} });
    };
    const client = new IcebergCatalogClient({
      catalogUrl: 'https://catalog.example.com/iceberg',
      bearerToken: 'token-abc',
      fetchImpl,
    });
    const result = await client.config();
    expect(result).toEqual({ defaults: {}, overrides: {} });
    expect(calls[0]?.url).toBe('https://catalog.example.com/iceberg/v1/config');
    expect(calls[0]?.headers.authorization).toBe('Bearer token-abc');
  });

  it('config() omits Authorization header when bearerToken is null', async () => {
    const calls: Array<{ headers: Record<string, string> }> = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      calls.push({ headers: Object.fromEntries(new Headers(init?.headers).entries()) });
      return jsonResponse({ defaults: {}, overrides: {} });
    };
    const client = new IcebergCatalogClient({
      catalogUrl: 'https://catalog.example.com',
      bearerToken: null,
      fetchImpl,
    });
    await client.config();
    expect(calls[0]?.headers.authorization).toBeUndefined();
  });

  it('trims trailing slashes off the catalog URL', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      calls.push(String(url));
      return jsonResponse({ defaults: {}, overrides: {} });
    };
    const client = new IcebergCatalogClient({
      catalogUrl: 'https://catalog.example.com/iceberg///',
      bearerToken: null,
      fetchImpl,
    });
    await client.config();
    expect(calls[0]).toBe('https://catalog.example.com/iceberg/v1/config');
  });

  it('listNamespaces() returns the namespaces array', async () => {
    const fetchImpl: typeof fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ namespaces: [['analytics'], ['lakehouse', 'public']] }),
      ) as never;
    const client = new IcebergCatalogClient({
      catalogUrl: 'https://catalog.example.com',
      bearerToken: null,
      fetchImpl,
    });
    expect(await client.listNamespaces()).toEqual([['analytics'], ['lakehouse', 'public']]);
  });

  it('listTables() hits the right path and returns table names', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      calls.push(String(url));
      return jsonResponse({
        identifiers: [
          { namespace: ['analytics'], name: 'sales' },
          { namespace: ['analytics'], name: 'customers' },
        ],
      });
    };
    const client = new IcebergCatalogClient({
      catalogUrl: 'https://catalog.example.com',
      bearerToken: null,
      fetchImpl,
    });
    expect(await client.listTables('analytics')).toEqual(['sales', 'customers']);
    expect(calls[0]).toBe('https://catalog.example.com/v1/namespaces/analytics/tables');
  });

  it('listTables() URL-encodes nested namespaces with %1F', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      calls.push(String(url));
      return jsonResponse({ identifiers: [] });
    };
    const client = new IcebergCatalogClient({
      catalogUrl: 'https://catalog.example.com',
      bearerToken: null,
      fetchImpl,
    });
    await client.listTables('lakehouse.public.subschema');
    expect(calls[0]).toBe(
      'https://catalog.example.com/v1/namespaces/lakehouse%1Fpublic%1Fsubschema/tables',
    );
  });

  it('loadTable() returns metadataLocation (kebab-case in response)', async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({
        'metadata-location': 's3://my-bucket/warehouse/sales/metadata/v3.metadata.json',
      });
    const client = new IcebergCatalogClient({
      catalogUrl: 'https://catalog.example.com',
      bearerToken: null,
      fetchImpl,
    });
    const result = await client.loadTable('analytics', 'sales');
    expect(result.metadataLocation).toBe(
      's3://my-bucket/warehouse/sales/metadata/v3.metadata.json',
    );
  });

  it('loadTable() accepts camelCase metadataLocation (some catalogs)', async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({ metadataLocation: 'https://example.com/metadata.json' });
    const client = new IcebergCatalogClient({
      catalogUrl: 'https://catalog.example.com',
      bearerToken: null,
      fetchImpl,
    });
    const result = await client.loadTable('ns', 'tbl');
    expect(result.metadataLocation).toBe('https://example.com/metadata.json');
  });

  it('loadTable() throws when the response lacks a metadata-location', async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({});
    const client = new IcebergCatalogClient({
      catalogUrl: 'https://catalog.example.com',
      bearerToken: null,
      fetchImpl,
    });
    await expect(client.loadTable('ns', 'tbl')).rejects.toThrow(/missing the metadata-location/);
  });

  it('surfaces non-2xx responses as IcebergCatalogError with status', async () => {
    const fetchImpl: typeof fetch = async () => textResponse('Unauthorized', 401);
    const client = new IcebergCatalogClient({
      catalogUrl: 'https://catalog.example.com',
      bearerToken: 'bad-token',
      fetchImpl,
    });
    await expect(client.listNamespaces()).rejects.toBeInstanceOf(IcebergCatalogError);
    try {
      await client.listNamespaces();
    } catch (err) {
      expect((err as IcebergCatalogError).status).toBe(401);
      expect((err as IcebergCatalogError).message).toContain('401');
    }
  });

  it('constructor rejects empty catalog URL', () => {
    expect(
      () =>
        new IcebergCatalogClient({
          catalogUrl: '',
          bearerToken: null,
        }),
    ).toThrow(/required/);
  });
});
