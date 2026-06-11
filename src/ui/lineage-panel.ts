// M2 — Lineage panel.
//
// Per handoff §6: "the SVG is enhancement, the list is the accessible
// truth." Renders both:
//   - List (load-bearing): every node grouped by kind; each cell shows
//     incoming + outgoing edges as nested rows. Keyboard-traversable.
//   - SVG (enhancement): three-lane layout (sources → cells → sinks),
//     hand-rolled topological-depth-based x-positioning. No D3 / no
//     React-Flow per handoff §10 hard NOT.

import { type CanvasOp, applyCanvasOp, getDependentsOfNode } from '../core/lineage-edit.ts';
import { getLineageStore } from '../core/lineage-store.ts';
import type {
  LineageCellKind,
  LineageEdge,
  LineageGraph,
  LineageNode,
} from '../core/lineage-store.ts';
import { iconSvg } from '../tokens/icons.ts';
import { restoreModalFocus } from './modal-focus.ts';

let _modalEl: HTMLElement | null = null;
let _onKey: ((ev: KeyboardEvent) => void) | null = null;
let _previouslyFocused: HTMLElement | null = null;

// v1.3 M6 Phase 2 — edit-mode state. The panel keeps a working copy of
// the graph; each canvas op is applied to it AND persisted to the store
// (loadFromJson), so reopening the panel reflects the edit. The list is
// the editable surface (accessible truth); the SVG re-renders read-only.
let _editMode = false;
let _workingGraph: LineageGraph = { version: 1, nodes: [], edges: [] };
let _pendingDeleteNodeId: string | null = null;
let _insertSeq = 0;

const INSERT_KINDS: ReadonlyArray<LineageCellKind> = ['sql', 'chart', 'pivot', 'stats', 'report'];

export function openLineagePanel(): void {
  if (_modalEl) return;
  _previouslyFocused = (document.activeElement as HTMLElement) ?? null;
  _editMode = false;
  _pendingDeleteNodeId = null;
  _workingGraph = getLineageStore().toJSON();
  const overlay = renderModal(_workingGraph);
  document.body.append(overlay);
  _modalEl = overlay;
  // Focus the Close button by default — safe Enter target.
  overlay.querySelector<HTMLElement>('[data-action="close-lineage"]')?.focus();
}

export function closeLineagePanel(): void {
  if (_modalEl?.parentElement) _modalEl.parentElement.removeChild(_modalEl);
  _modalEl = null;
  if (_onKey) {
    document.removeEventListener('keydown', _onKey);
    _onKey = null;
  }
  restoreModalFocus(_previouslyFocused);
  _previouslyFocused = null;
}

function renderModal(graph: LineageGraph): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'schema-graph-overlay lineage-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'lineage-title');
  overlay.innerHTML = `
    <div class="schema-graph-modal lineage-modal" role="document"
         style="width:min(960px,100%);height:auto;max-height:min(85vh,820px);display:flex;flex-direction:column;">
      <header class="schema-graph-header">
        <h2 id="lineage-title" style="margin:0;font-size:var(--text-md,15px);display:flex;align-items:center;gap:6px;">
          ${iconSvg('chart', 14)} Cell lineage
        </h2>
        <div style="margin-left:auto;display:flex;gap:6px;align-items:center;">
          ${renderEditToggle(graph)}
          <button class="btn btn-ghost schema-graph-close" data-action="close-lineage" aria-label="Close">
            ${iconSvg('x', 14)}
          </button>
        </div>
      </header>
      <div class="lineage-body" style="display:grid;grid-template-columns:1fr 1.6fr;gap:0;flex:1;min-height:0;">
        ${renderList(graph, _editMode)}
        ${renderSvg(graph)}
      </div>
    </div>
  `;
  overlay.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    if (target === overlay) {
      closeLineagePanel();
      return;
    }
    if (target.closest('[data-action="close-lineage"]')) {
      closeLineagePanel();
      return;
    }
    handleEditClick(target);
  });
  _onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') closeLineagePanel();
  };
  document.addEventListener('keydown', _onKey);
  return overlay;
}

