// Lineage visual annotations: pure projection logic.
//
// These operations modify the saved lineage graph only. They do not create,
// delete, or reposition actual notebook cells or sources. Observed lineage
// from a later cell run can replace the annotated inbound edges.
//
// **Engine-boundary contract (v1.3 M0):** no DOM, no FSA, no browser
// globals. Pure data + the canvas-op projection.

import { lineageGraphFromJson } from './lineage-store.ts';
import type { LineageCellKind, LineageGraph, LineageNode } from './lineage-store.ts';

/**
 * Visual-only operations supported by the lineage annotation surface.
 */
export type CanvasOp =
  | {
      kind: 'insert-on-edge';
      edge: { from: string; to: string };
      newCellKind: NewCellKind;
      newCellId: string;
    }
  | { kind: 'delete-node'; nodeId: string }
  | { kind: 'reposition'; nodeId: string; column?: number; row?: number };

/** Labels the annotation palette can apply to an inserted visual step. */
export type NewCellKind = LineageCellKind;

/**
 * Apply a canvas op to a `LineageGraph` to produce the next graph
 * state. Pure — same input → same output. The result is not a notebook diff.
 *
 * `insert-on-edge`: insert a new cell between `edge.from` and
 * `edge.to`. The old edge is REMOVED; two new edges are added —
 * `from → newCell` and `newCell → to`. The new cell is added as a
 * cell node.
 *
 * `delete-node`: remove the node + every edge it touches. Returns
 * the visual paths touching the node. Callers list downstream nodes before
 * confirmation so the view change is explicit.
 *
 * `reposition`: layout-only; no graph mutation. Returns the graph
 * unchanged (the canvas layout is computed from row/column hints
 * the caller stores separately).
 */
export function applyCanvasOp(graph: LineageGraph, op: CanvasOp): LineageGraph {
  if (op.kind === 'insert-on-edge') {
    const edgeExists = graph.edges.some((e) => e.from === op.edge.from && e.to === op.edge.to);
    if (!edgeExists) return graph;
    // Don't materialise a node id that already exists — a duplicate would
    // create two nodes sharing an id and ambiguous edges (forward-pass M4).
    if (graph.nodes.some((n) => n.id === op.newCellId)) return graph;
    const newNode: LineageNode = {
      id: op.newCellId,
      kind: 'cell',
      label: `cell_${op.newCellId}`,
      // Preserve the selected visual step label across persistence.
      cellKind: op.newCellKind,
    };
    return {
      version: 1,
      nodes: [...graph.nodes, newNode],
      edges: [
        ...graph.edges.filter((e) => !(e.from === op.edge.from && e.to === op.edge.to)),
        { from: op.edge.from, to: op.newCellId, confidence: 'high' as const },
        { from: op.newCellId, to: op.edge.to, confidence: 'high' as const },
      ],
    };
  }
  if (op.kind === 'delete-node') {
    return {
      version: 1,
      nodes: graph.nodes.filter((n) => n.id !== op.nodeId),
      edges: graph.edges.filter((e) => e.from !== op.nodeId && e.to !== op.nodeId),
    };
  }
  // reposition: layout-only.
  return graph;
}

/**
 * Identify downstream nodes whose visible paths are affected by hiding a node.
 */
export function getDependentsOfNode(graph: LineageGraph, nodeId: string): string[] {
  const downstream = new Set<string>();
  const queue = [nodeId];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === undefined) continue;
    for (const e of graph.edges) {
      if (e.from === cur && !downstream.has(e.to) && e.to !== nodeId) {
        downstream.add(e.to);
        queue.push(e.to);
      }
    }
  }
  return Array.from(downstream);
}

/**
 * Project a lineage graph into a **canvas state** — what the user
 * sees when they open lineage edit mode. The projection is THE
 * IDENTITY function on the graph nodes + edges (the canvas IS the
 * graph), plus a layout layer (column / row hints) the caller stores
 * separately and the canvas reads.
 *
 * Persistence invariant for visual annotations:
 *
 *   For any canvas op `op` applied to a graph `g`:
 *     project(apply(g, op)) === project(g) → then-applied-op
 *
 * Applying an annotation, persisting the graph, and re-projecting it produces
 * the same visual graph state.
 */
export interface CanvasState {
  /** Same nodes as the graph; the canvas IS the graph. */
  nodes: LineageGraph['nodes'];
  /** Same edges as the graph. */
  edges: LineageGraph['edges'];
}

export function projectToCanvas(graph: LineageGraph): CanvasState {
  return {
    nodes: graph.nodes,
    edges: graph.edges,
  };
}

/**
 * Test predicate for the M6 round-trip invariant. Applies an op to the
 * graph, then checks that the applied graph survives a
 * serialise → revive → project cycle identically to the direct
 * in-memory projection.
 *
 * The revive leg goes through `lineageGraphFromJson` — the same
 * untrusted-input validator used to load a `.naklidata` `lineage`
 * field — so this is a GENUINELY independent reconstruction path, not
 * the old tautology of calling `applyCanvasOp` twice with identical
 * inputs (forward-pass C3).
 *
 * What it proves: `applyCanvasOp` emits a well-formed, serialisation-
 * stable graph whose canvas projection is invariant under
 * persist-and-reload. A bug that produced a node/edge that couldn't
 * survive the round-trip — a missing field, an invalid `kind`, a
 * dropped `confidence` — would make the two projections diverge.
 */
export function roundTripInvariantHolds(graph: LineageGraph, op: CanvasOp): boolean {
  const applied = applyCanvasOp(graph, op);
  const inMemory = projectToCanvas(applied);
  // Serialise the applied graph, then revive it through the same
  // validator the file-load path uses, and re-project.
  const revived = lineageGraphFromJson(JSON.parse(JSON.stringify(applied)));
  const viaPersistence = projectToCanvas(revived);
  return (
    JSON.stringify(inMemory.nodes) === JSON.stringify(viaPersistence.nodes) &&
    JSON.stringify(inMemory.edges) === JSON.stringify(viaPersistence.edges)
  );
}
