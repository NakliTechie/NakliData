// Static analysis of the @cellName reference graph. Surfaced by the
// "@cellName cycle detection" follow-up (parked from 2026-05-30; picked
// up 2026-05-31).
//
// Today (pre-fix) the rewriter just replaces `@x` with the corresponding
// `cell_<id>` view — if the view doesn't exist yet (cycle, self-ref,
// or a typo'd name), DuckDB throws an opaque "table not found" error.
// That's confusing on first encounter: the surface didn't tell you
// which cell or why.
//
// This module catches the two statically-detectable broken shapes
// before the engine sees them:
//
//   - **self-reference**: cell named `x` whose code contains `@x`.
//   - **cycle**: a → b → … → a in the directed @-name graph (cells
//     that reference views — SQL / cohort / assertion).
//
// What we deliberately DON'T flag:
//   - **Unknown references** (code contains `@x` but no cell with
//     that name exists). The rewriter falls through to a quoted
//     identifier `"x"` which DuckDB resolves against mounted tables
//     and any pre-existing view. Mounting a CSV named `vendors` and
//     then writing `@vendors` in a SQL cell is a SUPPORTED pattern
//     since v1.0 — blocking it as a static error would regress
//     that. If the reference is genuinely a typo, DuckDB's own
//     "Table … does not exist" surfaces inline. (Forward-pass
//     review caught this regression before it shipped — 2026-05-31.)
//   - **Forward references** (cell A references @B where B is later
//     in the notebook): self-resolve after the first runAll.
//   - Refs inside input cell values: input cells inline as SQL
//     literals (`'value'` / `42` / `DATE '...'`), not view references.
//
// The check is pure — call from runCell / runAll before executing.

import type {
  AssertionCellState,
  CellState,
  CohortCellState,
  ReportCellState,
  SqlCellState,
} from './cells/types.ts';

/** Names of all "view-materialising" cells, i.e. ones a `@name` can resolve to. */
function viewCellNames(cells: CellState[]): Map<string, string> {
  // name → cellId. Input cells aren't view-materialising (they inline).
  // First-wins on duplicate names — matches the runtime rewriter
  // (`rewriteReferences` uses `.find()` which returns the first match
  // in document order). If we used `Map.set()` blindly we'd be
  // last-wins, and the detector would trace different edges than the
  // runtime — a real cycle could be missed.
  const out = new Map<string, string>();
  for (const c of cells) {
    if (
      (c.kind === 'sql' || c.kind === 'cohort' || c.kind === 'assertion' || c.kind === 'input') &&
      c.name?.trim() &&
      !out.has(c.name)
    ) {
      out.set(c.name, c.id);
    }
  }
  return out;
}

