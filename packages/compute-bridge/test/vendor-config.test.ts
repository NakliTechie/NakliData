import { describe, expect, it } from 'vitest';
import { backendFromEnvironment } from '../src/vendor-config.ts';

function environment(overrides: Record<string, string> = {}): Env {
  return {
    ENVIRONMENT: 'development',
    BRIDGE_NAME: 'naklidata-compute-bridge',
    BRIDGE_VERSION: '0.1.0',
    BRIDGE_ADAPTER: 'unconfigured',
    BRIDGE_VENDOR_CONFIG_JSON: '{}',
    ALLOWED_ORIGINS: 'http://localhost:5173',
    MAX_REQUEST_BYTES: '65536',
    MAX_RESULT_BYTES: '33554432',
    MAX_QUERY_MILLISECONDS: '30000',
    BRIDGE_AUTH_TOKEN: 'fixture-bridge-token',
    DATABRICKS_TOKEN: 'replace-with-a-databricks-token',
    SNOWFLAKE_TOKEN: 'replace-with-a-snowflake-token',
    ...overrides,
  } as Env;
}

const allowedObject = {
  id: 'orders-v1',
  sql_name: 'main.analytics.orders',
  name: 'orders',
  catalog: 'main',
  namespace: ['analytics'],
  kind: 'table',
  schema: [{ name: 'order_id', type: 'BIGINT' }],
};
const allowedObjects = [allowedObject];
const runtimeBounds = { maxResultBytes: 33_554_432, requestTimeoutMs: 30_000 };

describe('vendor environment factory', () => {
  it('returns no backend for the checked-in unconfigured profile', () => {
    expect(backendFromEnvironment(environment(), runtimeBounds)).toBeNull();
  });

  it('parses Databricks configuration but keeps an unproven identity unready', async () => {
    const backend = backendFromEnvironment(
      environment({
        BRIDGE_ADAPTER: 'databricks-sql-warehouse',
        DATABRICKS_TOKEN: 'fixture.databricks.token',
        BRIDGE_VENDOR_CONFIG_JSON: JSON.stringify({
          workspace_url: 'https://dbc.example.test',
          warehouse_id: 'warehouse-1',
          read_only_identity_verified: false,
          allowed_objects: allowedObjects,
        }),
      }),
      runtimeBounds,
    );
    expect(backend?.id).toBe('databricks-sql-warehouse');
    expect(backend?.security.readOnlyIdentity).toBe(false);
    expect((await backend?.listTables(new AbortController().signal))?.[0]?.source).toBe(
      'databricks',
    );
  });

  it('parses Snowflake configuration without accepting placeholder secrets', () => {
    const config = JSON.stringify({
      account_url: 'https://acme.snowflakecomputing.com',
      token_type: 'OAUTH',
      read_only_identity_verified: true,
      allowed_objects: allowedObjects,
    });
    expect(() =>
      backendFromEnvironment(
        environment({
          BRIDGE_ADAPTER: 'snowflake-virtual-warehouse',
          BRIDGE_VENDOR_CONFIG_JSON: config,
        }),
        runtimeBounds,
      ),
    ).toThrow('SNOWFLAKE_TOKEN secret is not configured');
    expect(
      backendFromEnvironment(
        environment({
          BRIDGE_ADAPTER: 'snowflake-virtual-warehouse',
          SNOWFLAKE_TOKEN: 'fixture.snowflake.token',
          BRIDGE_VENDOR_CONFIG_JSON: config,
        }),
        runtimeBounds,
      )?.id,
    ).toBe('snowflake-virtual-warehouse');
  });

  it('rejects unknown adapters and malformed inventories', () => {
    expect(() =>
      backendFromEnvironment(environment({ BRIDGE_ADAPTER: 'unknown-adapter' }), runtimeBounds),
    ).toThrow('BRIDGE_ADAPTER is unsupported');
    expect(() =>
      backendFromEnvironment(
        environment({
          BRIDGE_ADAPTER: 'databricks-sql-warehouse',
          DATABRICKS_TOKEN: 'fixture.databricks.token',
          BRIDGE_VENDOR_CONFIG_JSON: JSON.stringify({
            workspace_url: 'https://dbc.example.test',
            warehouse_id: 'warehouse-1',
            allowed_objects: [{ ...allowedObject, sql_name: 'orders; DROP TABLE users' }],
          }),
        }),
        runtimeBounds,
      ),
    ).toThrow('two- or three-part unquoted identifiers');
  });

  it('rejects credentials and undeclared fields in non-secret vendor configuration', () => {
    expect(() =>
      backendFromEnvironment(
        environment({
          BRIDGE_ADAPTER: 'databricks-sql-warehouse',
          DATABRICKS_TOKEN: 'fixture.databricks.token',
          BRIDGE_VENDOR_CONFIG_JSON: JSON.stringify({
            workspace_url: 'https://dbc.example.test',
            warehouse_id: 'warehouse-1',
            read_only_identity_verified: false,
            allowed_objects: allowedObjects,
            bearer_token: 'must-not-live-here',
          }),
        }),
        runtimeBounds,
      ),
    ).toThrow('bridge vendor config.bearer_token is unsupported');

    expect(() =>
      backendFromEnvironment(
        environment({
          BRIDGE_ADAPTER: 'snowflake-virtual-warehouse',
          SNOWFLAKE_TOKEN: 'fixture.snowflake.token',
          BRIDGE_VENDOR_CONFIG_JSON: JSON.stringify({
            account_url: 'https://acme.snowflakecomputing.com',
            token_type: 'OAUTH',
            read_only_identity_verified: true,
            allowed_objects: [{ ...allowedObject, password: 'must-not-live-here' }],
          }),
        }),
        runtimeBounds,
      ),
    ).toThrow('allowed_objects[0].password is unsupported');
  });
});
