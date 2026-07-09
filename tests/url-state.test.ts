import { describe, expect, it } from 'vitest';
import type { NakliDataFile } from '../src/core/persistence.ts';
import { decodeLensParam, encodeLensParam } from '../src/core/url-state.ts';

const SAMPLE: NakliDataFile = {
  format: 'naklidata',
  version: '1.0',
  created: '2026-01-01T00:00:00.000Z',
  modified: '2026-01-01T00:00:00.000Z',
  name: 'Sample',
  sources: [
    {
      id: 's1',
      kind: 'example-bundle',
      label: 'demo',
      ref: 'demo-bundle',
      tables: [{ id: 't1', name: 'vendors', format: 'csv', origin: 'demo', rowCount: 12 }],
    },
  ],
  assignments: [
    {
      key: 's1::t1::vendor_id',
      columnName: 'vendor_id',
      sqlType: 'VARCHAR',
      typeId: 'gstin',
      origin: 'user_override',
      confidence: 1,
      candidates: [],
      resolutionKind: 'auto_accept',
    },
  ],
  cells: [
    {
      id: 'c1',
      kind: 'sql',
      order: 0,
      name: 'q1',
      code: 'SELECT * FROM vendors LIMIT 5',
      status: 'idle',
      lastError: null,
      lastResult: null,
    },
  ],
  user_types: [],
  settings: { auto_accept_threshold: 0.9 },
};

describe('url-state encode/decode', () => {
  it('round-trips a NakliDataFile via gzip + base64url', async () => {
    const encoded = await encodeLensParam(SAMPLE);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    const decoded = await decodeLensParam(encoded);
    expect(decoded).toEqual(SAMPLE);
  });

  it('compresses better than naive base64 for repetitive content', async () => {
    const repetitive: NakliDataFile = {
      ...SAMPLE,
      cells: Array.from({ length: 40 }, (_, i) => ({
        id: `c${i}`,
        kind: 'sql' as const,
        order: i,
        name: `q${i}`,
        code: 'SELECT * FROM invoices WHERE vendor_id = 1234',
        status: 'idle' as const,
        lastError: null,
        lastResult: null,
      })),
    };
    const encoded = await encodeLensParam(repetitive);
    const naiveB64Len = Buffer.from(JSON.stringify(repetitive)).toString('base64').length;
    expect(encoded.length).toBeLessThan(naiveB64Len * 0.6);
  });

  it('rejects malformed base64url', async () => {
    await expect(decodeLensParam('not-valid-gzip-bytes')).rejects.toThrow();
  });

  it('rejects a gzip bomb — payload decompressing past the 2 MB cap (forward-pass H3)', async () => {
    // 'a'.repeat compresses to almost nothing, so the encoded lens stays
    // tiny on the wire while expanding well past the cap on decode —
    // exactly the gzip-bomb shape an attacker would put in a ?lens= link.
    const bomb = {
      ...SAMPLE,
      cells: [
        {
          id: 'c1',
          kind: 'sql' as const,
          order: 0,
          name: 'q1',
          code: 'a'.repeat(2_500_000),
          status: 'idle' as const,
          lastError: null,
          lastResult: null,
        },
      ],
    } as NakliDataFile;
    const encoded = await encodeLensParam(bomb);
    expect(encoded.length).toBeLessThan(50_000); // tiny compressed payload
    await expect(decodeLensParam(encoded)).rejects.toThrow(/gzip bomb|2 MB|decompress/i);
  });

  it('rejects payloads decoding to non-naklidata JSON', async () => {
    const garbage = { hello: 'world' };
    const json = JSON.stringify(garbage);
    const bytes = new TextEncoder().encode(json);
    const cs = new CompressionStream('gzip');
    const compressed = await new Response(
      new Blob([new Uint8Array(bytes)]).stream().pipeThrough(cs),
    ).arrayBuffer();
    const b64 = Buffer.from(compressed).toString('base64url');
    await expect(decodeLensParam(b64)).rejects.toThrow(/Not a \.naklidata file/);
  });
});
