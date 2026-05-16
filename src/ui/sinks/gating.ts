// Declarative type-gating for action sinks. A sink describes its column
// requirements as data; this module evaluates them against the current
// classified-column assignments. The schema panel can render a sink-by-sink
// matrix from the same shape.
//
// Each `Requirement` is "any one of these typeIds satisfies me." A
// requirement with a single typeId is the common case; `any: ['vendor_name',
// 'gl_account']` is the "vendor OR account" case from the Bahi sink.

import type { SqlResult } from '../cells/types.ts';
import type { ColumnAssignment } from '../schema-panel.ts';

export interface Requirement {
  /** Semantic typeIds that satisfy this requirement. Any one is enough. */
  any: string[];
  /** Short user-facing label — appears in blockReason text and the matrix. */
  label: string;
}

export interface GatingEvaluation {
  ok: boolean;
  missing: Requirement[];
  /** Per-requirement: which typeId actually satisfied it (or null). */
  satisfiedBy: Array<{ requirement: Requirement; satisfiedBy: string | null }>;
}

export interface GatedSink {
  id: string;
  name: string;
  description: string;
  /** Declarative requirements. All must be satisfied. */
  requires?: Requirement[];
  /**
   * Escape hatch for things the typeId-based requires can't express
   * (e.g. "any VARCHAR column with length 3-200"). Called only after the
   * `requires` check passes.
   */
  customBlockReason?: (result: SqlResult, assignments: ColumnAssignment[]) => string | null;
}

/** Build the set of typeIds present in the result, by mapping each result
 *  column back to its assignment (assignments may include columns from other
 *  cells / tables; we filter to columns that appear in this result). */
export function presentTypeIds(result: SqlResult, assignments: ColumnAssignment[]): Set<string> {
  const inResult = new Set(result.columns);
  const out = new Set<string>();
  for (const a of assignments) {
    if (!inResult.has(a.columnName)) continue;
    if (a.assigned.typeId) out.add(a.assigned.typeId);
  }
  return out;
}

export function evaluateRequirements(
  requires: Requirement[] | undefined,
  result: SqlResult,
  assignments: ColumnAssignment[],
): GatingEvaluation {
  if (!requires || requires.length === 0) {
    return { ok: true, missing: [], satisfiedBy: [] };
  }
  const present = presentTypeIds(result, assignments);
  const satisfiedBy: GatingEvaluation['satisfiedBy'] = [];
  const missing: Requirement[] = [];
  for (const req of requires) {
    const hit = req.any.find((t) => present.has(t));
    satisfiedBy.push({ requirement: req, satisfiedBy: hit ?? null });
    if (!hit) missing.push(req);
  }
  return { ok: missing.length === 0, missing, satisfiedBy };
}

export function blockReasonFor(
  sink: GatedSink,
  result: SqlResult,
  assignments: ColumnAssignment[],
): string | null {
  const eval_ = evaluateRequirements(sink.requires, result, assignments);
  if (!eval_.ok) {
    return `Need ${eval_.missing.map((m) => m.label).join(' + ')}.`;
  }
  if (sink.customBlockReason) return sink.customBlockReason(result, assignments);
  return null;
}
