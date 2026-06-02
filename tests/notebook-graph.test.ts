// Static @-cell-name reference-graph validation. Catches self-refs,
// cycles, and unknown @names before they reach DuckDB (where the
// error becomes an opaque "table not found"). See
// src/ui/notebook-graph.ts for the rationale.

import { describe, expect, it } from 'vitest';
import type {
  AssertionCellState,
  CohortCellState,
  InputCellState,
  SqlCellState,
} from '../src/ui/cells/types.ts';
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
function cohort(id: string, name: string, code: string): CohortCellState {
  return {
    id,
    kind: 'cohort',
    order: 0,
    name,
    code,
    status: 'idle',
    lastError: null,
    lastResult: null,
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

describe('detectRefIssue — unknown reference', () => {
  it('flags @name with no matching cell', () => {
    const cells = [sql('c1', null, 'SELECT * FROM @missing')];
    const issue = detectRefIssue('c1', cells);
    expect(issue).toEqual({
      kind: 'unknown_ref',
      cellId: 'c1',
      refName: 'missing',
      knownNames: [],
    });
  });

  it('includes known names in the hint', () => {
    const cells = [
      sql('c1', 'vendors', 'SELECT 1'),
      cohort('c2', 'active_users', 'SELECT 1'),
      sql('c3', null, 'SELECT * FROM @misspelled'),
    ];
    const issue = detectRefIssue('c3', cells);
    expect(issue).toEqual({
      kind: 'unknown_ref',
      cellId: 'c3',
      refName: 'misspelled',
      knownNames: ['active_users', 'vendors'],
    });
  });

  it('accepts a ref to an INPUT cell (input cells inline as literals, not views)', () => {
    const cells = [
      input('c1', 'min_amt', '5000'),
      sql('c2', null, 'SELECT * FROM invoices WHERE amount > @min_amt'),
    ];
    expect(detectRefIssue('c2', cells)).toBeNull();
  });

  it('accepts a ref to an ASSERTION cell (assertions materialise views)', () => {
    const cells = [
      assertion('c1', 'no_dupes', 'SELECT * FROM x'),
      sql('c2', null, 'SELECT * FROM @no_dupes'),
    ];
    expect(detectRefIssue('c2', cells)).toBeNull();
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

  it('renders an unknown_ref with hint when known names exist', () => {
    const msg = refIssueMessage({
      kind: 'unknown_ref',
      cellId: 'c1',
      refName: 'misspelled',
      knownNames: ['vendors', 'active_users'],
    });
    expect(msg).toContain('@misspelled');
    expect(msg).toContain('@vendors');
    expect(msg).toContain('@active_users');
  });

  it('renders an unknown_ref without hint when no names exist', () => {
    const msg = refIssueMessage({
      kind: 'unknown_ref',
      cellId: 'c1',
      refName: 'x',
      knownNames: [],
    });
    expect(msg).toContain('@x');
    expect(msg).toContain('No named cells');
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
