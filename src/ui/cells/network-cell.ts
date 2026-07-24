// Network / force-graph cell (Facet track). Renders an upstream SQL cell whose
// rows are EDGES — a source-id column + a target-id column — as a force-directed
// graph. Distinct ids become nodes (sized + coloured by degree); an in-house
// synchronous force sim lays them out (core/force-layout.ts — CSP-clean, no
// dep, no rAF; DECISIONS BS-addendum); deck.gl draws edges (LineLayer) + nodes
// (ScatterplotLayer). Clicking a node highlights its immediate neighbourhood;
// clicking the background clears.
//
// This file is the cell CHROME only — the picker row, event wiring, and empty
// states. The heavy RENDER BODY (graph build, force-layout orchestration, the
// node-metric worker round-trip, the deck.gl mount, the legend, and the layout
// / metric caches) lives in the `facet-network` lazy chunk so it stays off the
// inlined shell budget (spec §7.1 / A35 — same split `facet-charts.ts` does for
// the Temporal/Distribution render bodies). Nothing loads until a Network cell
// actually renders; `deck.gl` itself lives one hop further in the `deckgl`
// chunk. `disposeNetworkCell` delegates to the chunk once it's loaded — a
// no-op before then, which is correct: the caches are only ever populated by a
// render, which is what pulls the chunk in.

import { loadChunk } from '../../core/lazy-loader.ts';
import type { LazyChunkRegistry } from '../../core/lazy-loader.ts';
import { iconSvg } from '../../tokens/icons.ts';
import type { CellHandlers, NetworkCellState, NodeMetric, ResultRefCell } from './types.ts';

// Display labels for the node-metric picker. The `facet-network` chunk keeps its
// own copy for tooltips/notes — a closed four-metric set, mirrored the way the
// chunk-local `escapeHtml` mirrors the shell's.
const METRIC_LABELS: Record<NodeMetric, string> = {
  degree: 'degree',
  pagerank: 'PageRank',
  betweenness: 'betweenness',
  community: 'community',
};

// Reference to the loaded render chunk, captured on the first render so the
// synchronous `disposeNetworkCell` (called from Notebook.deleteCell) can reach
// the caches without forcing a chunk load. Null until the first graph renders.
let _netChunk: LazyChunkRegistry['facet-network'] | null = null;

/** L27: drop a deleted cell's cached layout so positions don't leak for the
 *  tab's lifetime. Called from Notebook.deleteCell. Delegates to the render
 *  chunk; a no-op until a graph has rendered (nothing is cached before then). */
export function disposeNetworkCell(id: string): void {
  _netChunk?.disposeNetworkCell(id);
}

export function renderNetworkCell(
  cell: NetworkCellState,
  upstreamCells: ResultRefCell[],
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
    <div data-region="net-legend" style="display:flex;flex-wrap:wrap;gap:8px;padding:2px 4px;"></div>
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
        case 'net-edge-color':
          patch.edgeColorCol = sel.value || null;
          break;
        case 'net-edge-width':
          patch.edgeWidthCol = sel.value || null;
          break;
        case 'net-metric':
          patch.nodeMetric = (sel.value || 'degree') as NodeMetric;
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
      // Defer to next microtask so layout settles + the canvas gets non-zero
      // size, then load the render chunk. Capture the module so the synchronous
      // dispose path can reach its caches. A re-render that fires before the
      // chunk resolves just kicks off another load — loadChunk dedups.
      const result = input.lastResult;
      queueMicrotask(() => {
        void loadChunk('facet-network').then((m) => {
          _netChunk = m;
          return m.renderGraph(mount, tip, cell, result);
        });
      });
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
  const metric = cell.nodeMetric ?? 'degree';
  const metricPick = `
    <label style="font-size:11px;color:var(--text-muted);display:inline-flex;align-items:center;gap:4px;">
      color/size by
      <select data-action="net-metric" style="font-size:12px;">
        ${(['degree', 'pagerank', 'betweenness', 'community'] as NodeMetric[])
          .map(
            (m) =>
              `<option value="${m}" ${metric === m ? 'selected' : ''}>${METRIC_LABELS[m]}</option>`,
          )
          .join('')}
      </select>
    </label>`;
  return (
    pick('source', 'net-source', cell.sourceCol) +
    pick('target', 'net-target', cell.targetCol) +
    pick('edge color', 'net-edge-color', cell.edgeColorCol ?? null) +
    pick('edge width', 'net-edge-width', cell.edgeWidthCol ?? null) +
    metricPick
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
