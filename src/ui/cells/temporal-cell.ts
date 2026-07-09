// Temporal cell (Facet track). Buckets an upstream SQL cell's time column into
// a histogram over time and draws it as an SVG bar timeline with a brushable
// window (drag → readout shows the range + in-window row count). The SVG render
// lives in the `facet-charts` lazy chunk (kept out of the shell for budget —
// spec §7.1); this file is just the cell chrome. Bucketing is core/temporal.ts.
// Mirrors embedding-cell.ts's shape.

import { loadChunk } from '../../core/lazy-loader.ts';
import { iconSvg } from '../../tokens/icons.ts';
import type { CellHandlers, ResultRefCell, TemporalCellState } from './types.ts';

export function renderTemporalCell(
  cell: TemporalCellState,
  upstreamCells: ResultRefCell[],
  handlers: CellHandlers,
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cell';
  el.dataset.cellId = cell.id;
  el.dataset.cellKind = 'temporal';

  const input = upstreamCells.find((c) => c.id === cell.inputCell);
  const cols = input?.lastResult?.columns ?? [];

  el.innerHTML = `
    <div class="cell-head">
      <span class="cell-kind">TIME</span>
      <input class="cell-name" data-region="cell-name" value="${escapeHtml(cell.name ?? '')}"
             placeholder="@name (optional)" aria-label="Temporal cell name"
             style="border:0;background:transparent;width:140px;outline:none;font-family:var(--font-mono);font-size:11px;" />
      <span style="color: var(--text-muted); font-size:11px;">of</span>
      <select data-action="temporal-input" aria-label="Input cell" style="font-size:12px;">
        <option value="">— pick a SQL cell —</option>
        ${upstreamCells
          .map(
            (c) =>
              `<option value="${c.id}" ${c.id === cell.inputCell ? 'selected' : ''}>${escapeHtml(c.name ?? c.id)}</option>`,
          )
          .join('')}
      </select>
      ${cols.length > 0 ? renderTimePicker(cell, cols) : ''}
      <div class="cell-actions">
        <button class="btn btn-ghost" data-action="cell-delete" title="Delete cell" aria-label="Delete cell">
          ${iconSvg('trash', 12)}
        </button>
      </div>
    </div>
    <div class="cell-output" data-region="temporal-canvas">
      ${input?.lastResult ? '' : '<div class="cell-output-empty">Pick a SQL cell that has a date / timestamp column.</div>'}
    </div>
    <div data-region="temporal-readout" style="font-size:11px;color:var(--text-muted);padding:2px 4px;min-height:15px;"></div>
  `;

  const nameInput = el.querySelector<HTMLInputElement>('[data-region="cell-name"]');
  nameInput?.addEventListener('change', () => {
    handlers.onChange(cell.id, { name: nameInput.value.trim() || null });
  });

  for (const sel of el.querySelectorAll<HTMLSelectElement>('select')) {
    sel.addEventListener('change', () => {
      const patch: Record<string, unknown> = {};
      if (sel.dataset.action === 'temporal-input') patch.inputCell = sel.value || null;
      else if (sel.dataset.action === 'temporal-time') patch.timeCol = sel.value || null;
      handlers.onChange(cell.id, patch);
    });
  }

  el.querySelector('[data-action="cell-delete"]')?.addEventListener('click', () =>
    handlers.onDelete(cell.id),
  );

  const mount = el.querySelector<HTMLElement>('[data-region="temporal-canvas"]');
  const readout = el.querySelector<HTMLElement>('[data-region="temporal-readout"]');
  if (mount && input?.lastResult && cell.timeCol) {
    const timeCol = cell.timeCol;
    const rows = input.lastResult.rows;
    mount.innerHTML = '<div class="cell-output-empty">Rendering…</div>';
    void loadChunk('facet-charts')
      .then((m) =>
        m.renderTimeline(mount, readout, timeCol, rows, {
          selection: cell.selection ?? null,
          onSelect: (sel) => handlers.onCrossfilter(cell.id, sel),
        }),
      )
      .catch((err) => {
        mount.innerHTML = `<div class="cell-output-empty">Couldn't render the timeline: ${escapeHtml(err instanceof Error ? err.message : String(err))}</div>`;
      });
  } else if (mount && input?.lastResult) {
    mount.innerHTML = '<div class="cell-output-empty">Pick the time column.</div>';
  }

  return el;
}

function renderTimePicker(cell: TemporalCellState, cols: string[]): string {
  return `
    <label style="font-size:11px;color:var(--text-muted);display:inline-flex;align-items:center;gap:4px;">
      time
      <select data-action="temporal-time" style="font-size:12px;">
        <option value="">—</option>
        ${cols
          .map(
            (c) =>
              `<option value="${escapeHtml(c)}" ${cell.timeCol === c ? 'selected' : ''}>${escapeHtml(c)}</option>`,
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
