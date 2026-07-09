// In-house synchronous force-directed layout for the Facet Network view.
// Fruchterman–Reingold, dependency-free (bundle budget), deterministic (seeded
// init), and — the whole reason it exists — SYNCHRONOUS: a tight loop with
// cooperative elapsed-time yields, not requestAnimationFrame.
//
// Why not a library:
//   * @antv/layout-gpu compiles GPGPU kernels with `new Function` → tripped by
//     the app's tight CSP (no `unsafe-eval`). (DECISIONS BS-addendum.)
//   * @antv/layout-wasm needs SharedArrayBuffer → cross-origin isolation
//     (COOP/COEP) → fights the cross-origin DuckDB CDN load.
//   * @antv/layout v2 pure-JS force is requestAnimationFrame-driven, so it
//     STALLS in a backgrounded tab (throttled rAF) — the same footgun that
//     forced project2d.ts's PCA off setTimeout-per-iteration (DECISIONS BR).
//   * d3-force scales well but "No D3" is a Hard NOT (handoff §10).
// So, like project2d.ts, we own ~100 lines of numeric code instead. Engine-
// boundary clean: no DOM, no globals — pure logic, unit-testable in Node.

export interface ForceNode {
  id: string;
}
export interface ForceEdge {
  source: string;
  target: string;
}

/** id → [x, y] after layout. */
export type LayoutPositions = Map<string, [number, number]>;

/**
 * Node ceiling for in-browser force layout. Beyond this the O(n²) repulsion
 * stops being interactive even synchronously (~2–3 s at 3k). The Network cell
 * surfaces this as a message + points at precompute. Revisit if a CSP-clean
 * accelerated path lands (a WebGPU-compute force sim — DECISIONS BS fallback).
 */
export const NETWORK_LAYOUT_MAX = 3000;

export class NetworkTooLargeError extends Error {
  readonly nodeCount: number;
  constructor(nodeCount: number) {
    super(
      `Graph has ${nodeCount} nodes; in-browser force layout is limited to ${NETWORK_LAYOUT_MAX}.`,
    );
    this.name = 'NetworkTooLargeError';
    this.nodeCount = nodeCount;
  }
}

export interface ForceLayoutOptions {
  /** Iterations. Default scales down with node count for responsiveness. */
  iterations?: number;
  /**
   * Called between iterations so the caller can yield to the event loop (the
   * Network cell passes a setTimeout(0) hop, throttled to ~every 30 ms of
   * compute). Default: no yield — tests + small graphs run straight through.
   */
  onIteration?: () => Promise<void>;
}

/**
 * Fruchterman–Reingold layout. Returns finite [x, y] per node id, laid out on
 * an abstract plane (deck.gl's OrthographicView renders it directly).
 *
 * Deterministic: seeded golden-angle spiral init, so a re-run on the same graph
 * gives the same map. Throws `NetworkTooLargeError` above NETWORK_LAYOUT_MAX so
 * the caller can message rather than freeze the tab. Degenerate inputs
 * (0 or 1 node) return trivially.
 */
