// Network / force-graph cell (Facet track). Renders an upstream SQL cell whose
// rows are EDGES — a source-id column + a target-id column — as a force-directed
// graph. Distinct ids become nodes (sized + coloured by degree); an in-house
// synchronous force sim lays them out (core/force-layout.ts — CSP-clean, no
// dep, no rAF; DECISIONS BS-addendum); deck.gl draws edges (LineLayer) + nodes
// (ScatterplotLayer). Clicking a node highlights its immediate neighbourhood;
// clicking the background clears.
//
// Layout is derived data: recomputed from the edge rows, cached in-memory by an
// input signature so an unrelated re-render doesn't re-run the sim, and NOT
// persisted (only the config on NetworkCellState is).
//
// deck.gl lives in the shared `deckgl` lazy chunk; nothing loads until a
// Network cell actually renders. Mirrors embedding-cell.ts.

import {
  type LayoutPositions,
  NETWORK_LAYOUT_MAX,
  NetworkTooLargeError,
  forceLayout,
} from '../../core/force-layout.ts';
import { loadChunk } from '../../core/lazy-loader.ts';
import { iconSvg } from '../../tokens/icons.ts';
import type { CellHandlers, NetworkCellState, SqlCellState } from './types.ts';

/** Neighbours highlighted per node click (immediate adjacency, capped). */
const NEIGHBOUR_CAP = 200;

// Module-level layout cache: cellId → { sig, positions }. `sig` folds the
// inputs that change the layout (input cell, columns, row count); a cache hit
// skips the recompute on an unrelated re-render.
interface CacheEntry {
  sig: string;
  positions: LayoutPositions;
}
const _layoutCache = new Map<string, CacheEntry>();

export function renderNetworkCell(
  cell: NetworkCellState,
  upstreamCells: SqlCellState[],
  handlers: CellHandlers,
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cell';
  el.dataset.cellId = cell.id;
  el.dataset.cellKind = 'network';

  const input = upstreamCells.find((c) => c.id === cell.inputCell);
  const cols = input?.lastResult?.columns ?? [];

  el.innerHTML = `
    <div class="cell-head">
      <span class="cell-kind">GRAPH</span>
      <input class="cell-name" data-region="cell-name" value="${escapeHtml(cell.name ?? '')}"
             placeholder="@name (optional)" aria-label="Network cell name"
             style="border:0;background:transparent;width:140px;outline:none;font-family:var(--font-mono);font-size:11px;" />
      <span style="color: var(--text-muted); font-size:11px;">of</span>
      <select data-action="net-input" aria-label="Input cell" style="font-size:12px;">
        <option value="">— pick a SQL cell —</option>
        ${upstreamCells
          .map(
            (c) =>
              `<option value="${c.id}" ${c.id === cell.inputCell ? 'selected' : ''}>${escapeHtml(c.name ?? c.id)}</option>`,
          )
          .join('')}
      </select>
      ${cols.length > 0 ? renderPickers(cell, cols) : ''}
      <div class="cell-actions">
        <button class="btn btn-ghost" data-action="cell-delete" title="Delete cell" aria-label="Delete cell">
          ${iconSvg('trash', 12)}
        </button>
      </div>
    </div>
    <div class="cell-output cell-output-map" data-region="net-canvas">
      ${input?.lastResult ? '' : '<div class="cell-output-empty">Pick a SQL cell whose rows are edges (a source-id and target-id column).</div>'}
    </div>
    <div data-region="net-tip" style="font-size:11px;color:var(--text-muted);padding:2px 4px;min-height:15px;"></div>
  `;

  const nameInput = el.querySelector<HTMLInputElement>('[data-region="cell-name"]');
  nameInput?.addEventListener('change', () => {
    handlers.onChange(cell.id, { name: nameInput.value.trim() || null });
  });

  for (const sel of el.querySelectorAll<HTMLSelectElement>('select')) {
    sel.addEventListener('change', () => {
      const patch: Record<string, unknown> = {};
      switch (sel.dataset.action) {
        case 'net-input':
          patch.inputCell = sel.value || null;
          break;
        case 'net-source':
          patch.sourceCol = sel.value || null;
          break;
        case 'net-target':
          patch.targetCol = sel.value || null;
          break;
      }
      handlers.onChange(cell.id, patch);
    });
  }

  el.querySelector('[data-action="cell-delete"]')?.addEventListener('click', () =>
    handlers.onDelete(cell.id),
  );

  const mount = el.querySelector<HTMLElement>('[data-region="net-canvas"]');
  const tip = el.querySelector<HTMLElement>('[data-region="net-tip"]');
  if (mount) {
    if (input?.lastResult && cell.sourceCol && cell.targetCol) {
      // Defer to next microtask so layout settles + the canvas gets non-zero size.
      queueMicrotask(() => renderGraph(mount, tip, cell, input.lastResult ?? null));
    } else if (input?.lastResult) {
      mount.innerHTML = '<div class="cell-output-empty">Pick the source and target columns.</div>';
    }
  }

  return el;
}