function renderEditToggle(graph: LineageGraph): string {
  if (graph.nodes.length === 0) return '';
  const label = _editMode ? 'Done' : 'Edit';
  return `<button class="btn btn-ghost ${_editMode ? 'is-active' : ''}" data-action="toggle-lineage-edit"
            aria-pressed="${_editMode}" title="Edit the lineage canvas — insert or delete nodes">${label}</button>`;
}

// ── Edit-mode plumbing (M6 Phase 2) ──────────────────────────────────

/** Re-render the modal header toggle + body from the working graph. */
function rerenderLineageBody(): void {
  if (!_modalEl) return;
  const header = _modalEl.querySelector('.schema-graph-header > div');
  if (header) {
    const toggle = header.querySelector('[data-action="toggle-lineage-edit"]');
    if (toggle) toggle.outerHTML = renderEditToggle(_workingGraph);
  }
  const body = _modalEl.querySelector<HTMLElement>('.lineage-body');
  if (body) body.innerHTML = renderList(_workingGraph, _editMode) + renderSvg(_workingGraph);
}

/** Apply a canvas op to the working graph, persist it, re-render. */
function applyOpAndRerender(op: CanvasOp): void {
  _workingGraph = applyCanvasOp(_workingGraph, op);
  // Persist into the store so the edit survives panel close/reopen + is
  // serialised with the workbook. NOTE: re-running a cell recomputes its
  // inbound edges from EXPLAIN and will overwrite that cell's edits — the
  // canvas is a projection (handoff §M6); materialising graph edits back
  // into notebook cells is the documented follow-up.
  getLineageStore().loadFromJson(_workingGraph);
  _workingGraph = getLineageStore().toJSON();
  rerenderLineageBody();
}

function handleEditClick(target: HTMLElement): void {
  const toggle = target.closest('[data-action="toggle-lineage-edit"]');
  if (toggle) {
    _editMode = !_editMode;
    _pendingDeleteNodeId = null;
    rerenderLineageBody();
    return;
  }
  const del = target.closest<HTMLElement>('[data-del-node]');
  if (del) {
    _pendingDeleteNodeId = del.dataset.delNode ?? null;
    rerenderLineageBody();
    return;
  }
  const cancel = target.closest('[data-cancel-del]');
  if (cancel) {
    _pendingDeleteNodeId = null;
    rerenderLineageBody();
    return;
  }
  const confirm = target.closest<HTMLElement>('[data-confirm-del]');
  if (confirm) {
    const nodeId = confirm.dataset.confirmDel;
    _pendingDeleteNodeId = null;
    if (nodeId) applyOpAndRerender({ kind: 'delete-node', nodeId });
    return;
  }
  const insert = target.closest<HTMLElement>('[data-insert-from]');
  if (insert) {
    const from = insert.dataset.insertFrom;
    const to = insert.dataset.insertTo;
    const sel = insert.closest('.lineage-insert')?.querySelector<HTMLSelectElement>('select');
    const newCellKind = (sel?.value ?? 'sql') as LineageCellKind;
    if (from && to) {
      applyOpAndRerender({
        kind: 'insert-on-edge',
        edge: { from, to },
        newCellKind,
        newCellId: `ins_${_insertSeq++}`,
      });
    }
  }
}

// ── List view (accessible truth) ────────────────────────────────────

