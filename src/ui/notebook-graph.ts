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

import type { CellState } from './cells/types.ts';

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

/** Render a RefIssue as a one-line user-facing error message. */
export function refIssueMessage(issue: RefIssue): string {
  if (issue.kind === 'self_ref') {
    return `Cell references itself (@${issue.name}). Reference a different cell, or remove the @${issue.name}.`;
  }
  // cycle
  return `Cycle in @-references: ${issue.path.map((n) => `@${n}`).join(' → ')}. Break one of these links.`;
}