function renderPickers(cell: NetworkCellState, cols: string[]): string {
  const pick = (label: string, action: string, current: string | null) => `
    <label style="font-size:11px;color:var(--text-muted);display:inline-flex;align-items:center;gap:4px;">
      ${label}
      <select data-action="${action}" style="font-size:12px;">
        <option value="">—</option>
        ${cols
          .map(
            (c) =>
              `<option value="${escapeHtml(c)}" ${current === c ? 'selected' : ''}>${escapeHtml(c)}</option>`,
          )
          .join('')}
      </select>
    </label>`;
  return (
    pick('source', 'net-source', cell.sourceCol) + pick('target', 'net-target', cell.targetCol)
  );
}

interface GraphNode {
  id: string;
  degree: number;
}
interface GraphEdge {
  source: string;
  target: string;
}

/** Build the node set (distinct ids + degree) and edge list from result rows. */
function buildGraph(
  rows: Array<Record<string, unknown>>,
  sourceCol: string,
  targetCol: string,
): { nodes: GraphNode[]; edges: GraphEdge[]; adjacency: Map<string, Set<string>> } {
  const degree = new Map<string, number>();
  const adjacency = new Map<string, Set<string>>();
  const edges: GraphEdge[] = [];
  const bump = (id: string) => degree.set(id, (degree.get(id) ?? 0) + 1);
  const link = (a: string, b: string) => {
    let set = adjacency.get(a);
    if (!set) {
      set = new Set();
      adjacency.set(a, set);
    }
    set.add(b);
  };
  for (const row of rows) {
    const s = row[sourceCol];
    const t = row[targetCol];
    if (s == null || t == null) continue;
    const source = String(s);
    const target = String(t);
    if (source === target) continue; // skip self-loops
    edges.push({ source, target });
    bump(source);
    bump(target);
    link(source, target);
    link(target, source);
  }
  const nodes: GraphNode[] = Array.from(degree, ([id, d]) => ({ id, degree: d }));
  return { nodes, edges, adjacency };
}

