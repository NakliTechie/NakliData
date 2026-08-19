import { describe, expect, it, vi } from 'vitest';
import {
  type SnowflakeJsonColumn,
  SnowflakeSqlAdapter,
} from '../src/core/bridge/snowflake-sql-adapter.ts';
import { WarehouseAdapterError } from '../src/core/bridge/warehouse-adapter-core.ts';

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const pending = {
  statementHandle: 'handle-1',
  statementStatusUrl: '/api/v2/statements/handle-1?requestId=req-1',
  message: 'Statement running.',
};

function result(overrides: Record<string, unknown> = {}) {
  return {
    statementHandle: 'handle-1',
    resultSetMetaData: {
      numRows: 1,
      format: 'jsonv2',
      partitionInfo: [{ rowCount: 1, uncompressedSize: 8 }],
      rowType: [
        {
          name: 'ID',
          type: 'fixed',
          nullable: false,
          precision: 38,
          scale: 0,
        },
      ],
    },
    data: [['1']],
    ...overrides,
  };
}

function adapter(
  fetchImpl: typeof fetch,
  options: Partial<ConstructorParameters<typeof SnowflakeSqlAdapter>[0]> = {},
) {
  return new SnowflakeSqlAdapter({
    accountUrl: 'https://acme.snowflakecomputing.com',
    bearerToken: 'secret.token',
    tokenType: 'OAUTH',
    userAgent: 'NakliData-Compute-Bridge/0.1',
    warehouse: 'COMPUTE_WH',
    database: 'ANALYTICS',
    schema: 'PUBLIC',
    role: 'ANALYST',
    maxResultBytes: 1_024,
    pollIntervalMs: 1,
    maxPolls: 2,
    fetchImpl,
    wait: async () => undefined,
    readAuthorizer: { authorize: () => ({ allowed: true }) },
    jsonV2Encoder: {
      async encode(
        _columns: readonly SnowflakeJsonColumn[],
        rows: readonly (readonly (string | null)[])[],
      ) {
        return new TextEncoder().encode(JSON.stringify(rows));
      },
    },
    ...options,
  });
}

