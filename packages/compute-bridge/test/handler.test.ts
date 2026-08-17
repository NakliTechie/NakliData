import { tableFromArrays, tableFromIPC, tableToIPC } from 'apache-arrow';
import { describe, expect, it, vi } from 'vitest';
import {
  BRIDGE_CAPABILITIES,
  BRIDGE_PROTOCOL_ID,
  BRIDGE_PROTOCOL_VERSION,
  type BridgeTable,
} from '../../../src/core/bridge/protocol.ts';
import type {
  BridgeBackend,
  BridgeDirectQueryRequest,
  BridgeResult,
  BridgeTableQueryRequest,
} from '../src/backend.ts';
import type { BridgeRuntimeConfig } from '../src/config.ts';
import { createBridgeHandler } from '../src/handler.ts';

const TOKEN = 'fixture-token-that-is-long-enough-for-tests';
const ORIGIN = 'https://workbench.example.test';
const SQL = 'SELECT order_id FROM main.analytics.orders';
const TABLE: BridgeTable = {
  name: 'orders',
  qualifiedName: 'main.analytics.orders',
  catalog: 'main',
  namespace: ['analytics'],
  kind: 'table',
  source: 'fixture',
  schema: [{ name: 'order_id', type: 'BIGINT' }],
};
const ARROW = tableToIPC(tableFromArrays({ order_id: [1, 2, 3] }), 'stream');

function config(overrides: Partial<BridgeRuntimeConfig> = {}): BridgeRuntimeConfig {
  return {
    name: 'fixture-bridge',
    version: '0.1.0-test',
    environment: 'test',
    allowedOrigins: new Set([ORIGIN]),
    authToken: TOKEN,
    maxRequestBytes: 1024,
    maxResultBytes: 1024 * 1024,
    maxQueryMilliseconds: 2_000,
    maxRowLimit: 1_000_000,
    ...overrides,
  };
}

function backend(overrides: Partial<BridgeBackend> = {}): BridgeBackend {
  const result = async (): Promise<BridgeResult> => ({ arrow: ARROW, rowCount: 3 });
  return {
    id: 'fixture',
    source: 'fixture',
    capabilities: Object.values(BRIDGE_CAPABILITIES),
    security: {
      readOnlyIdentity: true,
      objectAllowlist: true,
      downstreamCancellation: true,
    },
    readiness: async () => ({ ready: true, detail: null }),
    listTables: async () => [TABLE],
    query: result,
    queryTable: result,
    ...overrides,
  };
}

function request(path: string, init: RequestInit = {}, token = TOKEN): Request {
  const headers = new Headers(init.headers);
  headers.set('origin', ORIGIN);
  headers.set('authorization', `Bearer ${token}`);
  if (init.body) headers.set('content-type', 'application/json');
  return new Request(`https://bridge.example.test${path}`, { ...init, headers });
}

