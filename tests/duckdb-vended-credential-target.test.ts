import { describe, expect, it, vi } from 'vitest';
import {
  type DuckDbCredentialExecutor,
  DuckDbVendedCredentialTarget,
  type VendedStorageCredential,
} from '../src/lazy/iceberg-rest-client.ts';

function executorRecorder(): {
  executor: DuckDbCredentialExecutor;
  ensureExtension: ReturnType<typeof vi.fn>;
  exec: ReturnType<typeof vi.fn>;
} {
  const ensureExtension = vi.fn(async (_name: string) => {});
  const exec = vi.fn(async (_sql: string) => {});
  return {
    executor: { ensureExtension, exec },
    ensureExtension,
    exec,
  };
}

function s3Credential(overrides: Partial<VendedStorageCredential> = {}): VendedStorageCredential {
  return {
    provider: 's3',
    prefix: 's3://restricted/table/',
    config: {
      'client.region': 'us-west-2',
      's3.access-key-id': "temporary'access",
      's3.secret-access-key': "temporary'secret",
      's3.session-token': "temporary'session",
    },
    ...overrides,
  };
}

function gcsCredential(overrides: Partial<VendedStorageCredential> = {}): VendedStorageCredential {
  return {
    provider: 'gcs',
    prefix: 'gs://restricted/table/',
    config: {
      'gcs.oauth2.token': "temporary'oauth",
    },
    ...overrides,
  };
}

