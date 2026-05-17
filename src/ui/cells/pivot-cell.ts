// Pivot-table cell. Cross-tabulates an upstream SQL cell's result by
// rowCol × colCol with a numeric aggregation. In-memory pivot — no
// extra DuckDB round-trip needed; we operate on the rows the upstream
// SQL cell already produced.
//
// MVP scope: one rowCol, one colCol, one valueCol, one aggregation.
// Row totals + column totals + grand total shown for sum and count
// (other aggregations don't have a meaningful "total of totals").

import { iconSvg } from '../../tokens/icons.ts';
import type { CellHandlers, PivotCellState, SqlCellState } from './types.ts';

export function renderPivotCell(
  cell: PivotCellState,
  upstreamCells: SqlCellState[],
  handlers: CellHandlers,
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cell';
  el.dataset.cellId = cell.id;
  el.dataset.cellKind = 'pivot';

  const input = upstreamCells.find((c) => c.id === cell.inputCell);
  const cols = input?.lastResult?.columns ?? [];

  el.innerHTML = `
    <div class="cell-head">
      <span class="cell-kind">PIVOT</span>
      <span style="color: var(--text-muted); font-size:11px;">of</span>
      <select data-action="pivot-input" aria-label="Input cell" style="font-size:12px;">
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
    <div class="cell-output" data-region="pivot-canvas">
      ${input?.lastResult ? '' : '<div class="cell-output-empty">Pick a SQL cell that has been run.</div>'}
    </div>
  `;

  for (const sel of el.querySelectorAll<HTMLSelectElement>('select')) {
    sel.addEventListener('change', () => {
      const patch: Record<string, unknown> = {};
      switch (sel.dataset.action) {
        case 'pivot-input':
          patch.inputCell = sel.value || null;
          break;
        case 'pivot-row':
          patch.rowCol = sel.value || null;
          break;
        case 'pivot-col':
          patch.colCol = sel.value || null;
          break;
        case 'pivot-value':
          patch.valueCol = sel.value || null;
          break;
        case 'pivot-agg':
          patch.agg = sel.value;
          break;
      }
      handlers.onChange(cell.id, patch);
    });
  }

  el.querySelector('[data-action="cell-delete"]')?.addEventListener('click', () =>
    handlers.onDelete(cell.id),
  );

  if (input?.lastResult) {
    const mount = el.querySelector<HTMLElement>('[data-region="pivot-canvas"]');
    if (mount) {
      const rows = input.lastResult.rows;
      queueMicrotask(() => renderPivotTable(mount, cell, rows));
    }
  }

  return el;
}