describe('Compute Bridge Worker handler', () => {
  it('negotiates protocol v2 and reports an independently ready backend', async () => {
    const handler = createBridgeHandler({ config: config(), backend: backend() });
    const response = await handler.fetch(request('/v1/health'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      protocol: BRIDGE_PROTOCOL_ID,
      protocol_version: BRIDGE_PROTOCOL_VERSION,
      name: 'fixture-bridge',
      version: '0.1.0-test',
      auth: 'bearer',
      single_tenant: true,
      capabilities: Object.values(BRIDGE_CAPABILITIES),
      ready: true,
      adapter: 'fixture',
    });
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('fails closed when no adapter is configured', async () => {
    const handler = createBridgeHandler({ config: config(), backend: null });
    const health = await handler.fetch(request('/v1/health'));
    const healthBody = await health.json<Record<string, unknown>>();
    expect(health.status).toBe(200);
    expect(healthBody.ready).toBe(false);
    expect(healthBody.capabilities).toEqual([]);

    const ready = await handler.fetch(request('/v1/ready'));
    expect(ready.status).toBe(503);
    const query = await handler.fetch(
      request('/v1/query', { method: 'POST', body: JSON.stringify({ sql: SQL }) }),
    );
    expect(query.status).toBe(503);
  });

  it('blocks data routes until every backend security prerequisite is declared', async () => {
    const handler = createBridgeHandler({
      config: config(),
      backend: backend({
        security: {
          readOnlyIdentity: false,
          objectAllowlist: true,
          downstreamCancellation: true,
        },
      }),
    });
    const health = await handler.fetch(request('/v1/health'));
    expect((await health.json<Record<string, unknown>>()).ready).toBe(false);
    const query = await handler.fetch(
      request('/v1/query', { method: 'POST', body: JSON.stringify({ sql: SQL }) }),
    );
    expect(query.status).toBe(503);
  });

  it('blocks routes whose capabilities are not advertised', async () => {
    const handler = createBridgeHandler({
      config: config(),
      backend: backend({ capabilities: [BRIDGE_CAPABILITIES.query] }),
    });
    expect((await handler.fetch(request('/v1/tables'))).status).toBe(501);
    const query = await handler.fetch(
      request('/v1/query', { method: 'POST', body: JSON.stringify({ sql: SQL }) }),
    );
    expect(query.status).toBe(501);
  });

  it('serves wire-format inventory and bounded Arrow for both query paths', async () => {
    const querySpy = vi.fn(async (_request: BridgeDirectQueryRequest) => ({
      arrow: ARROW,
      rowCount: 3,
    }));
    const tableSpy = vi.fn(async (_request: BridgeTableQueryRequest) => ({
      arrow: ARROW,
      rowCount: 3,
    }));
    const handler = createBridgeHandler({
      config: config(),
      backend: backend({ query: querySpy, queryTable: tableSpy }),
    });
    const inventory = await handler.fetch(request('/v1/tables'));
    expect(await inventory.json()).toEqual({
      tables: [
        {
          name: 'orders',
          qualified_name: 'main.analytics.orders',
          catalog: 'main',
          namespace: ['analytics'],
          kind: 'table',
          source: 'fixture',
          schema: [{ name: 'order_id', type: 'BIGINT' }],
        },
      ],
    });

    const direct = await handler.fetch(
      request('/v1/query', {
        method: 'POST',
        body: JSON.stringify({ sql: SQL, row_limit: 25 }),
      }),
    );
    expect(direct.status).toBe(200);
    expect(direct.headers.get('content-type')).toBe('application/vnd.apache.arrow.stream');
    expect(tableFromIPC(await direct.arrayBuffer()).numRows).toBe(3);
    expect(querySpy).toHaveBeenCalledWith(
      expect.objectContaining({ sql: SQL, rowLimit: 25, signal: expect.any(AbortSignal) }),
    );

    const objectQuery = await handler.fetch(
      request('/v1/table-query', {
        method: 'POST',
        body: JSON.stringify({ qualified_name: TABLE.qualifiedName, row_limit: 25 }),
      }),
    );
    expect(objectQuery.status).toBe(200);
    expect(tableSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        qualifiedName: TABLE.qualifiedName,
        rowLimit: 25,
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('rejects wrong secrets, origins, methods, fields, sizes, and row ceilings', async () => {
    const handler = createBridgeHandler({ config: config(), backend: backend() });
    expect((await handler.fetch(request('/v1/health', {}, 'wrong-token'))).status).toBe(401);

    const deniedOrigin = request('/v1/health');
    deniedOrigin.headers.set('origin', 'https://attacker.example.test');
    expect((await handler.fetch(deniedOrigin)).status).toBe(403);

    expect((await handler.fetch(request('/v1/query'))).status).toBe(404);
    expect(
      (
        await handler.fetch(
          request('/v1/query', {
            method: 'POST',
            body: JSON.stringify({ sql: SQL, row_limit: 2_000_000 }),
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handler.fetch(
          request('/v1/query', {
            method: 'POST',
            body: JSON.stringify({ sql: SQL, row_limit: 10, secret: TOKEN }),
          }),
        )
      ).status,
    ).toBe(400);
    const smallHandler = createBridgeHandler({
      config: config({ maxRequestBytes: 16 }),
      backend: backend(),
    });
    expect(
      (
        await smallHandler.fetch(
          request('/v1/query', { method: 'POST', body: JSON.stringify({ sql: SQL }) }),
        )
      ).status,
    ).toBe(413);
  });

  it('propagates client disconnect cancellation to the backend', async () => {
    let backendCancelled = false;
    let markBackendStarted: (() => void) | null = null;
    const backendStarted = new Promise<void>((resolve) => {
      markBackendStarted = resolve;
    });
    const handler = createBridgeHandler({
      config: config(),
      backend: backend({
        query: async ({ signal }) =>
          await new Promise<BridgeResult>((_resolve, reject) => {
            markBackendStarted?.();
            signal.addEventListener(
              'abort',
              () => {
                backendCancelled = true;
                reject(new Error('cancelled'));
              },
              { once: true },
            );
          }),
      }),
    });
    const controller = new AbortController();
    const pending = handler.fetch(
      request('/v1/query', {
        method: 'POST',
        body: JSON.stringify({ sql: SQL }),
        signal: controller.signal,
      }),
    );
    await backendStarted;
    controller.abort();
    const response = await pending;
    expect(response.status).toBe(499);
    expect(backendCancelled).toBe(true);
  });

  it('emits metadata-only audit events', async () => {
    const events: unknown[] = [];
    const handler = createBridgeHandler({
      config: config(),
      backend: backend(),
      audit: (event) => events.push(event),
    });
    await handler.fetch(
      request('/v1/query', {
        method: 'POST',
        body: JSON.stringify({ sql: SQL, row_limit: 25 }),
      }),
    );
    expect(events).toHaveLength(1);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(SQL);
    expect(serialized).not.toContain(TABLE.qualifiedName);
    expect(serialized).not.toContain(TOKEN);
    expect(Object.keys(events[0] as Record<string, unknown>).sort()).toEqual([
      'adapter',
      'durationMs',
      'event',
      'method',
      'requestId',
      'route',
      'status',
    ]);
  });
});
