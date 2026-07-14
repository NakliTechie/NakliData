// Native graph analytics for the Facet Network view — dependency-free, pure,
// deterministic, engine-boundary clean (no DOM, no globals, unit-testable in
// Node). Cribbed in spirit from FrankenNetworkX (a Rust NetworkX port): the
// algorithm choices mirror NetworkX, and — the load-bearing part — every
// tie-break is PINNED so a metric is reproducible run-to-run. That matters
// because the Facet caches layouts by signature and we hash result snapshots
// for staleness; a metric that reshuffled on hash-order would churn both.
//
// CGSE-style determinism, concretely:
//   * Nodes are indexed in first-appearance (insertion) order.
//   * Each node's neighbour list is iterated in ASCENDING node-index order
//     (i.e. insertion order) — never Set/hash iteration order.
//   * Where an algorithm picks among equal-scoring options (Louvain community,
//     core-decomposition order), ties break to the LOWEST node/community index.
//   * No RNG anywhere.
//
// Scope: the graph is treated as UNDIRECTED and SIMPLE (parallel edges and
// self-loops collapse) — matching how the Network cell builds it. Values match
// NetworkX's undirected defaults (betweenness normalized; pagerank alpha 0.85).
//
// Why native TS and not a lib / the wasm port: same reasoning as force-layout.ts
// (CSP forbids `unsafe-eval`; "No D3" is a Hard NOT). These six are ≤~150 lines
// each and cover everything up to the 30k-node layout ceiling; the wasm route
// (compiling the Rust crates) is the >30k-node tier, tracked separately.

export interface GraphNodeRef {
  id: string;
}
export interface GraphEdgeRef {
  source: string;
  target: string;
}

/** Internal adjacency: ids by index + ascending-sorted neighbour index lists. */
interface Adjacency {
  /** Node id at each index, in first-appearance order. */
  ids: string[];
  /** id → index. */
  indexOf: Map<string, number>;
  /** neighbours[i] = sorted (ascending) distinct neighbour indices of node i. */
  neighbors: number[][];
  n: number;
}

/**
 * Build a simple undirected adjacency from a node set + edge list. Parallel
 * edges collapse, self-loops drop, and edges whose endpoints aren't in the node
 * set are ignored (same tolerance as force-layout.ts). Neighbour lists are
 * sorted ascending so every downstream iteration is deterministic.
 */
function buildAdjacency(nodes: readonly GraphNodeRef[], edges: readonly GraphEdgeRef[]): Adjacency {
  const ids: string[] = [];
  const indexOf = new Map<string, number>();
  for (const node of nodes) {
    if (!indexOf.has(node.id)) {
      indexOf.set(node.id, ids.length);
      ids.push(node.id);
    }
  }
  const n = ids.length;
  const sets: Array<Set<number>> = Array.from({ length: n }, () => new Set<number>());
  for (const e of edges) {
    const a = indexOf.get(e.source);
    const b = indexOf.get(e.target);
    if (a === undefined || b === undefined) continue;
    if (a === b) continue; // no self-loops
    sets[a]?.add(b);
    sets[b]?.add(a);
  }
  const neighbors = sets.map((s) => Array.from(s).sort((x, y) => x - y));
  return { ids, indexOf, neighbors, n };
}

// ── Connected components ────────────────────────────────────────────────────

/**
 * Undirected connected components. Components are ordered by the first-appearance
 * index of their lowest-index member (deterministic); each component lists its
 * members in BFS order. `componentOf` maps id → component index for colouring.
 */
export function connectedComponents(
  nodes: readonly GraphNodeRef[],
  edges: readonly GraphEdgeRef[],
): { components: string[][]; componentOf: Map<string, number> } {
  const { ids, neighbors, n } = buildAdjacency(nodes, edges);
  const comp = new Array<number>(n).fill(-1);
  const components: string[][] = [];
  for (let start = 0; start < n; start++) {
    if (comp[start] !== -1) continue;
    const cid = components.length;
    const members: string[] = [];
    const queue = [start];
    comp[start] = cid;
    let head = 0;
    while (head < queue.length) {
      const v = queue[head++] as number;
      members.push(ids[v] as string);
      for (const w of neighbors[v] as number[]) {
        if (comp[w] === -1) {
          comp[w] = cid;
          queue.push(w);
        }
      }
    }
    components.push(members);
  }
  const componentOf = new Map<string, number>();
  for (let i = 0; i < n; i++) componentOf.set(ids[i] as string, comp[i] as number);
  return { components, componentOf };
}

