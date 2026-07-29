import { describe, expect, it } from 'vitest';
import {
  BRIDGE_CAPABILITIES,
  BRIDGE_PROTOCOL_ID,
  BRIDGE_PROTOCOL_VERSION,
} from '../src/core/bridge/protocol.ts';
import { BridgeClient, BridgeError } from '../src/lazy/bridge-client.ts';

function jsonResponse(
  body: unknown,
  init: { status?: number; contentType?: string } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': init.contentType ?? 'application/json' },
  });
}

function healthBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    protocol: BRIDGE_PROTOCOL_ID,
    protocol_version: BRIDGE_PROTOCOL_VERSION,
    name: 'nakli-compute',
    version: '1.0.0',
    auth: 'bearer',
    single_tenant: true,
    capabilities: ['query', 'table-query', 'tables', 'arrow-ipc'],
    ...overrides,
  };
}

function arrowResponse(
  bytes: Uint8Array,
  contentType = 'application/vnd.apache.arrow.stream',
): Response {
  return new Response(bytes.buffer as ArrayBuffer, {
    status: 200,
    headers: { 'content-type': contentType },
  });
}

describe('BridgeClient protocol boundary', () => {
  it('negotiates the explicit protocol and sends a Bearer header', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({
        url: String(url),
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
      });
      return jsonResponse(healthBody());
    };
    const client = new BridgeClient({
      bridgeUrl: 'https://bridge.example.com:8088///',
      bearerToken: 'token-abc',
      fetchImpl,
    });
    const health = await client.health({
      requiredCapabilities: [
        BRIDGE_CAPABILITIES.query,
        BRIDGE_CAPABILITIES.tableQuery,
        BRIDGE_CAPABILITIES.tables,
        BRIDGE_CAPABILITIES.arrowIpc,
      ],
    });
    expect(health.protocol).toBe(BRIDGE_PROTOCOL_ID);
    expect(health.protocolVersion).toBe(BRIDGE_PROTOCOL_VERSION);
    expect(health.singleTenant).toBe(true);
    expect(calls[0]?.url).toBe('https://bridge.example.com:8088/v1/health');
    expect(calls[0]?.headers.authorization).toBe('Bearer token-abc');
  });

  it('omits Authorization when bearerToken is null', async () => {
    let authorization: string | null = 'unexpected';
    const client = new BridgeClient({
      bridgeUrl: 'https://bridge.example.com',
      bearerToken: null,
      fetchImpl: async (_url, init) => {
        authorization = new Headers(init?.headers).get('authorization');
        return jsonResponse(healthBody({ auth: 'none' }));
      },
    });
    await client.health();
    expect(authorization).toBeNull();
  });

  it('rejects missing, foreign, or unsupported protocol identities', async () => {
    for (const body of [
      {},
      healthBody({ protocol: 'other-bridge' }),
      healthBody({ protocol_version: BRIDGE_PROTOCOL_VERSION - 1 }),
    ]) {
      const client = new BridgeClient({
        bridgeUrl: 'https://bridge.example.com',
        bearerToken: null,
        fetchImpl: async () => jsonResponse(body),
      });
      await expect(client.health()).rejects.toMatchObject({
        name: 'BridgeError',
        code: 'protocol_mismatch',
      });
    }
  });

  it('rejects a bridge that lacks a capability required by the flow', async () => {
    const client = new BridgeClient({
      bridgeUrl: 'https://bridge.example.com',
      bearerToken: null,
      fetchImpl: async () => jsonResponse(healthBody({ capabilities: ['query'] })),
    });
    await expect(
      client.health({ requiredCapabilities: [BRIDGE_CAPABILITIES.arrowIpc] }),
    ).rejects.toMatchObject({ code: 'missing_capability' });
  });

  it('requires bridge-owned qualified names for hierarchical catalog objects', async () => {
    const client = new BridgeClient({
      bridgeUrl: 'https://bridge.example.com',
      bearerToken: null,
      fetchImpl: async () =>
        jsonResponse({
          tables: [
            {
              catalog: 'prod',
              namespace: ['finance', 'ap'],
              name: 'invoices',
              qualified_name: 'prod.finance.ap.invoices',
              kind: 'view',
              source: 'databricks',
              schema: [
                { name: 'vendor_id', type: 'VARCHAR' },
                { name: 'amount', type: 'DECIMAL(18,2)' },
              ],
            },
            {
              catalog: 'prod',
              namespace: 'sales.public',
              name: 'orders',
              qualified_name: '"prod"."sales"."orders"',
              schema: [],
            },
          ],
        }),
    });
    const tables = await client.listTables();
    expect(tables[0]).toMatchObject({
      catalog: 'prod',
      namespace: ['finance', 'ap'],
      name: 'invoices',
      qualifiedName: 'prod.finance.ap.invoices',
      kind: 'view',
      source: 'databricks',
    });
    expect(tables[1]?.qualifiedName).toBe('"prod"."sales"."orders"');
  });

  it('fails the whole catalog on a malformed descriptor', async () => {
    const client = new BridgeClient({
      bridgeUrl: 'https://bridge.example.com',
      bearerToken: null,
      fetchImpl: async () => jsonResponse({ tables: [{ name: 'ok' }, { schema: [] }] }),
    });
    await expect(client.listTables()).rejects.toMatchObject({ code: 'protocol_mismatch' });
  });

  it('POSTs trimmed SQL and accepts only Arrow IPC', async () => {
    const bytes = new Uint8Array([0x41, 0x52, 0x52, 0x4f, 0x57]);
    let body = '';
    const client = new BridgeClient({
      bridgeUrl: 'https://bridge.example.com',
      bearerToken: 'tok',
      fetchImpl: async (_url, init) => {
        body = String(init?.body);
        return arrowResponse(bytes);
      },
    });
    expect(new Uint8Array(await client.query('  SELECT 1  '))).toEqual(bytes);
    expect(JSON.parse(body)).toEqual({ sql: 'SELECT 1', row_limit: 100_000 });
  });

  it('sends opaque table identifiers structurally without dialect rewriting', async () => {
    const bytes = new Uint8Array([0x41]);
    const requests: Array<{ url: string; body: unknown }> = [];
    const client = new BridgeClient({
      bridgeUrl: 'https://bridge.example.com',
      bearerToken: null,
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return arrowResponse(bytes);
      },
    });

    const qualifiedName = '  "ANALYTICS"."PUBLIC"."ORDERS"  ';
    expect(new Uint8Array(await client.queryTable(qualifiedName, 25_000))).toEqual(bytes);
    expect(requests).toEqual([
      {
        url: 'https://bridge.example.com/v1/table-query',
        body: {
          qualified_name: qualifiedName,
          row_limit: 25_000,
        },
      },
    ]);
  });

  it('rejects write-shaped SQL and invalid row limits before network access', async () => {
    let fetches = 0;
    const client = new BridgeClient({
      bridgeUrl: 'https://bridge.example.com',
      bearerToken: null,
      fetchImpl: async () => {
        fetches++;
        return arrowResponse(new Uint8Array([0x41]));
      },
    });

    for (const sql of [
      'DROP TABLE prod.orders',
      'WITH changed AS (DELETE FROM prod.orders RETURNING *) SELECT * FROM changed',
      'SELECT 1; INSERT INTO audit VALUES (1)',
    ]) {
      await expect(client.query(sql)).rejects.toMatchObject({ code: 'unsafe_query' });
    }
    await expect(client.query('SELECT 1', { rowLimit: 1_000_001 })).rejects.toMatchObject({
      code: 'invalid_query',
    });
    await expect(client.queryTable('prod.orders', 0)).rejects.toMatchObject({
      code: 'invalid_query',
    });
    await expect(client.queryTable('prod.\norders', 100)).rejects.toMatchObject({
      code: 'invalid_query',
    });
    expect(fetches).toBe(0);
  });

  it('rejects wrong success Content-Type values', async () => {
    const healthClient = new BridgeClient({
      bridgeUrl: 'https://bridge.example.com',
      bearerToken: null,
      fetchImpl: async () => jsonResponse(healthBody(), { contentType: 'text/plain' }),
    });
    await expect(healthClient.health()).rejects.toMatchObject({ code: 'invalid_content_type' });

    const queryClient = new BridgeClient({
      bridgeUrl: 'https://bridge.example.com',
      bearerToken: null,
      fetchImpl: async () => arrowResponse(new Uint8Array([1]), 'application/octet-stream'),
    });
    await expect(queryClient.query('SELECT 1')).rejects.toMatchObject({
      code: 'invalid_content_type',
    });
  });

  it('enforces declared and streamed response byte limits', async () => {
    const declaredClient = new BridgeClient({
      bridgeUrl: 'https://bridge.example.com',
      bearerToken: null,
      maxArrowBytes: 4,
      fetchImpl: async () =>
        new Response(new Uint8Array([1, 2, 3, 4, 5]).buffer, {
          headers: {
            'content-type': 'application/vnd.apache.arrow.stream',
            'content-length': '5',
          },
        }),
    });
    await expect(declaredClient.query('SELECT 1')).rejects.toMatchObject({
      code: 'response_too_large',
    });

    const streamedClient = new BridgeClient({
      bridgeUrl: 'https://bridge.example.com',
      bearerToken: null,
      maxJsonBytes: 8,
      fetchImpl: async () => jsonResponse(healthBody()),
    });
    await expect(streamedClient.health()).rejects.toMatchObject({ code: 'response_too_large' });
  });

  it('distinguishes cancellation from deadline expiry', async () => {
    const pendingFetch: typeof fetch = async (_url, init) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true },
        );
      });

    const controller = new AbortController();
    const cancelled = new BridgeClient({
      bridgeUrl: 'https://bridge.example.com',
      bearerToken: null,
      fetchImpl: pendingFetch,
      timeoutMs: 500,
    });
    const cancellation = cancelled.health({ signal: controller.signal });
    controller.abort();
    await expect(cancellation).rejects.toMatchObject({ code: 'cancelled' });

    const timed = new BridgeClient({
      bridgeUrl: 'https://bridge.example.com',
      bearerToken: null,
      fetchImpl: pendingFetch,
      timeoutMs: 5,
    });
    await expect(timed.health()).rejects.toMatchObject({ code: 'timeout' });
  });

  it('keeps the deadline active while an Arrow body is streaming', async () => {
    const client = new BridgeClient({
      bridgeUrl: 'https://bridge.example.com',
      bearerToken: null,
      timeoutMs: 5,
      fetchImpl: async (_url, init) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([0x41]));
              init?.signal?.addEventListener(
                'abort',
                () => controller.error(new DOMException('aborted', 'AbortError')),
                { once: true },
              );
            },
          }),
          { headers: { 'content-type': 'application/vnd.apache.arrow.stream' } },
        ),
    });
    await expect(client.query('SELECT 1')).rejects.toMatchObject({ code: 'timeout' });
  });

  it('redacts and categorizes non-2xx bridge errors', async () => {
    const client = new BridgeClient({
      bridgeUrl: 'https://bridge.example.com',
      bearerToken: 'secret-token',
      fetchImpl: async () =>
        jsonResponse(
          {
            error: {
              code: 'unauthorized',
              message: 'Authorization: Bearer secret-token rejected',
            },
          },
          { status: 401 },
        ),
    });
    try {
      await client.health();
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(BridgeError);
      expect(error).toMatchObject({ status: 401, code: 'unauthorized' });
      expect((error as Error).message).not.toContain('secret-token');
    }
  });

  it('rejects empty URL and SQL inputs before fetch', async () => {
    expect(() => new BridgeClient({ bridgeUrl: '', bearerToken: null })).toThrow(/required/);
    const client = new BridgeClient({
      bridgeUrl: 'https://bridge.example.com',
      bearerToken: null,
      fetchImpl: async () => {
        throw new Error('fetch should not run');
      },
    });
    await expect(client.query('  ')).rejects.toMatchObject({ code: 'invalid_query' });
  });
});