describe('DuckDB vended credential target', () => {
  it('maps scoped S3 and GCS credentials to temporary DuckDB secrets', async () => {
    const recorder = executorRecorder();
    const target = new DuckDbVendedCredentialTarget(recorder.executor);

    await target.replace([s3Credential(), gcsCredential()]);

    expect(recorder.ensureExtension).toHaveBeenCalledOnce();
    expect(recorder.ensureExtension).toHaveBeenCalledWith('httpfs');
    expect(recorder.exec).toHaveBeenCalledOnce();
    const sql = String(recorder.exec.mock.calls[0]?.[0]);
    expect(sql).toContain('BEGIN TRANSACTION;');
    expect(sql).toContain('CREATE SECRET __naklidata_vended_s3_0');
    expect(sql).toContain('TYPE s3');
    expect(sql).toContain("KEY_ID 'temporary''access'");
    expect(sql).toContain("SECRET 'temporary''secret'");
    expect(sql).toContain("SESSION_TOKEN 'temporary''session'");
    expect(sql).toContain("REGION 'us-west-2'");
    expect(sql).toContain("SCOPE 's3://restricted/table/'");
    expect(sql).toContain('CREATE SECRET __naklidata_vended_gcs_1');
    expect(sql).toContain('TYPE gcs');
    expect(sql).toContain("BEARER_TOKEN 'temporary''oauth'");
    expect(sql).toContain("SCOPE 'gs://restricted/table/'");
    expect(sql).toMatch(/COMMIT;\s*$/);
    expect(sql).not.toContain('PERSISTENT');
    expect(JSON.parse(JSON.stringify(target))).toEqual({
      opaque: true,
      activeCredentialCount: 2,
    });
    expect(JSON.stringify(target)).not.toContain("temporary'secret");
  });

  it('rotates all target-owned names in one transaction and clears them transactionally', async () => {
    const recorder = executorRecorder();
    const target = new DuckDbVendedCredentialTarget(recorder.executor);

    await target.replace([s3Credential()]);
    await target.replace([gcsCredential()]);
    await target.clear();

    expect(recorder.ensureExtension).toHaveBeenCalledTimes(2);
    expect(recorder.exec).toHaveBeenCalledTimes(3);
    const rotation = String(recorder.exec.mock.calls[1]?.[0]);
    expect(rotation).toContain('BEGIN TRANSACTION;');
    expect(rotation).toContain('DROP SECRET IF EXISTS __naklidata_vended_s3_0;');
    expect(rotation).toContain('CREATE SECRET __naklidata_vended_gcs_0');
    expect(rotation).toMatch(/COMMIT;\s*$/);
    const clear = String(recorder.exec.mock.calls[2]?.[0]);
    expect(clear).toBe(
      'BEGIN TRANSACTION;\nDROP SECRET IF EXISTS __naklidata_vended_gcs_0;\nCOMMIT;',
    );
    expect(target.toJSON()).toEqual({ opaque: true, activeCredentialCount: 0 });
  });

  it('rolls back, drops candidate names, and redacts a failed replacement', async () => {
    const secret = 'secret-that-must-not-escape';
    const recorder = executorRecorder();
    recorder.exec.mockRejectedValueOnce(new Error(`DuckDB echoed ${secret}`));
    const target = new DuckDbVendedCredentialTarget(recorder.executor);

    let caught: unknown;
    try {
      await target.replace([
        s3Credential({
          config: {
            's3.access-key-id': 'access',
            's3.secret-access-key': secret,
            's3.session-token': 'session',
          },
        }),
      ]);
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ code: 'replace_failed' });
    expect(String(caught)).not.toContain(secret);
    expect(recorder.exec).toHaveBeenCalledTimes(3);
    expect(recorder.exec.mock.calls[1]?.[0]).toBe('ROLLBACK');
    expect(recorder.exec.mock.calls[2]?.[0]).toContain(
      'DROP SECRET IF EXISTS __naklidata_vended_s3_0',
    );
    expect(target.toJSON()).toEqual({ opaque: true, activeCredentialCount: 0 });
  });

  it('reports cleanup uncertainty without leaking the rejected credential', async () => {
    const secret = 'cleanup-secret-that-must-not-escape';
    const recorder = executorRecorder();
    recorder.exec.mockRejectedValue(new Error(`DuckDB echoed ${secret}`));
    const target = new DuckDbVendedCredentialTarget(recorder.executor);

    let caught: unknown;
    try {
      await target.replace([
        s3Credential({
          config: {
            's3.access-key-id': 'access',
            's3.secret-access-key': secret,
            's3.session-token': 'session',
          },
        }),
      ]);
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ code: 'clear_failed' });
    expect(String(caught)).not.toContain(secret);
    expect(recorder.exec.mock.calls.map(([sql]) => sql)).toEqual([
      expect.stringContaining('CREATE SECRET __naklidata_vended_s3_0'),
      'ROLLBACK',
      expect.stringContaining('DROP SECRET IF EXISTS __naklidata_vended_s3_0'),
      'ROLLBACK',
    ]);
  });

  it.each([
    {
      name: 'empty credential set',
      credentials: [],
      code: 'credentials_required',
    },
    {
      name: 'unknown provider',
      credentials: [
        {
          provider: 'unknown',
          prefix: 'https://private.example.test/table/',
          config: { credential: 'opaque' },
        },
      ],
      code: 'unsupported_provider',
    },
    {
      name: 'Azure provider',
      credentials: [
        {
          provider: 'azure',
          prefix: 'abfss://warehouse@fixture.dfs.core.windows.net/table/',
          config: {
            'adls.sas-token.fixture.dfs.core.windows.net': 'temporary',
          },
        },
      ],
      code: 'azure_wasm_unavailable',
    },
    {
      name: 'invalid S3 scope',
      credentials: [s3Credential({ prefix: 'https://bucket/table/' })],
      code: 'invalid_scope',
    },
    {
      name: 'incomplete S3 credentials',
      credentials: [
        s3Credential({
          config: {
            's3.access-key-id': 'access',
            's3.secret-access-key': 'secret',
          },
        }),
      ],
      code: 'incomplete_credentials',
    },
    {
      name: 'duplicate provider scope',
      credentials: [s3Credential(), s3Credential()],
      code: 'ambiguous_scope',
    },
    {
      name: 'unscoped credential overlapping a scoped credential',
      credentials: [s3Credential({ prefix: null }), s3Credential()],
      code: 'ambiguous_scope',
    },
    {
      name: 'nested provider scopes',
      credentials: [
        s3Credential({ prefix: 's3://restricted/' }),
        s3Credential({ prefix: 's3://restricted/table/' }),
      ],
      code: 'ambiguous_scope',
    },
    {
      name: 'equivalent GCS scheme aliases',
      credentials: [
        gcsCredential({ prefix: 'gs://restricted/table/' }),
        gcsCredential({ prefix: 'gcs://RESTRICTED/table/' }),
      ],
      code: 'ambiguous_scope',
    },
  ])('rejects $name before the executor sees credential data', async (fixture) => {
    const recorder = executorRecorder();
    const target = new DuckDbVendedCredentialTarget(recorder.executor);

    await expect(
      target.replace(fixture.credentials as VendedStorageCredential[]),
    ).rejects.toMatchObject({
      code: fixture.code,
    });
    expect(recorder.ensureExtension).not.toHaveBeenCalled();
    expect(recorder.exec).not.toHaveBeenCalled();
  });

  it('clears an active target when a later replacement is invalid', async () => {
    const recorder = executorRecorder();
    const target = new DuckDbVendedCredentialTarget(recorder.executor);
    await target.replace([s3Credential()]);

    await expect(
      target.replace([
        {
          provider: 'unknown',
          prefix: null,
          config: { credential: 'opaque' },
        },
      ]),
    ).rejects.toMatchObject({ code: 'unsupported_provider' });

    expect(recorder.exec).toHaveBeenCalledTimes(2);
    expect(recorder.exec.mock.calls[1]?.[0]).toContain(
      'DROP SECRET IF EXISTS __naklidata_vended_s3_0',
    );
    expect(target.toJSON()).toEqual({ opaque: true, activeCredentialCount: 0 });
  });

  it('serializes a clear behind an in-flight replacement', async () => {
    const recorder = executorRecorder();
    let releaseFirstExec = () => {};
    const firstExec = new Promise<void>((resolve) => {
      releaseFirstExec = resolve;
    });
    recorder.exec.mockImplementationOnce(async () => firstExec);
    const target = new DuckDbVendedCredentialTarget(recorder.executor);

    const replacement = target.replace([s3Credential()]);
    const clear = target.clear();
    await vi.waitFor(() => expect(recorder.exec).toHaveBeenCalledOnce());
    expect(target.toJSON()).toEqual({ opaque: true, activeCredentialCount: 0 });

    releaseFirstExec();
    await Promise.all([replacement, clear]);

    expect(recorder.exec).toHaveBeenCalledTimes(2);
    expect(recorder.exec.mock.calls[1]?.[0]).toContain(
      'DROP SECRET IF EXISTS __naklidata_vended_s3_0',
    );
    expect(target.toJSON()).toEqual({ opaque: true, activeCredentialCount: 0 });
  });
});
