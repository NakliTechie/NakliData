// Facet Chunk 2 de-risk — @antv/layout-GPU (WebGL/GPGPU) force layout, in-browser,
// at scale. The pure-JS main-thread path is unusable (7–26 s @ 2.6k nodes,
// FINDINGS.md); the -wasm path needs SharedArrayBuffer → cross-origin isolation
// (COOP/COEP) → collides with the cross-origin DuckDB CDN load. This spike tests
// the third door: -gpu, which needs only WebGL2 + float color buffers (both
// present per the capability probe) and NO header changes at all.
//
// Runs Fruchterman (GPU) at a ladder of sizes, measures wall-clock, and verifies
// the coordinates come back finite + spread (i.e. the layout actually resolved,
// not a degenerate collapse). Reports into the page for preview_eval to read.

import { Graph } from '@antv/graphlib';
import { FruchtermanLayout, GForceLayout } from '@antv/layout-gpu';

/**
 * Synthetic clustered graph: `clusters` communities, dense intra-cluster edges,
 * sparse inter-cluster bridges. This gives force layout real structure to
 * resolve (vs a random graph that just blows apart), mirroring the citation
 * graph's community shape. Deterministic PRNG so runs are comparable.
 */
function makeClusteredGraph(n, clusters, avgDeg) {
  // mulberry32 — proper 32-bit PRNG (the prior LCG had a short cycle, so the
  // `seen` dedup rejected most edges and graphs came out far too sparse).
  let s = 0x9e3779b9;
  const rand = () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Seed random initial positions. GForce reads node.data.{x,y} as the
  // starting point; without a seed every node sits at the origin, forces are
  // symmetric, and the layout can't break the collapse (Fruchterman randomizes
  // internally so it doesn't need this).
  const nodes = Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    data: { x: (rand() - 0.5) * 1000, y: (rand() - 0.5) * 1000 },
  }));
  const clusterOf = (i) => Math.floor(i / (n / clusters));
  const edges = [];
  const targetEdges = Math.floor((n * avgDeg) / 2);
  let e = 0;
  const seen = new Set();
  while (edges.length < targetEdges && e < targetEdges * 4) {
    e++;
    const a = Math.floor(rand() * n);
    // 90% intra-cluster, 10% bridge
    let b;
    if (rand() < 0.9) {
      const c = clusterOf(a);
      const lo = Math.floor((c * n) / clusters);
      const hi = Math.floor(((c + 1) * n) / clusters);
      b = lo + Math.floor(rand() * Math.max(1, hi - lo));
    } else {
      b = Math.floor(rand() * n);
    }
    if (a === b) continue;
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ id: `e${edges.length}`, source: `n${a}`, target: `n${b}`, data: {} });
  }
  return { nodes, edges };
}

async function runOne(kind, n, clusters, avgDeg, maxIteration) {
  const { nodes, edges } = makeClusteredGraph(n, clusters, avgDeg);
  const graph = new Graph({ nodes, edges });
  const layout =
    kind === 'gforce'
      ? new GForceLayout({ maxIteration, gravity: 10, gpuEnabled: true })
      : new FruchtermanLayout({ maxIteration, gravity: 10, speed: 5, width: 1000, height: 1000 });
  const t0 = performance.now();
  let mapping;
  let error = null;
  try {
    mapping = await layout.execute(graph);
  } catch (err) {
    error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }
  const ms = Math.round(performance.now() - t0);
  if (error) return { kind, n, edges: edges.length, maxIteration, ms, error };

  const pts = mapping.nodes.map((nn) => [nn.data.x, nn.data.y]);
  const finite = pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const xspread = Math.round(Math.max(...xs) - Math.min(...xs));
  const yspread = Math.round(Math.max(...ys) - Math.min(...ys));
  return {
    kind,
    n,
    edges: edges.length,
    maxIteration,
    ms,
    finite,
    xspread,
    yspread,
    resolved: finite && xspread > 1 && yspread > 1,
  };
}

async function main() {
  const results = [];
  // Ladder: small (sanity) → 10k → 50k → 100k, avgDeg 4. Fixed 200 iters (a
  // typical "good enough" force budget) so timings compare across sizes.
  // Both GPU layouts: Fruchterman (all-pairs repulsion, O(n²)) and GForce.
  const ladder = [
    [500, 8, 4, 200],
    [10_000, 20, 4, 200],
    [50_000, 40, 4, 200],
    [100_000, 60, 4, 200],
  ];
  for (const kind of ['fruchterman', 'gforce']) {
    for (const [n, c, d, it] of ladder) {
      // eslint-disable-next-line no-console
      console.log(`[gpu-spike] ${kind} ${n} nodes…`);
      // Yield so the page can paint between sizes.
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 30));
      // eslint-disable-next-line no-await-in-loop
      const res = await runOne(kind, n, c, d, it);
      results.push(res);
      // eslint-disable-next-line no-console
      console.log(`[gpu-spike] ${JSON.stringify(res)}`);
      globalThis.__gpuSpike = { done: false, results: [...results] };
      // Bail the rest of a layout's ladder if a size errors or blows past 40s.
      if (res.error || res.ms > 40_000) {
        // eslint-disable-next-line no-console
        console.log(`[gpu-spike] ${kind} stopping ladder (${res.error ?? `${res.ms}ms`})`);
        break;
      }
    }
  }
  globalThis.__gpuSpike = { done: true, results };
  const pre = document.getElementById('out');
  if (pre) pre.textContent = JSON.stringify(results, null, 2);
}

globalThis.__gpuSpike = { done: false, results: [] };
void main();
