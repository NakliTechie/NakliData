// v1.3 M6 — Lineage edit mode: pure projection logic.
//
// The lineage canvas is an EDITABLE PROJECTION of the notebook
// (handoff §M6). Any canvas action — insert-on-edge, delete node,
// reposition — is recorded as a cell operation; replaying the
// notebook re-derives the identical canvas. The round-trip invariant
// is the load-bearing test of this milestone.
//
// **Engine-boundary contract (v1.3 M0):** no DOM, no FSA, no browser
// globals. Pure data + the canvas-op projection.

import { lineageGraphFromJson } from './lineage-store.ts';
import type { LineageGraph, LineageNode } from './lineage-store.ts';

/**
 * Canvas operations the user can perform in lineage edit mode. Each
 * maps to a concrete notebook-level cell op so the round-trip
 * invariant holds: canvas action → notebook diff → re-rendered
 * canvas identical.
 *
 * Per handoff §M6: NO canvas-only transform types. If a transform
 * can't exist as a cell, it can't exist on the canvas.
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

/** Cell kinds the canvas palette offers. NO canvas-only types. */
export type NewCellKind = 'sql' | 'chart' | 'pivot' | 'stats' | 'report';

/**
 * Apply a canvas op to a `LineageGraph` to produce the next graph
 * state. Pure — same input → same output. Mirrors what the notebook
 * would produce after running the corresponding cell op.
 *
 * `insert-on-edge`: insert a new cell between `edge.from` and
 * `edge.to`. The old edge is REMOVED; two new edges are added —
 * `from → newCell` and `newCell → to`. The new cell is added as a
 * cell node.
 *
 * `delete-node`: remove the node + every edge it touches. Returns
 * the orphaned downstream nodes so the caller can decide whether
 * to confirm deletion (handoff §M6: dependents-listed-before-
 * confirmation).
 *
 * `reposition`: layout-only; no graph mutation. Returns the graph
 * unchanged (the canvas layout is computed from row/column hints
 * the caller stores separately).
 */
export function applyCanvasOp(graph: LineageGraph, op: CanvasOp): LineageGraph {
  if (op.kind === 'insert-on-edge') {
    const edgeExists = graph.edges.some((e) => e.from === op.edge.from && e.to === op.edge.to);
    if (!edgeExists) return graph;
    const newNode: LineageNode = {
      id: op.newCellId,
      kind: 'cell',
      label: `cell_${op.newCellId}`,
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
 * For a delete-node op, identify the downstream cells that depend on
 * the node being deleted. The handoff requires this list be shown
 * before confirmation (handoff §M6 — reuse the M2 measures-edit
 * pattern of "list dependents first").
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
 * The Round-Trip Invariant (handoff §M6 — load-bearing test of the
 * milestone):
 *
 *   For any canvas op `op` applied to a graph `g`:
 *     project(apply(g, op)) === project(g) → then-applied-op
 *
 * Or in plain English: applying an op to the canvas, then re-
 * projecting the graph, produces the SAME canvas state as applying
 * the op to the underlying graph and re-projecting. Notebook and
 * canvas are two projections of one state.
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
