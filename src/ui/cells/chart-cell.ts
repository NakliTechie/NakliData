// Chart cell. Renders one of seven chart types from a previous SQL cell's
// result. The actual chart renderer lives in src/charts/render.ts; here
// we own the cell chrome and the chart-type / x / y picker.

import { renderChart } from '../../charts/render.ts';
import { iconSvg } from '../../tokens/icons.ts';
import type { CellHandlers, ChartCellState, SqlCellState } from './types.ts';

export function renderChartCell(
  cell: ChartCellState,
  upstreamCells: SqlCellState[],
  handlers: CellHandlers,
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cell';
  el.dataset.cellId = cell.id;
  el.dataset.cellKind = 'chart';

  const input = upstreamCells.find((c) => c.id === cell.inputCell);
  const cols = input?.lastResult?.columns ?? [];

  el.innerHTML = `
    <div class="cell-head">
      <span class="cell-kind">CHART</span>
      <span style="color: var(--text-muted); font-size:11px;">Chart of</span>
      <select data-action="chart-input" aria-label="Input cell" style="font-size:12px;">
        <option value="">— pick a SQL cell —</option>
        ${upstreamCells
          .map(
            (c) =>
              `<option value="${c.id}" ${c.id === cell.inputCell ? 'selected' : ''}>${escapeHtml(c.name ?? c.id)}</option>`,
          )
          .join('')}
      </select>
      <select data-action="chart-type" aria-label="Chart type" style="font-size:12px;">
        ${['bar', 'line', 'area', 'scatter', 'histogram', 'stat', 'table']
          .map(
            (k) => `<option value="${k}" ${cell.chartType === k ? 'selected' : ''}>${k}</option>`,
          )
          .join('')}
      </select>
      ${cols.length > 0 ? renderColPickers(cell, cols) : ''}
      <div class="cell-actions">
        <button class="btn btn-ghost" data-action="cell-delete" title="Delete cell" aria-label="Delete cell">
          ${iconSvg('trash', 12)}
        </button>
      </div>
    </div>
    <div class="cell-output" data-region="chart-canvas">
      ${input?.lastResult ? '' : '<div class="cell-output-empty">Pick a SQL cell that has been run.</div>'}
    </div>
  `;

  for (const sel of el.querySelectorAll<HTMLSelectElement>('select')) {
    sel.addEventListener('change', () => {
      const patch: Record<string, unknown> = {};
      if (sel.dataset.action === 'chart-input') patch.inputCell = sel.value || null;
      if (sel.dataset.action === 'chart-type') patch.chartType = sel.value;
      if (sel.dataset.action === 'chart-x') patch.x = sel.value || null;
      if (sel.dataset.action === 'chart-y') patch.y = sel.value || null;
      handlers.onChange(cell.id, patch);
    });
  }

  el.querySelector('[data-action="cell-delete"]')?.addEventListener('click', () =>
    handlers.onDelete(cell.id),
  );

  if (input?.lastResult) {
    const canvasMount = el.querySelector<HTMLElement>('[data-region="chart-canvas"]');
    if (canvasMount) {
      // Defer to next microtask so layout settles.
      queueMicrotask(() => {
        renderChart(
          canvasMount,
          cell,
          input.lastResult ?? { columns: [], rows: [], rowCount: 0, elapsedMs: 0 },
        );
      });
    }
  }

  return el;
}

function renderColPickers(cell: ChartCellState, cols: string[]): string {
  const sel = (label: string, action: string, current: string | null | undefined) => `
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
  return sel('x', 'chart-x', cell.x) + sel('y', 'chart-y', cell.y);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
