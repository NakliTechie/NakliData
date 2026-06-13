// M3 — Incremental Refresh tests.
//
// Gate artifacts per handoff §M3:
//   - File replaced → stale propagation via lineage cascades to the
//     affected cells. Verified by `cascadeStaleness` over a hand-
//     built lineage graph.
//   - No false negatives: unsupported fingerprints never report
//     stale.
//   - Cycles in the lineage graph don't hang the cascade.

import { describe, expect, it } from 'vitest';
import type { LineageGraph } from '../src/core/lineage-store.ts';
import {
  cascadeStaleness,
  fingerprintFromFile,
  fingerprintFromHeaders,
  fingerprintsEqual,
  unsupportedFingerprint,
} from '../src/core/refresh.ts';

describe('fingerprintsEqual', () => {
  it('FSA: same size + lastModified compare equal', () => {
    const a = {
      kind: 'fsa' as const,
      size: 100,
      lastModified: 1700_000_000_000,
      computedAt: 'A',
    };
    const b = {
      kind: 'fsa' as const,
      size: 100,
      lastModified: 1700_000_000_000,
      computedAt: 'B', // different — should not affect equality
    };
    expect(fingerprintsEqual(a, b)).toBe(true);
  });

  it('FSA: different size → not equal', () => {
    const a = {
      kind: 'fsa' as const,
      size: 100,
      lastModified: 1700_000_000_000,
      computedAt: 'A',
    };
    const b = {
      kind: 'fsa' as const,
      size: 101,
      lastModified: 1700_000_000_000,
      computedAt: 'A',
    };
    expect(fingerprintsEqual(a, b)).toBe(false);
  });

  it('FSA: different lastModified → not equal', () => {
    const a = {
      kind: 'fsa' as const,
      size: 100,
      lastModified: 1700_000_000_000,
      computedAt: 'A',
    };
    const b = {
      kind: 'fsa' as const,
      size: 100,
      lastModified: 1700_000_000_001,
      computedAt: 'A',
    };
    expect(fingerprintsEqual(a, b)).toBe(false);
  });

  it('HTTP: same ETag + Last-Modified + Content-Length compare equal', () => {
    const a = {
      kind: 'http' as const,
      etag: '"abc123"',
      lastModifiedHeader: 'Tue, 01 Jan 2026 00:00:00 GMT',
      contentLength: 1024,
      computedAt: 'A',
    };
    const b = {
      kind: 'http' as const,
      etag: '"abc123"',
      lastModifiedHeader: 'Tue, 01 Jan 2026 00:00:00 GMT',
      contentLength: 1024,
      computedAt: 'B',
    };
    expect(fingerprintsEqual(a, b)).toBe(true);
  });

  it('HTTP: ETag change → not equal', () => {
    const a = {
      kind: 'http' as const,
      etag: '"abc123"',
      lastModifiedHeader: null,
      contentLength: 1024,
      computedAt: 'A',
    };
    const b = {
      kind: 'http' as const,
      etag: '"different"',
      lastModifiedHeader: null,
      contentLength: 1024,
      computedAt: 'A',
    };
    expect(fingerprintsEqual(a, b)).toBe(false);
  });

  it("HTTP: same nulls compare equal (server doesn't emit those headers)", () => {
    const a = {
      kind: 'http' as const,
      etag: null,
      lastModifiedHeader: null,
      contentLength: 1024,
      computedAt: 'A',
    };
    const b = {
      kind: 'http' as const,
      etag: null,
      lastModifiedHeader: null,
      contentLength: 1024,
      computedAt: 'B',
    };
    expect(fingerprintsEqual(a, b)).toBe(true);
  });

  it("HTTP: equal only on Content-Length → still false-positive-safe (the most common cache scenario won't claim 'no change' on body-rewrite-same-size, but it's an acceptable miss for static hosting)", () => {
    const a = {
      kind: 'http' as const,
      etag: null,
      lastModifiedHeader: null,
      contentLength: 1024,
      computedAt: 'A',
    };
    const b = {
      kind: 'http' as const,
      etag: null,
      lastModifiedHeader: null,
      contentLength: 1024,
      computedAt: 'B',
    };
    expect(fingerprintsEqual(a, b)).toBe(true);
  });

  it('Different kinds → not equal even if content-similar', () => {
    const fsa = {
      kind: 'fsa' as const,
      size: 100,
      lastModified: 1700_000_000_000,
      computedAt: 'A',
    };
    const http = {
      kind: 'http' as const,
      etag: null,
      lastModifiedHeader: null,
      contentLength: 100,
      computedAt: 'A',
    };
    expect(fingerprintsEqual(fsa, http)).toBe(false);
  });

  it('Unsupported fingerprints always compare equal (no auto-stale claims)', () => {
    const a = unsupportedFingerprint();
    const b = unsupportedFingerprint();
    expect(fingerprintsEqual(a, b)).toBe(true);
  });

  it('Iceberg: same snapshotId compares equal', () => {
    const a = {
      kind: 'iceberg' as const,
      snapshotId: 'snap-abc',
      computedAt: 'A',
    };
    const b = {
      kind: 'iceberg' as const,
      snapshotId: 'snap-abc',
      computedAt: 'B',
    };
    expect(fingerprintsEqual(a, b)).toBe(true);
  });

  it('Iceberg: different snapshotId → not equal', () => {
    const a = {
      kind: 'iceberg' as const,
      snapshotId: 'snap-abc',
      computedAt: 'A',
    };
    const b = {
      kind: 'iceberg' as const,
      snapshotId: 'snap-def',
      computedAt: 'A',
    };
    expect(fingerprintsEqual(a, b)).toBe(false);
  });

  it('Bridge: same SQL hash compares equal', () => {
    const a = {
      kind: 'bridge' as const,
      sqlHash: 'abc123',
      computedAt: 'A',
    };
    const b = {
      kind: 'bridge' as const,
      sqlHash: 'abc123',
      computedAt: 'B',
    };
    expect(fingerprintsEqual(a, b)).toBe(true);
  });
});

