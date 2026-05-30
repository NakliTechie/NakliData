import { describe, expect, it } from 'vitest';
import { BridgeClient, BridgeError } from '../src/core/bridge/bridge-client.ts';

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

function arrowResponse(bytes: Uint8Array): Response {
  // TS's lib BodyInit narrowed to exclude raw Uint8Array in some envs;
  // pass the underlying ArrayBuffer instead. Runtime is equivalent.
  return new Response(bytes.buffer as ArrayBuffer, {
    status: 200,
    headers: { 'content-type': 'application/vnd.apache.arrow.stream' },
  });
}

describe('BridgeClient (W3.4a)', () => {
  it('health() hits /v1/health with Bearer header when token supplied', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({
        url: String(url),
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
      });
      return jsonResponse({
        name: 'nakli-compute',
        version: '0.1.0',
        auth: 'bearer',
        single_tenant: true,
        capabilities: ['query', 'tables', 'arrow-ipc'],
      });
    };
    const client = new BridgeClient({
      bridgeUrl: 'https://bridge.example.com:8088',
      bearerToken: 'token-abc',
      fetchImpl,
    });
    const h = await client.health();
    expect(h.name).toBe('nakli-compute');
    expect(h.auth).toBe('bearer');
    expect(h.singleTenant).toBe(true);
    expect(h.capabilities).toEqual(['query', 'tables', 'arrow-ipc']);
    expect(calls[0]?.url).toBe('https://bridge.example.com:8088/v1/health');
    expect(calls[0]?.headers.authorization).toBe('Bearer token-abc');
  });

  it('omits Authorization header when bearerToken is null', async () => {
    const calls: Array<{ headers: Record<string, string> }> = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      calls.push({ headers: Object.fromEntries(new Headers(init?.headers).entries()) });
      return jsonResponse({ name: 'x', version: '0', auth: 'none', capabilities: [] });
    };
    const client = new BridgeClient({
      bridgeUrl: 'https://bridge.example.com',
      bearerToken: null,
      fetchImpl,
    });
    await client.health();
    expect(calls[0]?.headers.authorization).toBeUndefined();
  });

  it('trims trailing slashes off the bridge URL', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      calls.push(String(url));
      return jsonResponse({ name: 'x', version: '0', auth: 'none', capabilities: [] });
    };
    const client = new BridgeClient({
      bridgeUrl: 'https://bridge.example.com:8088///',
      bearerToken: null,
      fetchImpl,
    });
    await client.health();
    expect(calls[0]).toBe('https://bridge.example.com:8088/v1/health');
  });

  it('health() falls back gracefully on missing fields', async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({});
    const client = new BridgeClient({
      bridgeUrl: 'https://bridge.example.com',
      bearerToken: null,
      fetchImpl,
    });
    const h = await client.health();
    expect(h.singleTenant).toBe(true); // default
    expect(h.capabilities).toEqual([]);
  });

  it('health() accepts camelCase singleTenant (catalog quirk)', async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({ name: 'x', version: '0', auth: 'bearer', singleTenant: false });
    const client = new BridgeClient({
      bridgeUrl: 'https://bridge.example.com',
      bearerToken: null,
      fetchImpl,
    });
    const h = await client.health();
    expect(h.singleTenant).toBe(false);
  });

  it('listTables() parses the catalog shape and drops malformed entries', async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({
        tables: [
          {
            name: 'sales',
            source: 'iceberg',
            schema: [
              { name: 'gstin', type: 'VARCHAR' },
              { name: 'amount', type: 'DECIMAL(18,2)' },
              { name: 'bad', type: 123 }, // type not a string — drop the column
            ],
          },
          // Missing name → drop whole row.
          { source: 'iceberg', schema: [] },
        ],
      });
    const client = new BridgeClient({
      bridgeUrl: 'https://bridge.example.com',
      bearerToken: null,
      fetchImpl,
    });
    const tables = await client.listTables();
    expect(tables).toHaveLength(1);
    expect(tables[0]?.name).toBe('sales');
    expect(tables[0]?.source).toBe('iceberg');
    expect(tables[0]?.schema.map((c) => c.name)).toEqual(['gstin', 'amount']);
  });

  it('query() POSTs JSON and returns the Arrow IPC bytes', async () => {
    const fakeArrowBytes = new Uint8Array([0x41, 0x52, 0x52, 0x4f, 0x57]); // "ARROW"
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return arrowResponse(fakeArrowBytes);
    };
    const client = new BridgeClient({
      bridgeUrl: 'https://bridge.example.com',
      bearerToken: 'tok',
      fetchImpl,
    });
    const result = await client.query('SELECT 1');
    expect(new Uint8Array(result)).toEqual(fakeArrowBytes);
    expect(calls[0]?.url).toBe('https://bridge.example.com/v1/query');
    expect(calls[0]?.init?.method).toBe('POST');
    const sent = JSON.parse(String(calls[0]?.init?.body)) as { sql: string };
    expect(sent.sql).toBe('SELECT 1');
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('authorization')).toBe('Bearer tok');
  });

  it('surfaces non-2xx responses as BridgeError with status + code', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'bad token' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    const client = new BridgeClient({
      bridgeUrl: 'https://bridge.example.com',
      bearerToken: 'bad',
      fetchImpl,
    });
    await expect(client.health()).rejects.toBeInstanceOf(BridgeError);
    try {
      await client.health();
    } catch (err) {
      const e = err as BridgeError;
      expect(e.status).toBe(401);
      expect(e.code).toBe('unauthorized');
      expect(e.message).toContain('bad token');
    }
  });

  it('falls back to status text when the error body is not JSON', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response('Plain text 500', { status: 500, headers: { 'content-type': 'text/plain' } });
    const client = new BridgeClient({
      bridgeUrl: 'https://bridge.example.com',
      bearerToken: null,
      fetchImpl,
    });
    try {
      await client.query('SELECT 1');
      throw new Error('should have thrown');
    } catch (err) {
      const e = err as BridgeError;
      expect(e.status).toBe(500);
      expect(e.message).toContain('500');
      expect(e.message).toContain('Plain text 500');
    }
  });

  it('constructor rejects empty bridge URL', () => {
    expect(() => new BridgeClient({ bridgeUrl: '', bearerToken: null })).toThrow(/required/);
  });
});
