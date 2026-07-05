// Dashboard cell — Wave 6 W6.4.
//
// Closes the "linear notebook can't show a real dashboard" gap.
// Renders a CSS grid of referenced cells (markdown / chart / pivot /
// map), each in its own slot, by re-invoking the appropriate
// renderer with a no-op handler set (so the embedded copies have no
// edit/run/delete chrome).
//
// The dashboard cell itself has small edit chrome: a columns-count
// input + a comma-separated list of cell names. Both update via
// onChange; the grid re-renders on every workbook tick.
//
// What dashboards do NOT do (intentional):
// - Drag-and-drop layout. The user types cell names in order; layout
//   flows left-to-right, top-to-bottom in a fixed column grid.
// - Cross-cell linking. Cohorts/inputs already let the user share
//   state through @-refs; a dashboard slot is just a render port,
//   not a wiring layer.
// - Hide/show. Cells not listed in `items` simply aren't rendered.

import { iconSvg } from '../../tokens/icons.ts';
import { renderChartCell } from './chart-cell.ts';
import { renderMapCell } from './map-cell.ts';
import { renderMarkdownCell } from './markdown-cell.ts';
import { renderPivotCell } from './pivot-cell.ts';
import type { CellHandlers, CellState, DashboardCellState, SqlCellState } from './types.ts';

const NOOP_HANDLERS: CellHandlers = {
  onRun: () => {},
  onChange: () => {},
  onChangeSilent: () => {},
  onDelete: () => {},
};

export function renderDashboardCell(
  cell: DashboardCellState,
  /** Every cell in the notebook (used to resolve `items` by name). */
  allCells: CellState[],
  handlers: CellHandlers,
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cell';
  el.dataset.cellId = cell.id;
  el.dataset.cellKind = 'dashboard';

  // Defensive defaults — a hand-edited or third-party-tool-generated
  // .naklidata might land a dashboard cell missing `items` or `columns`.
  // The persistence parser trusts the JSON shape (per spec) so this is
  // the right place to recover. (Audit follow-up.)
  //
  // Columns: `Number(0) || 2` would flip an explicit 0 to 2 instead of
  // clamping to 1 (because 0 is falsy). Check finiteness and positivity
  // before falling back to 2. Then clamp to [1, 4].
  const items: string[] = Array.isArray(cell.items) ? cell.items : [];
  const rawCols = Number(cell.columns);
  const columns = Math.min(4, Math.max(1, Number.isFinite(rawCols) && rawCols > 0 ? rawCols : 2));

  // Per-cell ids so the visual "Columns" label associates with the
  // columns input via `for=` (a11y review).
  const colsId = `dash-cols-${cell.id}`;
  el.innerHTML = `
    <div class="cell-head">
      <span class="cell-kind">DASHBOARD</span>
      <input class="cell-name" data-region="cell-name" value="${escapeAttr(cell.name ?? '')}"
             placeholder="@name (optional)" aria-label="Dashboard name"
             style="border:0;background:transparent;width:140px;outline:none;font-family:var(--font-mono);font-size:12px;" />
      <label for="${colsId}" style="font-size:12px;color:var(--text-muted);">Columns</label>
      <input id="${colsId}" data-region="dashboard-cols" type="number" min="1" max="4" value="${columns}" aria-label="Dashboard columns" style="width:48px;font-size:12px;padding:2px 6px;" />
      <input data-region="dashboard-items" type="text" placeholder="comma-separated cell names" value="${escapeAttr(items.join(', '))}" aria-label="Embedded cell names" style="flex:1 1 auto;min-width:200px;font-size:12px;padding:2px 8px;font-family:var(--font-mono);" />
      <div class="cell-actions">
        <button class="btn btn-ghost" data-action="cell-delete" title="Delete cell" aria-label="Delete cell">
          ${iconSvg('trash', 12)}
        </button>
      </div>
    </div>
    <div class="dashboard-grid" data-region="dashboard-grid" style="display:grid;grid-template-columns:repeat(${columns}, 1fr);gap:12px;padding:12px;"></div>
  `;

  // Bind name input.
  const nameInput = el.querySelector<HTMLInputElement>('[data-region="cell-name"]');
  nameInput?.addEventListener('change', () => {
    handlers.onChange(cell.id, { name: nameInput.value.trim() || null });
  });

  // Bind columns input. Use the same explicit-zero handling as the
  // init path above so a user typing 0 lands on 1 (not 2).
  const colsInput = el.querySelector<HTMLInputElement>('[data-region="dashboard-cols"]');
  colsInput?.addEventListener('change', () => {
    const parsed = Number.parseInt(colsInput.value, 10);
    const next = Math.min(4, Math.max(1, Number.isFinite(parsed) && parsed > 0 ? parsed : 2));
    handlers.onChange(cell.id, { columns: next });
  });

  // Bind items input.
  const itemsInput = el.querySelector<HTMLInputElement>('[data-region="dashboard-items"]');
  itemsInput?.addEventListener('change', () => {
    const items = itemsInput.value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    handlers.onChange(cell.id, { items });
  });

  // Delete.
  el.querySelector('[data-action="cell-delete"]')?.addEventListener('click', () =>
    handlers.onDelete(cell.id),
  );

  // Populate grid slots.
  const grid = el.querySelector<HTMLElement>('[data-region="dashboard-grid"]');
  if (grid) {
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText =
        'grid-column: 1 / -1;color:var(--text-muted);font-size:12px;padding:24px;text-align:center;border:1px dashed var(--border);border-radius:4px;';
      empty.textContent =
        'Add cell names (comma-separated) in the header to populate this dashboard.';
      grid.appendChild(empty);
    } else {
      const sqlCells = allCells.filter((c): c is SqlCellState => c.kind === 'sql');
      for (const name of items) {
        grid.appendChild(renderSlot(name, allCells, sqlCells));
      }
    }
  }

  return el;
}

