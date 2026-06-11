// M2 — In-memory lineage graph + .naklidata round-trip.
//
// Graph shape (handoff §M2):
//   - Nodes: source (mounted table/file/S3 mount), cell, sink.
//   - Edges: directional; source → cell, cell → cell, cell → sink.
//   - "view/table nodes" from the handoff: collapsed into the source
//     they came from. A mounted CSV "vendors" registers as ONE source
//     node — the view name and the file path are both attributes on
//     it, not separate nodes. Keeps the graph small enough to render
//     as a single SVG without scroll.
//
// Incremental update (handoff §M2): on cell edit/run we DELETE every
// edge with that cell as the FROM side, then re-add. Downstream edges
// (cells that read from this cell) are untouched — they're owned by
// THOSE cells' lineage entries, not this one's.
//
// Persistence: serialises into the `.naklidata` file as the `lineage`
// field. The graph describes WHAT was used to produce each cell, not
// the data itself — handoff Hard NOT #3 preserved.

import type { LineageInput } from './lineage.ts';

export type LineageNodeKind = 'source' | 'cell' | 'sink';

/**
 * Cell kinds a lineage `cell` node can materialise as. Carried on
 * canvas-inserted nodes so a future canvas-to-cell action knows what to
 * create (M6 Phase 2 prep — forward-pass H12). Single source of truth;
 * `lineage-edit.ts` aliases this as `NewCellKind`.
 */
export type LineageCellKind = 'sql' | 'chart' | 'pivot' | 'stats' | 'report';

export interface LineageNode {
  id: string;
  kind: LineageNodeKind;
  /** Display label. For cells: the cell name or `cell_<id>`. For
   *  sources: the table name. For sinks: `<kind> @ <cellName>`. */
  label: string;
  /** Optional path/URL/source-of-truth for the node. */
  ref?: string;
  /** For `cell` nodes inserted via the lineage canvas: which cell kind
   *  the node should materialise as (M6 Phase 2 prep, forward-pass H12). */
  cellKind?: LineageCellKind;
}

export interface LineageEdge {
  from: string;
  to: string;
  /** `high` = derived from EXPLAIN plan. `low` = regex fallback. */
  confidence: 'high' | 'low';
}

export interface LineageGraph {
  /** Schema version. v1 is the only version today. */
  version: 1;
  nodes: LineageNode[];
  edges: LineageEdge[];
}

/** Empty graph factory — used at boot before any cell has run. */
export function emptyLineageGraph(): LineageGraph {
  return { version: 1, nodes: [], edges: [] };
}

const LINEAGE_NODE_KINDS: ReadonlySet<string> = new Set(['source', 'cell', 'sink']);
const LINEAGE_CELL_KINDS: ReadonlySet<string> = new Set([
  'sql',
  'chart',
  'pivot',
  'stats',
  'report',
]);

/**
 * Reconstruct a `LineageGraph` from an untrusted JSON value — e.g. the
 * `lineage` field of a loaded `.naklidata` file, or a serialised graph
 * snapshot. Validates the shape and DROPS malformed nodes/edges rather
 * than trusting the input verbatim; an edge whose `confidence` isn't
 * the literal `'low'` defaults to `'high'`. Throws `TypeError` only if
 * the top-level value isn't an object.
 *
 * This is the inverse of a serialised `LineageGraph` (and of
 * `LineageStore.toJSON()`), and gives the M6 round-trip invariant a
 * genuinely independent reconstruction path (serialise → revive →
 * project) instead of a tautological double-apply (forward-pass C3).
 */
export function lineageGraphFromJson(value: unknown): LineageGraph {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('lineageGraphFromJson: expected a graph object');
  }
  const obj = value as Record<string, unknown>;
  const rawNodes = Array.isArray(obj.nodes) ? obj.nodes : [];
  const rawEdges = Array.isArray(obj.edges) ? obj.edges : [];

  const nodes: LineageNode[] = [];
  for (const n of rawNodes) {
    if (typeof n !== 'object' || n === null) continue;
    const r = n as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.label !== 'string') continue;
    if (typeof r.kind !== 'string' || !LINEAGE_NODE_KINDS.has(r.kind)) continue;
    const kind = r.kind as LineageNodeKind;
    const node: LineageNode = { id: r.id, kind, label: r.label };
    if (typeof r.ref === 'string') node.ref = r.ref;
    if (typeof r.cellKind === 'string' && LINEAGE_CELL_KINDS.has(r.cellKind)) {
      node.cellKind = r.cellKind as LineageCellKind;
    }
    nodes.push(node);
  }

  const edges: LineageEdge[] = [];
  for (const e of rawEdges) {
    if (typeof e !== 'object' || e === null) continue;
    const r = e as Record<string, unknown>;
    if (typeof r.from !== 'string' || typeof r.to !== 'string') continue;
    edges.push({ from: r.from, to: r.to, confidence: r.confidence === 'low' ? 'low' : 'high' });
  }

  return { version: 1, nodes, edges };
}

