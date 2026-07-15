// Wire protocol between the Network cell and the graph-metrics worker.
//
// The interesting property isn't "it round-trips" — it's that the round trip
// preserves the INDEX SPACE. graph-metrics.ts's determinism guarantee (DECISIONS
// EB) is defined in terms of first-appearance node order, so if packing shuffled
// that, the worker would return correct-looking numbers computed against a
// different tie-break order than the in-process path used to produce. These
// tests pin the order, and pin that a packed graph scores identically to the
// same graph passed straight to the algorithms.

import { describe, expect, it } from 'vitest';
import {
  packCommunities,
  packGraph,
  packValues,
  unpackGraph,
  unpackValues,
} from '../src/core/graph-metrics-protocol.ts';
import { betweennessCentrality, louvainCommunities, pageRank } from '../src/core/graph-metrics.ts';

const N = (...ids: string[]) => ids.map((id) => ({ id }));
const E = (...pairs: Array<[string, string]>) =>
  pairs.map(([source, target]) => ({ source, target }));

describe('packGraph', () => {
  it('indexes nodes in first-appearance order', () => {
    const packed = packGraph(N('c', 'a', 'b'), E(['a', 'b']));
    expect(packed.ids).toEqual(['c', 'a', 'b']);
    // 'a' is index 1, 'b' is index 2.
    expect(Array.from(packed.pairs)).toEqual([1, 2]);
  });

  it('collapses a duplicate node id to its first index', () => {
    const packed = packGraph(N('a', 'b', 'a'), E(['a', 'b']));
    expect(packed.ids).toEqual(['a', 'b']);
    expect(Array.from(packed.pairs)).toEqual([0, 1]);
  });

  it('drops edges whose endpoints are not in the node set', () => {
    const packed = packGraph(N('a', 'b'), E(['a', 'b'], ['a', 'ghost'], ['ghost', 'b']));
    expect(Array.from(packed.pairs)).toEqual([0, 1]);
  });

  it('keeps self-loops and parallel edges for the worker-side adjacency to collapse', () => {
    // packGraph deliberately does NOT dedupe — buildAdjacency already does, and
    // duplicating it here would put the work back on the main thread.
    const packed = packGraph(N('a', 'b'), E(['a', 'a'], ['a', 'b'], ['a', 'b']));
    expect(Array.from(packed.pairs)).toEqual([0, 0, 0, 1, 0, 1]);
  });

  it('returns a pairs view sized to the kept edges, not the input', () => {
    const packed = packGraph(N('a', 'b'), E(['a', 'b'], ['x', 'y'], ['p', 'q']));
    expect(packed.pairs.length).toBe(2);
  });

  it('handles an empty graph', () => {
    const packed = packGraph([], []);
    expect(packed.ids).toEqual([]);
    expect(packed.pairs.length).toBe(0);
    expect(unpackGraph(packed)).toEqual({ nodes: [], edges: [] });
  });
});

describe('unpackGraph', () => {
  it('inverts packGraph', () => {
    const nodes = N('a', 'b', 'c');
    const edges = E(['a', 'b'], ['b', 'c']);
    const { nodes: rn, edges: re } = unpackGraph(packGraph(nodes, edges));
    expect(rn).toEqual(nodes);
    expect(re).toEqual(edges);
  });
});

describe('value packing', () => {
  it('round-trips a metric map by index', () => {
    const ids = ['a', 'b', 'c'];
    const values = new Map([
      ['a', 0.5],
      ['b', 0.25],
      ['c', 0.25],
    ]);
    expect(unpackValues(ids, packValues(ids, values))).toEqual(values);
  });

  it('round-trips communities by index', () => {
    const ids = ['a', 'b', 'c'];
    const comms = new Map([
      ['a', 0],
      ['b', 1],
      ['c', 0],
    ]);
    expect(unpackValues(ids, packCommunities(ids, comms))).toEqual(comms);
  });

  it('fills 0 for an id the metric did not score', () => {
    const packed = packValues(['a', 'ghost'], new Map([['a', 1]]));
    expect(Array.from(packed)).toEqual([1, 0]);
  });
});

describe('pack → compute → unpack matches computing in-process', () => {
  // The graph the differential-vs-networkx pass used as its bridge case: two
  // triangles joined by a single edge. Node order is deliberately NOT sorted,
  // so a pack that re-ordered ids would show up as a different bridge score.
  const nodes = N('f', 'a', 'e', 'b', 'd', 'c');
  const edges = E(
    ['a', 'b'],
    ['b', 'c'],
    ['c', 'a'],
    ['c', 'd'],
    ['d', 'e'],
    ['e', 'f'],
    ['f', 'd'],
  );

  const viaWire = (
    fn: (
      n: Array<{ id: string }>,
      e: Array<{ source: string; target: string }>,
    ) => Map<string, number>,
  ) => {
    const packed = packGraph(nodes, edges);
    const g = unpackGraph(packed);
    return unpackValues(packed.ids, packValues(packed.ids, fn(g.nodes, g.edges)));
  };

  it('pagerank is identical through the wire', () => {
    expect(viaWire(pageRank)).toEqual(pageRank(nodes, edges));
  });

  it('betweenness is identical through the wire', () => {
    expect(viaWire(betweennessCentrality)).toEqual(betweennessCentrality(nodes, edges));
  });

  it('louvain is identical through the wire', () => {
    const wire = viaWire(louvainCommunities);
    const direct = louvainCommunities(nodes, edges);
    expect(wire).toEqual(direct);
    // And it actually found the two triangles — a guard against both sides
    // agreeing on a degenerate all-one-community answer.
    expect(new Set(direct.values()).size).toBe(2);
  });
});