describe('SnowflakeSqlAdapter', () => {
  it('submits one bounded async statement and consumes JSONv2 partitions in order', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const encoded: { columns: readonly SnowflakeJsonColumn[]; rows: unknown }[] = [];
    const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init: init ?? {} });
      if (calls.length === 1) return json(pending, 202);
      if (calls.length === 2) {
        return json({
          statementHandle: 'handle-1',
          resultSetMetaData: {
            numRows: 3,
            format: 'jsonv2',
            partitionInfo: [
              { rowCount: 2, uncompressedSize: 16 },
              { rowCount: 1, uncompressedSize: 8 },
            ],
            rowType: [
              {
                name: 'ID',
                type: 'fixed',
                nullable: false,
                precision: 38,
                scale: 0,
              },
              {
                name: 'LABEL',
                type: 'text',
                nullable: true,
                precision: null,
                scale: null,
              },
            ],
          },
          data: [
            ['1', 'alpha'],
            ['2', null],
          ],
        });
      }
      if (url.includes('partition=1')) return json({ data: [['3', 'gamma']] });
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;
    const instance = adapter(fetchImpl, {
      jsonV2Encoder: {
        async encode(columns, rows) {
          encoded.push({ columns, rows });
          return Uint8Array.from([1, 2, 3]);
        },
      },
    });

    await expect(
      instance.execute({
        sql: 'WITH recent AS (SELECT 1 AS id) SELECT * FROM recent;',
        rowLimit: 7,
      }),
    ).resolves.toEqual({
      statementHandle: 'handle-1',
      rowCount: 3,
      arrow: Uint8Array.from([1, 2, 3]),
    });

    const submitted = JSON.parse(String(calls[0]?.init.body));
    expect(submitted).toEqual({
      statement:
        'SELECT * FROM (WITH recent AS (SELECT 1 AS id) SELECT * FROM recent) AS "__naklidata_bounded" LIMIT 7',
      timeout: 60,
      parameters: { MULTI_STATEMENT_COUNT: '1' },
      warehouse: 'COMPUTE_WH',
      database: 'ANALYTICS',
      schema: 'PUBLIC',
      role: 'ANALYST',
    });
    expect(calls[0]?.url).toBe('https://acme.snowflakecomputing.com/api/v2/statements?async=true');
    expect(calls[0]?.init.headers).toMatchObject({
      Authorization: 'Bearer secret.token',
      'User-Agent': 'NakliData-Compute-Bridge/0.1',
      'X-Snowflake-Authorization-Token-Type': 'OAUTH',
    });
    expect(calls[2]?.url).toBe(
      'https://acme.snowflakecomputing.com/api/v2/statements/handle-1?partition=1',
    );
    expect(encoded[0]?.rows).toEqual([
      ['1', 'alpha'],
      ['2', null],
      ['3', 'gamma'],
    ]);
  });

  it('rejects unsafe or unwrappable SQL before network access', async () => {
    const fetchImpl = vi.fn() as typeof fetch;
    const instance = adapter(fetchImpl);
    await expect(instance.execute({ sql: 'DELETE FROM events' })).rejects.toMatchObject({
      code: 'unsafe_query',
    });
    await expect(instance.execute({ sql: 'VALUES (1)' })).rejects.toMatchObject({
      code: 'unsafe_query',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('requires the deployment read policy to authorize vendor-specific SQL', async () => {
    const fetchImpl = vi.fn() as typeof fetch;
    await expect(
      adapter(fetchImpl, {
        readAuthorizer: {
          authorize: () => ({
            allowed: false,
            reason: 'Stage and external-volume reads are not allowed.',
          }),
        },
      }).execute({ sql: 'SELECT * FROM analytics.public.events' }),
    ).rejects.toMatchObject({ code: 'unsafe_query' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects an off-origin statement status URL before credentialed polling', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: URL | RequestInfo) => {
      calls.push(String(input));
      if (calls.length === 1) {
        return json(
          {
            statementHandle: 'handle-1',
            statementStatusUrl: 'https://attacker.example/status',
          },
          202,
        );
      }
      if (calls.length === 2) return json({ message: 'cancel accepted' });
      return json({ code: '000604', message: 'SQL execution canceled' }, 422);
    }) as typeof fetch;
    await expect(adapter(fetchImpl).execute({ sql: 'SELECT 1' })).rejects.toMatchObject({
      code: 'protocol_mismatch',
    });
    expect(calls).toHaveLength(3);
    expect(calls.some((url) => url.includes('attacker.example'))).toBe(false);
  });

  it('fails closed on inconsistent partition metadata and row widths', async () => {
    const badPartitions = result({
      resultSetMetaData: {
        ...result().resultSetMetaData,
        numRows: 2,
      },
    });
    await expect(
      adapter(vi.fn(async () => json(badPartitions)) as typeof fetch).execute({
        sql: 'SELECT 1',
      }),
    ).rejects.toMatchObject({ code: 'protocol_mismatch' });

    const badWidth = result({ data: [['1', 'unexpected']] });
    await expect(
      adapter(vi.fn(async () => json(badWidth)) as typeof fetch).execute({
        sql: 'SELECT 1',
      }),
    ).rejects.toMatchObject({ code: 'protocol_mismatch' });
  });

  it('applies one cumulative byte budget across all JSONv2 partitions', async () => {
    const first = {
      statementHandle: 'handle-1',
      resultSetMetaData: {
        numRows: 2,
        format: 'jsonv2',
        partitionInfo: [
          { rowCount: 1, uncompressedSize: 1 },
          { rowCount: 1, uncompressedSize: 1 },
        ],
        rowType: [
          {
            name: 'VALUE',
            type: 'text',
            nullable: false,
            precision: null,
            scale: null,
          },
        ],
      },
      data: [['first']],
    };
    const second = { data: [['x'.repeat(500)]] };
    const combinedBytes =
      new TextEncoder().encode(JSON.stringify(first)).byteLength +
      new TextEncoder().encode(JSON.stringify(second)).byteLength;
    const fetchImpl = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) =>
      init?.method === 'POST' ? json(first) : json(second),
    ) as typeof fetch;

    await expect(
      adapter(fetchImpl, { maxResultBytes: combinedBytes - 1 }).execute({
        sql: 'SELECT value FROM events',
      }),
    ).rejects.toMatchObject({ code: 'result_limit' });
  });

  it('rejects multiple-statement responses even when the request asked for one', async () => {
    const fetchImpl = vi.fn(async () =>
      json({ statementHandles: ['one', 'two'], statementHandle: 'one' }),
    ) as typeof fetch;
    await expect(adapter(fetchImpl).execute({ sql: 'SELECT 1' })).rejects.toMatchObject({
      code: 'protocol_mismatch',
    });
  });

  it('cancels and polls to terminal after an interrupted pending statement', async () => {
    const methods: string[] = [];
    const fetchImpl = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      methods.push(init?.method ?? 'GET');
      if (methods.length === 1) return json(pending, 202);
      if (methods.length === 2) return json({ message: 'cancel accepted' });
      return json({ code: '000604', message: 'SQL execution canceled' }, 422);
    }) as typeof fetch;
    const wait = vi.fn(async () => {
      throw new WarehouseAdapterError('stop', 'cancelled');
    });
    await expect(adapter(fetchImpl, { wait }).execute({ sql: 'SELECT 1' })).rejects.toMatchObject({
      code: 'cancelled',
    });
    expect(methods).toEqual(['POST', 'POST', 'GET']);
  });

  it('does not treat a cancel receipt as proof of terminal state', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      if (call === 1) return json(pending, 202);
      if (call === 2) return json({ message: 'accepted' });
      return json(pending, 202);
    }) as typeof fetch;
    const wait = async () => {
      if (call === 1) throw new WarehouseAdapterError('stop', 'cancelled');
    };
    await expect(
      adapter(fetchImpl, { wait, maxPolls: 1 }).execute({ sql: 'SELECT 1' }),
    ).rejects.toMatchObject({ code: 'cancellation_unconfirmed' });
  });

  it('treats HTTP 408 as an already-cancelled timeout, not pending work', async () => {
    const fetchImpl = vi.fn(async () =>
      json(
        {
          statementHandle: 'handle-1',
          message: 'Execution exceeded the timeout period.',
        },
        408,
      ),
    ) as typeof fetch;
    await expect(adapter(fetchImpl).execute({ sql: 'SELECT 1' })).rejects.toMatchObject({
      code: 'timeout',
      status: 408,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('accepts HTTP 408 as terminal while confirming cancellation', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      if (call === 1) return json(pending, 202);
      if (call === 2) return json({ message: 'cancel accepted' });
      return json({ message: 'Execution timed out and was cancelled.' }, 408);
    }) as typeof fetch;
    const wait = async () => {
      throw new WarehouseAdapterError('stop', 'cancelled');
    };
    await expect(adapter(fetchImpl, { wait }).execute({ sql: 'SELECT 1' })).rejects.toMatchObject({
      code: 'cancelled',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('reports a generic 429 without a statement handle as rate limiting', async () => {
    const fetchImpl = vi.fn(async () =>
      json({ message: 'Too many requests.' }, 429),
    ) as typeof fetch;
    await expect(adapter(fetchImpl).execute({ sql: 'SELECT 1' })).rejects.toMatchObject({
      code: 'rate_limited',
      status: 429,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, 'credential_rejected'],
    [403, 'authorization_denied'],
  ])('classifies Snowflake HTTP %i without reflecting vendor details', async (status, code) => {
    const fetchImpl = vi.fn(async () =>
      json({ message: 'secret.token failed at https://private.example/query' }, status),
    ) as typeof fetch;
    const error = await adapter(fetchImpl)
      .execute({ sql: 'SELECT 1' })
      .catch((value: unknown) => value);
    expect(error).toMatchObject({ code, status });
    expect(String(error)).not.toContain('secret.token');
    expect(String(error)).not.toContain('private.example');
  });

  it.each([
    [401, 'credential_rejected'],
    [403, 'authorization_denied'],
  ])('classifies bodyless Snowflake HTTP %i by status', async (status, code) => {
    const fetchImpl = vi.fn(async () => new Response(null, { status })) as typeof fetch;
    await expect(adapter(fetchImpl).execute({ sql: 'SELECT 1' })).rejects.toMatchObject({
      code,
      status,
    });
  });

  it('redacts Snowflake errors and omits credentials from serialization', async () => {
    const fetchImpl = vi.fn(async () =>
      json(
        {
          code: '123',
          message: 'credential secret.token failed at https://signed.example/result?sig=capability',
        },
        422,
      ),
    ) as typeof fetch;
    const instance = adapter(fetchImpl);
    const error = await instance.execute({ sql: 'SELECT 1' }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(WarehouseAdapterError);
    expect(String(error)).not.toContain('secret.token');
    expect(String(error)).not.toContain('signed.example');
    expect(String(error)).not.toContain('capability');
    expect(JSON.stringify(instance)).not.toContain('secret.token');
  });

  it('rejects header injection and invalid statement timeouts at construction', () => {
    const fetchImpl = vi.fn() as typeof fetch;
    expect(() => adapter(fetchImpl, { userAgent: 'NakliData\r\nX-Evil: yes' })).toThrow(
      WarehouseAdapterError,
    );
    expect(() => adapter(fetchImpl, { statementTimeoutSeconds: 604_801 })).toThrow(
      WarehouseAdapterError,
    );
  });
});
