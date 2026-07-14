import { describe, expect, it } from 'vitest';
import {
  betweennessCentrality,
  clusteringCoefficient,
  connectedComponents,
  coreNumber,
  louvainCommunities,
  modularity,
  pageRank,
} from '../src/core/graph-metrics.ts';

// Small helpers: nodes from an id list, edges from [a,b] pairs.
const N = (...ids: string[]) => ids.map((id) => ({ id }));
const E = (...pairs: Array<[string, string]>) =>
  pairs.map(([source, target]) => ({ source, target }));

// Common fixtures.
const triangle = { nodes: N('a', 'b', 'c'), edges: E(['a', 'b'], ['b', 'c'], ['a', 'c']) };
const path3 = { nodes: N('a', 'b', 'c'), edges: E(['a', 'b'], ['b', 'c']) };
const star3 = {
  nodes: N('c', 'l1', 'l2', 'l3'),
  edges: E(['c', 'l1'], ['c', 'l2'], ['c', 'l3']),
};

describe('connectedComponents', () => {
  it('splits two disjoint edges into two components, insertion-ordered', () => {
    const nodes = N('a', 'b', 'c', 'd');
    const edges = E(['a', 'b'], ['c', 'd']);
    const { components, componentOf } = connectedComponents(nodes, edges);
    expect(components).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(componentOf.get('a')).toBe(0);
    expect(componentOf.get('d')).toBe(1);
  });

  it('one component for a connected triangle', () => {
    const { components } = connectedComponents(triangle.nodes, triangle.edges);
    expect(components).toHaveLength(1);
    expect(new Set(components[0])).toEqual(new Set(['a', 'b', 'c']));
  });

  it('is deterministic across runs', () => {
    const a = connectedComponents(path3.nodes, path3.edges).components;
    const b = connectedComponents(path3.nodes, path3.edges).components;
    expect(a).toEqual(b);
  });
});

describe('coreNumber', () => {
  it('K4 → every node has core number 3', () => {
    const nodes = N('a', 'b', 'c', 'd');
    const edges = E(['a', 'b'], ['a', 'c'], ['a', 'd'], ['b', 'c'], ['b', 'd'], ['c', 'd']);
    const core = coreNumber(nodes, edges);
    for (const v of ['a', 'b', 'c', 'd']) expect(core.get(v)).toBe(3);
  });

  it('triangle + pendant → triangle core 2, pendant core 1', () => {
    const nodes = N('a', 'b', 'c', 'p');
    const edges = E(['a', 'b'], ['b', 'c'], ['a', 'c'], ['a', 'p']);
    const core = coreNumber(nodes, edges);
    expect(core.get('a')).toBe(2);
    expect(core.get('b')).toBe(2);
    expect(core.get('c')).toBe(2);
    expect(core.get('p')).toBe(1);
  });

  it('path → all core 1', () => {
    const core = coreNumber(path3.nodes, path3.edges);
    expect([...core.values()]).toEqual([1, 1, 1]);
  });
});

describe('clusteringCoefficient', () => {
  it('triangle → all 1.0', () => {
    const c = clusteringCoefficient(triangle.nodes, triangle.edges);
    for (const v of ['a', 'b', 'c']) expect(c.get(v)).toBeCloseTo(1, 10);
  });

  it('star centre and leaves → all 0', () => {
    const c = clusteringCoefficient(star3.nodes, star3.edges);
    expect(c.get('c')).toBe(0);
    expect(c.get('l1')).toBe(0);
  });

  it('a node with two connected neighbours → 1, with two unconnected → 0', () => {
    // x-a, x-b, a-b present → a,b,x each see their two nbrs connected.
    const nodes = N('x', 'a', 'b', 'y');
    const edges = E(['x', 'a'], ['x', 'b'], ['a', 'b'], ['x', 'y']);
    const c = clusteringCoefficient(nodes, edges);
    // x has nbrs a,b,y; only a-b connected → 1 link of C(3,2)=3 pairs → 1/3.
    expect(c.get('x')).toBeCloseTo(1 / 3, 10);
    // a has nbrs x,b → connected → 1.
    expect(c.get('a')).toBeCloseTo(1, 10);
  });
});

