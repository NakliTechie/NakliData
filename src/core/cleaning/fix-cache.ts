// Cleaning surface — the suggested-fix cache (C0).
//
// Suggestions are DERIVED data: recomputed from the column sample that
// classification already takes, and deliberately NOT persisted to `.naklidata`
// (a workbook file describes the notebook, not our advice about it — and a
// stale suggestion is worse than none). This is the same posture as the Facet
// layout cache: module-level, in-memory, dropped with the session.
//
// It exists so the schema panel can render suggestions without issuing a query
// per column: `classifyTableColumns` already samples every column, so main.ts
// computes fixes from that sample at classification time and parks them here.
//
// Engine-boundary clean — a Map and three functions, no DOM/engine/globals.

import type { SuggestedFix } from './fix-registry.ts';

/** assignmentKey (`sourceId::tableId::columnName`) → ranked fixes. */
const _fixes = new Map<string, SuggestedFix[]>();

/** Park the fixes for one column. An empty array is stored as "computed, and
 *  this column is clean" — distinct from "not computed yet" (undefined). */
export function setFixesFor(key: string, fixes: SuggestedFix[]): void {
  _fixes.set(key, fixes);
}

/** Fixes for one column; `[]` when clean or not yet computed. */
export function getFixesFor(key: string): SuggestedFix[] {
  return _fixes.get(key) ?? [];
}

/** Drop everything — call on session switch / workbook clear so one workbook's
 *  advice never leaks into the next. */
export function clearFixes(): void {
  _fixes.clear();
}

/** Drop one source's entries (keys are prefixed `sourceId::`). Used when a
 *  source is removed. */
export function clearFixesForSource(sourceId: string): void {
  const prefix = `${sourceId}::`;
  for (const k of [..._fixes.keys()]) {
    if (k.startsWith(prefix)) _fixes.delete(k);
  }
}

/** Total columns currently carrying at least one suggestion — the number a
 *  future roll-up panel (EJ-2) would headline. */
export function columnsWithFixes(): number {
  let n = 0;
  for (const v of _fixes.values()) {
    if (v.length > 0) n++;
  }
  return n;
}
