import { describe, expect, it, vi } from 'vitest';
import {
  IcebergCatalogClient,
  type LoadTableResult,
  VendedCredentialLease,
  VendedCredentialSession,
  type VendedCredentialTarget,
  type VendedStorageCredential,
} from '../src/lazy/iceberg-rest-client.ts';

const NOW_MS = 1_800_000_000_000;
const USABLE_EXPIRY_MS = NOW_MS + 5 * 60_000;

function loadResult(
  body: Record<string, unknown>,
  accessDelegation: 'none' | 'vended-credentials' = 'vended-credentials',
): Promise<LoadTableResult> {
  const fetchImpl: typeof fetch = async (input) =>
    String(input).endsWith('/v1/config')
      ? jsonResponse({ defaults: {}, overrides: {} })
      : jsonResponse({
          'metadata-location': 's3://fixture/table/metadata/v1.metadata.json',
          ...body,
        });
  return new IcebergCatalogClient({
    catalogUrl: 'https://catalog.example.test',
    bearerToken: null,
    accessDelegation,
    fetchImpl,
  }).loadTable('analytics', 'orders');
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });
}

function targetRecorder(): {
  target: VendedCredentialTarget;
  replacements: VendedStorageCredential[][];
  clear: ReturnType<typeof vi.fn>;
} {
  const replacements: VendedStorageCredential[][] = [];
  const clear = vi.fn(async () => {});
  return {
    replacements,
    clear,
    target: {
      replace: async (credentials) => {
        replacements.push(
          credentials.map((credential) => ({
            provider: credential.provider,
            prefix: credential.prefix,
            config: { ...credential.config },
          })),
        );
      },
      clear,
    },
  };
}