export class LineageStore {
  private nodes = new Map<string, LineageNode>();
  /** Per-cell list of OUTGOING-from-source edges (i.e. edges this
   *  cell owns: source/cell → THIS cell). Lets us invalidate the
   *  cell's lineage without touching downstream edges. */
  private cellInbound = new Map<string, LineageEdge[]>();
  /** Per-cell list of OUTGOING-to-sink edges. */
  private cellOutbound = new Map<string, LineageEdge[]>();

  /**
   * Register a known source node (mounted table / file / S3 mount).
   * Idempotent — overwrites attributes if called again with the same id.
   */
  upsertSource(id: string, label: string, ref?: string): void {
    const node: LineageNode =
      ref !== undefined ? { id, kind: 'source', label, ref } : { id, kind: 'source', label };
    this.nodes.set(id, node);
  }

  /**
   * Register a cell node. Idempotent.
   */
  upsertCell(id: string, label: string): void {
    this.nodes.set(id, { id, kind: 'cell', label });
  }

  /**
   * Replace the inbound lineage for a cell. Removes all edges of the
   * form `* → cellId`, then adds the new ones.
   *
   * `inputs` come from `extractInputsFromPlan` or
   * `extractInputsFromSqlRegex`. The caller maps `kind: 'table'` →
   * either an upstream source node or an upstream cell node:
   *   - `cell_<id>` pattern → cell node
   *   - anything else → source node (auto-created if not yet registered)
   *
   * `cellRefs` is an explicit list of `@name` references found in the
   * cell's text — used to draw cell→cell edges even when EXPLAIN
   * couldn't resolve them (e.g., the upstream cell hasn't run yet).
   * Confidence inherits from the extraction source.
   */
  setCellInputs(opts: {
    cellId: string;
    cellLabel: string;
    inputs: ReadonlyArray<LineageInput>;
    cellRefs?: ReadonlyArray<{ refCellId: string; refLabel: string }>;
    confidence: 'high' | 'low';
  }): void {
    this.upsertCell(opts.cellId, opts.cellLabel);

    // Wipe prior inbound edges for this cell.
    this.cellInbound.set(opts.cellId, []);

    const edges: LineageEdge[] = [];

    for (const inp of opts.inputs) {
      if (inp.kind === 'table') {
        // Could be `cell_<id>` (upstream cell view) OR a real source.
        const cellIdMatch = /^cell_(.+)$/.exec(inp.name);
        if (cellIdMatch?.[1]) {
          const upstreamCellId = cellIdMatch[1];
          // Ensure the upstream cell is in the graph — even if it
          // hasn't yet run; the label will be filled in when it does.
          if (!this.nodes.has(upstreamCellId)) {
            this.upsertCell(upstreamCellId, upstreamCellId);
          }
          edges.push({
            from: upstreamCellId,
            to: opts.cellId,
            confidence: opts.confidence,
          });
        } else {
          // Source node. Auto-register with the table name as label.
          if (!this.nodes.has(inp.name)) {
            this.upsertSource(inp.name, inp.name);
          }
          edges.push({
            from: inp.name,
            to: opts.cellId,
            confidence: opts.confidence,
          });
        }
      } else {
        // File path — register as a source node keyed by the path.
        const sourceId = `file:${inp.path}`;
        if (!this.nodes.has(sourceId)) {
          this.upsertSource(sourceId, basename(inp.path), inp.path);
        }
        edges.push({
          from: sourceId,
          to: opts.cellId,
          confidence: opts.confidence,
        });
      }
    }

    // Explicit @name references — augment the EXPLAIN-derived edges.
    for (const ref of opts.cellRefs ?? []) {
      if (!this.nodes.has(ref.refCellId)) {
        this.upsertCell(ref.refCellId, ref.refLabel);
      }
      const existing = edges.find((e) => e.from === ref.refCellId && e.to === opts.cellId);
      if (!existing) {
        edges.push({
          from: ref.refCellId,
          to: opts.cellId,
          confidence: opts.confidence,
        });
      }
    }

    this.cellInbound.set(opts.cellId, edges);
  }

