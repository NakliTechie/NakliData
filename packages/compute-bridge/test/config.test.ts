import { describe, expect, it } from 'vitest';
import { runtimeConfig } from '../src/config.ts';

function environment(allowedOrigins: string): Env {
  return {
    ENVIRONMENT: 'development',
    BRIDGE_NAME: 'naklidata-compute-bridge',
    BRIDGE_VERSION: '0.1.0',
    BRIDGE_ADAPTER: 'unconfigured',
    BRIDGE_VENDOR_CONFIG_JSON: '{}',
    ALLOWED_ORIGINS: allowedOrigins,
    MAX_REQUEST_BYTES: '65536',
    MAX_RESULT_BYTES: '33554432',
    MAX_QUERY_MILLISECONDS: '30000',
    BRIDGE_AUTH_TOKEN: 'fixture-bridge-token',
    DATABRICKS_TOKEN: 'replace-with-a-databricks-token',
    SNOWFLAKE_TOKEN: 'replace-with-a-snowflake-token',
  } as Env;
}

describe('Compute Bridge runtime configuration', () => {
  it('accepts exact HTTPS origins and loopback HTTP development origins', () => {
    expect([...runtimeConfig(environment('https://app.example.test')).allowedOrigins]).toEqual([
      'https://app.example.test',
    ]);
    expect([
      ...runtimeConfig(environment('http://localhost:5173,http://127.0.0.1:5173,http://[::1]:5173'))
        .allowedOrigins,
    ]).toHaveLength(3);
  });

  it.each([
    'http://app.example.test',
    'https://app.example.test/path',
    'https://user:password@app.example.test',
  ])('rejects an unsafe or non-origin ALLOWED_ORIGINS entry: %s', (origin) => {
    expect(() => runtimeConfig(environment(origin))).toThrow(
      'ALLOWED_ORIGINS contains an invalid origin',
    );
  });
});
