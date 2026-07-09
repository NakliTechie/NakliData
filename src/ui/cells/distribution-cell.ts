// Distribution cell (Facet track). Summarizes one column of an upstream SQL
// cell as SVG bars: numeric → histogram, categorical → top-N value bars; click
// a bar to select it. The SVG render lives in the `facet-charts` lazy chunk
// (kept out of the shell for budget — spec §7.1); this file is just the cell
// chrome. Classification + counting is core/distribution.ts. Mirrors
// temporal-cell.ts's shape.

import { loadChunk } from '../../core/lazy-loader.ts';
import { iconSvg } from '../../tokens/icons.ts';
import type { CellHandlers, DistributionCellState, ResultRefCell } from './types.ts';

export function renderDistributionCell(
  cell: DistributionCellState,
  upstreamCells: ResultRefCell[],
  handlers: CellHandlers,
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cell';
  el.dataset.cellId = cell.id;
  el.dataset.cellKind = 'distribution';

  const input = upstreamCells.find((c) => c.id === cell.inputCell);
  const cols = input?.lastResult?.columns ?? [];

  el.innerHTML = `
    <div class="cell-head">
      <span class="cell-kind">DIST</span>
      <input class="cell-name" data-region="cell-name" value="${escapeHtml(cell.name ?? '')}"
             placeholder="@name (optional)" aria-label="Distribution cell name"
             style="border:0;background:transparent;width:140px;outline:none;font-family:var(--font-mono);font-size:11px;" />
      <span style="color: var(--text-muted); font-size:11px;">of</span>
      <select data-action="dist-input" aria-label="Input cell" style="font-size:12px;">
        <option value="">— pick a SQL cell —</option>
        ${upstreamCells
          .map(
            (c) =>
              `<option value="${c.id}" ${c.id === cell.inputCell ? 'selected' : ''}>${escapeHtml(c.name ?? c.id)}</option>`,
          )
          .join('')}
      </select>
      ${cols.length > 0 ? renderColumnPicker(cell, cols) : ''}
      <div class="cell-actions">
        <button class="btn btn-ghost" data-action="cell-delete" title="Delete cell" aria-label="Delete cell">
          ${iconSvg('trash', 12)}
        </button>
      </div>
    </div>
    <div class="cell-output" data-region="dist-canvas">
      ${input?.lastResult ? '' : '<div class="cell-output-empty">Pick a SQL cell, then a column to summarize.</div>'}
    </div>
    <div data-region="dist-readout" style="font-size:11px;color:var(--text-muted);padding:2px 4px;min-height:15px;"></div>
  `;

  const nameInput = el.querySelector<HTMLInputElement>('[data-region="cell-name"]');
  nameInput?.addEventListener('change', () => {
    handlers.onChange(cell.id, { name: nameInput.value.trim() || null });
  });

  for (const sel of el.querySelectorAll<HTMLSelectElement>('select')) {
    sel.addEventListener('change', () => {
      const patch: Record<string, unknown> = {};
      if (sel.dataset.action === 'dist-input') patch.inputCell = sel.value || null;
      else if (sel.dataset.action === 'dist-column') patch.column = sel.value || null;
      handlers.onChange(cell.id, patch);
    });
  }

  el.querySelector('[data-action="cell-delete"]')?.addEventListener('click', () =>
    handlers.onDelete(cell.id),
  );

  const mount = el.querySelector<HTMLElement>('[data-region="dist-canvas"]');
  const readout = el.querySelector<HTMLElement>('[data-region="dist-readout"]');
  if (mount && input?.lastResult && cell.column) {
    const column = cell.column;
    const rows = input.lastResult.rows;
    mount.innerHTML = '<div class="cell-output-empty">Rendering…</div>';
    void loadChunk('facet-charts')
      .then((m) => m.renderDistribution(mount, readout, column, rows))
      .catch((err) => {
        mount.innerHTML = `<div class="cell-output-empty">Couldn't render the distribution: ${escapeHtml(err instanceof Error ? err.message : String(err))}</div>`;
      });
  } else if (mount && input?.lastResult) {
    mount.innerHTML = '<div class="cell-output-empty">Pick a column.</div>';
  }

  return el;
}

function renderColumnPicker(cell: DistributionCellState, cols: string[]): string {
  return `
    <label style="font-size:11px;color:var(--text-muted);display:inline-flex;align-items:center;gap:4px;">
      column
      <select data-action="dist-column" style="font-size:12px;">
        <option value="">—</option>
        ${cols
          .map(
            (c) =>
              `<option value="${escapeHtml(c)}" ${cell.column === c ? 'selected' : ''}>${escapeHtml(c)}</option>`,
          )
          .join('')}
      </select>
    </label>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