async function renderGraph(
  mount: HTMLElement,
  tip: HTMLElement | null,
  cell: NetworkCellState,
  result: { rows: Array<Record<string, unknown>>; columns: string[] } | null,
): Promise<void> {
  if (!result || !cell.sourceCol || !cell.targetCol) return;
  mount.innerHTML = '<div class="cell-output-empty">Building graph…</div>';

  const { nodes, edges, adjacency } = buildGraph(result.rows, cell.sourceCol, cell.targetCol);
  if (nodes.length === 0) {
    mount.innerHTML = `<div class="cell-output-empty">No edges in "${escapeHtml(cell.sourceCol)}" → "${escapeHtml(cell.targetCol)}" (both columns non-null?).</div>`;
    return;
  }
  if (nodes.length > NETWORK_LAYOUT_MAX) {
    // Honest ceiling — don't freeze the tab (or load the heavy chunk) on a
    // graph the in-browser force sim can't lay out interactively.
    mount.innerHTML = `<div class="cell-output-empty">Graph has ${nodes.length.toLocaleString()} nodes — in-browser force layout is limited to ${NETWORK_LAYOUT_MAX.toLocaleString()}. Filter the edge list down, or precompute x / y and use an Embedding cell to scatter them.</div>`;
    return;
  }

  // Layout FIRST (core module, no chunk needed), then the render chunk — so a
  // too-large or failed layout never fetches the heavy deck.gl bundle.
  const sig = `${cell.inputCell}|${cell.sourceCol}|${cell.targetCol}|${result.rows.length}|${nodes.length}`;
  let positions =
    _layoutCache.get(cell.id)?.sig === sig ? _layoutCache.get(cell.id)?.positions : null;
  if (!positions) {
    mount.innerHTML = `<div class="cell-output-empty">Laying out ${nodes.length.toLocaleString()} nodes / ${edges.length.toLocaleString()} edges…</div>`;
    try {
      // Yield to the event loop as the sim runs so the tab stays responsive
      // (the sim itself paces the callback to ~every 30 ms of compute).
      positions = await forceLayout(nodes, edges, {
        onIteration: () => new Promise((r) => setTimeout(r, 0)),
      });
    } catch (err) {
      const msg = err instanceof NetworkTooLargeError ? err.message : errMsg(err);
      mount.innerHTML = `<div class="cell-output-empty">Force layout failed: ${escapeHtml(msg)}</div>`;
      return;
    }
    _layoutCache.set(cell.id, { sig, positions });
  }

  mount.innerHTML = '';
  mount.style.height = '440px';

  let mod: Awaited<ReturnType<typeof loadChunk<'deckgl'>>>;
  try {
    mod = await loadChunk('deckgl');
  } catch (err) {
    mount.innerHTML = `<div class="cell-output-empty">Couldn't load the graph renderer: ${escapeHtml(errMsg(err))}</div>`;
    return;
  }

  // Render lists. `renderNodes` index === node index (used for highlight +
  // neighbour lookup); `idIndex` maps id → that index.
  const renderNodes = nodes.map((n) => {
    const p = positions.get(n.id) ?? [0, 0];
    return { id: n.id, position: p as [number, number], degree: n.degree };
  });
  const idIndex = new Map<string, number>();
  renderNodes.forEach((n, i) => idIndex.set(n.id, i));
  const renderEdges = edges.flatMap((e) => {
    const s = positions.get(e.source);
    const t = positions.get(e.target);
    return s && t ? [{ sourcePosition: s, targetPosition: t }] : [];
  });

  try {
    const handle = mod.mountNetworkGraph({
      container: mount,
      nodes: renderNodes,
      edges: renderEdges,
      onHover: (label) => {
        if (tip && !tip.dataset.pinned) tip.textContent = label ?? '';
      },
      onClick: (index) => {
        if (index === null) {
          handle.setHighlight(null, []);
          if (tip) {
            delete tip.dataset.pinned;
            tip.textContent = '';
          }
          return;
        }
        const node = renderNodes[index];
        if (!node) return;
        const nbrIds = adjacency.get(node.id) ?? new Set<string>();
        const neighbors: number[] = [];
        for (const nid of nbrIds) {
          const i = idIndex.get(nid);
          if (i !== undefined) neighbors.push(i);
          if (neighbors.length >= NEIGHBOUR_CAP) break;
        }
        handle.setHighlight(index, neighbors);
        if (tip) {
          tip.dataset.pinned = '1';
          const shown = nbrIds.size > NEIGHBOUR_CAP ? `${NEIGHBOUR_CAP}+` : String(nbrIds.size);
          tip.textContent = `${node.id} — degree ${node.degree}, ${shown} neighbours highlighted — click background to clear`;
        }
      },
    });
    (mount as HTMLElement & { __networkGraph?: unknown }).__networkGraph = handle;
  } catch (err) {
    mount.innerHTML = `<div class="cell-output-empty">Couldn't render the graph: ${escapeHtml(errMsg(err))}</div>`;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