function renderList(graph: LineageGraph, editMode: boolean): string {
  if (graph.nodes.length === 0) {
    return `
      <div class="lineage-list" style="padding:var(--space-4) var(--space-5);overflow:auto;border-right:1px solid var(--border);">
        <p style="color:var(--text-muted);font-size:var(--text-sm,12px);">
          No lineage recorded yet. Run a SQL cell to populate this panel.
        </p>
      </div>
    `;
  }

  const cells = graph.nodes.filter((n) => n.kind === 'cell');
  const sources = graph.nodes.filter((n) => n.kind === 'source');
  const sinks = graph.nodes.filter((n) => n.kind === 'sink');

  // Build a quick edge index for the list view.
  const incomingFor = new Map<string, LineageEdge[]>();
  const outgoingFor = new Map<string, LineageEdge[]>();
  for (const e of graph.edges) {
    const inList = incomingFor.get(e.to) ?? [];
    inList.push(e);
    incomingFor.set(e.to, inList);
    const outList = outgoingFor.get(e.from) ?? [];
    outList.push(e);
    outgoingFor.set(e.from, outList);
  }

  const nodeLabel = (id: string): string => {
    return graph.nodes.find((n) => n.id === id)?.label ?? id;
  };

  // Edit-mode affordances (M6 Phase 2). Only rendered in edit mode.
  const deleteControl = (node: LineageNode): string => {
    if (!editMode) return '';
    if (_pendingDeleteNodeId === node.id) {
      const deps = getDependentsOfNode(graph, node.id);
      const depNote = deps.length
        ? ` Also orphans ${deps.length} downstream node${deps.length === 1 ? '' : 's'}: ${deps
            .map((d) => escapeHtml(nodeLabel(d)))
            .join(', ')}.`
        : '';
      return `<span class="lineage-del-confirm" role="alertdialog" aria-label="Confirm delete">
        <span class="lineage-del-msg">Delete “${escapeHtml(node.label)}”?${depNote}</span>
        <button class="btn btn-ghost lineage-del-go" data-confirm-del="${escapeAttr(node.id)}">Delete</button>
        <button class="btn btn-ghost" data-cancel-del="1">Cancel</button>
      </span>`;
    }
    return `<button class="btn btn-ghost lineage-del-btn" data-del-node="${escapeAttr(node.id)}" title="Delete node" aria-label="Delete ${escapeHtml(node.label)}">${iconSvg('trash', 11)}</button>`;
  };

  const insertControl = (from: string, to: string): string => {
    if (!editMode) return '';
    const opts = INSERT_KINDS.map((k) => `<option value="${k}">${k}</option>`).join('');
    return `<span class="lineage-insert">
      <select class="lineage-insert-kind" aria-label="Cell kind to insert">${opts}</select>
      <button class="btn btn-ghost lineage-insert-go" data-insert-from="${escapeAttr(from)}" data-insert-to="${escapeAttr(to)}" title="Insert a cell on this edge">+ insert</button>
    </span>`;
  };

  const cellRows = cells
    .map((c) => {
      const incoming = incomingFor.get(c.id) ?? [];
      const outgoing = outgoingFor.get(c.id) ?? [];
      const inboundHtml = incoming.length
        ? incoming
            .map(
              (e) =>
                `<li class="lineage-edge lineage-edge-${e.confidence}">
                   <span class="lineage-arrow">←</span>
                   <span class="lineage-edge-label">${escapeHtml(nodeLabel(e.from))}</span>
                   ${e.confidence === 'low' ? '<span class="lineage-low">low-confidence</span>' : ''}
                   ${insertControl(e.from, e.to)}
                 </li>`,
            )
            .join('')
        : '<li class="lineage-empty">(no inputs)</li>';
      const outboundHtml = outgoing.length
        ? outgoing
            .map(
              (e) =>
                `<li class="lineage-edge">
                   <span class="lineage-arrow">→</span>
                   <span class="lineage-edge-label">${escapeHtml(nodeLabel(e.to))}</span>
                 </li>`,
            )
            .join('')
        : '';
      return `
        <li class="lineage-row" tabindex="0">
          <div class="lineage-row-head">
            <strong class="lineage-row-name">${escapeHtml(c.label)}</strong>
            <span class="lineage-kind-badge lineage-kind-cell">cell</span>
            ${deleteControl(c)}
          </div>
          ${inboundHtml ? `<ul class="lineage-edges">${inboundHtml}</ul>` : ''}
          ${outboundHtml ? `<ul class="lineage-edges">${outboundHtml}</ul>` : ''}
        </li>
      `;
    })
    .join('');

  const sourceRows = sources
    .map(
      (s) =>
        `<li class="lineage-row lineage-row-source" tabindex="0">
           <div class="lineage-row-head">
             <strong class="lineage-row-name">${escapeHtml(s.label)}</strong>
             <span class="lineage-kind-badge lineage-kind-source">source</span>
             ${deleteControl(s)}
           </div>
           ${s.ref ? `<div class="lineage-row-ref">${escapeHtml(s.ref)}</div>` : ''}
         </li>`,
    )
    .join('');

  const sinkRows = sinks
    .map(
      (s) =>
        `<li class="lineage-row lineage-row-sink" tabindex="0">
           <div class="lineage-row-head">
             <strong class="lineage-row-name">${escapeHtml(s.label)}</strong>
             <span class="lineage-kind-badge lineage-kind-sink">sink</span>
             ${deleteControl(s)}
           </div>
         </li>`,
    )
    .join('');

  const editHint = editMode
    ? `<p class="lineage-edit-hint" role="note">Editing the canvas — insert a cell on an edge or delete a node. Re-running a cell re-derives its inbound edges.</p>`
    : '';

  return `
    <div class="lineage-list" style="padding:var(--space-3) var(--space-4);overflow:auto;border-right:1px solid var(--border);min-width:0;">
      ${editHint}
      ${
        sources.length > 0
          ? `<h3 class="lineage-section-h">Sources</h3><ul class="lineage-section">${sourceRows}</ul>`
          : ''
      }
      ${
        cells.length > 0
          ? `<h3 class="lineage-section-h">Cells</h3><ul class="lineage-section">${cellRows}</ul>`
          : ''
      }
      ${
        sinks.length > 0
          ? `<h3 class="lineage-section-h">Sinks</h3><ul class="lineage-section">${sinkRows}</ul>`
          : ''
      }
    </div>
  `;
}