function renderPickers(cell: PivotCellState, cols: string[]): string {
  const pick = (label: string, action: string, current: string | null | undefined) => `
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
  const agg = `
    <label style="font-size:11px;color:var(--text-muted);display:inline-flex;align-items:center;gap:4px;">
      agg
      <select data-action="pivot-agg" style="font-size:12px;">
        ${(['sum', 'avg', 'min', 'max', 'count'] as const)
          .map((a) => `<option value="${a}" ${cell.agg === a ? 'selected' : ''}>${a}</option>`)
          .join('')}
      </select>
    </label>`;
  return (
    pick('row', 'pivot-row', cell.rowCol) +
    pick('col', 'pivot-col', cell.colCol) +
    pick('value', 'pivot-value', cell.valueCol) +
    agg
  );
}

export interface PivotComputed {
  rowKeys: string[];
  colKeys: string[];
  /** values[rowKey][colKey] — undefined when no rows match that cell. */
  values: Record<string, Record<string, number>>;
  rowTotals: Record<string, number>;
  colTotals: Record<string, number>;
  grandTotal: number;
  hasMeaningfulTotals: boolean;
}

/**
 * Pure-function pivot computation. Exported for unit testing.
 */
export function computePivot(
  cell: Pick<PivotCellState, 'rowCol' | 'colCol' | 'valueCol' | 'agg'>,
  rows: Array<Record<string, unknown>>,
): PivotComputed | null {
  if (!cell.rowCol || !cell.colCol) return null;
  if (cell.agg !== 'count' && !cell.valueCol) return null;

  const rowKeysSet = new Set<string>();
  const colKeysSet = new Set<string>();
  // buckets[rowKey][colKey] = number[]
  const buckets: Record<string, Record<string, number[]>> = {};

  for (const r of rows) {
    const rk = String(r[cell.rowCol] ?? '');
    const ck = String(r[cell.colCol] ?? '');
    rowKeysSet.add(rk);
    colKeysSet.add(ck);
    const v = cell.agg === 'count' ? 1 : coerceNumeric(r[cell.valueCol ?? '']);
    if (v === null) continue;
    buckets[rk] = buckets[rk] ?? {};
    buckets[rk][ck] = buckets[rk][ck] ?? [];
    buckets[rk][ck].push(v);
  }

  const rowKeys = [...rowKeysSet].sort();
  const colKeys = [...colKeysSet].sort();
  const values: Record<string, Record<string, number>> = {};
  const rowTotals: Record<string, number> = {};
  const colTotals: Record<string, number> = {};
  let grandTotal = 0;
  let totalsCount = 0; // for avg-of-totals if we ever need it

  for (const rk of rowKeys) {
    values[rk] = {};
    rowTotals[rk] = 0;
    for (const ck of colKeys) {
      const arr = buckets[rk]?.[ck];
      const v = arr && arr.length > 0 ? aggregate(arr, cell.agg) : null;
      if (v !== null) {
        values[rk][ck] = v;
        rowTotals[rk] += v;
        colTotals[ck] = (colTotals[ck] ?? 0) + v;
        grandTotal += v;
        totalsCount++;
      }
    }
  }

  const hasMeaningfulTotals = cell.agg === 'sum' || cell.agg === 'count';
  void totalsCount;
  return {
    rowKeys,
    colKeys,
    values,
    rowTotals,
    colTotals,
    grandTotal,
    hasMeaningfulTotals,
  };
}

function aggregate(values: number[], agg: PivotCellState['agg']): number {
  switch (agg) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'avg':
      return values.reduce((a, b) => a + b, 0) / values.length;
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    case 'count':
      return values.length;
  }
}

function coerceNumeric(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string' && v !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function renderPivotTable(
  mount: HTMLElement,
  cell: PivotCellState,
  rows: Array<Record<string, unknown>>,
): void {
  mount.innerHTML = '';
  if (rows.length === 0) {
    mount.innerHTML = '<div class="cell-output-empty">No rows to pivot.</div>';
    return;
  }
  if (!cell.rowCol || !cell.colCol) {
    mount.innerHTML =
      '<div class="cell-output-empty">Pick row, column, and value (or use count).</div>';
    return;
  }
  if (cell.agg !== 'count' && !cell.valueCol) {
    mount.innerHTML =
      '<div class="cell-output-empty">Pick a value column or switch agg to count.</div>';
    return;
  }
  const piv = computePivot(cell, rows);
  if (!piv) {
    mount.innerHTML = '<div class="cell-output-empty">Could not pivot — check picks.</div>';
    return;
  }
  if (piv.rowKeys.length === 0 || piv.colKeys.length === 0) {
    mount.innerHTML = '<div class="cell-output-empty">No data after pivot.</div>';
    return;
  }

  // Cap displayed rows/columns to keep the DOM sane on large pivots.
  const MAX_ROWS = 200;
  const MAX_COLS = 50;
  const displayedRows = piv.rowKeys.slice(0, MAX_ROWS);
  const displayedCols = piv.colKeys.slice(0, MAX_COLS);
  const truncatedRows = piv.rowKeys.length - displayedRows.length;
  const truncatedCols = piv.colKeys.length - displayedCols.length;

  const t = document.createElement('table');
  t.className = 'result-table pivot-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const corner = document.createElement('th');
  corner.textContent = `${cell.rowCol} \\ ${cell.colCol}`;
  corner.style.background = 'var(--surface-alt)';
  headRow.appendChild(corner);
  for (const ck of displayedCols) {
    const th = document.createElement('th');
    th.textContent = ck;
    headRow.appendChild(th);
  }
  if (piv.hasMeaningfulTotals) {
    const totalTh = document.createElement('th');
    totalTh.textContent = '∑';
    totalTh.style.background = 'var(--surface-alt)';
    headRow.appendChild(totalTh);
  }
  thead.appendChild(headRow);
  t.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const rk of displayedRows) {
    const tr = document.createElement('tr');
    const rowHead = document.createElement('th');
    rowHead.textContent = rk;
    rowHead.scope = 'row';
    rowHead.style.background = 'var(--surface-alt)';
    rowHead.style.textAlign = 'left';
    tr.appendChild(rowHead);
    for (const ck of displayedCols) {
      const td = document.createElement('td');
      const v = piv.values[rk]?.[ck];
      td.textContent = v === undefined ? '·' : formatNumber(v);
      td.classList.add('numeric');
      tr.appendChild(td);
    }
    if (piv.hasMeaningfulTotals) {
      const totalTd = document.createElement('td');
      totalTd.textContent = formatNumber(piv.rowTotals[rk] ?? 0);
      totalTd.classList.add('numeric');
      totalTd.style.fontWeight = '600';
      totalTd.style.background = 'var(--surface-alt)';
      tr.appendChild(totalTd);
    }
    tbody.appendChild(tr);
  }
  t.appendChild(tbody);

  if (piv.hasMeaningfulTotals) {
    const tfoot = document.createElement('tfoot');
    const footRow = document.createElement('tr');
    const footHead = document.createElement('th');
    footHead.textContent = '∑';
    footHead.scope = 'row';
    footHead.style.background = 'var(--surface-alt)';
    footHead.style.fontWeight = '600';
    footRow.appendChild(footHead);
    for (const ck of displayedCols) {
      const td = document.createElement('td');
      td.textContent = formatNumber(piv.colTotals[ck] ?? 0);
      td.classList.add('numeric');
      td.style.fontWeight = '600';
      td.style.background = 'var(--surface-alt)';
      footRow.appendChild(td);
    }
    const grandTd = document.createElement('td');
    grandTd.textContent = formatNumber(piv.grandTotal);
    grandTd.classList.add('numeric');
    grandTd.style.fontWeight = '600';
    grandTd.style.background = 'var(--surface-alt)';
    footRow.appendChild(grandTd);
    tfoot.appendChild(footRow);
    t.appendChild(tfoot);
  }

  mount.style.padding = '12px';
  mount.appendChild(t);

  if (truncatedRows > 0 || truncatedCols > 0) {
    const note = document.createElement('div');
    note.style.cssText = 'color: var(--text-muted); font-size: 11px; margin-top: 6px;';
    const bits: string[] = [];
    if (truncatedRows > 0) bits.push(`${truncatedRows} more rows`);
    if (truncatedCols > 0) bits.push(`${truncatedCols} more columns`);
    note.textContent = `Showing ${displayedRows.length} × ${displayedCols.length}. ${bits.join(', ')} hidden.`;
    mount.appendChild(note);
  }
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2).replace(/\.00$/, '')}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2).replace(/\.00$/, '')}M`;
  if (Math.abs(n) >= 1e4) return n.toLocaleString();
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toFixed(2);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
