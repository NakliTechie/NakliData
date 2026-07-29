import { afterEach, describe, expect, it, vi } from 'vitest';
import { Engine } from '../src/core/engine.ts';
import { _primeChunkForTests } from '../src/core/lazy-loader.ts';
import * as remoteDelimited from '../src/lazy/remote-delimited.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('remote delimited encoding normalization', () => {
  it('keeps valid UTF-8 bytes unchanged', () => {
    const input = new TextEncoder().encode('name\ncafé\n');
    const result = remoteDelimited.normalizeRemoteDelimitedBytes(input);
    expect(result.encoding).toBe('utf-8');
    expect(result.bytes).toBe(input);
    expect(result.byteLength).toBe(input.byteLength);
  });

  it('detects and converts Windows-1252/Latin-1 bytes to UTF-8', () => {
    const input = Uint8Array.from([
      ...new TextEncoder().encode('sku,price\nA,'),
      0xa3,
      ...new TextEncoder().encode('10\n'),
    ]);
    const result = remoteDelimited.normalizeRemoteDelimitedBytes(input);
    expect(result.encoding).toBe('windows-1252');
    expect(new TextDecoder().decode(result.bytes)).toBe('sku,price\nA,£10\n');
    expect(result.byteLength).toBe(input.byteLength);
  });

  it('honours an explicit Latin-1 response charset even for ASCII-only bytes', () => {
    const input = new TextEncoder().encode('id\n1\n');
    const result = remoteDelimited.normalizeRemoteDelimitedBytes(
      input,
      'text/csv; charset=iso-8859-1',
    );
    expect(result.encoding).toBe('windows-1252');
    expect(new TextDecoder().decode(result.bytes)).toBe('id\n1\n');
  });
});

describe('Engine.registerUrl delimited materialization', () => {
  it('fetches once and creates an owned view over a VFS buffer, never the URL', async () => {
    _primeChunkForTests('remote-delimited', remoteDelimited);
    const source = new TextEncoder().encode('id,label\n1,one\n2,two\n');
    const fetchMock = vi.fn(
      async () => new Response(source, { headers: { 'content-type': 'text/csv' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const registerFileBuffer = vi.fn(async (_name: string, _bytes: Uint8Array) => {});
    const statements: string[] = [];
    const engine = Object.create(Engine.prototype) as Engine;
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ n: 2n }])
      .mockResolvedValueOnce([{ n: 0n }]);
    Object.assign(engine as unknown as Record<string, unknown>, {
      db: { registerFileBuffer, dropFile: vi.fn(async () => {}) },
      registeredFileSeq: 0,
      filesByRelation: new Map(),
      relationsByFile: new Map(),
      exec: vi.fn(async (sql: string) => {
        statements.push(sql);
      }),
      query,
    });

    const registration = await engine.registerUrl({
      tableName: 'orders',
      url: 'https://example.com/no-range/orders.csv',
      format: 'csv',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/no-range/orders.csv', {
      credentials: 'omit',
    });
    expect(registerFileBuffer).toHaveBeenCalledTimes(1);
    expect(new TextDecoder().decode(registerFileBuffer.mock.calls[0]?.[1])).toBe(
      'id,label\n1,one\n2,two\n',
    );
    expect(statements[0]).toContain("read_csv_auto('__nd_src_1_orders.csv'");
    expect(statements[0]).not.toContain('https://example.com');
    expect(registration).toEqual({
      ingestionMode: 'materialized',
      byteLength: source.byteLength,
      encoding: 'utf-8',
    });
  });
});