// ── SVG view (enhancement) ───────────────────────────────────────────

const NODE_W = 130;
const NODE_H = 36;
const COL_GAP = 36;
const ROW_GAP = 18;
const PAD_X = 16;
const PAD_Y = 16;

function renderSvg(graph: LineageGraph): string {
  if (graph.nodes.length === 0) {
    return `<div class="lineage-svg-wrap" style="display:flex;align-items:center;justify-content:center;padding:var(--space-4);"><p style="color:var(--text-muted);font-size:var(--text-sm,12px);">SVG view appears here after the first cell runs.</p></div>`;
  }

  const layout = layoutNodes(graph);

  const width = layout.totalWidth + PAD_X * 2;
  const height = layout.totalHeight + PAD_Y * 2;

  // Edges first (so nodes paint on top).
  const edgeSvg = graph.edges
    .map((e) => {
      const from = layout.positions.get(e.from);
      const to = layout.positions.get(e.to);
      if (!from || !to) return '';
      const x1 = from.x + NODE_W + PAD_X;
      const y1 = from.y + NODE_H / 2 + PAD_Y;
      const x2 = to.x + PAD_X;
      const y2 = to.y + NODE_H / 2 + PAD_Y;
      const stroke = e.confidence === 'low' ? 'var(--text-muted)' : 'var(--accent)';
      const dash = e.confidence === 'low' ? 'stroke-dasharray="4 4"' : '';
      // Quadratic Bezier for a gentle curve.
      const mx = (x1 + x2) / 2;
      return `<path d="M ${x1} ${y1} Q ${mx} ${y1} ${mx} ${(y1 + y2) / 2} T ${x2} ${y2}" stroke="${stroke}" fill="none" stroke-width="1.5" ${dash} marker-end="url(#lineage-arrow)"></path>`;
    })
    .join('\n');

  const nodeSvg = graph.nodes
    .map((n) => {
      const pos = layout.positions.get(n.id);
      if (!pos) return '';
      const x = pos.x + PAD_X;
      const y = pos.y + PAD_Y;
      const fill = nodeFill(n);
      const stroke = nodeStroke(n);
      const label = ellipsize(n.label, 18);
      const kindLabel = n.kind === 'source' ? '◢' : n.kind === 'sink' ? '◣' : '●';
      return `
        <g class="lineage-svg-node" tabindex="0">
          <rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="6" ry="6"
                fill="${fill}" stroke="${stroke}" stroke-width="1" />
          <text x="${x + 10}" y="${y + NODE_H / 2 + 1}" dominant-baseline="middle"
                font-size="11" fill="var(--text)" font-weight="500">
            <tspan font-weight="bold" fill="${stroke}">${kindLabel}</tspan> ${escapeHtml(label)}
          </text>
        </g>
      `;
    })
    .join('\n');

  return `
    <div class="lineage-svg-wrap" style="padding:var(--space-3) var(--space-4);overflow:auto;min-width:0;background:var(--surface-subtle,#f9fafb);">
      <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Lineage diagram (SVG)">
        <defs>
          <marker id="lineage-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)"></path>
          </marker>
        </defs>
        ${edgeSvg}
        ${nodeSvg}
      </svg>
    </div>
  `;
}