// ── k-core (core number) ────────────────────────────────────────────────────

/**
 * Core number per node — the largest k such that the node belongs to a k-core.
 * Batagelj–Zaversnik O(n+m) decomposition, ported from NetworkX's `core_number`
 * with the sort tie-broken by node index for determinism.
 */
export function coreNumber(
  nodes: readonly GraphNodeRef[],
  edges: readonly GraphEdgeRef[],
): Map<string, number> {
  const { ids, neighbors, n } = buildAdjacency(nodes, edges);
  const core = neighbors.map((nb) => nb.length); // init = degree
  // Nodes sorted by degree ascending; ties by index (stable, deterministic).
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => (core[a] as number) - (core[b] as number) || a - b,
  );
  const pos = new Array<number>(n);
  order.forEach((v, i) => {
    pos[v] = i;
  });
  // bin_boundaries[d] = index in `order` of the first node with core ≥ d.
  const binBoundaries = [0];
  let curr = 0;
  for (let i = 0; i < order.length; i++) {
    const d = core[order[i] as number] as number;
    if (d > curr) {
      for (let k = 0; k < d - curr; k++) binBoundaries.push(i);
      curr = d;
    }
  }
  // Mutable neighbour sets so we can "remove" a processed node from its nbrs.
  const nbrs = neighbors.map((nb) => new Set(nb));
  for (const v of order) {
    for (const u of Array.from(nbrs[v] as Set<number>)) {
      if ((core[u] as number) > (core[v] as number)) {
        (nbrs[u] as Set<number>).delete(v);
        const posU = pos[u] as number;
        const binStart = binBoundaries[core[u] as number] as number;
        const w = order[binStart] as number;
        // Swap u to the front of its bin, then advance the bin start.
        if (u !== w) {
          order[posU] = w;
          order[binStart] = u;
          pos[w] = posU;
          pos[u] = binStart;
        }
        binBoundaries[core[u] as number] = binStart + 1;
        core[u] = (core[u] as number) - 1;
      }
    }
  }
  const result = new Map<string, number>();
  for (let i = 0; i < n; i++) result.set(ids[i] as string, core[i] as number);
  return result;
}

// ── Local clustering coefficient ────────────────────────────────────────────

/**
 * Local clustering coefficient per node: fraction of a node's neighbour pairs
 * that are themselves connected. 0 for degree < 2. Matches NetworkX `clustering`
 * for an undirected unweighted graph.
 */
export function clusteringCoefficient(
  nodes: readonly GraphNodeRef[],
  edges: readonly GraphEdgeRef[],
): Map<string, number> {
  const { ids, neighbors, n } = buildAdjacency(nodes, edges);
  const nbrSet = neighbors.map((nb) => new Set(nb));
  const result = new Map<string, number>();
  for (let v = 0; v < n; v++) {
    const nb = neighbors[v] as number[];
    const k = nb.length;
    if (k < 2) {
      result.set(ids[v] as string, 0);
      continue;
    }
    let links = 0;
    for (let i = 0; i < nb.length; i++) {
      const setI = nbrSet[nb[i] as number] as Set<number>;
      for (let j = i + 1; j < nb.length; j++) {
        if (setI.has(nb[j] as number)) links++;
      }
    }
    result.set(ids[v] as string, (2 * links) / (k * (k - 1)));
  }
  return result;
}

// ── PageRank ────────────────────────────────────────────────────────────────

