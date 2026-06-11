// v1.3 M6 — Lineage edit mode tests.
//
// Gate artifact per handoff §M6 (load-bearing):
//   "Round-trip invariant test green (canvas action → notebook diff →
//   re-rendered canvas identical)."
//
// Plus:
//   - Insert-on-edge produces correct cell + correct re-execution of
//     downstream cells (the cell-id wiring is verified here; the
//     downstream re-execution is the host's responsibility, validated
//     via the e2e smoke once UI is wired).
//   - Delete safety flow — getDependentsOfNode returns the right set.

import { describe, expect, it } from 'vitest';
import {
  type CanvasOp,
  applyCanvasOp,
  getDependentsOfNode,
  projectToCanvas,
  roundTripInvariantHolds,
} from '../src/core/lineage-edit.ts';
import { lineageGraphFromJson } from '../src/core/lineage-store.ts';
import type { LineageGraph } from '../src/core/lineage-store.ts';

function graph(): LineageGraph {
  // Three-hop chain: src → a → b → c
  return {
    version: 1,
    nodes: [
      { id: 'src', kind: 'source', label: 'orders' },
      { id: 'a', kind: 'cell', label: 'cell_a' },
      { id: 'b', kind: 'cell', label: 'cell_b' },
      { id: 'c', kind: 'cell', label: 'cell_c' },
    ],
    edges: [
      { from: 'src', to: 'a', confidence: 'high' },
      { from: 'a', to: 'b', confidence: 'high' },
      { from: 'b', to: 'c', confidence: 'high' },
    ],
  };
}

describe('applyCanvasOp — insert-on-edge', () => {
  it('inserts a new cell between two nodes; rewires the edge', () => {
    const g = graph();
    const op: CanvasOp = {
      kind: 'insert-on-edge',
      edge: { from: 'a', to: 'b' },
      newCellKind: 'sql',
      newCellId: 'new1',
    };
    const next = applyCanvasOp(g, op);
    expect(next.nodes.find((n) => n.id === 'new1')).toBeDefined();
    expect(next.edges.find((e) => e.from === 'a' && e.to === 'new1')).toBeDefined();
    expect(next.edges.find((e) => e.from === 'new1' && e.to === 'b')).toBeDefined();
    // Original edge a→b is gone.
    expect(next.edges.find((e) => e.from === 'a' && e.to === 'b')).toBeUndefined();
  });

  it("no-ops if the targeted edge doesn't exist", () => {
    const g = graph();
    const op: CanvasOp = {
      kind: 'insert-on-edge',
      edge: { from: 'a', to: 'nowhere' },
      newCellKind: 'sql',
      newCellId: 'new1',
    };
    expect(applyCanvasOp(g, op)).toEqual(g);
  });

  it('the new cell is a cell-kind node (NOT a source / sink)', () => {
    const g = graph();
    const op: CanvasOp = {
      kind: 'insert-on-edge',
      edge: { from: 'a', to: 'b' },
      newCellKind: 'chart',
      newCellId: 'new1',
    };
    const next = applyCanvasOp(g, op);
    expect(next.nodes.find((n) => n.id === 'new1')?.kind).toBe('cell');
  });

  it('carries the requested newCellKind onto the node + survives the round-trip (H12)', () => {
    const g = graph();
    const op: CanvasOp = {
      kind: 'insert-on-edge',
      edge: { from: 'a', to: 'b' },
      newCellKind: 'stats',
      newCellId: 'new1',
    };
    const next = applyCanvasOp(g, op);
    expect(next.nodes.find((n) => n.id === 'new1')?.cellKind).toBe('stats');
    // And the round-trip invariant still holds (cellKind survives the
    // serialise → revive → project path).
    expect(roundTripInvariantHolds(g, op)).toBe(true);
  });
});

describe('applyCanvasOp — delete-node', () => {
  it('removes the node + all incident edges', () => {
    const g = graph();
    const next = applyCanvasOp(g, { kind: 'delete-node', nodeId: 'b' });
    expect(next.nodes.find((n) => n.id === 'b')).toBeUndefined();
    expect(next.edges.find((e) => e.from === 'b' || e.to === 'b')).toBeUndefined();
    // a and c are untouched at the node level.
    expect(next.nodes.find((n) => n.id === 'a')).toBeDefined();
    expect(next.nodes.find((n) => n.id === 'c')).toBeDefined();
  });
});

describe('applyCanvasOp — reposition (layout-only)', () => {
  it('returns the graph unchanged', () => {
    const g = graph();
    const next = applyCanvasOp(g, { kind: 'reposition', nodeId: 'a', column: 2 });
    expect(next).toEqual(g);
  });
});

