import { describe, expect, it } from 'vitest';
import { SOURCE_OPTIONS, sourceOptionForAction } from '../src/core/product-capabilities.ts';
import {
  IcebergCatalogClient,
  type LoadTableResult,
  type VendedStorageCredential,
} from '../src/lazy/iceberg-rest-client.ts';

const FIXTURE_TOKEN = 'fixture-bearer-token-never-use';
const REQUIRED_ENDPOINTS = [
  'GET /v1/{prefix}/namespaces',
  'GET /v1/{prefix}/namespaces/{namespace}/tables',
  'GET /v1/{prefix}/namespaces/{namespace}/tables/{table}',
] as const;

interface WarehouseProfile {
  id: 'databricks-unity-catalog' | 'snowflake-open-catalog';
  catalogUrl: string;
  warehouse: string;
  prefix: string;
  namespace: string[];
  table: string;
  metadataLocation: string;
  loadConfig: Record<string, string>;
  storageCredentials: Array<{
    prefix: string;
    config: Record<string, string>;
  }>;
  expectedProviders: string[];
  expectedExpiry: number;
  expectedRequestUrls: string[];
}

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
}

interface ConformanceResult {
  configurationPrefix: string | null;
  namespaces: string[][];
  tables: string[];
  load: LoadTableResult;
  requests: CapturedRequest[];
}

const PROFILES: WarehouseProfile[] = [
  {
    id: 'databricks-unity-catalog',
    catalogUrl: 'https://fixture.cloud.databricks.com/api/2.1/unity-catalog/iceberg-rest',
    warehouse: 'sales_catalog',
    prefix: 'catalogs/sales_catalog',
    namespace: ['analytics'],
    table: 'orders',
    metadataLocation: 's3://fixture-databricks/orders/metadata/v1.metadata.json',
    loadConfig: {
      'client.region': 'us-west-2',
      'expires-at-ms': '1785326400000',
      's3.access-key-id': 'fixture-databricks-access',
      's3.secret-access-key': 'fixture-databricks-secret',
      's3.session-token': 'fixture-databricks-session',
    },
    storageCredentials: [],
    expectedProviders: ['s3'],
    expectedExpiry: 1785326400000,
    expectedRequestUrls: [
      'https://fixture.cloud.databricks.com/api/2.1/unity-catalog/iceberg-rest/v1/config?warehouse=sales_catalog',
      'https://fixture.cloud.databricks.com/api/2.1/unity-catalog/iceberg-rest/v1/catalogs/sales_catalog/namespaces',
      'https://fixture.cloud.databricks.com/api/2.1/unity-catalog/iceberg-rest/v1/catalogs/sales_catalog/namespaces/analytics/tables',
      'https://fixture.cloud.databricks.com/api/2.1/unity-catalog/iceberg-rest/v1/catalogs/sales_catalog/namespaces/analytics/tables/orders',
    ],
  },
  {
    id: 'snowflake-open-catalog',
    catalogUrl: 'https://fixture-org-fixture-account.snowflakecomputing.com/polaris/api/catalog',
    warehouse: 'analytics_catalog',
    prefix: 'analytics_catalog',
    namespace: ['finance', 'mart'],
    table: 'revenue',
    metadataLocation:
      'abfss://warehouse@fixtureaccount.dfs.core.windows.net/revenue/metadata/v2.metadata.json',
    loadConfig: {},
    storageCredentials: [
      {
        prefix: 'abfss://restricted@fixtureaccount.dfs.core.windows.net/revenue/',
        config: {
          'adls.sas-token.fixtureaccount.dfs.core.windows.net': 'fixture-snowflake-sas-secret',
          'adls.sas-token-expires-at-ms.fixtureaccount.dfs.core.windows.net': '1785322800000',
        },
      },
    ],
    expectedProviders: ['azure'],
    expectedExpiry: 1785322800000,
    expectedRequestUrls: [
      'https://fixture-org-fixture-account.snowflakecomputing.com/polaris/api/catalog/v1/config?warehouse=analytics_catalog',
      'https://fixture-org-fixture-account.snowflakecomputing.com/polaris/api/catalog/v1/analytics_catalog/namespaces',
      'https://fixture-org-fixture-account.snowflakecomputing.com/polaris/api/catalog/v1/analytics_catalog/namespaces/finance%1Fmart/tables',
      'https://fixture-org-fixture-account.snowflakecomputing.com/polaris/api/catalog/v1/analytics_catalog/namespaces/finance%1Fmart/tables/revenue',
    ],
  },
];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });
}

