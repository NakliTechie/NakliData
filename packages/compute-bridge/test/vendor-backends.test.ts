import { tableFromArrays, tableFromIPC, tableToIPC } from 'apache-arrow';
import { describe, expect, it, vi } from 'vitest';
import type { BridgeAllowedObject } from '../src/vendor-backends.ts';
import { createDatabricksBackend, createSnowflakeBackend } from '../src/vendor-backends.ts';

const allowedObject = (source: string): BridgeAllowedObject => ({
  sqlName: 'main.analytics.orders',
  table: {
    name: 'orders',
    qualifiedName: 'opaque-orders-v1',
    catalog: 'main',
    namespace: ['analytics'],
    kind: 'table',
    source,
    schema: [{ name: 'order_id', type: 'BIGINT' }],
  },
});

describe('packaged vendor backends', () => {
  it('assembles Databricks Arrow without forwarding authorization to signed links', async () => {
    const arrow = tableToIPC(tableFromArrays({ order_id: [1, 2] }), 'stream');
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init: init ?? {} });
      if (url.startsWith('https://signed.example/')) {
        return new Response(arrow, {
          headers: { 'content-type': 'binary/octet-stream' },
        });
      }
      return new Response(
        JSON.stringify({
          statement_id: 'statement-1',
          status: { state: 'SUCCEEDED' },
          manifest: {
            format: 'ARROW_STREAM',
            total_row_count: 2,
            total_byte_count: arrow.byteLength,
            total_chunk_count: 1,
            truncated: false,
            chunks: [
              {
                chunk_index: 0,
                row_offset: 0,
                row_count: 2,
                byte_count: arrow.byteLength,
              },
            ],
          },
          result: {
            external_links: [
              {
                chunk_index: 0,
                row_offset: 0,
                row_count: 2,
                byte_count: arrow.byteLength,
                external_link: 'https://signed.example/result?signature=secret',
              },
            ],
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    const backend = createDatabricksBackend({
      workspaceUrl: 'https://dbc.example.test',
      warehouseId: 'warehouse-1',
      bearerToken: 'fixture.databricks.token',
      allowedObjects: [allowedObject('databricks')],
      readOnlyIdentityVerified: true,
      maxResultBytes: 1024,
      fetchImpl,
    });

    const result = await backend.queryTable({
      requestId: 'request-1',
      qualifiedName: 'opaque-orders-v1',
      rowLimit: 10,
      signal: new AbortController().signal,
    });

    expect(result.rowCount).toBe(2);
    expect(tableFromIPC(result.arrow).numRows).toBe(2);
    expect(JSON.parse(String(calls[0]?.init.body)).statement).toBe(
      'SELECT * FROM main.analytics.orders',
    );
    expect(JSON.parse(String(calls[0]?.init.body)).byte_limit).toBe(1024);
    const signed = calls.find((call) => call.url.startsWith('https://signed.example/'));
    expect(signed?.init.headers).not.toHaveProperty('Authorization');
    expect(signed?.init).not.toHaveProperty('credentials');
    expect(signed?.init.redirect).toBe('manual');
  });

  it('encodes a complete Snowflake JSONv2 result as deterministic Arrow', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            statementHandle: 'statement-1',
            resultSetMetaData: {
              numRows: 2,
              format: 'jsonv2',
              partitionInfo: [{ rowCount: 2, uncompressedSize: 32 }],
              rowType: [
                {
                  name: 'ORDER_ID',
                  type: 'fixed',
                  nullable: false,
                  precision: 38,
                  scale: 0,
                },
              ],
            },
            data: [['1'], ['2']],
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    ) as typeof fetch;
    const backend = createSnowflakeBackend({
      accountUrl: 'https://acme.snowflakecomputing.com',
      bearerToken: 'fixture.snowflake.token',
      tokenType: 'OAUTH',
      warehouse: 'COMPUTE_WH',
      database: 'MAIN',
      schema: 'ANALYTICS',
      role: 'NAKLIDATA_READER',
      allowedObjects: [allowedObject('snowflake')],
      readOnlyIdentityVerified: true,
      fetchImpl,
    });

    const left = await backend.query({
      requestId: 'request-1',
      sql: 'SELECT order_id FROM main.analytics.orders',
      rowLimit: 10,
      signal: new AbortController().signal,
    });
    const right = await backend.query({
      requestId: 'request-2',
      sql: 'SELECT order_id FROM main.analytics.orders',
      rowLimit: 10,
      signal: new AbortController().signal,
    });

    expect(left.arrow).toEqual(right.arrow);
    expect(left.rowCount).toBe(2);
    expect(tableFromIPC(left.arrow).numRows).toBe(2);
  });

  it('rejects unknown opaque inventory IDs before vendor access', async () => {
    const fetchImpl = vi.fn() as typeof fetch;
    const backend = createDatabricksBackend({
      workspaceUrl: 'https://dbc.example.test',
      warehouseId: 'warehouse-1',
      bearerToken: 'fixture.databricks.token',
      allowedObjects: [allowedObject('databricks')],
      readOnlyIdentityVerified: true,
      fetchImpl,
    });
    await expect(
      backend.queryTable({
        requestId: 'request-1',
        qualifiedName: 'unknown',
        rowLimit: 10,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'object_denied', status: 403 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
