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
      <input class="cell-name" data-region="cell-name" value="${escapeAttr(cell.name ?? '')}"
             placeholder="@name (optional)" aria-label="Chart cell name"
             style="border:0;background:transparent;width:120px;outline:none;font-family:var(--font-mono);font-size:11px;" />
      <span style="color: var(--text-muted); font-size:11px;">of</span>
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
        ${[
          'bar',
          'line',
          'area',
          'scatter',
          'histogram',
          'pie',
          'stacked-bar',
          'area-stacked',
          'heatmap',
          'stat',
          'table',
        ]
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
      if (sel.dataset.action === 'chart-facet') patch.facet = sel.value || null;
      handlers.onChange(cell.id, patch);
    });
  }

  // Bind the name input (W6.4 — dashboards reference cells by name).
  const nameInput = el.querySelector<HTMLInputElement>('[data-region="cell-name"]');
  nameInput?.addEventListener('change', () => {
    handlers.onChange(cell.id, { name: nameInput.value.trim() || null });
  });

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

// Chart types that meaningfully respond to a facet-by column. Other
// chart types (bar / line / scatter / etc.) ignore the facet field
// even if a value sneaks through from a saved file.
const FACETABLE: ReadonlySet<ChartCellState['chartType']> = new Set([
  'pie',
  'stacked-bar',
  'area-stacked',
  'heatmap',
]);

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
  const xy = sel('x', 'chart-x', cell.x) + sel('y', 'chart-y', cell.y);
  return FACETABLE.has(cell.chartType) ? xy + sel('facet', 'chart-facet', cell.facet) : xy;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
