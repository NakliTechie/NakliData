// Chart cell. Renders one of seven chart types from a previous SQL cell's
// result. The actual chart renderer lives in src/charts/render.ts; here
// we own the cell chrome and the chart-type / x / y picker.
//
// v1.3 M5 Phase 2 — adds a "Shelves" authoring mode alongside the manual
// dropdowns: drag result fields onto Columns / Rows / Color shelves and
// the shelf state COMPILES TO the same cell config the dropdowns write
// (chart-shelves.ts → ChartConfig → {chartType, x, y, facet}). Per the
// Transparency Rule the two modes are two editors over ONE state, so the
// mode itself is a view preference (session-ephemeral), not data.

import { renderChart } from '../../charts/render.ts';
import {
  type FieldClass,
  type ShelfState,
  compileShelvesToConfig,
  inferFieldClass,
} from '../../core/chart-shelves.ts';
import { iconSvg } from '../../tokens/icons.ts';
import type { CellHandlers, ChartCellState, ResultRefCell } from './types.ts';

/**
 * Chart-type picker options. `satisfies` keeps every entry a valid member
 * of the `ChartCellState['chartType']` union, so the picker can't offer an
 * unrenderable type — and it now includes `funnel` + `path`, which the
 * union has but the picker had been silently omitting (forward-pass M13).
 */
const CHART_TYPE_OPTIONS = [
  'bar',
  'line',
  'area',
  'scatter',
  'histogram',
  'pie',
  'stacked-bar',
  'area-stacked',
  'heatmap',
  'funnel',
  'path',
  'stat',
  'table',
] as const satisfies ReadonlyArray<ChartCellState['chartType']>;

// Per-cell authoring mode. A view preference (which editor is showing),
// NOT persisted data — the shelf state is a projection of the cell's
// config, so there's nothing extra to save. Lives in a module map like
// the SQL cell's CM-editor registry; resets to 'manual' on reload.
type AuthorMode = 'manual' | 'shelves';
const authorMode = new Map<string, AuthorMode>();

const SHELVES: ReadonlyArray<{ key: keyof ShelfState; label: string }> = [
  { key: 'x', label: 'Columns (x)' },
  { key: 'y', label: 'Rows (y)' },
  { key: 'color', label: 'Color' },
];

