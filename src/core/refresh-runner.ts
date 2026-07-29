export type RefreshCellOutcome =
  | { status: 'success'; id: string }
  | { status: 'failure'; id: string; error: string }
  | { status: 'cancelled'; id: string; reason: string }
  | { status: 'not-runnable'; id: string };

export type RefreshApplicationResult =
  | { status: 'success'; refreshedCells: number }
  | {
      status: 'cell-failure';
      refreshedCells: number;
      outcome: Exclude<RefreshCellOutcome, { status: 'success' }>;
    };

/**
 * Enforce refresh ordering: stage bytes → atomic relation swap → publish
 * source metadata → recompute affected cells → advance the fingerprint
 * baseline. A failed/cancelled cell deliberately leaves the old baseline in
 * place so the next user check proposes the refresh again.
 */
export async function applyDetectedRefresh<Staged>(opts: {
  stage: () => Promise<Staged>;
  commit: (staged: Staged) => Promise<void>;
  publish: (staged: Staged) => void;
  cellIds: ReadonlyArray<string>;
  runCell: (id: string) => Promise<RefreshCellOutcome>;
  persistBaseline: () => Promise<void>;
}): Promise<RefreshApplicationResult> {
  const staged = await opts.stage();
  await opts.commit(staged);
  opts.publish(staged);

  let refreshedCells = 0;
  for (const id of opts.cellIds) {
    const outcome = await opts.runCell(id);
    if (outcome.status !== 'success') {
      return { status: 'cell-failure', refreshedCells, outcome };
    }
    refreshedCells += 1;
  }

  await opts.persistBaseline();
  return { status: 'success', refreshedCells };
}

/** Filter a dependency-first whole-notebook order to the affected set. */
export function orderAffectedCellIds(
  affectedCellIds: ReadonlyArray<string>,
  topologicalCellIds: ReadonlyArray<string>,
): string[] {
  const affected = new Set(affectedCellIds);
  const ordered = topologicalCellIds.filter((id) => affected.has(id));
  const included = new Set(ordered);
  // Keep malformed/stale-lineage ids visible and fail closed through
  // `runCell(not-runnable)` instead of silently advancing the baseline.
  for (const id of affectedCellIds) {
    if (!included.has(id)) {
      ordered.push(id);
      included.add(id);
    }
  }
  return ordered;
}
