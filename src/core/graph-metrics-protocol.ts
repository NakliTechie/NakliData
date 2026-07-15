// Wire protocol between the Network cell (main thread) and the graph-metrics
// worker. Pure + engine-boundary clean, so both sides and the unit tests share
// ONE definition of the encoding.
//
// Why an encoding at all: the graph crosses a postMessage boundary, and the
// obvious shape (`{source, target}[]`) structured-clones every edge — 171k
// objects on the main thread, which is the jank we moved to a worker to avoid.
// Instead the graph crosses as a `string[]` of node ids plus an `Int32Array` of
// index pairs that is TRANSFERRED (zero-copy); results come back as typed
// arrays over the same index space and are transferred back.
//
// The index space is the load-bearing part: `packGraph` assigns indices in
// first-appearance order over `nodes`, which is exactly what graph-metrics.ts's
// buildAdjacency does. Same order → same pinned tie-breaks → the worker's
// answers are bit-identical to the in-process ones (DECISIONS EB: determinism).

/** Metrics worth crossing to the worker. `degree` is free on the node already. */
export type WorkerMetric = 'pagerank' | 'betweenness' | 'community';

export interface PackedGraph {
  /** Node id at each index, in first-appearance order over the node list. */
  ids: string[];
  /** 2·E index pairs, flattened: [s0,t0, s1,t1, …]. Transferable. */
  pairs: Int32Array;
}

export interface ComputeRequest extends PackedGraph {
  type: 'compute';
  requestId: string;
  metric: WorkerMetric;
}

export interface ComputeResultMsg {
  type: 'compute_result';
  requestId: string;
  /** Metric value per node index (pagerank / betweenness), or null. */
  values: Float64Array | null;
  /** Community index per node index (community), or null. */
  community: Int32Array | null;
}

export interface WorkerErrorMsg {
  type: 'error';
  requestId: string | null;
  message: string;
}

export interface WorkerReadyMsg {
  type: 'ready';
}

export type ToWorker = ComputeRequest;
export type FromWorker = ComputeResultMsg | WorkerErrorMsg | WorkerReadyMsg;

/**
 * Encode a node set + edge list into the transferable index-space form.
 *
 * Mirrors graph-metrics.ts's own tolerance: duplicate node ids collapse to
 * their first index, and an edge whose endpoint isn't in the node set is
 * dropped. Self-loops and parallel edges are left in — the worker's
 * buildAdjacency collapses them, and doing it here would just duplicate that
 * logic on the main thread (the side we're trying to keep free).
 */
export function packGraph(
  nodes: ReadonlyArray<{ id: string }>,
  edges: ReadonlyArray<{ source: string; target: string }>,
): PackedGraph {
  const ids: string[] = [];
  const indexOf = new Map<string, number>();
  for (const node of nodes) {
    if (!indexOf.has(node.id)) {
      indexOf.set(node.id, ids.length);
      ids.push(node.id);
    }
  }
  // Fill a worst-case buffer, then hand back a view of what we actually used —
  // `subarray` shares the buffer, so the transfer stays zero-copy.
  const buf = new Int32Array(edges.length * 2);
  let w = 0;
  for (const e of edges) {
    const a = indexOf.get(e.source);
    const b = indexOf.get(e.target);
    if (a === undefined || b === undefined) continue;
    buf[w++] = a;
    buf[w++] = b;
  }
  return { ids, pairs: buf.subarray(0, w) };
}

/**
 * Rebuild the node/edge refs graph-metrics.ts takes from the packed form.
 * Worker-side inverse of `packGraph`; exported for the unit tests, which assert
 * the round-trip preserves the index space the determinism guarantee rests on.
 */
export function unpackGraph(packed: PackedGraph): {
  nodes: Array<{ id: string }>;
  edges: Array<{ source: string; target: string }>;
} {
  const { ids, pairs } = packed;
  const nodes = ids.map((id) => ({ id }));
  const edges: Array<{ source: string; target: string }> = [];
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    const source = ids[pairs[i] as number];
    const target = ids[pairs[i + 1] as number];
    if (source === undefined || target === undefined) continue;
    edges.push({ source, target });
  }
  return { nodes, edges };
}

/** Encode an id-keyed metric map as a value-per-index typed array. */
export function packValues(ids: readonly string[], values: Map<string, number>): Float64Array {
  const out = new Float64Array(ids.length);
  for (let i = 0; i < ids.length; i++) out[i] = values.get(ids[i] as string) ?? 0;
  return out;
}

/** Encode an id-keyed community map as a community-per-index typed array. */
export function packCommunities(
  ids: readonly string[],
  communities: Map<string, number>,
): Int32Array {
  const out = new Int32Array(ids.length);
  for (let i = 0; i < ids.length; i++) out[i] = communities.get(ids[i] as string) ?? 0;
  return out;
}

/** Decode a value-per-index typed array back to an id-keyed map. */
export function unpackValues(
  ids: readonly string[],
  values: Float64Array | Int32Array,
): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i < ids.length; i++) out.set(ids[i] as string, values[i] as number);
  return out;
}
