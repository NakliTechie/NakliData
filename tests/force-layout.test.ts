// core/force-layout — the in-house synchronous Fruchterman for the Facet
// Network view. Pure numeric logic, no DOM.

import { describe, expect, it } from 'vitest';
import { NETWORK_LAYOUT_MAX, NetworkTooLargeError, forceLayout } from '../src/core/force-layout.ts';

describe('forceLayout', () => {
  it('handles empty + single-node graphs', async () => {
    expect((await forceLayout([], [])).size).toBe(0);
    const one = await forceLayout([{ id: 'a' }], []);
    expect(one.get('a')).toEqual([0, 0]);
  });

  it('throws NetworkTooLargeError above the ceiling', async () => {
    const nodes = Array.from({ length: NETWORK_LAYOUT_MAX + 1 }, (_, i) => ({ id: `n${i}` }));
    await expect(forceLayout(nodes, [])).rejects.toBeInstanceOf(NetworkTooLargeError);
  });

  it('returns finite coordinates for every node', async () => {
    const nodes = Array.from({ length: 50 }, (_, i) => ({ id: `n${i}` }));
    const edges = Array.from({ length: 80 }, (_, i) => ({
      source: `n${i % 50}`,
      target: `n${(i * 7 + 1) % 50}`,
    }));
    const pos = await forceLayout(nodes, edges, { iterations: 100 });
    expect(pos.size).toBe(50);
    for (const [, [x, y]] of pos) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
  });

  it('spreads nodes out (non-degenerate)', async () => {
    const nodes = Array.from({ length: 40 }, (_, i) => ({ id: `n${i}` }));
    const edges = Array.from({ length: 40 }, (_, i) => ({
      source: `n${i}`,
      target: `n${(i + 1) % 40}`,
    }));
    const pos = await forceLayout(nodes, edges, { iterations: 150 });
    const xs = [...pos.values()].map((p) => p[0]);
    const ys = [...pos.values()].map((p) => p[1]);
    const spread = (arr: number[]) => Math.max(...arr) - Math.min(...arr);
    expect(spread(xs)).toBeGreaterThan(1);
    expect(spread(ys)).toBeGreaterThan(1);
  });

  it('is deterministic across runs', async () => {
    const nodes = Array.from({ length: 30 }, (_, i) => ({ id: `n${i}` }));
    const edges = Array.from({ length: 50 }, (_, i) => ({
      source: `n${i % 30}`,
      target: `n${(i * 13 + 2) % 30}`,
    }));
    const a = await forceLayout(nodes, edges, { iterations: 120 });
    const b = await forceLayout(nodes, edges, { iterations: 120 });
    for (const [id, [ax, ay]] of a) {
      const [bx, by] = b.get(id) as [number, number];
      expect(bx).toBeCloseTo(ax, 10);
      expect(by).toBeCloseTo(ay, 10);
    }
  });

  it('separates two communities (structure emerges)', async () => {
    // Two 20-node cliques, densely intra-connected, a single bridge between.
    const nodes = Array.from({ length: 40 }, (_, i) => ({ id: `n${i}` }));
    const edges: Array<{ source: string; target: string }> = [];
    const clique = (lo: number, hi: number) => {
      for (let i = lo; i < hi; i++)
        for (let j = i + 1; j < hi; j++) {
          if ((i * 3 + j) % 2 === 0) edges.push({ source: `n${i}`, target: `n${j}` });
        }
    };
    clique(0, 20);
    clique(20, 40);
    edges.push({ source: 'n0', target: 'n20' }); // lone bridge
    const pos = await forceLayout(nodes, edges, { iterations: 300 });
    const centroid = (lo: number, hi: number) => {
      let cx = 0;
      let cy = 0;
      for (let i = lo; i < hi; i++) {
        const [x, y] = pos.get(`n${i}`) as [number, number];
        cx += x;
        cy += y;
      }
      return [cx / (hi - lo), cy / (hi - lo)] as [number, number];
    };
    const [ax, ay] = centroid(0, 20);
    const [bx, by] = centroid(20, 40);
    const between = Math.hypot(ax - bx, ay - by);
    // Within-community spread should be small vs the gap between centroids.
    const spreadA = Math.max(
      ...Array.from({ length: 20 }, (_, i) => {
        const [x, y] = pos.get(`n${i}`) as [number, number];
        return Math.hypot(x - ax, y - ay);
      }),
    );
    expect(between).toBeGreaterThan(spreadA);
  });

  it('calls onIteration when a graph is large enough to exceed the yield window', async () => {
    // Enough nodes/iters that the O(n²) inner loop crosses the 30 ms threshold.
    const nodes = Array.from({ length: 400 }, (_, i) => ({ id: `n${i}` }));
    const edges = Array.from({ length: 800 }, (_, i) => ({
      source: `n${i % 400}`,
      target: `n${(i * 7 + 3) % 400}`,
    }));
    let calls = 0;
    await forceLayout(nodes, edges, {
      iterations: 200,
      onIteration: async () => {
        calls++;
      },
    });
    expect(calls).toBeGreaterThan(0);
  });
});