describe('getDependentsOfNode', () => {
  it('returns the transitive downstream cells for a chain', () => {
    // src → a → b → c — dependents of "a" are {b, c}.
    const deps = getDependentsOfNode(graph(), 'a');
    expect(deps.sort()).toEqual(['b', 'c']);
  });

  it('returns empty for a leaf', () => {
    expect(getDependentsOfNode(graph(), 'c')).toEqual([]);
  });

  it('handles diamond shape correctly', () => {
    // src → a, src → b, a → c, b → c
    const g: LineageGraph = {
      version: 1,
      nodes: [
        { id: 'src', kind: 'source', label: 's' },
        { id: 'a', kind: 'cell', label: 'a' },
        { id: 'b', kind: 'cell', label: 'b' },
        { id: 'c', kind: 'cell', label: 'c' },
      ],
      edges: [
        { from: 'src', to: 'a', confidence: 'high' },
        { from: 'src', to: 'b', confidence: 'high' },
        { from: 'a', to: 'c', confidence: 'high' },
        { from: 'b', to: 'c', confidence: 'high' },
      ],
    };
    expect(getDependentsOfNode(g, 'a').sort()).toEqual(['c']);
    expect(getDependentsOfNode(g, 'src').sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('projectToCanvas — canvas IS the graph (handoff §M6 Transparency Rule)', () => {
  it('canvas state has the same nodes + edges as the graph', () => {
    const g = graph();
    const canvas = projectToCanvas(g);
    expect(canvas.nodes).toEqual(g.nodes);
    expect(canvas.edges).toEqual(g.edges);
  });
});

describe('Round-trip invariant (THE load-bearing test of M6)', () => {
  it('insert-on-edge preserves the invariant', () => {
    expect(
      roundTripInvariantHolds(graph(), {
        kind: 'insert-on-edge',
        edge: { from: 'a', to: 'b' },
        newCellKind: 'sql',
        newCellId: 'new1',
      }),
    ).toBe(true);
  });

  it('delete-node preserves the invariant', () => {
    expect(roundTripInvariantHolds(graph(), { kind: 'delete-node', nodeId: 'b' })).toBe(true);
  });

  it('reposition preserves the invariant', () => {
    expect(roundTripInvariantHolds(graph(), { kind: 'reposition', nodeId: 'a', column: 0 })).toBe(
      true,
    );
  });
});

// C3 — the round-trip invariant now revives through this validator, so
// it has to do real work. Lock its behaviour down directly.
describe('lineageGraphFromJson (the revive leg of the M6 round-trip)', () => {
  it('round-trips a clean graph identically', () => {
    const g = graph();
    const revived = lineageGraphFromJson(JSON.parse(JSON.stringify(g)));
    expect(revived).toEqual(g);
  });

  it('preserves a node ref', () => {
    const revived = lineageGraphFromJson({
      version: 1,
      nodes: [{ id: 'src', kind: 'source', label: 'orders', ref: '/data/orders.parquet' }],
      edges: [],
    });
    expect(revived.nodes[0]).toEqual({
      id: 'src',
      kind: 'source',
      label: 'orders',
      ref: '/data/orders.parquet',
    });
  });

  it('drops malformed nodes (missing label, invalid kind, non-object)', () => {
    const revived = lineageGraphFromJson({
      nodes: [
        { id: 'ok', kind: 'cell', label: 'cell_ok' },
        { id: 'no-label', kind: 'cell' },
        { id: 'bad-kind', kind: 'transform', label: 'x' },
        null,
        'garbage',
      ],
      edges: [],
    });
    expect(revived.nodes.map((n) => n.id)).toEqual(['ok']);
  });

  it('drops malformed edges and defaults confidence to high', () => {
    const revived = lineageGraphFromJson({
      nodes: [],
      edges: [
        { from: 'a', to: 'b' }, // no confidence → high
        { from: 'b', to: 'c', confidence: 'low' },
        { from: 'd' }, // missing `to` → dropped
        42,
      ],
    });
    expect(revived.edges).toEqual([
      { from: 'a', to: 'b', confidence: 'high' },
      { from: 'b', to: 'c', confidence: 'low' },
    ]);
  });

  it('tolerates missing nodes/edges arrays', () => {
    expect(lineageGraphFromJson({})).toEqual({ version: 1, nodes: [], edges: [] });
  });

  it('throws on a non-object top-level value', () => {
    expect(() => lineageGraphFromJson(null)).toThrow(TypeError);
    expect(() => lineageGraphFromJson('not a graph')).toThrow(TypeError);
  });
});