export interface PageRankOptions {
  /** Damping factor. Default 0.85 (NetworkX default). */
  alpha?: number;
  /** L1 convergence tolerance (per NetworkX: stop when err < n·tol). */
  tol?: number;
  /** Iteration cap. Default 100 (NetworkX default). */
  maxIter?: number;
}

/**
 * PageRank via power iteration on the undirected graph (each edge treated as
 * bidirectional). Deterministic: uniform 1/n init, fixed iteration order, exact
 * NetworkX dangling-mass redistribution. Returns a probability distribution
 * (sums to 1). Empty graph → empty map.
 */
export function pageRank(
  nodes: readonly GraphNodeRef[],
  edges: readonly GraphEdgeRef[],
  opts: PageRankOptions = {},
): Map<string, number> {
  const { ids, neighbors, n } = buildAdjacency(nodes, edges);
  const result = new Map<string, number>();
  if (n === 0) return result;
  const alpha = opts.alpha ?? 0.85;
  const tol = opts.tol ?? 1e-6;
  const maxIter = opts.maxIter ?? 100;
  const deg = neighbors.map((nb) => nb.length);
  const dangling: number[] = [];
  for (let i = 0; i < n; i++) if (deg[i] === 0) dangling.push(i);

  let x = new Array<number>(n).fill(1 / n);
  for (let iter = 0; iter < maxIter; iter++) {
    const xlast = x;
    const base = (1 - alpha) / n;
    const xnew = new Array<number>(n).fill(base);
    let danglesum = 0;
    for (const d of dangling) danglesum += xlast[d] as number;
    danglesum *= alpha;
    for (let i = 0; i < n; i++) {
      const d = deg[i] as number;
      if (d === 0) continue;
      const contrib = (alpha * (xlast[i] as number)) / d;
      for (const j of neighbors[i] as number[]) xnew[j] = (xnew[j] as number) + contrib;
    }
    if (danglesum > 0) {
      const share = danglesum / n;
      for (let i = 0; i < n; i++) xnew[i] = (xnew[i] as number) + share;
    }
    let err = 0;
    for (let i = 0; i < n; i++) err += Math.abs((xnew[i] as number) - (xlast[i] as number));
    x = xnew;
    if (err < n * tol) break;
  }
  for (let i = 0; i < n; i++) result.set(ids[i] as string, x[i] as number);
  return result;
}

// ── Betweenness centrality (Brandes) ────────────────────────────────────────

/**
 * Betweenness centrality via Brandes' algorithm (unweighted, undirected),
 * normalized to [0,1] like NetworkX's default. Deterministic: BFS explores
 * neighbours in ascending-index order, so predecessor lists (and thus the
 * accumulation) are order-stable. n ≤ 2 → all zeros.
 */
export function betweennessCentrality(
  nodes: readonly GraphNodeRef[],
  edges: readonly GraphEdgeRef[],
): Map<string, number> {
  const { ids, neighbors, n } = buildAdjacency(nodes, edges);
  const bc = new Array<number>(n).fill(0);
  for (let s = 0; s < n; s++) {
    const stack: number[] = [];
    const preds: number[][] = Array.from({ length: n }, () => []);
    const sigma = new Array<number>(n).fill(0);
    const dist = new Array<number>(n).fill(-1);
    sigma[s] = 1;
    dist[s] = 0;
    const queue = [s];
    let head = 0;
    while (head < queue.length) {
      const v = queue[head++] as number;
      stack.push(v);
      const dv = dist[v] as number;
      for (const w of neighbors[v] as number[]) {
        if (dist[w] === -1) {
          dist[w] = dv + 1;
          queue.push(w);
        }
        if (dist[w] === dv + 1) {
          sigma[w] = (sigma[w] as number) + (sigma[v] as number);
          (preds[w] as number[]).push(v);
        }
      }
    }
    const delta = new Array<number>(n).fill(0);
    for (let i = stack.length - 1; i >= 0; i--) {
      const w = stack[i] as number;
      const coeff = (1 + (delta[w] as number)) / (sigma[w] as number);
      for (const v of preds[w] as number[]) {
        delta[v] = (delta[v] as number) + (sigma[v] as number) * coeff;
      }
      if (w !== s) bc[w] = (bc[w] as number) + (delta[w] as number);
    }
  }
  const result = new Map<string, number>();
  const scale = n > 2 ? 1 / ((n - 1) * (n - 2)) : 0;
  for (let i = 0; i < n; i++) result.set(ids[i] as string, (bc[i] as number) * scale);
  return result;
}

