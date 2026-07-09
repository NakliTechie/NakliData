// In-house synchronous force-directed layout for the Facet Network view.
// Fruchterman–Reingold, dependency-free (bundle budget), deterministic (seeded
// init), and — the whole reason it exists — SYNCHRONOUS: a tight loop with
// cooperative elapsed-time yields, not requestAnimationFrame.
//
// Repulsion has two paths, picked by node count:
//   * n ≤ BARNES_HUT_THRESHOLD → exact O(n²) all-pairs (simple, and the tiny
//     graphs are where you want the exact map).
//   * n >  BARNES_HUT_THRESHOLD → Barnes–Hut quadtree, O(n log n): each body is
//     repelled by aggregated far cells (opening criterion s/d < θ) instead of
//     every other body. This is what lifts the ceiling from 3k to ~30k while
//     staying interactive-synchronous. Still deterministic (fixed θ, seeded
//     init, fixed traversal order — no RNG) and engine-boundary clean (no DOM,
//     no globals, unit-testable in Node).
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
// So, like project2d.ts, we own the numeric code instead — now including a
// compact array-backed Barnes–Hut quadtree.

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
 * Node ceiling for in-browser force layout. The Barnes–Hut path (used above
 * BARNES_HUT_THRESHOLD) keeps each iteration O(n log n), so the interactive
 * ceiling moved from the old O(n²) 3k up to ~30k. Beyond this even O(n log n)
 * over ~60 iterations plus the deck.gl render stops being snappy, so the
 * Network cell surfaces a message + points at precompute rather than freezing
 * the tab. Revisit if a CSP-clean GPU-compute force sim ever lands
 * (DECISIONS BS fallback).
 */
export const NETWORK_LAYOUT_MAX = 30000;

/**
 * At/below this, repulsion is exact all-pairs O(n²); above it, Barnes–Hut. The
 * crossover is set where the quadtree's per-iteration overhead (build + traverse)
 * starts paying for itself, and low enough that the exact path never gets slow.
 */
export const BARNES_HUT_THRESHOLD = 2000;

/**
 * Barnes–Hut opening angle. A cell of side `s` at distance `d` is treated as a
 * single aggregate mass when `s / d < THETA`. 0.9 favours speed (fewer openings)
 * at a small accuracy cost that a force *layout* — where only the emergent shape
 * matters, not exact positions — comfortably tolerates.
 */
