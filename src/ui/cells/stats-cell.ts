// v1.3 M4 — Stats cell renderer.
//
// Bound to an upstream cell via `inputCell` (mirrors chart-cell /
// pivot-cell). Computes + renders descriptive statistics + a Pearson
// correlation matrix over numeric columns. All computation is in
// DuckDB SQL via `src/core/stats.ts` emitters; this file is the
// presentation layer.

import type { Engine } from '../../core/engine.ts';
import {
  type StatsColumnSpec,
  emitCorrelationMatrixSql,
  emitDescriptivesSql,
  parseCorrelationRow,
  parseDescriptivesRow,
} from '../../core/stats.ts';
import { iconSvg } from '../../tokens/icons.ts';
import type { CellHandlers, StatsCellState } from './types.ts';

/**
 * Render a stats cell. The renderer is pure — actual computation
 * happens via `computeStats` (which the notebook calls before
 * rendering).
 */
export function renderStatsCell(
  cell: StatsCellState,
  cells: ReadonlyArray<{ id: string; name: string | null }>,
  handlers: CellHandlers,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'cell cell-stats';
  wrap.dataset.cellId = cell.id;
  wrap.dataset.cellKind = 'stats';

  // Resolve the upstream cell id to its human name (forward-pass H15 —
  // the head used to show the internal `@c_ab12cd` id). Fall back to the
  // id when the upstream cell is unnamed, mirroring chart/pivot cells.
  const upstream = cell.inputCell ? cells.find((c) => c.id === cell.inputCell) : null;
  const inputName = cell.inputCell ? `@${upstream?.name ?? cell.inputCell}` : '(no input)';

  wrap.innerHTML = `
    <div class="cell-head">
      <span class="cell-kind">${iconSvg('chart', 12)} stats</span>
      <input class="cell-name-input" placeholder="name (optional)" value="${cell.name ? escapeAttr(cell.name) : ''}" data-action="cell-name-edit" />
      <span class="cell-input-ref">${escapeHtml(inputName)}</span>
      <span style="flex:1;"></span>
      <button class="btn btn-ghost" data-action="run-stats" data-cell-id="${cell.id}" title="Compute statistics">${iconSvg('play', 12)} <span>Run</span></button>
      <button class="btn btn-ghost" data-action="cell-delete" data-cell-id="${cell.id}" aria-label="Delete cell">${iconSvg('x', 12)}</button>
    </div>
    <div class="cell-output">
      ${renderBody(cell)}
    </div>
  `;
  // Hand-rolled name input wiring — same pattern as other cells.
  wrap
    .querySelector<HTMLInputElement>('[data-action="cell-name-edit"]')
    ?.addEventListener('change', (ev) => {
      const next = (ev.target as HTMLInputElement).value.trim() || null;
      handlers.onChange(cell.id, { name: next });
    });
  return wrap;
}

function renderBody(cell: StatsCellState): string {
  if (cell.status === 'error') {
    return `<div class="cell-output-error">Stats: ${escapeHtml(cell.lastError ?? 'unknown error')}</div>`;
  }
  if (cell.status === 'running') {
    return `<div class="cell-output-loading">Computing statistics…</div>`;
  }
  if (!cell.descriptives) {
    return `<div class="cell-output-empty">Click Run to compute statistics for the upstream cell's result.</div>`;
  }
  return `
    ${renderDescriptivesTable(cell.descriptives)}
    ${cell.correlations && cell.correlations.length > 0 ? renderCorrelationMatrix(cell.correlations) : ''}
  `;
}