describe('pageRank', () => {
  it('sums to 1 and is symmetric on a triangle', () => {
    const pr = pageRank(triangle.nodes, triangle.edges);
    const sum = [...pr.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
    expect(pr.get('a')).toBeCloseTo(1 / 3, 5);
    expect(pr.get('b')).toBeCloseTo(1 / 3, 5);
    expect(pr.get('c')).toBeCloseTo(1 / 3, 5);
  });

  it('star centre ranks above its leaves; leaves are equal', () => {
    const pr = pageRank(star3.nodes, star3.edges);
    const centre = pr.get('c') as number;
    const leaf = pr.get('l1') as number;
    expect(centre).toBeGreaterThan(leaf);
    expect(pr.get('l2')).toBeCloseTo(leaf, 10);
    expect(pr.get('l3')).toBeCloseTo(leaf, 10);
  });

  it('is deterministic and empty on the empty graph', () => {
    expect(pageRank([], [])).toEqual(new Map());
    const a = pageRank(path3.nodes, path3.edges);
    const b = pageRank(path3.nodes, path3.edges);
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it('handles a dangling (degree-0) node: mass redistributes, sum stays 1', () => {
    // Triangle + an isolated node — the isolated node is a dangling sink.
    const nodes = N('a', 'b', 'c', 'iso');
    const pr = pageRank(nodes, triangle.edges);
    const sum = [...pr.values()].reduce((x, y) => x + y, 0);
    expect(sum).toBeCloseTo(1, 6);
    // Every node keeps positive mass; the isolated node ranks below the triangle.
    for (const v of ['a', 'b', 'c', 'iso']) expect(pr.get(v) as number).toBeGreaterThan(0);
    expect(pr.get('iso') as number).toBeLessThan(pr.get('a') as number);
  });
});

describe('betweennessCentrality', () => {
  it('P3 middle node is the sole bridge → normalized 1.0, ends 0', () => {
    const bc = betweennessCentrality(path3.nodes, path3.edges);
    expect(bc.get('b')).toBeCloseTo(1, 10);
    expect(bc.get('a')).toBeCloseTo(0, 10);
    expect(bc.get('c')).toBeCloseTo(0, 10);
  });

  it('star centre → 1.0, leaves → 0', () => {
    const bc = betweennessCentrality(star3.nodes, star3.edges);
    expect(bc.get('c')).toBeCloseTo(1, 10);
    expect(bc.get('l1')).toBeCloseTo(0, 10);
  });

  it('triangle → all 0 (every pair adjacent)', () => {
    const bc = betweennessCentrality(triangle.nodes, triangle.edges);
    for (const v of ['a', 'b', 'c']) expect(bc.get(v)).toBeCloseTo(0, 10);
  });

  it('n ≤ 2 → all zeros', () => {
    const bc = betweennessCentrality(N('a', 'b'), E(['a', 'b']));
    expect(bc.get('a')).toBe(0);
    expect(bc.get('b')).toBe(0);
  });

  it('C4 (two equal shortest paths per opposite pair, σ=2) → all nodes 1/6', () => {
    // 4-cycle: each opposite pair has two shortest paths, exercising σ>1 in the
    // Brandes accumulation. By symmetry every node has normalized betweenness 1/6.
    const nodes = N('a', 'b', 'c', 'd');
    const edges = E(['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'a']);
    const bc = betweennessCentrality(nodes, edges);
    for (const v of ['a', 'b', 'c', 'd']) expect(bc.get(v)).toBeCloseTo(1 / 6, 10);
  });
});

describe('louvainCommunities', () => {
  // Two triangles joined by a single bridge edge — the textbook 2-community case.
  const twoCliques = {
    nodes: N('a', 'b', 'c', 'd', 'e', 'f'),
    edges: E(
      ['a', 'b'],
      ['b', 'c'],
      ['a', 'c'],
      ['d', 'e'],
      ['e', 'f'],
      ['d', 'f'],
      ['c', 'd'], // bridge
    ),
  };

  it('recovers the two cliques as separate communities', () => {
    const comm = louvainCommunities(twoCliques.nodes, twoCliques.edges);
    // a,b,c share a community; d,e,f share another; the two differ.
    expect(comm.get('a')).toBe(comm.get('b'));
    expect(comm.get('b')).toBe(comm.get('c'));
    expect(comm.get('d')).toBe(comm.get('e'));
    expect(comm.get('e')).toBe(comm.get('f'));
    expect(comm.get('a')).not.toBe(comm.get('d'));
    // Renumbered from 0.
    expect(new Set(comm.values())).toEqual(new Set([0, 1]));
  });

  it('produces a partition with positive modularity', () => {
    const comm = louvainCommunities(twoCliques.nodes, twoCliques.edges);
    expect(modularity(twoCliques.nodes, twoCliques.edges, comm)).toBeGreaterThan(0.3);
  });

  it('is deterministic across runs', () => {
    const a = louvainCommunities(twoCliques.nodes, twoCliques.edges);
    const b = louvainCommunities(twoCliques.nodes, twoCliques.edges);
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it('handles an edgeless node set (each node its own community)', () => {
    const comm = louvainCommunities(N('a', 'b', 'c'), []);
    expect(new Set(comm.values()).size).toBe(3);
  });
});

describe('modularity', () => {
  it('all-in-one-community on a triangle → 0 (fully connected, no structure)', () => {
    const comm = new Map([
      ['a', 0],
      ['b', 0],
      ['c', 0],
    ]);
    expect(modularity(triangle.nodes, triangle.edges, comm)).toBeCloseTo(0, 10);
  });
});
