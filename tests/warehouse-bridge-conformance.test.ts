import { describe, expect, it } from 'vitest';
import {
  BRIDGE_CAPABILITIES,
  BRIDGE_PROTOCOL_ID,
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_QUERY_ROW_CAP_DEFAULT,
} from '../src/core/bridge/protocol.ts';
import { SOURCE_OPTIONS } from '../src/core/product-capabilities.ts';
import { BridgeClient } from '../src/lazy/bridge-client.ts';

const FIXTURE_TOKEN = 'fixture-bridge-token-never-use';
const ARROW_BYTES = new Uint8Array([0x41, 0x52, 0x52, 0x4f, 0x57]);

interface BridgeProfile {
  id: 'databricks-sql-warehouse' | 'snowflake-virtual-warehouse';
  bridgeUrl: string;
  source: 'databricks' | 'snowflake';
  catalog: string;
  namespace: string[];
  name: string;
  qualifiedName: string;
  directSql: string;
}

interface CapturedRequest {
  url: string;
  method: string;
  authorization: string | null;
  body: unknown;
}

const PROFILES: BridgeProfile[] = [
  {
    id: 'databricks-sql-warehouse',
    bridgeUrl: 'https://fixture-databricks-bridge.example.test',
    source: 'databricks',
    catalog: 'main',
    namespace: ['analytics'],
    name: 'orders',
    qualifiedName: 'main.analytics.orders',
    directSql: 'SELECT order_id FROM main.analytics.orders',
  },
  {
    id: 'snowflake-virtual-warehouse',
    bridgeUrl: 'https://fixture-snowflake-bridge.example.test',
    source: 'snowflake',
    catalog: 'ANALYTICS',
    namespace: ['PUBLIC'],
    name: 'ORDERS',
    qualifiedName: '"ANALYTICS"."PUBLIC"."ORDERS"',
    directSql: 'SELECT "ORDER_ID" FROM "ANALYTICS"."PUBLIC"."ORDERS"',
  },
];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });
}

function arrowResponse(): Response {
  return new Response(ARROW_BYTES.buffer as ArrayBuffer, {
    headers: { 'content-type': 'application/vnd.apache.arrow.stream' },
  });
}

function fixtureFetch(profile: BridgeProfile, requests: CapturedRequest[]): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    requests.push({
      url,
      method: init?.method ?? 'GET',
      authorization: new Headers(init?.headers).get('authorization'),
      body,
    });
    if (url === `${profile.bridgeUrl}/v1/health`) {
      return jsonResponse({
        protocol: BRIDGE_PROTOCOL_ID,
        protocol_version: BRIDGE_PROTOCOL_VERSION,
        name: `${profile.id}-fixture`,
        version: '0.0.0-fixture',
        auth: 'bearer',
        single_tenant: true,
        capabilities: Object.values(BRIDGE_CAPABILITIES),
      });
    }
    if (url === `${profile.bridgeUrl}/v1/tables`) {
      return jsonResponse({
        tables: [
          {
            catalog: profile.catalog,
            namespace: profile.namespace,
            name: profile.name,
            qualified_name: profile.qualifiedName,
            kind: 'table',
            source: profile.source,
            schema: [{ name: 'ORDER_ID', type: 'BIGINT' }],
          },
        ],
      });
    }
    if (url === `${profile.bridgeUrl}/v1/table-query` || url === `${profile.bridgeUrl}/v1/query`) {
      return arrowResponse();
    }
    return new Response('fixture route not found', {
      status: 404,
      headers: { 'content-type': 'text/plain' },
    });
  };
}

describe('credential-free direct warehouse bridge conformance fixtures', () => {
  for (const profile of PROFILES) {
    it(`${profile.id}: keeps vendor qualification opaque and bounds both query paths`, async () => {
      const requests: CapturedRequest[] = [];
      const client = new BridgeClient({
        bridgeUrl: profile.bridgeUrl,
        bearerToken: FIXTURE_TOKEN,
        fetchImpl: fixtureFetch(profile, requests),
      });

      const health = await client.health({
        requiredCapabilities: [
          BRIDGE_CAPABILITIES.tables,
          BRIDGE_CAPABILITIES.tableQuery,
          BRIDGE_CAPABILITIES.query,
          BRIDGE_CAPABILITIES.arrowIpc,
        ],
      });
      const tables = await client.listTables();
      const tableResult = await client.queryTable(tables[0]?.qualifiedName ?? '', 25_000);
      const directResult = await client.query(profile.directSql);

      expect(health.protocolVersion).toBe(2);
      expect(tables).toEqual([
        {
          catalog: profile.catalog,
          namespace: profile.namespace,
          name: profile.name,
          qualifiedName: profile.qualifiedName,
          kind: 'table',
          source: profile.source,
          schema: [{ name: 'ORDER_ID', type: 'BIGINT' }],
        },
      ]);
      expect(new Uint8Array(tableResult)).toEqual(ARROW_BYTES);
      expect(new Uint8Array(directResult)).toEqual(ARROW_BYTES);
      expect(requests.map(({ url, method }) => `${method} ${url}`)).toEqual([
        `GET ${profile.bridgeUrl}/v1/health`,
        `GET ${profile.bridgeUrl}/v1/tables`,
        `POST ${profile.bridgeUrl}/v1/table-query`,
        `POST ${profile.bridgeUrl}/v1/query`,
      ]);
      expect(requests[2]?.body).toEqual({
        qualified_name: profile.qualifiedName,
        row_limit: 25_000,
      });
      expect(requests[3]?.body).toEqual({
        sql: profile.directSql,
        row_limit: BRIDGE_QUERY_ROW_CAP_DEFAULT,
      });
      expect(requests.every((request) => request.authorization === `Bearer ${FIXTURE_TOKEN}`)).toBe(
        true,
      );
      expect(JSON.stringify({ health, tables, tableResult, directResult })).not.toContain(
        FIXTURE_TOKEN,
      );
    });
  }

  it('fails before catalog access when the bridge lacks structured table-query support', async () => {
    let dataRequests = 0;
    const client = new BridgeClient({
      bridgeUrl: 'https://incomplete-bridge.example.test',
      bearerToken: null,
      fetchImpl: async (input) => {
        if (String(input).endsWith('/v1/health')) {
          return jsonResponse({
            protocol: BRIDGE_PROTOCOL_ID,
            protocol_version: BRIDGE_PROTOCOL_VERSION,
            name: 'incomplete-fixture',
            version: '0',
            auth: 'none',
            single_tenant: true,
            capabilities: ['query', 'tables', 'arrow-ipc'],
          });
        }
        dataRequests++;
        return jsonResponse({ tables: [] });
      },
    });

    await expect(
      client.health({
        requiredCapabilities: [
          BRIDGE_CAPABILITIES.tables,
          BRIDGE_CAPABILITIES.tableQuery,
          BRIDGE_CAPABILITIES.arrowIpc,
        ],
      }),
    ).rejects.toMatchObject({ code: 'missing_capability' });
    expect(dataRequests).toBe(0);
  });

  it('keeps vendor-branded source cards absent after fixture success', () => {
    const branded = SOURCE_OPTIONS.filter((option) =>
      [option.id, option.action, option.label, option.hint, option.title].some((value) =>
        /databricks|snowflake/i.test(value),
      ),
    );
    expect(branded).toEqual([]);
    expect(
      SOURCE_OPTIONS.filter((option) => option.group === 'warehouse-compute').every(
        (option) => option.readiness === 'advanced' && /bridge/i.test(option.label),
      ),
    ).toBe(true);
  });
});