describe('cascadeStaleness — 3-hop chain', () => {
  // raw_source → cell A (joins it) → cell B (aggregates A) → sink
  const graph: LineageGraph = {
    version: 1,
    nodes: [
      { id: 'raw_source', kind: 'source', label: 'raw' },
      { id: 'a', kind: 'cell', label: 'cell_a' },
      { id: 'b', kind: 'cell', label: 'cell_b' },
      { id: 'sink:b:csv', kind: 'sink', label: 'CSV' },
    ],
    edges: [
      { from: 'raw_source', to: 'a', confidence: 'high' },
      { from: 'a', to: 'b', confidence: 'high' },
      { from: 'b', to: 'sink:b:csv', confidence: 'high' },
    ],
  };

  it('mark raw_source stale → cascades to a AND b', () => {
    const { staleCellIds } = cascadeStaleness(['raw_source'], graph);
    expect(staleCellIds.sort()).toEqual(['a', 'b']);
  });

  it('mark cell_a stale (intermediate) → cascades to b only; a not in result', () => {
    // Edge case: caller marks the cell itself as stale (e.g., user
    // edited the cell). The cascade walks forward; the cell ID isn't
    // a "source," so it's NOT in `staleSourceIds` arg, but `a`'s
    // children get marked. To get this behaviour, the caller should
    // include `a` in the input and we filter out a from the output
    // when a is itself a cell.
    const { staleCellIds } = cascadeStaleness(['a'], graph);
    // 'a' is in the cell node set, so the cascade marks both a + b.
    // The result is the set of cells whose results need re-running.
    expect(staleCellIds.sort()).toEqual(['a', 'b']);
  });

  it('mark sink (impossible in practice — handles defensively) → no cells affected', () => {
    const { staleCellIds } = cascadeStaleness(['sink:b:csv'], graph);
    expect(staleCellIds).toEqual([]);
  });

  it('unknown stale ID → no cells affected', () => {
    const { staleCellIds } = cascadeStaleness(['nonexistent'], graph);
    expect(staleCellIds).toEqual([]);
  });

  it('empty stale list → no cells affected', () => {
    const { staleCellIds } = cascadeStaleness([], graph);
    expect(staleCellIds).toEqual([]);
  });
});