const THETA = 0.9;
const THETA2 = THETA * THETA;

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

  const iterations =
    opts.iterations ?? (n > 10000 ? 70 : n > 4000 ? 90 : n > 1500 ? 120 : n > 500 ? 200 : 400);

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

  // Barnes–Hut scratch is allocated once and reused across iterations (avoids
  // re-allocating ~2n typed arrays every step); null on the exact path.
  const useBarnesHut = n > BARNES_HUT_THRESHOLD;
  const tree = useBarnesHut ? createQuadtree(n) : null;

  let lastYield = elapsedNow();
  for (let iter = 0; iter < iterations; iter++) {
    dispX.fill(0);
    dispY.fill(0);

    if (tree) {
      // Barnes–Hut repulsion: O(n log n) via a fresh quadtree over this step's
      // positions. Accumulates each body's total repulsion into dispX/dispY.
      barnesHutRepulsion(tree, xs, ys, n, k, dispX, dispY);
    } else {
      // Exact repulsion — every pair (O(n²)). fr = k²/d.
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

// ── Barnes–Hut quadtree ──────────────────────────────────────────────────────
//
// A compact array-of-structs quadtree. Every node stores its cell square
// (origin + side), aggregate mass (body count), and the running SUM of member
// positions (centre of mass = sum / mass). `body` encodes the node kind:
//   ≥ 0  → leaf holding exactly that body index
//   EMPTY→ freshly created, no body yet
//   INTERNAL → has children
//   BUCKET   → a leaf that hit the depth/size floor and holds ≥ 2 (near-)
//              coincident bodies it can't separate; treated as one aggregate.

const EMPTY = -1;
const INTERNAL = -2;
const BUCKET = -3;

// Subdivision floors — stop splitting for (near-)coincident points so the tree
// can't grow without bound. 48 halvings is well past Float64 precision at any
// realistic spread.
const MAX_DEPTH = 48;

interface Quadtree {
  cap: number;
  count: number;
  // per-node parallel arrays
  child: Int32Array; // cap * 4, child node ids or EMPTY
  body: Int32Array; // cap, node-kind / body index (see above)
  mass: Float64Array; // cap, body count in subtree
  sumX: Float64Array; // cap, Σ member x  (COM x = sumX / mass)
  sumY: Float64Array; // cap, Σ member y
  cellX: Float64Array; // cap, cell origin (min corner) x
  cellY: Float64Array; // cap, cell origin y
  cellS: Float64Array; // cap, cell side length
  stack: Int32Array; // traversal scratch (reused per body)
}

function createQuadtree(n: number): Quadtree {
  // A quadtree over n bodies has O(n) nodes; 2n + slack covers the common case
  // and growQuadtree() handles pathological clustering.
  const cap = Math.max(64, n * 2);
  return {
    cap,
    count: 0,
    child: new Int32Array(cap * 4),
    body: new Int32Array(cap),
    mass: new Float64Array(cap),
    sumX: new Float64Array(cap),
    sumY: new Float64Array(cap),
    cellX: new Float64Array(cap),
    cellY: new Float64Array(cap),
    cellS: new Float64Array(cap),
    // DFS stack: at most ~4 pushes per level of depth.
    stack: new Int32Array(MAX_DEPTH * 4 + 16),
  };
}

function growQuadtree(t: Quadtree): void {
  const cap = t.cap * 2;
  const child = new Int32Array(cap * 4);
  child.set(t.child);
  const body = new Int32Array(cap);
  body.set(t.body);
  const mass = new Float64Array(cap);
  mass.set(t.mass);
  const sumX = new Float64Array(cap);
  sumX.set(t.sumX);
  const sumY = new Float64Array(cap);
  sumY.set(t.sumY);
  const cellX = new Float64Array(cap);
  cellX.set(t.cellX);
  const cellY = new Float64Array(cap);
  cellY.set(t.cellY);
  const cellS = new Float64Array(cap);
  cellS.set(t.cellS);
  t.cap = cap;
  t.child = child;
  t.body = body;
  t.mass = mass;
  t.sumX = sumX;
  t.sumY = sumY;
  t.cellX = cellX;
  t.cellY = cellY;
  t.cellS = cellS;
}

/** Allocate a fresh, empty node covering the given cell; returns its id. */
function newNode(t: Quadtree, x: number, y: number, s: number): number {
  if (t.count >= t.cap) growQuadtree(t);
  const id = t.count++;
  t.child[id * 4] = EMPTY;
  t.child[id * 4 + 1] = EMPTY;
  t.child[id * 4 + 2] = EMPTY;
  t.child[id * 4 + 3] = EMPTY;
  t.body[id] = EMPTY;
  t.mass[id] = 0;
  t.sumX[id] = 0;
  t.sumY[id] = 0;
  t.cellX[id] = x;
  t.cellY[id] = y;
  t.cellS[id] = s;
  return id;
}

/**
 * Rebuild the tree over the current positions and accumulate each body's total
 * repulsion (Σ over aggregated far cells of `mass · k² / d²` along the outward
 * vector) into dispX/dispY. Additive — the caller has already zeroed disp.
 */
function barnesHutRepulsion(
  t: Quadtree,
  xs: Float64Array,
  ys: Float64Array,
  n: number,
  k: number,
  dispX: Float64Array,
  dispY: Float64Array,
): void {
  // Bounding square of all bodies.
  let minX = xs[0] as number;
  let maxX = minX;
  let minY = ys[0] as number;
  let maxY = minY;
  for (let i = 1; i < n; i++) {
    const x = xs[i] as number;
    const y = ys[i] as number;
    if (x < minX) minX = x;
    else if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    else if (y > maxY) maxY = y;
  }
  let size = Math.max(maxX - minX, maxY - minY);
  if (!(size > 0)) size = 1; // all coincident → arbitrary non-zero square
  size *= 1.0001; // pad so the max-corner body falls strictly inside

  // Reset the pool and seed the root.
  t.count = 0;
  const root = newNode(t, minX, minY, size);

  const child = t.child;
  const body = t.body;
  const mass = t.mass;
  const sumX = t.sumX;
  const sumY = t.sumY;
  const cellX = t.cellX;
  const cellY = t.cellY;
  const cellS = t.cellS;

  // ── Insert every body ──
  for (let b = 0; b < n; b++) {
    const bx = xs[b] as number;
    const by = ys[b] as number;
    let node = root;
    let depth = 0;
    for (;;) {
      // Accumulate aggregate mass / COM as we descend.
      mass[node] = (mass[node] as number) + 1;
      sumX[node] = (sumX[node] as number) + bx;
      sumY[node] = (sumY[node] as number) + by;

      const kind = body[node] as number;
      if (kind === EMPTY) {
        body[node] = b; // becomes a single-body leaf
        break;
      }
      if (kind === BUCKET) {
        break; // near-coincident pile — mass/COM already updated; done
      }
      if (kind >= 0) {
        // Single-body leaf → must split (or bucket at the floor).
        if (depth >= MAX_DEPTH || (cellS[node] as number) <= 0) {
          body[node] = BUCKET; // give up separating (near-)coincident bodies
          break;
        }
        // Relocate the existing body one level down, then fall through to
        // descend the new body too.
        const oldB = kind;
        body[node] = INTERNAL;
        placeInChild(t, node, oldB, xs[oldB] as number, ys[oldB] as number);
      }
      // Internal node → descend into the quadrant for (bx, by).
      const half = (cellS[node] as number) / 2;
      const midX = (cellX[node] as number) + half;
      const midY = (cellY[node] as number) + half;
      const q = (bx >= midX ? 1 : 0) + (by >= midY ? 2 : 0);
      let c = child[node * 4 + q] as number;
      if (c === EMPTY) {
        c = newNode(
          t,
          q & 1 ? midX : (cellX[node] as number),
          q & 2 ? midY : (cellY[node] as number),
          half,
        );
        child[node * 4 + q] = c;
      }
      node = c;
      depth++;
    }
  }

  // ── Force on each body ──
  const stack = t.stack;
  const eps = 1e-9;
  for (let i = 0; i < n; i++) {
    const xi = xs[i] as number;
    const yi = ys[i] as number;
    let dxi = 0;
    let dyi = 0;
    let sp = 0;
    stack[sp++] = root;
    while (sp > 0) {
      const node = stack[--sp] as number;
      const kind = body[node] as number;
      if (kind === i) continue; // this single-body leaf IS body i → skip self
      const mNode = mass[node] as number;
      if (mNode === 0) continue; // empty (only a stray unfilled child)
      let dx = xi - (sumX[node] as number) / mNode; // vector: COM → i
      let dy = yi - (sumY[node] as number) / mNode;
      let d2 = dx * dx + dy * dy;

      if (kind >= 0) {
        // Exact single-body interaction.
        if (d2 < eps) {
          dx = (i - kind) * 1e-4 + 1e-5;
          dy = (i + kind) * 1e-4 + 1e-5;
          d2 = dx * dx + dy * dy;
        }
        const force = (k * k) / d2;
        dxi += dx * force;
        dyi += dy * force;
        continue;
      }

      // Internal or bucket. Open if the cell subtends too wide an angle AND we
      // can actually recurse (internal); buckets have no children so they are
      // always treated as an aggregate.
      const s = cellS[node] as number;
      if (kind === INTERNAL && s * s >= THETA2 * d2) {
        const base = node * 4;
        const c0 = child[base] as number;
        const c1 = child[base + 1] as number;
        const c2 = child[base + 2] as number;
        const c3 = child[base + 3] as number;
        if (c0 !== EMPTY) stack[sp++] = c0;
        if (c1 !== EMPTY) stack[sp++] = c1;
        if (c2 !== EMPTY) stack[sp++] = c2;
        if (c3 !== EMPTY) stack[sp++] = c3;
        continue;
      }
      // Far enough (or an unsplittable bucket) → one aggregate mass at the COM.
      if (d2 < eps) {
        dx = (i - node) * 1e-4 + 1e-5;
        dy = (i + node) * 1e-4 + 1e-5;
        d2 = dx * dx + dy * dy;
      }
      const force = (mNode * k * k) / d2;
      dxi += dx * force;
      dyi += dy * force;
    }
    dispX[i] = (dispX[i] as number) + dxi;
    dispY[i] = (dispY[i] as number) + dyi;
  }
}

/**
 * Place `b` as a fresh single-body leaf in `parent`'s quadrant for (bx, by),
 * creating the child cell. Used only when splitting a former single-body leaf,
 * so the target child is guaranteed empty.
 */
function placeInChild(t: Quadtree, parent: number, b: number, bx: number, by: number): void {
  const half = (t.cellS[parent] as number) / 2;
  const midX = (t.cellX[parent] as number) + half;
  const midY = (t.cellY[parent] as number) + half;
  const q = (bx >= midX ? 1 : 0) + (by >= midY ? 2 : 0);
  const c = newNode(
    t,
    q & 1 ? midX : (t.cellX[parent] as number),
    q & 2 ? midY : (t.cellY[parent] as number),
    half,
  );
  t.body[c] = b;
  t.mass[c] = 1;
  t.sumX[c] = bx;
  t.sumY[c] = by;
  t.child[parent * 4 + q] = c;
}

// performance.now when available (browser), else a monotonic-ish fallback.
// Avoids Date.now (banned in some contexts); only used for yield pacing.
function elapsedNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : 0;
}