export async function forceLayout(
  nodes: readonly ForceNode[],
  edges: readonly ForceEdge[],
  opts: ForceLayoutOptions = {},
): Promise<LayoutPositions> {
  const n = nodes.length;
  const out: LayoutPositions = new Map();
  if (n === 0) return out;
  if (n === 1) {
    out.set((nodes[0] as ForceNode).id, [0, 0]);
    return out;
  }
  if (n > NETWORK_LAYOUT_MAX) throw new NetworkTooLargeError(n);

  const iterations = opts.iterations ?? (n > 1500 ? 120 : n > 500 ? 200 : 400);

  // Index nodes; ignore edges with unknown endpoints / self-loops.
  const index = new Map<string, number>();
  nodes.forEach((node, i) => index.set(node.id, i));
  const srcs: number[] = [];
  const dsts: number[] = [];
  for (const e of edges) {
    const a = index.get(e.source);
    const b = index.get(e.target);
    if (a === undefined || b === undefined || a === b) continue;
    srcs.push(a);
    dsts.push(b);
  }
  const m = srcs.length;

  // Deterministic seeded init: golden-angle spiral (spreads nodes evenly, no
  // RNG needed, no two nodes coincident → no divide-by-zero in repulsion).
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  // S9: the Fruchterman-Reingold ideal edge length. With unit area per node it
  // is exactly 1 (the old `sqrt(area/n)` with `area = n` was dead generality
  // that always evaluated to 1); positions are scaled to the viewport by the
  // caller, so a fixed unit-length k is correct.
  const k = 1;
  const initR = Math.sqrt(n);
  for (let i = 0; i < n; i++) {
    const r = initR * Math.sqrt((i + 0.5) / n);
    const a = i * GOLDEN;
    xs[i] = r * Math.cos(a);
    ys[i] = r * Math.sin(a);
  }

  const dispX = new Float64Array(n);
  const dispY = new Float64Array(n);
  // Temperature: max displacement per step, cooled linearly to ~0.
  const t0 = initR * 0.4;

  let lastYield = elapsedNow();
  for (let iter = 0; iter < iterations; iter++) {
    dispX.fill(0);
    dispY.fill(0);

    // Repulsion — every pair (O(n²); fine to NETWORK_LAYOUT_MAX). fr = k²/d.
    for (let i = 0; i < n; i++) {
      const xi = xs[i] as number;
      const yi = ys[i] as number;
      let dxi = 0;
      let dyi = 0;
      for (let j = i + 1; j < n; j++) {
        let dx = xi - (xs[j] as number);
        let dy = yi - (ys[j] as number);
        let d2 = dx * dx + dy * dy;
        if (d2 < 1e-9) {
          // Coincident — nudge deterministically so the pair separates.
          dx = (i - j) * 1e-4 + 1e-5;
          dy = (i + j) * 1e-4 + 1e-5;
          d2 = dx * dx + dy * dy;
        }
        const force = (k * k) / d2; // (k²/d) / d, folding the 1/d normalization
        const fx = dx * force;
        const fy = dy * force;
        dxi += fx;
        dyi += fy;
        dispX[j] = (dispX[j] as number) - fx;
        dispY[j] = (dispY[j] as number) - fy;
      }
      dispX[i] = (dispX[i] as number) + dxi;
      dispY[i] = (dispY[i] as number) + dyi;
    }

    // Attraction along edges. fa = d²/k.
    for (let e = 0; e < m; e++) {
      const a = srcs[e] as number;
      const b = dsts[e] as number;
      const dx = (xs[a] as number) - (xs[b] as number);
      const dy = (ys[a] as number) - (ys[b] as number);
      const dist = Math.sqrt(dx * dx + dy * dy) || 1e-5;
      const force = (dist * dist) / k / dist; // (d²/k) normalized by d
      const fx = dx * force;
      const fy = dy * force;
      dispX[a] = (dispX[a] as number) - fx;
      dispY[a] = (dispY[a] as number) - fy;
      dispX[b] = (dispX[b] as number) + fx;
      dispY[b] = (dispY[b] as number) + fy;
    }

    // Cool + apply, capping displacement at the current temperature.
    const temp = t0 * (1 - iter / iterations);
    for (let i = 0; i < n; i++) {
      const dx = dispX[i] as number;
      const dy = dispY[i] as number;
      const len = Math.sqrt(dx * dx + dy * dy) || 1e-9;
      const capped = Math.min(len, temp);
      xs[i] = (xs[i] as number) + (dx / len) * capped;
      ys[i] = (ys[i] as number) + (dy / len) * capped;
    }

    if (opts.onIteration && elapsedNow() - lastYield >= 30) {
      lastYield = elapsedNow();
      await opts.onIteration();
    }
  }

  for (let i = 0; i < n; i++) {
    const x = xs[i] as number;
    const y = ys[i] as number;
    out.set((nodes[i] as ForceNode).id, [Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0]);
  }
  return out;
}

// performance.now when available (browser), else a monotonic-ish fallback.
// Avoids Date.now (banned in some contexts); only used for yield pacing.
function elapsedNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : 0;
}