/** Extract every `@name` token from SQL code. Same regex as `Notebook.rewriteReferences`. */
export function extractRefs(code: string): string[] {
  const out: string[] = [];
  const re = /@([A-Za-z_][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex.exec loop.
  while ((m = re.exec(code)) !== null) {
    const name = m[1];
    if (name) out.push(name);
  }
  return out;
}

export type RefIssue =
  | {
      kind: 'self_ref';
      cellId: string;
      name: string;
    }
  | {
      kind: 'cycle';
      cellId: string;
      /** Path of names forming the cycle, ending at the entry name. */
      path: string[];
    };

/**
 * Inspect the @-graph rooted at `targetId` for issues that would cause
 * a confusing engine error. Returns `null` when the cell is safe to run.
 *
 * Only cells with `kind` ∈ {sql, cohort, assertion} are checkable — the
 * function returns `null` for any other kind (those don't run SQL).
 */
export function detectRefIssue(targetId: string, cells: CellState[]): RefIssue | null {
  const target = cells.find((c) => c.id === targetId);
  if (!target) return null;
  if (target.kind !== 'sql' && target.kind !== 'cohort' && target.kind !== 'assertion') return null;

  const nameToId = viewCellNames(cells);
  const byId = new Map<string, CellState>();
  for (const c of cells) byId.set(c.id, c);

  // 1. Self-reference. The target cell's code says @<its-own-name>.
  if (target.name) {
    const refs = extractRefs(target.code);
    if (refs.includes(target.name)) {
      return { kind: 'self_ref', cellId: target.id, name: target.name };
    }
  }

  // 2. Cycle. Walk the directed graph from `target` via @-refs in code.
  //    Only count view-materialising cells (input cells are leaves).
  const stack: string[] = []; // names along current DFS path
  const visited = new Set<string>(); // names fully explored (no cycle from here)
  function dfs(currentId: string, currentName: string | null): string[] | null {
    if (currentName && stack.includes(currentName)) {
      // Cycle — slice from the first occurrence + append the repeating name.
      const startIdx = stack.indexOf(currentName);
      return [...stack.slice(startIdx), currentName];
    }
    if (currentName && visited.has(currentName)) return null;
    if (currentName) stack.push(currentName);
    const cell = byId.get(currentId);
    const code =
      cell && (cell.kind === 'sql' || cell.kind === 'cohort' || cell.kind === 'assertion')
        ? cell.code
        : '';
    for (const ref of extractRefs(code)) {
      const nextId = nameToId.get(ref);
      if (!nextId) continue;
      const next = byId.get(nextId);
      // Don't recurse into input cells — they don't materialise views,
      // so they can't form a cycle.
      if (!next || next.kind === 'input') continue;
      const path = dfs(nextId, ref);
      if (path) return path;
    }
    if (currentName) {
      stack.pop();
      visited.add(currentName);
    }
    return null;
  }
  const cyclePath = dfs(targetId, target.name);
  if (cyclePath) {
    return { kind: 'cycle', cellId: target.id, path: cyclePath };
  }

  return null;
}

/**
 * Order the runnable (view-materialising) cells so every cell runs AFTER
 * the cells it references via `@name`. Document order is the tiebreak and
 * the fallback for cells caught in a cycle — `detectRefIssue` then
 * surfaces the cycle error when `runCell` reaches the offending cell.
 *
 * runAll previously ran in pure document order, which silently ran a
 * cell before its input when the input was defined LATER in the notebook
 * (forward-pass M14). Returns the runnable cell ids in run order.
 */
export function topoOrderRunnableCells(cells: CellState[]): string[] {
  const isRunnable = (c: CellState): c is SqlCellState | CohortCellState | AssertionCellState =>
    c.kind === 'sql' || c.kind === 'cohort' || c.kind === 'assertion';
  const runnable = cells.filter(isRunnable);
  const nameToId = viewCellNames(cells);
  const byId = new Map<string, CellState>();
  for (const c of cells) byId.set(c.id, c);
  const docIndex = new Map<string, number>();
  runnable.forEach((c, i) => docIndex.set(c.id, i));

  const order: string[] = [];
  const done = new Set<string>();
  const onPath = new Set<string>();

  function visit(id: string): void {
    if (done.has(id) || onPath.has(id)) return; // visited, or a cycle back-edge
    onPath.add(id);
    const cell = byId.get(id);
    if (cell && isRunnable(cell)) {
      // Dependencies = @-refs resolving to another runnable cell, visited
      // in document order for a deterministic result.
      const deps = extractRefs(cell.code)
        .map((name) => nameToId.get(name))
        .filter((depId): depId is string => !!depId && depId !== id)
        .map((depId) => byId.get(depId))
        .filter((c): c is CellState => !!c && isRunnable(c))
        .sort((a, b) => (docIndex.get(a.id) ?? 0) - (docIndex.get(b.id) ?? 0));
      for (const dep of deps) visit(dep.id);
    }
    onPath.delete(id);
    done.add(id);
    order.push(id);
  }

  // Seed in document order so output is document-stable absent cross-refs.
  for (const c of runnable) visit(c.id);
  return order;
}

/**
 * A4 — the runnable cells a report depends on, in run (topo) order. Scoped
 * report-refresh runs THIS subgraph instead of `runAll`, so refreshing one
 * report doesn't re-run every unrelated cell in the notebook.
 *
 * Seeds = the report's referenced cells (cell-refs + each kpi-row's
 * `sourceCell`). A referenced cell that materialises a view (sql / cohort /
 * assertion) is a seed directly; a referenced *view* cell (chart / stats /
 * pivot / …) contributes its `inputCell` instead (that's where the data comes
 * from). From each seed we take the transitive `@name`-upstream closure, then
 * return those ids filtered into the notebook's topo order.
 */
export function reportRefreshOrder(report: ReportCellState, cells: CellState[]): string[] {
  const nameToId = viewCellNames(cells);
  const byId = new Map<string, CellState>();
  for (const c of cells) byId.set(c.id, c);
  const byName = new Map<string, CellState>();
  for (const c of cells) {
    if (c.name?.trim() && !byName.has(c.name)) byName.set(c.name, c);
  }
  const isRunnable = (c: CellState | undefined): boolean =>
    !!c && (c.kind === 'sql' || c.kind === 'cohort' || c.kind === 'assertion');

  // Resolve a referenced cell to its runnable root(s): itself if runnable, else
  // its `inputCell` (recursively, guarded against a chain cycle).
  const seeds = new Set<string>();
  const addRoot = (cell: CellState | undefined, seen: Set<string>): void => {
    if (!cell || seen.has(cell.id)) return;
    seen.add(cell.id);
    if (isRunnable(cell)) {
      seeds.add(cell.id);
      return;
    }
    const input = (cell as { inputCell?: string }).inputCell;
    if (input) addRoot(byId.get(input), seen);
  };
  for (const item of report.definition.items) {
    if (item.kind === 'cell-ref') addRoot(byName.get(item.cellName), new Set());
    else if (item.kind === 'kpi-row' && item.sourceCell) {
      addRoot(byName.get(item.sourceCell), new Set());
    }
  }

  // Transitive @name-upstream closure over view-materialising cells.
  const closure = new Set<string>();
  const walk = (id: string): void => {
    if (closure.has(id)) return;
    closure.add(id);
    const cell = byId.get(id);
    const code = isRunnable(cell)
      ? (cell as SqlCellState | CohortCellState | AssertionCellState).code
      : '';
    for (const ref of extractRefs(code)) {
      const upId = nameToId.get(ref);
      if (upId && upId !== id) walk(upId);
    }
  };
  for (const s of seeds) walk(s);

  return topoOrderRunnableCells(cells).filter((id) => closure.has(id));
}

/** Render a RefIssue as a one-line user-facing error message. */
export function refIssueMessage(issue: RefIssue): string {
  if (issue.kind === 'self_ref') {
    return `Cell references itself (@${issue.name}). Reference a different cell, or remove the @${issue.name}.`;
  }
  // cycle
  return `Cycle in @-references: ${issue.path.map((n) => `@${n}`).join(' → ')}. Break one of these links.`;
}
