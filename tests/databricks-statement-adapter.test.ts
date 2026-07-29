import { describe, expect, it, vi } from 'vitest';
import {
  type DatabricksArrowChunk,
  DatabricksStatementAdapter,
} from '../src/core/bridge/databricks-statement-adapter.ts';
import { WarehouseAdapterError } from '../src/core/bridge/warehouse-adapter-core.ts';

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const arrow = (bytes: number[]) =>
  new Response(Uint8Array.from(bytes), {
    headers: { 'Content-Type': 'application/vnd.apache.arrow.stream' },
  });

const pending = {
  statement_id: 'stmt-1',
  status: { state: 'PENDING' },
};

function success(overrides: Record<string, unknown> = {}) {
  return {
    statement_id: 'stmt-1',
    status: { state: 'SUCCEEDED' },
    manifest: {
      format: 'ARROW_STREAM',
      total_row_count: 2,
      total_byte_count: 3,
      total_chunk_count: 1,
      truncated: false,
      chunks: [{ chunk_index: 0, row_offset: 0, row_count: 2, byte_count: 3 }],
    },
    result: {
      external_links: [
        {
          chunk_index: 0,
          row_offset: 0,
          row_count: 2,
          byte_count: 3,
          external_link: 'https://signed.example/result?sig=secret',
        },
      ],
    },
    ...overrides,
  };
}

function adapter(
  fetchImpl: typeof fetch,
  options: Partial<ConstructorParameters<typeof DatabricksStatementAdapter>[0]> = {},
) {
  return new DatabricksStatementAdapter({
    workspaceUrl: 'https://dbc.example',
    warehouseId: 'warehouse-1',
    bearerToken: 'secret.token',
    maxResultBytes: 1_024,
    pollIntervalMs: 1,
    maxPolls: 2,
    fetchImpl,
    wait: async () => undefined,
    readAuthorizer: { authorize: () => ({ allowed: true }) },
    arrowAssembler: {
      async assemble(chunks: readonly DatabricksArrowChunk[]) {
        return Uint8Array.from(chunks.flatMap((chunk) => [...chunk.bytes]));
      },
    },
    ...options,
  });
}