function renderDescriptivesTable(
  descriptives: NonNullable<StatsCellState['descriptives']>,
): string {
  const rowsHtml = descriptives
    .map(
      (d) => `
        <tr>
          <td>${escapeHtml(d.name)}</td>
          <td class="numeric">${d.count ?? '∅'}</td>
          <td class="numeric">${d.nulls ?? '∅'}</td>
          <td class="numeric">${d.distinct ?? '∅'}</td>
          <td class="numeric">${fmtMaybe(d.min)}</td>
          <td class="numeric">${fmtMaybe(d.max)}</td>
          <td class="numeric">${fmtMaybe(d.mean)}</td>
          <td class="numeric">${fmtMaybe(d.median)}</td>
          <td class="numeric">${fmtMaybe(d.stddev)}</td>
        </tr>
      `,
    )
    .join('');
  return `
    <table class="result-table stats-descriptives">
      <thead>
        <tr>
          <th>column</th>
          <th>count</th>
          <th>nulls</th>
          <th>distinct</th>
          <th>min</th>
          <th>max</th>
          <th>mean</th>
          <th>median</th>
          <th>stddev</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
}

function renderCorrelationMatrix(
  correlations: NonNullable<StatsCellState['correlations']>,
): string {
  // Pivot the upper-triangle entries into a square matrix for rendering.
  const cols = Array.from(new Set(correlations.flatMap((c) => [c.a, c.b]))).sort();
  const matrix = new Map<string, Map<string, number | null>>();
  for (const col of cols) matrix.set(col, new Map());
  for (const { a, b, value } of correlations) {
    matrix.get(a)?.set(b, value);
    // Mirror across the diagonal.
    matrix.get(b)?.set(a, value);
  }
  const headHtml = cols.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
  const rowsHtml = cols
    .map((row) => {
      const cells = cols
        .map((col) => {
          const v = matrix.get(row)?.get(col);
          if (v === null || v === undefined) return `<td class="numeric">∅</td>`;
          const colorIntensity = Math.abs(v); // 0..1
          const r = v < 0 ? 255 : 79;
          const g = v < 0 ? 79 : 175;
          const b = v < 0 ? 79 : 79;
          const bg = `rgba(${r}, ${g}, ${b}, ${colorIntensity * 0.7})`;
          return `<td class="numeric" style="background:${bg};color:${colorIntensity > 0.5 ? '#fff' : 'inherit'};">${v.toFixed(2)}</td>`;
        })
        .join('');
      return `<tr><th>${escapeHtml(row)}</th>${cells}</tr>`;
    })
    .join('');
  return `
    <h4 style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin:var(--space-3) 0 var(--space-1) 0;">Pearson correlation (numeric columns)</h4>
    <table class="result-table stats-correlation">
      <thead><tr><th></th>${headHtml}</tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
}

/**
 * Compute stats for the upstream cell's result against the engine.
 * Called by Notebook.runCell when the stats cell's Run button fires.
 *
 * Returns a partial patch the notebook applies via patchCell.
 */
export async function computeStats(opts: {
  engine: Engine;
  inputCellId: string;
  /** Column metadata derived from the upstream cell's last result +
   *  taxonomy assignments. Caller passes the bucketed type per column. */
  columns: ReadonlyArray<StatsColumnSpec>;
}): Promise<{
  descriptives: NonNullable<StatsCellState['descriptives']>;
  correlations: NonNullable<StatsCellState['correlations']>;
}> {
  const viewName = `cell_${opts.inputCellId}`;
  const descSql = emitDescriptivesSql(viewName, opts.columns);
  const descRows = await opts.engine.query<Record<string, unknown>>(descSql);
  const descRow = descRows[0] ?? {};
  const descriptives = parseDescriptivesRow(descRow, opts.columns).map((d) => ({
    ...d,
    type: opts.columns.find((c) => c.name === d.name)?.type ?? 'other',
  }));

  const numericCols = opts.columns.filter((c) => c.type === 'numeric').map((c) => c.name);
  let correlations: NonNullable<StatsCellState['correlations']> = [];
  if (numericCols.length >= 2) {
    const corrSql = emitCorrelationMatrixSql(viewName, numericCols);
    const corrRows = await opts.engine.query<Record<string, unknown>>(corrSql);
    const corrRow = corrRows[0] ?? {};
    correlations = parseCorrelationRow(corrRow, numericCols);
  }

  return { descriptives, correlations };
}

function fmtMaybe(v: unknown): string {
  if (v === null || v === undefined) return '∅';
  // DuckDB returns BIGINT/HUGEINT aggregates (e.g. MIN/MAX on an integer
  // column) as a JS bigint; coerce so they format as numbers instead of
  // falling through to String() and printing "100n" (forward-pass M7).
  const n = typeof v === 'bigint' ? Number(v) : v;
  if (typeof n === 'number') {
    if (!Number.isFinite(n)) return '∅';
    return Math.abs(n) < 0.01 || Math.abs(n) > 1e6 ? n.toExponential(2) : n.toFixed(2);
  }
  return String(v);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