function fixtureFetch(profile: WarehouseProfile, requests: CapturedRequest[]): typeof fetch {
  const namespacePath = profile.namespace.map(encodeURIComponent).join('%1F');
  const routeRoot = `${profile.catalogUrl}/v1/${profile.prefix}`;

  return async (input, init) => {
    const url = String(input);
    requests.push({
      url,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });

    if (url === `${profile.catalogUrl}/v1/config?warehouse=${profile.warehouse}`) {
      return jsonResponse({
        defaults: { 'namespace-separator': '%1F' },
        overrides: { prefix: profile.prefix },
        endpoints: REQUIRED_ENDPOINTS,
      });
    }
    if (url === `${routeRoot}/namespaces`) {
      return jsonResponse({ namespaces: [profile.namespace] });
    }
    if (url === `${routeRoot}/namespaces/${namespacePath}/tables`) {
      return jsonResponse({
        identifiers: [{ namespace: profile.namespace, name: profile.table }],
      });
    }
    if (url === `${routeRoot}/namespaces/${namespacePath}/tables/${profile.table}`) {
      return jsonResponse({
        'metadata-location': profile.metadataLocation,
        metadata: {
          'format-version': 2,
          'table-uuid': `00000000-0000-4000-8000-${profile.id === 'databricks-unity-catalog' ? '000000000001' : '000000000002'}`,
          location: profile.metadataLocation.replace(/\/metadata\/[^/]+$/, ''),
          'last-sequence-number': 0,
          'last-updated-ms': 1785320000000,
          'last-column-id': 1,
          schemas: [
            {
              type: 'struct',
              'schema-id': 0,
              fields: [{ id: 1, name: 'id', required: true, type: 'long' }],
            },
          ],
          'current-schema-id': 0,
          'partition-specs': [{ 'spec-id': 0, fields: [] }],
          'default-spec-id': 0,
          'last-partition-id': 999,
          properties: {},
          'current-snapshot-id': -1,
          snapshots: [],
          'snapshot-log': [],
          'metadata-log': [],
          'sort-orders': [{ 'order-id': 0, fields: [] }],
          'default-sort-order-id': 0,
          refs: {},
        },
        config: profile.loadConfig,
        'storage-credentials': profile.storageCredentials,
      });
    }
    return new Response('fixture route not found', {
      status: 404,
      headers: { 'content-type': 'text/plain' },
    });
  };
}

async function runConformance(profile: WarehouseProfile): Promise<ConformanceResult> {
  const requests: CapturedRequest[] = [];
  const client = new IcebergCatalogClient({
    catalogUrl: profile.catalogUrl,
    bearerToken: FIXTURE_TOKEN,
    warehouse: profile.warehouse,
    accessDelegation: 'vended-credentials',
    fetchImpl: fixtureFetch(profile, requests),
  });

  const configuration = await client.config();
  const namespaces = await client.listNamespaces();
  const tables = await client.listTables(profile.namespace.join('.'));
  const load = await client.loadTable(profile.namespace.join('.'), profile.table);

  return {
    configurationPrefix: configuration.prefix,
    namespaces,
    tables,
    load,
    requests,
  };
}

