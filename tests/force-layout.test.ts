// core/force-layout — the in-house synchronous Fruchterman for the Facet
// Network view. Pure numeric logic, no DOM.

import { describe, expect, it } from 'vitest';
import {
  BARNES_HUT_THRESHOLD,
  NETWORK_LAYOUT_MAX,
  NetworkTooLargeError,
  forceLayout,
} from '../src/core/force-layout.ts';

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

describe('forceLayout — Barnes–Hut path (n > BARNES_HUT_THRESHOLD)', () => {
  // Deterministic ring-of-cliques generator so the tests exercise the quadtree
  // path (n above the threshold) with real structure, not just noise.
  const cliqueRing = (cliques: number, per: number) => {
    const n = cliques * per;
    const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}` }));
    const edges: Array<{ source: string; target: string }> = [];
    for (let c = 0; c < cliques; c++) {
      const base = c * per;
      // sparse intra-clique links (every 3rd pair — enough to bind, cheap)
      for (let i = 0; i < per; i++)
        for (let j = i + 1; j < per; j++)
          if ((i * 5 + j) % 3 === 0) edges.push({ source: `n${base + i}`, target: `n${base + j}` });
      // one bridge to the next clique
      edges.push({ source: `n${base}`, target: `n${((c + 1) % cliques) * per}` });
    }
    return { nodes, edges };
  };

  it('the threshold sits below the ceiling', () => {
    expect(BARNES_HUT_THRESHOLD).toBeLessThan(NETWORK_LAYOUT_MAX);
    expect(NETWORK_LAYOUT_MAX).toBe(30000);
  });

  it('returns finite coordinates for every node on a large graph', async () => {
    const { nodes, edges } = cliqueRing(20, 250); // 5,000 nodes
    expect(nodes.length).toBeGreaterThan(BARNES_HUT_THRESHOLD);
    const pos = await forceLayout(nodes, edges, { iterations: 40 });
    expect(pos.size).toBe(5000);
    for (const [, [x, y]] of pos) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
  });

  it('is deterministic across runs (fixed θ + seeded init, no RNG)', async () => {
    const { nodes, edges } = cliqueRing(12, 250); // 3,000 nodes
    const a = await forceLayout(nodes, edges, { iterations: 30 });
    const b = await forceLayout(nodes, edges, { iterations: 30 });
    for (const [id, [ax, ay]] of a) {
      const [bx, by] = b.get(id) as [number, number];
      expect(bx).toBeCloseTo(ax, 10);
      expect(by).toBeCloseTo(ay, 10);
    }
  });

  it('clusters adjacency: edge-connected pairs land far closer than random pairs', async () => {
    // A ring (i — i+1 mod n) is the robust large-scale structure check: the
    // approximation must still pull neighbours together far more than the
    // average pair. (A two-clique "separation" test is ill-posed at this scale —
    // the symmetric golden-spiral init gives both halves a coincident centre of
    // mass, a metastable concentric minimum that *exact* FR gets stuck in too.)
    const n = 3000; // > BARNES_HUT_THRESHOLD
    const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}` }));
    const edges = Array.from({ length: n }, (_, i) => ({
      source: `n${i}`,
      target: `n${(i + 1) % n}`,
    }));
    const pos = await forceLayout(nodes, edges, { iterations: 120 });
    const dist = (i: number, j: number) => {
      const [ax, ay] = pos.get(`n${i}`) as [number, number];
      const [bx, by] = pos.get(`n${j}`) as [number, number];
      return Math.hypot(ax - bx, ay - by);
    };
    let adj = 0;
    for (let i = 0; i < n; i++) adj += dist(i, (i + 1) % n);
    adj /= n;
    // Deterministic spread of non-adjacent pairs.
    let rnd = 0;
    let cnt = 0;
    for (let s = 0; s < n; s += 7) {
      const i = s % n;
      const j = (s * 131 + 59) % n;
      if (i === j) continue;
      rnd += dist(i, j);
      cnt++;
    }
    rnd /= cnt;
    // Neighbours cluster; empirically the ratio is ~15×. Assert a wide margin.
    expect(rnd).toBeGreaterThan(adj * 4);
  });

  it('repulsion expands an edgeless cloud (Barnes–Hut push works)', async () => {
    // With no edges there is only repulsion; the seeded ~sqrt(n) init radius
    // must blow up. Validates the quadtree force magnitude/sign end-to-end.
    const n = 3000;
    const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}` }));
    const pos = await forceLayout(nodes, [], { iterations: 20 });
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    for (const [, [x]] of pos) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
    // Init radius ≈ sqrt(3000) ≈ 55 → x-spread ≈ 110; repulsion pushes it well
    // past that. Empirically ~570.
    expect(maxX - minX).toBeGreaterThan(200);
  });

  it('handles a graph at the ceiling without throwing', async () => {
    // Edgeless 30k-node cloud, few iters — exercises quadtree build + traverse
    // at the max size and asserts it terminates with finite output.
    const nodes = Array.from({ length: NETWORK_LAYOUT_MAX }, (_, i) => ({ id: `n${i}` }));
    const pos = await forceLayout(nodes, [], { iterations: 6 });
    expect(pos.size).toBe(NETWORK_LAYOUT_MAX);
    let ok = true;
    for (const [, [x, y]] of pos) if (!Number.isFinite(x) || !Number.isFinite(y)) ok = false;
    expect(ok).toBe(true);
  });

  it('tolerates coincident bodies (bucket path) without NaN or hang', async () => {
    // All-coincident init is impossible (golden-angle spreads them), but heavy
    // clustering drives deep subdivision → bucket leaves. A star graph piles
    // many leaves onto one hub; assert clean finite output.
    const n = BARNES_HUT_THRESHOLD + 500;
    const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}` }));
    const edges = Array.from({ length: n - 1 }, (_, i) => ({
      source: 'n0',
      target: `n${i + 1}`,
    }));
    const pos = await forceLayout(nodes, edges, { iterations: 25 });
    expect(pos.size).toBe(n);
    for (const [, [x, y]] of pos) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
  });
});
