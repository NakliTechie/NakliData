// Assertion cell — Wave 5 W5.5.
//
// A SQL query that should return 0 rows when the invariant holds.
// Any returned row is a counter-example; the cell goes red. dbt's
// `tests:` block is the closest analog.
//
// Renders by reusing the SQL cell's renderer with a small chrome
// adjustment: header label flips from "SQL" to "ASSERTION" and a
// PASS / FAIL pill appears once the cell has run. Pass = lastResult
// has 0 rows; fail = N rows (counter-examples). The underlying
// editor, run/delete actions, error display all come from
// renderSqlCell.

import { type SqlCellExtra, renderSqlCell } from './sql-cell.ts';
import type { AssertionCellState, CellHandlers, SqlCellState } from './types.ts';

export function renderAssertionCell(
  cell: AssertionCellState,
  handlers: CellHandlers,
  extra?: SqlCellExtra,
): HTMLElement {
  // Build a SqlCellState-shaped object so we can pass through the
  // SQL renderer. The fields all line up.
  const sqlCompat: SqlCellState = {
    id: cell.id,
    kind: 'sql',
    order: cell.order,
    name: cell.name,
    code: cell.code,
    status: cell.status,
    lastError: cell.lastError,
    lastResult: cell.lastResult,
  };
  const el = renderSqlCell(sqlCompat, handlers, extra);
  el.dataset.cellKind = 'assertion';
  const kindLabel = el.querySelector<HTMLElement>('.cell-kind');
  if (kindLabel) kindLabel.textContent = 'ASSERTION';

  // Verdict pill — visible only after a successful run (errored
  // cells use the existing red ".errored" treatment from sql-cell).
  if (cell.lastResult && cell.status === 'success') {
    const head = el.querySelector<HTMLElement>('.cell-head');
    if (head) {
      const passed = cell.lastResult.rowCount === 0;
      const pill = document.createElement('span');
      pill.className = `assertion-verdict assertion-verdict--${passed ? 'pass' : 'fail'}`;
      pill.style.cssText = passed
        ? 'font-size:11px;color:var(--success,#2f8a4a);margin-left:8px;padding:2px 8px;border:1px solid var(--success,#2f8a4a);border-radius:999px;font-weight:600;'
        : 'font-size:11px;color:var(--danger);margin-left:8px;padding:2px 8px;border:1px solid var(--danger);border-radius:999px;font-weight:600;';
      pill.textContent = passed
        ? '✓ PASS'
        : `✗ FAIL · ${cell.lastResult.rowCount} counter-example${cell.lastResult.rowCount === 1 ? '' : 's'}`;
      const actions = head.querySelector<HTMLElement>('.cell-actions');
      if (actions) head.insertBefore(pill, actions);
      else head.appendChild(pill);
    }
    // Failed assertions also paint the cell border red.
    if (cell.lastResult.rowCount > 0) el.classList.add('errored');
  }
  return el;
}