describe('credential-free warehouse conformance fixtures', () => {
  for (const profile of PROFILES) {
    it(`${profile.id}: negotiates config, browses, and loads without leaking fixture secrets`, async () => {
      const result = await runConformance(profile);

      expect(result.configurationPrefix).toBe(profile.prefix);
      expect(result.namespaces).toEqual([profile.namespace]);
      expect(result.tables).toEqual([profile.table]);
      expect(result.load.metadataLocation).toBe(profile.metadataLocation);
      expect(result.load.credentialVending).toMatchObject({
        requested: true,
        provided: true,
        providers: profile.expectedProviders,
        expiresAtMs: profile.expectedExpiry,
        storageCredentialCount: profile.storageCredentials.length,
      });
      const appliedCredentials: VendedStorageCredential[][] = [];
      await result.load.credentialLease?.applyTo(
        {
          replace: async (credentials) => {
            appliedCredentials.push(
              credentials.map((credential) => ({
                provider: credential.provider,
                prefix: credential.prefix,
                config: { ...credential.config },
              })),
            );
          },
          clear: async () => {
            appliedCredentials.length = 0;
          },
        },
        {
          nowMs: profile.expectedExpiry - 120_000,
          minValidityMs: 60_000,
        },
      );
      expect(appliedCredentials).toHaveLength(1);
      expect(appliedCredentials[0]?.[0]?.provider).toBe(profile.expectedProviders[0]);

      expect(result.requests).toHaveLength(4);
      expect(result.requests.map((request) => request.url)).toEqual(profile.expectedRequestUrls);
      for (const request of result.requests) {
        expect(request.headers.authorization).toBe(`Bearer ${FIXTURE_TOKEN}`);
      }
      expect(
        result.requests
          .slice(0, -1)
          .every((request) => request.headers['x-iceberg-access-delegation'] === undefined),
      ).toBe(true);
      expect(result.requests.at(-1)?.headers['x-iceberg-access-delegation']).toBe(
        'vended-credentials',
      );

      const publicResult = JSON.stringify({
        configurationPrefix: result.configurationPrefix,
        namespaces: result.namespaces,
        tables: result.tables,
        load: result.load,
      });
      expect(publicResult).not.toContain(FIXTURE_TOKEN);
      for (const secret of [
        'fixture-databricks-access',
        'fixture-databricks-secret',
        'fixture-databricks-session',
        'fixture-snowflake-sas-secret',
        'restricted@fixtureaccount',
      ]) {
        expect(publicResult).not.toContain(secret);
      }
    });
  }

  it('fails closed when a vendor-shaped config omits load-table capability', async () => {
    const profile = PROFILES[0];
    if (!profile) throw new Error('Databricks conformance fixture is missing.');
    let dataRequests = 0;
    const client = new IcebergCatalogClient({
      catalogUrl: profile.catalogUrl,
      bearerToken: FIXTURE_TOKEN,
      warehouse: profile.warehouse,
      accessDelegation: 'vended-credentials',
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes('/v1/config')) {
          return jsonResponse({
            defaults: {},
            overrides: { prefix: profile.prefix },
            endpoints: REQUIRED_ENDPOINTS.slice(0, 2),
          });
        }
        dataRequests++;
        return jsonResponse({});
      },
    });

    await expect(client.loadTable('analytics', 'orders')).rejects.toMatchObject({
      code: 'unsupported_endpoint',
    });
    expect(dataRequests).toBe(0);
  });

  it('keeps REST and branded profiles unavailable after fixture-only success', () => {
    expect(sourceOptionForAction('mount-iceberg')).toMatchObject({
      readiness: 'available',
    });
    expect(sourceOptionForAction('mount-iceberg-catalog')).toMatchObject({
      readiness: 'unavailable',
    });
    const brandedOptions = SOURCE_OPTIONS.filter((option) =>
      [option.id, option.action, option.label, option.hint, option.title].some((value) =>
        /databricks|snowflake/i.test(value),
      ),
    );
    expect(brandedOptions.every((option) => option.readiness === 'unavailable')).toBe(true);
  });
});