export function renderChartCell(
  cell: ChartCellState,
  upstreamCells: ResultRefCell[],
  handlers: CellHandlers,
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cell';
  el.dataset.cellId = cell.id;
  el.dataset.cellKind = 'chart';

  const input = upstreamCells.find((c) => c.id === cell.inputCell);
  const cols = input?.lastResult?.columns ?? [];
  const rows = input?.lastResult?.rows ?? [];
  const mode: AuthorMode = authorMode.get(cell.id) ?? 'manual';

  // Field classes are inferred from the result data (not the source-table
  // taxonomy) — see inferFieldClass. Used by both the shelf chips and the
  // shelf-compile defaults / warnings.
  const classOf = new Map<string, FieldClass>();
  for (const c of cols) classOf.set(c, inferFieldClass(c, rows));

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
      <div class="chart-mode-toggle" role="group" aria-label="Authoring mode">
        <button class="btn btn-ghost ${mode === 'manual' ? 'is-active' : ''}" data-action="mode-manual"
                aria-pressed="${mode === 'manual'}" title="Pick chart type + columns by hand">Manual</button>
        <button class="btn btn-ghost ${mode === 'shelves' ? 'is-active' : ''}" data-action="mode-shelves"
                aria-pressed="${mode === 'shelves'}" title="Drag fields onto shelves (VizQL-style)">Shelves</button>
      </div>
      ${
        mode === 'manual'
          ? `<select data-action="chart-type" aria-label="Chart type" style="font-size:12px;">
        ${CHART_TYPE_OPTIONS.map(
          (k) => `<option value="${k}" ${cell.chartType === k ? 'selected' : ''}>${k}</option>`,
        ).join('')}
      </select>
      ${cols.length > 0 ? renderColPickers(cell, cols) : ''}`
          : ''
      }
      <div class="cell-actions">
        <button class="btn btn-ghost" data-action="cell-delete" title="Delete cell" aria-label="Delete cell">
          ${iconSvg('trash', 12)}
        </button>
      </div>
    </div>
    ${mode === 'shelves' ? renderShelfZone(cell, cols, classOf) : ''}
    <div class="cell-output" data-region="chart-canvas">
      ${input?.lastResult ? '' : '<div class="cell-output-empty">Pick a SQL cell that has been run.</div>'}
    </div>
  `;

  // Manual-mode selects (scoped to the head so shelf-zone selects aren't
  // double-bound — they get their own handlers below).
  for (const sel of el.querySelectorAll<HTMLSelectElement>('.cell-head select')) {
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

  // Mode toggle. patchCell always notifies, so an empty patch is a clean
  // re-render nudge that picks up the new module-map mode.
  el.querySelector('[data-action="mode-manual"]')?.addEventListener('click', () => {
    authorMode.set(cell.id, 'manual');
    handlers.onChange(cell.id, {});
  });
  el.querySelector('[data-action="mode-shelves"]')?.addEventListener('click', () => {
    authorMode.set(cell.id, 'shelves');
    handlers.onChange(cell.id, {});
  });

  if (mode === 'shelves') wireShelfZone(el, cell, classOf, handlers);

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

// ── Shelf authoring mode (M5 Phase 2) ────────────────────────────────

/** Build the current shelf state from the cell's config + field classes.
 *  This is the Transparency-Rule projection: the shelves mirror whatever
 *  the manual dropdowns / sidecar last wrote to the cell. */
function shelvesFromCell(cell: ChartCellState, classOf: Map<string, FieldClass>): ShelfState {
  const field = (name: string | null) =>
    name ? { name, class: classOf.get(name) ?? ('unknown' as FieldClass) } : null;
  return { x: field(cell.x), y: field(cell.y), color: field(cell.facet) };
}

function renderShelfZone(
  cell: ChartCellState,
  cols: string[],
  classOf: Map<string, FieldClass>,
): string {
  if (cols.length === 0) {
    return `<div class="shelf-zone shelf-zone-empty">Run the input SQL cell, then drag its fields onto the shelves.</div>`;
  }
  const shelves = shelvesFromCell(cell, classOf);
  const { config, warnings } = compileShelvesToConfig(shelves, cell.name ?? 'Chart');

  const tray = cols
    .map((c) => {
      const cls = classOf.get(c) ?? 'unknown';
      return `<span class="shelf-chip" draggable="true" data-field="${escapeAttr(c)}" title="${escapeAttr(c)} — ${cls}">
        ${escapeHtml(c)}<em class="shelf-cls cls-${cls}">${cls}</em></span>`;
    })
    .join('');

  const shelfBoxes = SHELVES.map(({ key, label }) => {
    const assigned = shelves[key];
    const drop = assigned
      ? `<span class="shelf-assigned">${escapeHtml(assigned.name)}
           <button class="shelf-clear" data-shelf-clear="${key}" title="Clear ${label}" aria-label="Clear ${label}">×</button>
         </span>`
      : `<span class="shelf-placeholder">drop a field</span>`;
    const opts = [`<option value="">—</option>`]
      .concat(
        cols.map(
          (c) =>
            `<option value="${escapeAttr(c)}" ${assigned?.name === c ? 'selected' : ''}>${escapeHtml(c)}</option>`,
        ),
      )
      .join('');
    return `<div class="shelf" data-shelf="${key}">
      <span class="shelf-name">${label}</span>
      <div class="shelf-drop" data-shelf-drop="${key}">${drop}</div>
      <select class="shelf-select" data-shelf-select="${key}" aria-label="${label} field">${opts}</select>
    </div>`;
  }).join('');

  const warnHtml = warnings
    .map((w) => `<div class="shelf-warning" role="status">${escapeHtml(w.reason)}</div>`)
    .join('');

  return `
    <div class="shelf-zone" data-region="shelf-zone">
      <div class="shelf-tray" aria-label="Result fields">
        <span class="shelf-tray-label">Fields</span>${tray}
      </div>
      <div class="shelf-row">${shelfBoxes}</div>
      <div class="shelf-readout">→ <strong>${config.chartType}</strong> chart${warnHtml}</div>
    </div>`;
}

function wireShelfZone(
  el: HTMLElement,
  cell: ChartCellState,
  classOf: Map<string, FieldClass>,
  handlers: CellHandlers,
): void {
  const assign = (shelf: keyof ShelfState, col: string | null): void => {
    const next = shelvesFromCell(cell, classOf);
    next[shelf] = col ? { name: col, class: classOf.get(col) ?? ('unknown' as FieldClass) } : null;
    const { config, warnings } = compileShelvesToConfig(next, cell.name ?? 'Chart');
    // Surface compile warnings transiently. A rejected field (e.g.
    // identifier-on-y) is dropped from the config, so it can't live on
    // the shelf to carry its own warning (the shelf is a pure projection
    // of committed state — Transparency Rule); a toast is the only place
    // the "teach, don't silently fail" signal can land.
    if (warnings.length > 0) {
      globalThis.dispatchEvent(
        new CustomEvent('naklidata:toast', {
          detail: { message: warnings.map((w) => w.reason).join(' · '), kind: 'info' },
        }),
      );
    }
    handlers.onChange(cell.id, {
      chartType: config.chartType,
      x: config.xColumn,
      y: config.yColumn,
      facet: config.groupColumn,
    });
  };

  // Drag: chips → shelves.
  for (const chip of el.querySelectorAll<HTMLElement>('.shelf-chip')) {
    chip.addEventListener('dragstart', (ev) => {
      ev.dataTransfer?.setData('text/plain', chip.dataset.field ?? '');
      if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'copy';
    });
  }
  for (const drop of el.querySelectorAll<HTMLElement>('[data-shelf-drop]')) {
    const shelf = drop.dataset.shelfDrop as keyof ShelfState;
    drop.addEventListener('dragover', (ev) => {
      ev.preventDefault();
      drop.classList.add('over');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (ev) => {
      ev.preventDefault();
      drop.classList.remove('over');
      const col = ev.dataTransfer?.getData('text/plain');
      if (col) assign(shelf, col);
    });
  }
  // Accessible / fallback: per-shelf select + clear button.
  for (const sel of el.querySelectorAll<HTMLSelectElement>('[data-shelf-select]')) {
    sel.addEventListener('change', () => {
      assign(sel.dataset.shelfSelect as keyof ShelfState, sel.value || null);
    });
  }
  for (const btn of el.querySelectorAll<HTMLElement>('[data-shelf-clear]')) {
    btn.addEventListener('click', () => assign(btn.dataset.shelfClear as keyof ShelfState, null));
  }
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