  /**
   * Record sinks driven by a cell — every successful export sink call
   * adds a cell → sink edge. Replaces all prior cell→sink edges for
   * this cell (so the sinks panel reflects current state, not history).
   */
  setCellSinks(
    cellId: string,
    sinks: ReadonlyArray<{ id: string; label: string; ref?: string }>,
  ): void {
    const edges: LineageEdge[] = [];
    for (const s of sinks) {
      const sinkId = `sink:${cellId}:${s.id}`;
      const sinkNode: LineageNode =
        s.ref !== undefined
          ? { id: sinkId, kind: 'sink', label: s.label, ref: s.ref }
          : { id: sinkId, kind: 'sink', label: s.label };
      this.nodes.set(sinkId, sinkNode);
      edges.push({ from: cellId, to: sinkId, confidence: 'high' });
    }
    this.cellOutbound.set(cellId, edges);
  }

  /**
   * Remove a cell + its inbound edges + the cell-as-from-side edges
   * it owns. Edges where this cell appears as the FROM side of an
   * inbound edge for a downstream cell remain — they'll be cleaned up
   * when that downstream cell re-runs (or when the user explicitly
   * deletes that cell). This keeps incremental update O(1) per cell.
   */
  removeCell(cellId: string): void {
    this.nodes.delete(cellId);
    this.cellInbound.delete(cellId);
    this.cellOutbound.delete(cellId);
  }

  /**
   * Snapshot the graph as a plain JSON shape, deduplicating edges and
   * pruning nodes that aren't referenced by any edge. Source / sink
   * orphans (no edges at all) ARE pruned — they reflect mounted
   * sources never used, or sinks never run.
   */
  toJSON(): LineageGraph {
    const allEdges: LineageEdge[] = [];
    for (const edges of this.cellInbound.values()) allEdges.push(...edges);
    for (const edges of this.cellOutbound.values()) allEdges.push(...edges);

    const referenced = new Set<string>();
    for (const e of allEdges) {
      referenced.add(e.from);
      referenced.add(e.to);
    }

    const nodes: LineageNode[] = [];
    for (const node of this.nodes.values()) {
      if (referenced.has(node.id)) nodes.push(node);
    }
    return { version: 1, nodes, edges: dedupeEdges(allEdges) };
  }

  /**
   * Replace the entire graph from a deserialized .naklidata blob.
   * Inbound / outbound bookkeeping is rebuilt from the flat edge list.
   */
  loadFromJson(graph: LineageGraph): void {
    this.nodes.clear();
    this.cellInbound.clear();
    this.cellOutbound.clear();
    if (!graph || graph.version !== 1) return;
    for (const n of graph.nodes) this.nodes.set(n.id, n);
    for (const e of graph.edges) {
      const toNode = this.nodes.get(e.to);
      if (toNode?.kind === 'sink') {
        const fromCell = e.from;
        const list = this.cellOutbound.get(fromCell) ?? [];
        list.push(e);
        this.cellOutbound.set(fromCell, list);
      } else if (toNode?.kind === 'cell') {
        const list = this.cellInbound.get(e.to) ?? [];
        list.push(e);
        this.cellInbound.set(e.to, list);
      }
    }
  }

  /** For testing + debug — full node count. */
  size(): { nodes: number; edges: number } {
    return { nodes: this.toJSON().nodes.length, edges: this.toJSON().edges.length };
  }
}

function dedupeEdges(edges: ReadonlyArray<LineageEdge>): LineageEdge[] {
  const seen = new Map<string, LineageEdge>();
  for (const e of edges) {
    const key = `${e.from}|${e.to}`;
    const prior = seen.get(key);
    if (!prior) {
      seen.set(key, e);
    } else if (prior.confidence === 'low' && e.confidence === 'high') {
      // Prefer the higher-confidence edge if duplicated.
      seen.set(key, e);
    }
  }
  return Array.from(seen.values());
}

function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}

let _store: LineageStore | null = null;

/** Singleton accessor — same pattern as `getWorkbook()` / `getNotebook()`. */
export function getLineageStore(): LineageStore {
  if (!_store) _store = new LineageStore();
  return _store;
}

/** Test-only: reset the singleton between tests. Not exported from index. */
export function _resetLineageStoreForTests(): void {
  _store = null;
}
