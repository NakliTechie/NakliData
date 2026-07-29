import { describe, expect, it, vi } from 'vitest';
import { IcebergCatalogClient, IcebergCatalogError } from '../src/lazy/iceberg-rest-client.ts';

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

function withConfig(
  dataFetch: typeof fetch,
  config: unknown = { defaults: {}, overrides: {} },
): typeof fetch {
  return async (url, init) =>
    String(url).includes('/v1/config') ? jsonResponse(config) : await dataFetch(url, init);
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
    expect(result).toEqual({
      defaults: {},
      overrides: {},
      resolved: {},
      endpoints: null,
      prefix: null,
      namespaceSeparator: '%1F',
    });
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

  it('negotiates warehouse, route prefix, namespace separator, and endpoints once', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      calls.push(String(url));
      if (String(url).includes('/v1/config')) {
        return jsonResponse({
          defaults: { prefix: 'ignored-default' },
          overrides: {
            prefix: 'catalogs/sales west',
            'namespace-separator': '~',
          },
          endpoints: [
            'GET /v1/{prefix}/namespaces',
            'GET /v1/{prefix}/namespaces/{namespace}/tables',
          ],
        });
      }
      if (String(url).endsWith('/tables')) return jsonResponse({ identifiers: [] });
      return jsonResponse({ namespaces: [['analytics']] });
    };
    const client = new IcebergCatalogClient({
      catalogUrl: 'https://catalog.example.com/iceberg',
      bearerToken: null,
      warehouse: 'finance catalog',
      fetchImpl,
    });

    expect(await client.listNamespaces()).toEqual([['analytics']]);
    await client.listTables('lakehouse.public');

    expect(calls).toEqual([
      'https://catalog.example.com/iceberg/v1/config?warehouse=finance%20catalog',
      'https://catalog.example.com/iceberg/v1/catalogs/sales%20west/namespaces',
      'https://catalog.example.com/iceberg/v1/catalogs/sales%20west/namespaces/lakehouse~public/tables',
    ]);
  });

  it('listNamespaces() returns the namespaces array', async () => {
    const fetchImpl = withConfig(
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ namespaces: [['analytics'], ['lakehouse', 'public']] }),
        ) as never,
    );
    const client = new IcebergCatalogClient({
      catalogUrl: 'https://catalog.example.com',
      bearerToken: null,
      fetchImpl,
    });
    expect(await client.listNamespaces()).toEqual([['analytics'], ['lakehouse', 'public']]);
  });

  it('follows Iceberg next-page-token pagination', async () => {
    const calls: string[] = [];
    const fetchImpl = withConfig(async (url) => {
      calls.push(String(url));
      return calls.length === 1
        ? jsonResponse({ namespaces: [['analytics']], 'next-page-token': 'page 2' })
        : jsonResponse({ namespaces: [['finance']] });
    });
    const client = new IcebergCatalogClient({
      catalogUrl: 'https://catalog.example.com',
      bearerToken: null,
      fetchImpl,
    });
    expect(await client.listNamespaces()).toEqual([['analytics'], ['finance']]);
    expect(calls[1]).toBe('https://catalog.example.com/v1/namespaces?pageToken=page%202');
  });

  it('listTables() hits the right path and returns table names', async () => {
    const calls: string[] = [];
    const fetchImpl = withConfig(async (url) => {
      calls.push(String(url));
      return jsonResponse({
        identifiers: [
          { namespace: ['analytics'], name: 'sales' },
          { namespace: ['analytics'], name: 'customers' },
        ],
      });
    });
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
    const fetchImpl = withConfig(async (url) => {
      calls.push(String(url));
      return jsonResponse({ identifiers: [] });
    });
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
    const fetchImpl = withConfig(async () =>
      jsonResponse({
        'metadata-location': 's3://my-bucket/warehouse/sales/metadata/v3.metadata.json',
      }),
    );
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
    const fetchImpl = withConfig(async () =>
      jsonResponse({ metadataLocation: 'https://example.com/metadata.json' }),
    );
    const client = new IcebergCatalogClient({
      catalogUrl: 'https://catalog.example.com',
      bearerToken: null,
      fetchImpl,
    });
    const result = await client.loadTable('ns', 'tbl');
    expect(result.metadataLocation).toBe('https://example.com/metadata.json');
  });

  it('loadTable() throws when the response lacks a metadata-location', async () => {
    const fetchImpl = withConfig(async () => jsonResponse({}));
    const client = new IcebergCatalogClient({
      catalogUrl: 'https://catalog.example.com',
      bearerToken: null,
      fetchImpl,
    });
    await expect(client.loadTable('ns', 'tbl')).rejects.toThrow(/missing the metadata-location/);
  });

  it('surfaces non-2xx responses as IcebergCatalogError with status', async () => {
    const fetchImpl = withConfig(async () => textResponse('Unauthorized', 401));
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

  it('requests vended credentials but returns only non-secret access metadata', async () => {
    const calls: Array<{ headers: Record<string, string> }> = [];
    const fetchImpl = withConfig(async (_url, init) => {
      calls.push({ headers: Object.fromEntries(new Headers(init?.headers).entries()) });
      return jsonResponse({
        'metadata-location': 's3://bucket/table/metadata/v1.metadata.json',
        config: {
          'client.region': 'us-west-2',
          'expires-at-ms': '1785326400000',
          's3.access-key-id': 'temporary-access',
          's3.secret-access-key': 'do-not-persist-secret',
          's3.session-token': 'do-not-persist-session',
        },
        'storage-credentials': [
          {
            prefix: 's3://private-prefix-only/',
            config: {
              's3.access-key-id': 'scoped-access',
              's3.secret-access-key': 'scoped-secret',
              's3.session-token': 'scoped-session',
            },
          },
          {
            prefix: 'https://private-provider-prefix/',
            config: { bearer: 'unknown-provider-secret' },
          },
        ],
      });
    });
    const client = new IcebergCatalogClient({
      catalogUrl: 'https://catalog.example.com',
      bearerToken: null,
      accessDelegation: 'vended-credentials',
      fetchImpl,
    });

    const result = await client.loadTable('analytics', 'sales');

    expect(calls[0]?.headers['x-iceberg-access-delegation']).toBe('vended-credentials');
    expect(result.credentialVending).toEqual({
      requested: true,
      provided: true,
      providers: ['s3', 'unknown'],
      expiresAtMs: 1785326400000,
      configKeys: [
        'bearer',
        'client.region',
        'expires-at-ms',
        's3.access-key-id',
        's3.secret-access-key',
        's3.session-token',
      ],
      storageCredentialCount: 2,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('do-not-persist');
    expect(serialized).not.toContain('scoped-secret');
    expect(serialized).not.toContain('unknown-provider-secret');
    expect(serialized).not.toContain('s3://private-prefix-only/');
    expect(serialized).not.toContain('https://private-provider-prefix/');
  });

  it('rejects unsafe server-supplied route configuration', async () => {
    const unsafePrefix = new IcebergCatalogClient({
      catalogUrl: 'https://catalog.example.com',
      bearerToken: null,
      fetchImpl: async () =>
        jsonResponse({ defaults: {}, overrides: { prefix: '../other-service' } }),
    });
    await expect(unsafePrefix.config()).rejects.toMatchObject({ code: 'invalid_catalog' });

    for (const separator of ['%1F?redirect=', '%2F', '%00', '..', '%2E%2E']) {
      const unsafeSeparator = new IcebergCatalogClient({
        catalogUrl: 'https://catalog.example.com',
        bearerToken: null,
        fetchImpl: async () =>
          jsonResponse({
            defaults: {},
            overrides: { 'namespace-separator': separator },
          }),
      });
      await expect(unsafeSeparator.config()).rejects.toMatchObject({
        code: 'invalid_catalog',
      });
    }
  });

  it('fails before a data request when the catalog omits a required advertised endpoint', async () => {
    let dataRequests = 0;
    const client = new IcebergCatalogClient({
      catalogUrl: 'https://catalog.example.com',
      bearerToken: null,
      fetchImpl: withConfig(
        async () => {
          dataRequests++;
          return jsonResponse({ identifiers: [] });
        },
        {
          defaults: {},
          overrides: {},
          endpoints: ['GET /v1/{prefix}/namespaces'],
        },
      ),
    });

    await expect(client.listTables('analytics')).rejects.toMatchObject({
      code: 'unsupported_endpoint',
    });
    expect(dataRequests).toBe(0);
  });

  it('does not accept an unprefixed advertised endpoint for a prefixed route', async () => {
    let dataRequests = 0;
    const client = new IcebergCatalogClient({
      catalogUrl: 'https://catalog.example.com',
      bearerToken: null,
      fetchImpl: withConfig(
        async () => {
          dataRequests++;
          return jsonResponse({ namespaces: [] });
        },
        {
          defaults: {},
          overrides: { prefix: 'tenant' },
          endpoints: ['GET /v1/namespaces'],
        },
      ),
    });

    await expect(client.listNamespaces()).rejects.toMatchObject({
      code: 'unsupported_endpoint',
    });
    expect(dataRequests).toBe(0);
  });

  it('requires JSON Content-Type and enforces response-size limits', async () => {
    const wrongType = new IcebergCatalogClient({
      catalogUrl: 'https://catalog.example.com',
      bearerToken: null,
      fetchImpl: async () => new Response('{}', { headers: { 'content-type': 'text/plain' } }),
    });
    await expect(wrongType.config()).rejects.toMatchObject({ code: 'invalid_content_type' });

    const tooLarge = new IcebergCatalogClient({
      catalogUrl: 'https://catalog.example.com',
      bearerToken: null,
      maxJsonBytes: 4,
      fetchImpl: async () => jsonResponse({ defaults: {}, overrides: {} }),
    });
    await expect(tooLarge.config()).rejects.toMatchObject({ code: 'response_too_large' });
  });

  it('distinguishes cancellation from timeout', async () => {
    const pendingFetch: typeof fetch = async (_url, init) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true },
        );
      });
    const controller = new AbortController();
    const cancelled = new IcebergCatalogClient({
      catalogUrl: 'https://catalog.example.com',
      bearerToken: null,
      fetchImpl: pendingFetch,
      timeoutMs: 500,
    });
    const request = cancelled.config({ signal: controller.signal });
    controller.abort();
    await expect(request).rejects.toMatchObject({ code: 'cancelled' });

    const timed = new IcebergCatalogClient({
      catalogUrl: 'https://catalog.example.com',
      bearerToken: null,
      fetchImpl: pendingFetch,
      timeoutMs: 5,
    });
    await expect(timed.config()).rejects.toMatchObject({ code: 'timeout' });
  });

  it('keeps the deadline active while a JSON body is streaming', async () => {
    const client = new IcebergCatalogClient({
      catalogUrl: 'https://catalog.example.com',
      bearerToken: null,
      timeoutMs: 5,
      fetchImpl: async (_url, init) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"defaults":'));
              init?.signal?.addEventListener(
                'abort',
                () => controller.error(new DOMException('aborted', 'AbortError')),
                { once: true },
              );
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    });
    await expect(client.config()).rejects.toMatchObject({ code: 'timeout' });
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
