// Static @-cell-name reference-graph validation. Catches self-refs,
// cycles, and unknown @names before they reach DuckDB (where the
// error becomes an opaque "table not found"). See
// src/ui/notebook-graph.ts for the rationale.

import { describe, expect, it } from 'vitest';
import type { AssertionCellState, InputCellState, SqlCellState } from '../src/ui/cells/types.ts';
import { detectRefIssue, extractRefs, refIssueMessage } from '../src/ui/notebook-graph.ts';

function sql(id: string, name: string | null, code: string): SqlCellState {
  return {
    id,
    kind: 'sql',
    order: 0,
    name,
    code,
    status: 'idle',
    lastError: null,
    lastResult: null,
    pinned: false,
  };
}
function assertion(id: string, name: string, code: string): AssertionCellState {
  return {
    id,
    kind: 'assertion',
    order: 0,
    name,
    code,
    status: 'idle',
    lastError: null,
    lastResult: null,
  };
}
function input(id: string, name: string, value: string): InputCellState {
  return {
    id,
    kind: 'input',
    order: 0,
    name,
    label: null,
    inputType: 'text',
    value,
    options: [],
  };
}

describe('extractRefs', () => {
  it('pulls every @name out of SQL', () => {
    expect(extractRefs('SELECT * FROM @a WHERE x = @b AND y IN (SELECT * FROM @c)')).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('handles repeated names', () => {
    expect(extractRefs('SELECT @x, @x FROM @y JOIN @x ON 1=1')).toEqual(['x', 'x', 'y', 'x']);
  });

  it('ignores @-followed-by-non-identifier', () => {
    expect(extractRefs("SELECT '@notarefqq' AS lit")).toEqual(['notarefqq']);
    // The detector is structural — anything matching the identifier regex
    // counts. SQL string-literal awareness is out of scope (DuckDB doesn't
    // care). The point is no spurious matches on non-identifier chars.
    expect(extractRefs('SELECT 1 -- @comment')).toEqual(['comment']);
  });

  it('returns empty for code with no refs', () => {
    expect(extractRefs('SELECT 1')).toEqual([]);
  });
});

describe('detectRefIssue — self-reference', () => {
  it('flags a cell whose code references its own name', () => {
    const cells = [sql('c1', 'x', 'SELECT * FROM @x')];
    const issue = detectRefIssue('c1', cells);
    expect(issue).toEqual({ kind: 'self_ref', cellId: 'c1', name: 'x' });
  });

  it('does NOT flag a cell that references a same-named OTHER cell (legacy aliasing)', () => {
    // Two cells, only one named — code references that other name. Fine.
    const cells = [sql('c1', 'a', 'SELECT 1'), sql('c2', null, 'SELECT * FROM @a')];
    expect(detectRefIssue('c2', cells)).toBeNull();
  });
});

describe('detectRefIssue — unknown @-references are NOT flagged', () => {
  // The rewriter falls through unknown @-names to a quoted identifier
  // ("name") that DuckDB resolves against MOUNTED TABLES and any
  // pre-existing view. So `SELECT * FROM @vendors` where `vendors` is
  // a mounted CSV (not a cell) is a SUPPORTED pattern — blocking it
  // here would regress that. The forward-pass code-review on the
  // autonomous batch caught this regression before it shipped to
  // users (2026-05-31). If the name is a real typo, DuckDB's own
  // "Table … does not exist" surfaces inline.
  it('does NOT flag @name that resolves to a mounted-table identifier (lets DuckDB handle it)', () => {
    const cells = [sql('c1', null, 'SELECT * FROM @vendors')];
    expect(detectRefIssue('c1', cells)).toBeNull();
  });

  it('does NOT flag a typo either — DuckDB will surface the table-not-found error inline', () => {
    const cells = [sql('c1', 'vendors', 'SELECT 1'), sql('c2', null, 'SELECT * FROM @misspelled')];
    expect(detectRefIssue('c2', cells)).toBeNull();
  });

  it('still passes-through valid input-cell + assertion-cell @-refs', () => {
    const cells = [
      input('c1', 'min_amt', '5000'),
      assertion('c2', 'no_dupes', 'SELECT * FROM x'),
      sql('c3', null, 'SELECT * FROM invoices WHERE amount > @min_amt'),
      sql('c4', null, 'SELECT * FROM @no_dupes'),
    ];
    expect(detectRefIssue('c3', cells)).toBeNull();
    expect(detectRefIssue('c4', cells)).toBeNull();
  });
});

describe('detectRefIssue — cycles', () => {
  it('flags a two-cell cycle (a → b → a)', () => {
    const cells = [sql('c1', 'a', 'SELECT * FROM @b'), sql('c2', 'b', 'SELECT * FROM @a')];
    const issue = detectRefIssue('c1', cells);
    expect(issue?.kind).toBe('cycle');
    if (issue?.kind === 'cycle') {
      expect(issue.path).toEqual(['a', 'b', 'a']);
    }
  });

  it('flags a three-cell cycle (a → b → c → a)', () => {
    const cells = [
      sql('c1', 'a', 'SELECT * FROM @b'),
      sql('c2', 'b', 'SELECT * FROM @c'),
      sql('c3', 'c', 'SELECT * FROM @a'),
    ];
    const issue = detectRefIssue('c1', cells);
    expect(issue?.kind).toBe('cycle');
    if (issue?.kind === 'cycle') {
      expect(issue.path).toEqual(['a', 'b', 'c', 'a']);
    }
  });

  it('does NOT flag a DAG (a → b → c, no back-edge)', () => {
    const cells = [
      sql('c1', 'a', 'SELECT * FROM @b'),
      sql('c2', 'b', 'SELECT * FROM @c'),
      sql('c3', 'c', 'SELECT 1'),
    ];
    expect(detectRefIssue('c1', cells)).toBeNull();
    expect(detectRefIssue('c2', cells)).toBeNull();
    expect(detectRefIssue('c3', cells)).toBeNull();
  });

  it('does NOT recurse into input cells (they are leaves in the @-graph)', () => {
    // sql c1 references @inp (input) — input doesn't form cycles
    // because it inlines as a literal.
    const cells = [input('c1', 'inp', '5'), sql('c2', 'a', 'SELECT @inp AS v')];
    expect(detectRefIssue('c2', cells)).toBeNull();
  });
});

describe('detectRefIssue — short-circuits', () => {
  it('returns null for non-runnable kinds (markdown / chart / pivot / map / input / dashboard)', () => {
    const cells = [sql('c1', 'x', 'SELECT * FROM @nonexistent'), sql('c2', null, 'SELECT 1')];
    expect(detectRefIssue('non-existent-id', cells)).toBeNull();
  });

  it('returns null for an empty cells list', () => {
    expect(detectRefIssue('any', [])).toBeNull();
  });
});

describe('refIssueMessage', () => {
  it('renders a self_ref as a one-liner', () => {
    const msg = refIssueMessage({ kind: 'self_ref', cellId: 'c1', name: 'x' });
    expect(msg).toContain('@x');
    expect(msg).toContain('itself');
  });

  it('renders a cycle path as a → b → a', () => {
    const msg = refIssueMessage({
      kind: 'cycle',
      cellId: 'c1',
      path: ['a', 'b', 'a'],
    });
    expect(msg).toContain('@a');
    expect(msg).toContain('@b');
    expect(msg).toContain('→');
  });
});

describe('detectRefIssue — duplicate-name resolution matches the runtime', () => {
  // When two cells share a name (no UI prevents this), both the
  // rewriter and the detector should resolve to the FIRST occurrence.
  // viewCellNames uses first-wins; rewriteReferences uses .find() →
  // first-wins. They must agree, else the detector traces different
  // edges than the runtime and misses real cycles.
  it('traces edges through the first cell when names collide', () => {
    // c1{name:'x', code:'SELECT * FROM @y'}, c2{name:'x', code:'SELECT 1'},
    // c3{name:'y', code:'SELECT * FROM @x'} — the runtime resolves @x to
    // c1, so c3→c1→c3 is a real cycle. Detector must catch it.
    const cells = [
      sql('c1', 'x', 'SELECT * FROM @y'),
      sql('c2', 'x', 'SELECT 1'),
      sql('c3', 'y', 'SELECT * FROM @x'),
    ];
    const issue = detectRefIssue('c1', cells);
    expect(issue?.kind).toBe('cycle');
    if (issue?.kind === 'cycle') {
      expect(issue.path).toEqual(['x', 'y', 'x']);
    }
  });
});