function renderSlot(name: string, allCells: CellState[], sqlCells: SqlCellState[]): HTMLElement {
  const slot = document.createElement('div');
  slot.className = 'dashboard-slot';
  slot.style.cssText =
    'min-height:140px;border:1px solid var(--border);border-radius:4px;padding:8px;background:var(--surface);overflow:auto;';

  const target = allCells.find((c) => c.name === name);
  if (!target) {
    slot.innerHTML = `<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:24px;">No cell named <code style="font-family:var(--font-mono);">${escapeHtml(name)}</code>.</div>`;
    return slot;
  }
  // Only "presentation-suitable" kinds are valid items.
  if (
    target.kind === 'sql' ||
    target.kind === 'cohort' ||
    target.kind === 'assertion' ||
    target.kind === 'input' ||
    target.kind === 'dashboard'
  ) {
    slot.innerHTML = `<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:24px;">Cell <code style="font-family:var(--font-mono);">${escapeHtml(name)}</code> is a <strong>${target.kind}</strong> cell — only markdown / chart / pivot / map can be embedded in a dashboard.</div>`;
    return slot;
  }

  // Re-render the cell with no-op handlers so the embedded copy
  // can't be edited/deleted from inside the dashboard. Strip the
  // resulting `.cell-head` and any `.cell-actions` so only the
  // output content shows in the slot.
  let rendered: HTMLElement | null = null;
  if (target.kind === 'markdown') {
    rendered = renderMarkdownCell(target, NOOP_HANDLERS);
  } else if (target.kind === 'chart') {
    rendered = renderChartCell(target, sqlCells, NOOP_HANDLERS);
  } else if (target.kind === 'pivot') {
    rendered = renderPivotCell(target, sqlCells, NOOP_HANDLERS);
  } else if (target.kind === 'map') {
    rendered = renderMapCell(target, sqlCells, NOOP_HANDLERS);
  }
  if (!rendered) {
    slot.innerHTML = `<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:24px;">Could not render cell <code>${escapeHtml(name)}</code>.</div>`;
    return slot;
  }
  // Inline-strip chrome: remove .cell-head + cell-actions. Keep
  // .cell-output / .markdown-preview / chart canvas / pivot table.
  for (const node of Array.from(rendered.querySelectorAll('.cell-head, .cell-actions'))) {
    node.remove();
  }
  rendered.classList.add('dashboard-embedded');
  slot.appendChild(rendered);
  return slot;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