/**
 * Three-lane topological layout:
 *   - sources fill column 0
 *   - cells fill columns 1..N by topological depth (longest path from
 *     any source). Cycles, if they ever exist, get the depth they
 *     would have under a tie-break iteration cap.
 *   - sinks fill the last column
 *
 * Within a column, rows are alphabetical-by-label for determinism.
 */
function layoutNodes(graph: LineageGraph): {
  positions: Map<string, { x: number; y: number }>;
  totalWidth: number;
  totalHeight: number;
} {
  const positions = new Map<string, { x: number; y: number }>();

  // Compute depth per cell by Kahn-like longest-path.
  const depth = new Map<string, number>();
  for (const n of graph.nodes) {
    if (n.kind === 'source') depth.set(n.id, 0);
    if (n.kind === 'cell') depth.set(n.id, 0);
    // Sinks aren't depth-ranked — they're placed in the final column
    // directly from their kind, so the old Infinity seed was never read (L16).
  }

  // Run a few passes — handles a chain of arbitrary cell depth.
  const cells = graph.nodes.filter((n) => n.kind === 'cell');
  for (let iter = 0; iter < cells.length + 1; iter++) {
    let changed = false;
    for (const e of graph.edges) {
      const fromDepth = depth.get(e.from);
      const toNode = graph.nodes.find((n) => n.id === e.to);
      if (toNode?.kind !== 'cell') continue;
      if (typeof fromDepth !== 'number' || !Number.isFinite(fromDepth)) continue;
      const proposed = fromDepth + 1;
      if (proposed > (depth.get(e.to) ?? 0)) {
        depth.set(e.to, proposed);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Group by column.
  const maxCellDepth = Math.max(1, ...cells.map((c) => depth.get(c.id) ?? 1));
  const sinkCol = maxCellDepth + 1;

  const columns: LineageNode[][] = [];
  for (let c = 0; c <= sinkCol; c++) columns.push([]);

  for (const n of graph.nodes) {
    if (n.kind === 'source') columns[0]!.push(n);
    else if (n.kind === 'sink') columns[sinkCol]!.push(n);
    else {
      const d = Math.max(1, depth.get(n.id) ?? 1);
      // Cells without an inbound edge land in column 1 too.
      columns[Math.min(d, maxCellDepth)]!.push(n);
    }
  }

  for (const col of columns) {
    col.sort((a, b) => a.label.localeCompare(b.label));
  }

  // Assign positions.
  let maxColHeight = 0;
  columns.forEach((col, ci) => {
    col.forEach((n, ri) => {
      positions.set(n.id, {
        x: ci * (NODE_W + COL_GAP),
        y: ri * (NODE_H + ROW_GAP),
      });
    });
    const colHeight = col.length * (NODE_H + ROW_GAP);
    if (colHeight > maxColHeight) maxColHeight = colHeight;
  });

  const totalWidth = (sinkCol + 1) * NODE_W + sinkCol * COL_GAP;
  const totalHeight = maxColHeight;
  return { positions, totalWidth, totalHeight };
}

function nodeFill(n: LineageNode): string {
  if (n.kind === 'source') return '#eff6ff';
  if (n.kind === 'sink') return '#f0fdf4';
  return '#fffbeb';
}

function nodeStroke(n: LineageNode): string {
  if (n.kind === 'source') return '#3b82f6';
  if (n.kind === 'sink') return '#16a34a';
  return '#f59e0b';
}

function ellipsize(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export const _internalsForTesting = { layoutNodes, ellipsize };