// ── Louvain community detection ─────────────────────────────────────────────

/** A weighted level of the Louvain hierarchy (undirected; self-loops allowed). */
interface Level {
  n: number;
  /** Undirected edges as [a, b, weight]; a==b is an aggregated self-loop. */
  links: Array<[number, number, number]>;
}

/** Build per-node adjacency (with weights) + weighted degree from a level. */
function levelAdjacency(level: Level): {
  adj: Array<Array<[number, number]>>;
  degree: number[];
  selfLoop: number[];
  m2: number;
} {
  const { n, links } = level;
  const adj: Array<Array<[number, number]>> = Array.from({ length: n }, () => []);
  const degree = new Array<number>(n).fill(0);
  const selfLoop = new Array<number>(n).fill(0);
  let m2 = 0;
  for (const [a, b, w] of links) {
    if (a === b) {
      selfLoop[a] = (selfLoop[a] as number) + w;
      degree[a] = (degree[a] as number) + 2 * w; // self-loop adds 2w to degree
      m2 += 2 * w;
    } else {
      (adj[a] as Array<[number, number]>).push([b, w]);
      (adj[b] as Array<[number, number]>).push([a, w]);
      degree[a] = (degree[a] as number) + w;
      degree[b] = (degree[b] as number) + w;
      m2 += 2 * w;
    }
  }
  return { adj, degree, selfLoop, m2 };
}

/**
 * One Louvain local-moving pass over a level. Returns the community label per
 * node (labels are arbitrary indices; caller renumbers). Deterministic: nodes
 * visited in ascending index, candidate communities evaluated in ascending
 * index, ties break to the lowest community index. Self-loops add a constant to
 * every candidate's gain, so they're excluded from the move decision (but kept
 * in the degree, which is correct).
 */
function louvainOneLevel(level: Level): number[] {
  const { adj, degree, m2 } = levelAdjacency(level);
  const n = level.n;
  const comm = Array.from({ length: n }, (_, i) => i);
  const stot = degree.slice(); // Σtot per community = Σ degree of its members
  if (m2 === 0) return comm; // no edges → every node its own community

  let improved = true;
  let guard = 0;
  const maxPasses = 50;
  while (improved && guard++ < maxPasses) {
    improved = false;
    for (let i = 0; i < n; i++) {
      const ci = comm[i] as number;
      const ki = degree[i] as number;
      // Weight from i to each neighbouring community (self-loops excluded).
      const wTo = new Map<number, number>();
      for (const [j, w] of adj[i] as Array<[number, number]>) {
        if (j === i) continue;
        const cj = comm[j] as number;
        wTo.set(cj, (wTo.get(cj) ?? 0) + w);
      }
      // Remove i from its community before scoring.
      stot[ci] = (stot[ci] as number) - ki;
      // Candidate communities: current + all neighbouring, ascending index.
      const candidates = new Set<number>(wTo.keys());
      candidates.add(ci);
      let bestC = ci;
      let bestGain = (wTo.get(ci) ?? 0) - ((stot[ci] as number) * ki) / m2;
      for (const c of Array.from(candidates).sort((a, b) => a - b)) {
        const gain = (wTo.get(c) ?? 0) - ((stot[c] as number) * ki) / m2;
        if (gain > bestGain) {
          bestGain = gain;
          bestC = c;
        }
      }
      stot[bestC] = (stot[bestC] as number) + ki;
      comm[i] = bestC;
      if (bestC !== ci) improved = true;
    }
  }
  return comm;
}

/**
 * Louvain community detection (modularity maximization) for an undirected
 * unweighted graph. Deterministic (no RNG; pinned visit + tie-break order).
 * Returns id → community index, communities renumbered 0..k-1 in ascending
 * order of their lowest-index member.
 */
