// v1.4 F4/F5 — Calculated / derived fields on a result.
//
// Point-and-click a derived column without hand-writing the full query.
// The result is a NEW SQL cell (handoff §10 Hard NOT #4 — the user runs
// it). The upstream cell's SQL is wrapped as a subquery so the new cell
// is self-contained (no view-name / @ref coupling):
//
//   SELECT *, (<expr>) AS "<alias>"
//   FROM ( <upstream_sql> ) AS calc_src
//
// **Injection posture (reuses the M5 emitter contract):** the alias
// flows through `quoteIdent` (any chars safe). The expression is
// arbitrary SQL (like a measure body), guarded the same way
// (`validateMeasureExpression`: no semicolons, no DDL/DML keywords). The
// F5 window builder constructs the expression from `quoteIdent`-quoted
// identifiers + a fixed fn allowlist, so it's safe by construction.
//
// **Engine-boundary contract (v1.3 M0):** no DOM, no FSA, no globals.

import { validateMeasureExpression } from './measures.ts';
import { quoteIdent, stripTrailingSql } from './query-builder.ts';

export function validateCalcAlias(alias: string): string | null {
  const t = alias.trim();
  if (!t) return 'Column name is required.';
  if (t.length > 64) return 'Column name must be ≤ 64 chars.';
  return null;
}

/** Reuses the measure-expression guard (no semicolons, no DDL/DML). */
export function validateCalcExpression(expr: string): string | null {
  return validateMeasureExpression(expr);
}

export type WindowFn = 'SUM' | 'AVG' | 'COUNT' | 'MIN' | 'MAX';
const WINDOW_FNS = new Set<WindowFn>(['SUM', 'AVG', 'COUNT', 'MIN', 'MAX']);

/**
 * F5 — build a windowed (LOD-style) aggregate expression, safe by
 * construction: `<fn>(<col>) OVER (PARTITION BY <part…>)`. An empty
 * `partitionBy` emits a whole-result window (`OVER ()`). Every
 * identifier flows through `quoteIdent`; `fn` is allowlist-checked.
 */
export function emitWindowExpression(
  fn: WindowFn,
  column: string,
  partitionBy: ReadonlyArray<string>,
): string {
  if (!WINDOW_FNS.has(fn)) throw new Error(`Invalid window function: ${fn}`);
  const part =
    partitionBy.length > 0 ? `PARTITION BY ${partitionBy.map(quoteIdent).join(', ')}` : '';
  return `${fn}(${quoteIdent(column)}) OVER (${part})`;
}

/**
 * Emit the new-cell SQL adding one derived column to a result. Throws
 * (with a user-facing message) if the alias or expression is invalid —
 * the caller surfaces it; the UI should validate first.
 */
export function emitCalculatedField(upstreamSql: string, alias: string, expr: string): string {
  const aliasErr = validateCalcAlias(alias);
  if (aliasErr) throw new Error(aliasErr);
  const exprErr = validateCalcExpression(expr);
  if (exprErr) throw new Error(exprErr);
  // Strip trailing terminators/comments so the wrap stays a valid subquery (L19).
  const src = stripTrailingSql(upstreamSql);
  return `SELECT *, (${expr.trim()}) AS ${quoteIdent(alias.trim())}\nFROM (\n${src}\n) AS calc_src`;
}
