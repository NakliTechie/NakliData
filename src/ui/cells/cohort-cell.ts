// Cohort cell — Wave 4 W4.4.
//
// Structurally a SQL cell whose result is a 1-column `user_id` list.
// Downstream cells reference the cohort via `@<cohort_name>` — same
// machinery that resolves any @cellName SQL ref (see notebook.ts
// rewriteReferences).
//
// Renders by reusing the SQL cell's renderer with a tiny chrome
// adjustment: header label flips from "SQL" to "COHORT" and a
// "<n> users" badge appears next to the name input once the cell has
// run successfully. The underlying editor, run/delete actions, and
// result table all come from renderSqlCell — so cohorts get
// CodeMirror, error display, etc., for free.

import { type SqlCellExtra, renderSqlCell } from './sql-cell.ts';
import type { CellHandlers, CohortCellState, SqlCellState } from './types.ts';

export function renderCohortCell(
  cell: CohortCellState,
  handlers: CellHandlers,
  extra?: SqlCellExtra,
): HTMLElement {
  // Build a SqlCellState-shaped object so we can pass it through the
  // standard SQL renderer. The fields all line up; `pinned` is the
  // only SqlCell-only field, and false is the right default.
  const sqlCompat: SqlCellState = {
    id: cell.id,
    kind: 'sql',
    order: cell.order,
    name: cell.name,
    code: cell.code,
    status: cell.status,
    lastError: cell.lastError,
    lastResult: cell.lastResult,
    pinned: false,
  };
  const el = renderSqlCell(sqlCompat, handlers, extra);
  // Re-stamp the kind so save/load round-trips honor the cohort
  // discriminant, and the DOM tells the world this is a cohort.
  el.dataset.cellKind = 'cohort';
  const kindLabel = el.querySelector<HTMLElement>('.cell-kind');
  if (kindLabel) kindLabel.textContent = 'COHORT';

  // User count badge — visible only after a successful run.
  const head = el.querySelector<HTMLElement>('.cell-head');
  if (head && cell.lastResult) {
    const badge = document.createElement('span');
    badge.className = 'cohort-count-badge';
    badge.style.cssText =
      'font-size:11px;color:var(--text-muted);margin-left:8px;padding:2px 8px;border:1px solid var(--border);border-radius:999px;';
    badge.textContent = `${cell.lastResult.rowCount} user${cell.lastResult.rowCount === 1 ? '' : 's'}`;
    // Insert before .cell-actions so the badge sits next to the name input.
    const actions = head.querySelector<HTMLElement>('.cell-actions');
    if (actions) head.insertBefore(badge, actions);
    else head.appendChild(badge);
  }
  return el;
}