describe('DatabricksStatementAdapter', () => {
  it('submits a bounded async read and downloads signed Arrow without credentials', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init: init ?? {} });
      if (calls.length === 1) return json(pending);
      if (calls.length === 2) {
        return json({
          ...success(),
          manifest: {
            format: 'ARROW_STREAM',
            total_row_count: 3,
            total_byte_count: 5,
            total_chunk_count: 2,
            truncated: true,
            chunks: [
              { chunk_index: 0, row_offset: 0, row_count: 2, byte_count: 3 },
              { chunk_index: 1, row_offset: 2, row_count: 1, byte_count: 2 },
            ],
          },
          result: {
            external_links: [
              {
                chunk_index: 0,
                row_offset: 0,
                row_count: 2,
                byte_count: 3,
                external_link: 'https://signed.example/zero?sig=one',
                next_chunk_index: 1,
                next_chunk_internal_link: '/api/2.0/sql/statements/stmt-1/result/chunks/1',
              },
            ],
          },
        });
      }
      if (url.includes('/result/chunks/1')) {
        return json({
          external_links: [
            {
              chunk_index: 1,
              row_offset: 2,
              row_count: 1,
              byte_count: 2,
              external_link: 'https://signed.example/one?sig=two',
            },
          ],
        });
      }
      if (url.includes('/zero?')) return arrow([1, 2, 3]);
      if (url.includes('/one?')) return arrow([4, 5]);
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    const result = await adapter(fetchImpl).execute({
      sql: ' SELECT id FROM catalog.schema.events; ',
      rowLimit: 10,
    });

    expect(result).toEqual({
      statementId: 'stmt-1',
      rowCount: 3,
      truncated: true,
      arrow: Uint8Array.from([1, 2, 3, 4, 5]),
    });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      statement: 'SELECT id FROM catalog.schema.events',
      warehouse_id: 'warehouse-1',
      format: 'ARROW_STREAM',
      disposition: 'EXTERNAL_LINKS',
      wait_timeout: '0s',
      on_wait_timeout: 'CONTINUE',
      row_limit: 10,
      byte_limit: 1_024,
    });
    const signedCalls = calls.filter((call) => call.url.startsWith('https://signed.'));
    expect(signedCalls).toHaveLength(2);
    for (const call of signedCalls) {
      expect(call.init.headers).not.toHaveProperty('Authorization');
      expect(call.init.credentials).toBe('omit');
      expect(call.init.redirect).toBe('error');
    }
    expect(calls.find((call) => call.url.includes('/result/chunks/1'))?.init.headers).toMatchObject(
      {
        Authorization: 'Bearer secret.token',
      },
    );
  });

  it('rejects unsafe SQL before making a request', async () => {
    const fetchImpl = vi.fn() as typeof fetch;
    await expect(adapter(fetchImpl).execute({ sql: 'DROP TABLE important' })).rejects.toMatchObject(
      {
        code: 'unsafe_query',
      },
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('requires the deployment read policy to authorize vendor-specific SQL', async () => {
    const fetchImpl = vi.fn() as typeof fetch;
    await expect(
      adapter(fetchImpl, {
        readAuthorizer: {
          authorize: () => ({
            allowed: false,
            reason: 'Object is outside the bridge allowlist.',
          }),
        },
      }).execute({ sql: 'SELECT * FROM other_catalog.secret.events' }),
    ).rejects.toMatchObject({ code: 'unsafe_query' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects off-origin control links without leaking its bearer token', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const body = {
      ...success(),
      manifest: {
        format: 'ARROW_STREAM',
        total_row_count: 0,
        total_byte_count: 0,
        total_chunk_count: 0,
        truncated: false,
        chunks: [],
      },
      result: {
        external_links: [],
        next_chunk_internal_link: 'https://attacker.example/steal',
      },
    };
    const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      return json(body);
    }) as typeof fetch;

    await expect(adapter(fetchImpl).execute({ sql: 'SELECT 1' })).rejects.toMatchObject({
      code: 'protocol_mismatch',
    });
    expect(calls.some((call) => call.url.includes('attacker.example'))).toBe(false);
  });

  it('fails closed when link metadata disagrees with the manifest', async () => {
    const body = success();
    const link = body.result.external_links[0];
    if (!link) throw new Error('Fixture is missing its first external link.');
    link.row_count = 1;
    const fetchImpl = vi.fn(async () => json(body)) as typeof fetch;
    await expect(adapter(fetchImpl).execute({ sql: 'SELECT 1' })).rejects.toMatchObject({
      code: 'protocol_mismatch',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('bounds result pagination and rejects pages that make no progress', async () => {
    const body = {
      ...success(),
      manifest: {
        format: 'ARROW_STREAM',
        total_row_count: 1,
        total_byte_count: 1,
        total_chunk_count: 1,
        truncated: false,
        chunks: [{ chunk_index: 0, row_offset: 0, row_count: 1, byte_count: 1 }],
      },
      result: {
        external_links: [],
        next_chunk_internal_link: '/api/2.0/sql/statements/stmt-1/result/chunks/0',
      },
    };
    const fetchImpl = vi.fn(async () => json(body)) as typeof fetch;
    await expect(adapter(fetchImpl).execute({ sql: 'SELECT 1' })).rejects.toMatchObject({
      code: 'protocol_mismatch',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('requires an explicit boolean manifest truncation signal', async () => {
    const body = success() as unknown as { manifest: Record<string, unknown> };
    body.manifest.truncated = 'false';
    const fetchImpl = vi.fn(async () => json(body)) as typeof fetch;
    await expect(adapter(fetchImpl).execute({ sql: 'SELECT 1' })).rejects.toMatchObject({
      code: 'protocol_mismatch',
    });
  });

  it('cancels and polls to terminal when work is interrupted', async () => {
    const methods: string[] = [];
    const fetchImpl = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      methods.push(init?.method ?? 'GET');
      if (methods.length === 1) return json(pending);
      if (methods.length === 2) return json({});
      return json({ statement_id: 'stmt-1', status: { state: 'CANCELED' } });
    }) as typeof fetch;
    const wait = vi.fn(async () => {
      throw new WarehouseAdapterError('stop', 'cancelled');
    });

    await expect(adapter(fetchImpl, { wait }).execute({ sql: 'SELECT 1' })).rejects.toMatchObject({
      code: 'cancelled',
    });
    expect(methods).toEqual(['POST', 'POST', 'GET']);
  });

  it('still polls terminal state when the cancellation receipt races', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      if (call === 1) return json(pending);
      if (call === 2) return json({ message: 'already completed' }, 409);
      return json({ statement_id: 'stmt-1', status: { state: 'SUCCEEDED' } });
    }) as typeof fetch;
    const wait = async () => {
      throw new WarehouseAdapterError('stop', 'cancelled');
    };
    await expect(adapter(fetchImpl, { wait }).execute({ sql: 'SELECT 1' })).rejects.toMatchObject({
      code: 'cancelled',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('reports unconfirmed cancellation instead of treating a receipt as terminal', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      if (call === 1) return json(pending);
      if (call === 2) return json({});
      return json(pending);
    }) as typeof fetch;
    const wait = async () => {
      if (call === 1) throw new WarehouseAdapterError('stop', 'cancelled');
    };
    await expect(
      adapter(fetchImpl, { wait, maxPolls: 1 }).execute({ sql: 'SELECT 1' }),
    ).rejects.toMatchObject({ code: 'cancellation_unconfirmed' });
  });

  it('redacts vendor secrets and does not serialize credentials', async () => {
    const fetchImpl = vi.fn(async () =>
      json({
        statement_id: 'stmt-1',
        status: {
          state: 'FAILED',
          error: {
            message:
              'credential secret.token failed at https://signed.example/result?sig=capability',
          },
        },
      }),
    ) as typeof fetch;
    const instance = adapter(fetchImpl);
    const error = await instance.execute({ sql: 'SELECT 1' }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(WarehouseAdapterError);
    expect(String(error)).not.toContain('secret.token');
    expect(String(error)).not.toContain('signed.example');
    expect(String(error)).not.toContain('capability');
    expect(JSON.stringify(instance)).not.toContain('secret.token');
  });
});