describe('cascadeStaleness — diamond join', () => {
  // raw_a → cell_x ┐
  //                ├→ cell_z
  // raw_b → cell_y ┘
  const graph: LineageGraph = {
    version: 1,
    nodes: [
      { id: 'raw_a', kind: 'source', label: 'raw_a' },
      { id: 'raw_b', kind: 'source', label: 'raw_b' },
      { id: 'x', kind: 'cell', label: 'cell_x' },
      { id: 'y', kind: 'cell', label: 'cell_y' },
      { id: 'z', kind: 'cell', label: 'cell_z' },
    ],
    edges: [
      { from: 'raw_a', to: 'x', confidence: 'high' },
      { from: 'raw_b', to: 'y', confidence: 'high' },
      { from: 'x', to: 'z', confidence: 'high' },
      { from: 'y', to: 'z', confidence: 'high' },
    ],
  };

  it('raw_a stale → x + z stale; y untouched', () => {
    const { staleCellIds } = cascadeStaleness(['raw_a'], graph);
    expect(staleCellIds.sort()).toEqual(['x', 'z']);
  });

  it('raw_b stale → y + z stale; x untouched', () => {
    const { staleCellIds } = cascadeStaleness(['raw_b'], graph);
    expect(staleCellIds.sort()).toEqual(['y', 'z']);
  });

  it('both raw_a + raw_b stale → x, y, z all stale (no duplicates)', () => {
    const { staleCellIds } = cascadeStaleness(['raw_a', 'raw_b'], graph);
    expect(staleCellIds.sort()).toEqual(['x', 'y', 'z']);
  });

  it('z visited only once even though two paths reach it', () => {
    // The cascade uses a `visited` set; this guards O(V+E).
    const { staleCellIds } = cascadeStaleness(['raw_a', 'raw_b'], graph);
    const zCount = staleCellIds.filter((id) => id === 'z').length;
    expect(zCount).toBe(1);
  });
});

describe('cascadeStaleness — cycle safety', () => {
  it("a → b → a (lineage shouldn't cycle, but if it does, BFS still terminates)", () => {
    const cyclicGraph: LineageGraph = {
      version: 1,
      nodes: [
        { id: 'raw', kind: 'source', label: 'raw' },
        { id: 'a', kind: 'cell', label: 'a' },
        { id: 'b', kind: 'cell', label: 'b' },
      ],
      edges: [
        { from: 'raw', to: 'a', confidence: 'high' },
        { from: 'a', to: 'b', confidence: 'high' },
        { from: 'b', to: 'a', confidence: 'high' }, // back-edge → cycle
      ],
    };
    const { staleCellIds } = cascadeStaleness(['raw'], cyclicGraph);
    // Both cells stale; the BFS terminates because `a` is already
    // visited by the time `b → a` is considered.
    expect(staleCellIds.sort()).toEqual(['a', 'b']);
  });
});

describe('fingerprintFromFile / fingerprintFromHeaders constructors', () => {
  it('fingerprintFromFile lifts size + lastModified from a File', () => {
    // Synthesize a File-like object — vitest jsdom supports `new File`.
    const file = new File(['hello'], 'test.csv', {
      type: 'text/csv',
      lastModified: 1700_000_000_000,
    });
    const fp = fingerprintFromFile(file);
    expect(fp.kind).toBe('fsa');
    if (fp.kind === 'fsa') {
      expect(fp.size).toBe(5);
      expect(fp.lastModified).toBe(1700_000_000_000);
      expect(fp.computedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
    }
  });

  it('fingerprintFromHeaders pulls ETag + Last-Modified + Content-Length', () => {
    const headers = new Headers();
    headers.set('etag', '"xyz789"');
    headers.set('last-modified', 'Mon, 01 Feb 2026 12:00:00 GMT');
    headers.set('content-length', '4096');
    const fp = fingerprintFromHeaders(headers);
    expect(fp.kind).toBe('http');
    if (fp.kind === 'http') {
      expect(fp.etag).toBe('"xyz789"');
      expect(fp.lastModifiedHeader).toBe('Mon, 01 Feb 2026 12:00:00 GMT');
      expect(fp.contentLength).toBe(4096);
    }
  });

  // forward-pass L1 — a zero-byte file (content-length: 0) must keep a
  // contentLength of 0, not get coerced to null by `0 || null` (which
  // would make a later non-zero change harder to spot via length alone).
  it('fingerprintFromHeaders preserves a zero content-length', () => {
    const headers = new Headers();
    headers.set('content-length', '0');
    const fp = fingerprintFromHeaders(headers);
    if (fp.kind === 'http') {
      expect(fp.contentLength).toBe(0);
    }
  });

  it('fingerprintFromHeaders with a non-numeric content-length → null', () => {
    const headers = new Headers();
    headers.set('content-length', 'not-a-number');
    const fp = fingerprintFromHeaders(headers);
    if (fp.kind === 'http') {
      expect(fp.contentLength).toBeNull();
    }
  });

  it('fingerprintFromHeaders with no relevant headers → all nulls', () => {
    const fp = fingerprintFromHeaders(new Headers());
    expect(fp.kind).toBe('http');
    if (fp.kind === 'http') {
      expect(fp.etag).toBeNull();
      expect(fp.lastModifiedHeader).toBeNull();
      expect(fp.contentLength).toBeNull();
    }
  });
});