export function louvainCommunities(
  nodes: readonly GraphNodeRef[],
  edges: readonly GraphEdgeRef[],
): Map<string, number> {
  const { ids, neighbors, n } = buildAdjacency(nodes, edges);
  const result = new Map<string, number>();
  if (n === 0) return result;

  // Level 0: one unit-weight link per undirected edge (a < b), from the
  // deterministic adjacency (parallel/self already collapsed).
  let links: Array<[number, number, number]> = [];
  for (let a = 0; a < n; a++) {
    for (const b of neighbors[a] as number[]) if (a < b) links.push([a, b, 1]);
  }
  // membership[originalNodeIndex] tracks the current super-node it lives in.
  const membership = Array.from({ length: n }, (_, i) => i);
  let levelN = n;

  const maxLevels = 50;
  for (let lvl = 0; lvl < maxLevels; lvl++) {
    const comm = louvainOneLevel({ n: levelN, links });
    // Distinct communities present → renumber to 0..k-1 ascending.
    const relabel = new Map<number, number>();
    for (const c of comm) if (!relabel.has(c)) relabel.set(c, relabel.size);
    const k = relabel.size;
    // Fold the level's community assignment back onto the original nodes.
    for (let i = 0; i < n; i++) {
      const superNode = membership[i] as number;
      membership[i] = relabel.get(comm[superNode] as number) as number;
    }
    if (k === levelN) break; // no coarsening happened → converged
    // Aggregate: build the next level's weighted links between communities.
    const agg = new Map<string, number>();
    for (const [a, b, w] of links) {
      const ca = relabel.get(comm[a] as number) as number;
      const cb = relabel.get(comm[b] as number) as number;
      const lo = Math.min(ca, cb);
      const hi = Math.max(ca, cb);
      const key = `${lo},${hi}`;
      agg.set(key, (agg.get(key) ?? 0) + w);
    }
    links = Array.from(agg, ([key, w]) => {
      const [lo, hi] = key.split(',').map(Number) as [number, number];
      return [lo, hi, w] as [number, number, number];
    });
    levelN = k;
  }

  // Final renumber: communities in ascending order of lowest original index.
  const finalLabel = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const c = membership[i] as number;
    if (!finalLabel.has(c)) finalLabel.set(c, finalLabel.size);
  }
  for (let i = 0; i < n; i++) {
    result.set(ids[i] as string, finalLabel.get(membership[i] as number) as number);
  }
  return result;
}

/**
 * Modularity of a community partition for an undirected unweighted graph
 * (NetworkX `community.modularity`, resolution 1). Exposed mainly so tests can
 * assert Louvain produced a sensible partition.
 */
export function modularity(
  nodes: readonly GraphNodeRef[],
  edges: readonly GraphEdgeRef[],
  communityOf: Map<string, number>,
): number {
  const { ids, neighbors, n } = buildAdjacency(nodes, edges);
  let m = 0;
  for (let i = 0; i < n; i++) m += (neighbors[i] as number[]).length;
  m /= 2; // each undirected edge counted twice
  if (m === 0) return 0;
  const deg = neighbors.map((nb) => nb.length);
  // Σ over communities of (L_c/m − (D_c/2m)²), L_c = intra-edges, D_c = Σdegree.
  const intra = new Map<number, number>();
  const degSum = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const ci = communityOf.get(ids[i] as string) ?? -1;
    degSum.set(ci, (degSum.get(ci) ?? 0) + (deg[i] as number));
    for (const j of neighbors[i] as number[]) {
      if (j <= i) continue; // count each undirected edge once
      const cj = communityOf.get(ids[j] as string) ?? -2;
      if (ci === cj) intra.set(ci, (intra.get(ci) ?? 0) + 1);
    }
  }
  let q = 0;
  for (const [c, d] of degSum) {
    q += (intra.get(c) ?? 0) / m - (d / (2 * m)) ** 2;
  }
  return q;
}