describe('opaque vended credential leases', () => {
  it('keeps Databricks-shaped inline S3 secrets out of public serialization', async () => {
    const secret = 'inline-s3-secret-never-serialize';
    const result = await loadResult({
      config: {
        'client.region': 'us-west-2',
        'expires-at-ms': String(USABLE_EXPIRY_MS),
        's3.access-key-id': 'temporary-access',
        's3.secret-access-key': secret,
        's3.session-token': 'temporary-session',
      },
    });

    expect(result.credentialLease).toBeInstanceOf(VendedCredentialLease);
    expect(Object.keys(result)).toEqual(['metadataLocation', 'credentialVending']);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result.credentialLease)).not.toContain(secret);
    expect({ ...result }).not.toHaveProperty('credentialLease');

    const recorder = targetRecorder();
    await result.credentialLease?.applyTo(recorder.target, { nowMs: NOW_MS });
    expect(recorder.replacements).toEqual([
      [
        {
          provider: 's3',
          prefix: null,
          config: {
            'client.region': 'us-west-2',
            'expires-at-ms': String(USABLE_EXPIRY_MS),
            's3.access-key-id': 'temporary-access',
            's3.secret-access-key': secret,
            's3.session-token': 'temporary-session',
          },
        },
      ],
    ]);
  });

  it.each([
    {
      name: 'GCS',
      metadataLocation: 'gs://warehouse/table/metadata/v1.json',
      prefix: 'gs://restricted/table/',
      config: {
        'gcs.oauth2.token': 'temporary-gcs-token',
        'gcs.oauth2.token-expires-at': String(USABLE_EXPIRY_MS),
      },
      provider: 'gcs',
    },
    {
      name: 'ADLS',
      metadataLocation: 'abfss://warehouse@fixture.dfs.core.windows.net/table/metadata/v1.json',
      prefix: 'abfss://restricted@fixture.dfs.core.windows.net/table/',
      config: {
        'adls.sas-token.fixture.dfs.core.windows.net': 'temporary-adls-token',
        'adls.sas-token-expires-at-ms.fixture.dfs.core.windows.net': String(USABLE_EXPIRY_MS),
      },
      provider: 'azure',
    },
  ])('applies a complete $name storage credential atomically', async (fixture) => {
    const fetchImpl: typeof fetch = async (input) =>
      String(input).endsWith('/v1/config')
        ? jsonResponse({ defaults: {}, overrides: {} })
        : jsonResponse({
            'metadata-location': fixture.metadataLocation,
            'storage-credentials': [{ prefix: fixture.prefix, config: fixture.config }],
          });
    const result = await new IcebergCatalogClient({
      catalogUrl: 'https://catalog.example.test',
      bearerToken: null,
      accessDelegation: 'vended-credentials',
      fetchImpl,
    }).loadTable('analytics', 'orders');
    const recorder = targetRecorder();

    await result.credentialLease?.applyTo(recorder.target, { nowMs: NOW_MS });

    expect(recorder.replacements).toEqual([
      [
        {
          provider: fixture.provider,
          prefix: fixture.prefix,
          config: fixture.config,
        },
      ],
    ]);
  });

  it('fails before target application when expiry is absent or too close', async () => {
    const missingExpiry = await loadResult({
      config: {
        's3.access-key-id': 'access',
        's3.secret-access-key': 'secret',
        's3.session-token': 'session',
      },
    });
    const nearExpiry = await loadResult({
      config: {
        'expires-at-ms': String(NOW_MS + 60_000),
        's3.access-key-id': 'access',
        's3.secret-access-key': 'secret',
        's3.session-token': 'session',
      },
    });
    const recorder = targetRecorder();

    await expect(
      missingExpiry.credentialLease?.applyTo(recorder.target, { nowMs: NOW_MS }),
    ).rejects.toMatchObject({ code: 'credential_refresh_required' });
    await expect(
      nearExpiry.credentialLease?.applyTo(recorder.target, { nowMs: NOW_MS }),
    ).rejects.toMatchObject({ code: 'credential_refresh_required' });
    expect(recorder.replacements).toHaveLength(0);
    expect(recorder.clear).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'incomplete S3',
      prefix: 's3://restricted/table/',
      config: {
        's3.access-key-id': 'access',
        's3.secret-access-key': 'secret',
        'expires-at-ms': String(USABLE_EXPIRY_MS),
      },
      code: 'incomplete_credentials',
    },
    {
      name: 'empty S3 secret',
      prefix: 's3://restricted/table/',
      config: {
        's3.access-key-id': 'access',
        's3.secret-access-key': ' ',
        's3.session-token': 'session',
        'expires-at-ms': String(USABLE_EXPIRY_MS),
      },
      code: 'incomplete_credentials',
    },
    {
      name: 'unsupported provider',
      prefix: 'https://private.example.test/table/',
      config: {
        credential: 'opaque-unsupported-secret',
        'expires-at-ms': String(USABLE_EXPIRY_MS),
      },
      code: 'unsupported_credential_provider',
    },
  ])('rejects an $name shape before target application', async (fixture) => {
    const result = await loadResult({
      'storage-credentials': [{ prefix: fixture.prefix, config: fixture.config }],
    });
    const recorder = targetRecorder();

    await expect(
      result.credentialLease?.applyTo(recorder.target, { nowMs: NOW_MS }),
    ).rejects.toMatchObject({ code: fixture.code });
    expect(recorder.replacements).toHaveLength(0);
    expect(recorder.clear).not.toHaveBeenCalled();
  });

  it('clears a target and redacts its failure when atomic replacement fails', async () => {
    const secret = 'never-echo-this-s3-secret';
    const result = await loadResult({
      config: {
        'expires-at-ms': String(USABLE_EXPIRY_MS),
        's3.access-key-id': 'access',
        's3.secret-access-key': secret,
        's3.session-token': 'session',
      },
    });
    const clear = vi.fn(async () => {});
    const target: VendedCredentialTarget = {
      replace: async () => {
        throw new Error(`engine rejected ${secret}`);
      },
      clear,
    };

    let caught: unknown;
    try {
      await result.credentialLease?.applyTo(target, { nowMs: NOW_MS });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: 'credential_apply_failed' });
    expect(String(caught)).not.toContain(secret);
    expect(clear).toHaveBeenCalledOnce();
  });

  it('revocation drops the capability and prevents reapplication', async () => {
    const result = await loadResult({
      config: {
        'expires-at-ms': String(USABLE_EXPIRY_MS),
        's3.access-key-id': 'access',
        's3.secret-access-key': 'secret',
        's3.session-token': 'session',
      },
    });
    const recorder = targetRecorder();

    result.credentialLease?.revoke();

    expect(result.credentialLease?.revoked).toBe(true);
    await expect(
      result.credentialLease?.applyTo(recorder.target, { nowMs: NOW_MS }),
    ).rejects.toMatchObject({ code: 'credential_revoked' });
    expect(recorder.replacements).toHaveLength(0);
  });

  it('refreshes a near-expiry lease before replacing the target credential', async () => {
    const expiring = new VendedCredentialLease(
      [
        {
          provider: 's3',
          prefix: 's3://restricted/table/',
          config: {
            's3.access-key-id': 'first-access',
            's3.secret-access-key': 'first-secret',
            's3.session-token': 'first-session',
          },
        },
      ],
      NOW_MS + 30_000,
    );
    const refreshed = new VendedCredentialLease(
      [
        {
          provider: 's3',
          prefix: 's3://restricted/table/',
          config: {
            's3.access-key-id': 'second-access',
            's3.secret-access-key': 'second-secret',
            's3.session-token': 'second-session',
          },
        },
      ],
      USABLE_EXPIRY_MS,
    );
    const loads = [
      resultWithLease(expiring, 's3://fixture/table/metadata/v1.json'),
      resultWithLease(refreshed, 's3://fixture/table/metadata/v2.json'),
    ];
    const load = vi.fn(async () => {
      const result = loads.shift();
      if (!result) throw new Error('unexpected extra refresh');
      return result;
    });
    const session = new VendedCredentialSession(load);
    const recorder = targetRecorder();

    await expect(
      session.applyTo(recorder.target, {
        nowMs: NOW_MS - 120_000,
        minValidityMs: 60_000,
      }),
    ).resolves.toMatchObject({
      metadataLocation: 's3://fixture/table/metadata/v1.json',
    });
    const safeResult = await session.applyTo(recorder.target, {
      nowMs: NOW_MS,
      minValidityMs: 60_000,
    });

    expect(load).toHaveBeenCalledTimes(2);
    expect(expiring.revoked).toBe(true);
    expect(safeResult).toMatchObject({
      metadataLocation: 's3://fixture/table/metadata/v2.json',
    });
    expect(JSON.stringify(safeResult)).not.toContain('second-secret');
    expect(recorder.replacements.at(-1)?.[0]?.config['s3.secret-access-key']).toBe('second-secret');

    await session.revoke();
    expect(refreshed.revoked).toBe(true);
    expect(recorder.clear).toHaveBeenCalledOnce();
  });

  it('clears the active target when refresh fails', async () => {
    const lease = new VendedCredentialLease(
      [
        {
          provider: 's3',
          prefix: 's3://restricted/table/',
          config: {
            's3.access-key-id': 'first-access',
            's3.secret-access-key': 'first-secret',
            's3.session-token': 'first-session',
          },
        },
      ],
      NOW_MS + 90_000,
    );
    const load = vi
      .fn<() => Promise<LoadTableResult>>()
      .mockResolvedValueOnce(resultWithLease(lease, 's3://fixture/table/metadata/v1.json'))
      .mockRejectedValueOnce(new Error('refresh unavailable'));
    const session = new VendedCredentialSession(load);
    const recorder = targetRecorder();
    await session.applyTo(recorder.target, { nowMs: NOW_MS, minValidityMs: 60_000 });

    await expect(
      session.applyTo(recorder.target, {
        nowMs: NOW_MS + 60_000,
        minValidityMs: 60_000,
      }),
    ).rejects.toThrow('refresh unavailable');

    expect(lease.revoked).toBe(true);
    expect(recorder.clear).toHaveBeenCalledOnce();
  });

  it('clears the previous target before applying credentials to a new target', async () => {
    const lease = new VendedCredentialLease(
      [
        {
          provider: 's3',
          prefix: 's3://restricted/table/',
          config: {
            's3.access-key-id': 'access',
            's3.secret-access-key': 'secret',
            's3.session-token': 'session',
          },
        },
      ],
      USABLE_EXPIRY_MS,
    );
    const session = new VendedCredentialSession(async () =>
      resultWithLease(lease, 's3://fixture/table/metadata/v1.json'),
    );
    const first = targetRecorder();
    const second = targetRecorder();

    await session.applyTo(first.target, { nowMs: NOW_MS });
    await session.applyTo(second.target, { nowMs: NOW_MS });

    expect(first.clear).toHaveBeenCalledOnce();
    expect(second.replacements).toHaveLength(1);
  });

  it('does not create a lease when delegation was not requested', async () => {
    const result = await loadResult(
      {
        config: {
          'expires-at-ms': String(USABLE_EXPIRY_MS),
          's3.access-key-id': 'access',
          's3.secret-access-key': 'secret',
          's3.session-token': 'session',
        },
      },
      'none',
    );

    expect(result.credentialVending).toMatchObject({
      requested: false,
      provided: true,
    });
    expect(result.credentialLease).toBeNull();
  });

  it('does not treat a refresh endpoint alone as a provided credential', async () => {
    const result = await loadResult({
      config: {
        'refresh-credentials-endpoint': '/v1/credentials',
        'expires-at-ms': String(USABLE_EXPIRY_MS),
      },
      'storage-credentials': [
        {
          prefix: 's3://restricted/table/',
          config: {
            'refresh-credentials-endpoint': '/v1/credentials/storage',
          },
        },
      ],
    });

    expect(result.credentialVending).toMatchObject({
      requested: true,
      provided: false,
      storageCredentialCount: 1,
    });
    expect(result.credentialLease).toBeNull();
  });
});

function resultWithLease(
  credentialLease: VendedCredentialLease,
  metadataLocation: string,
): LoadTableResult {
  return {
    metadataLocation,
    credentialVending: {
      requested: true,
      provided: true,
      providers: ['s3'],
      expiresAtMs: credentialLease.expiresAtMs,
      configKeys: [],
      storageCredentialCount: 1,
    },
    credentialLease,
  };
}
