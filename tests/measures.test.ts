// v1.3 M2 — Measures layer tests.
//
// Gate artifacts per handoff §M2:
//   - Macro expansion unit tests including malformed expressions.
//   - Rename/edit propagation: findReferencedMeasures returns the
//     names a SQL string references — used by the panel to show
//     "this measure is used by N cells."

import { describe, expect, it } from 'vitest';
import { MeasuresStore } from '../src/core/measures-store.ts';
import {
  type MeasureDefinition,
  type MeasuresFile,
  applicableMeasures,
  expandMeasures,
  findReferencedMeasures,
  validateMeasureExpression,
  validateMeasureName,
  validateMeasuresFile,
} from '../src/core/measures.ts';

function m(name: string, expression: string): MeasureDefinition {
  return {
    name,
    expression,
    format: 'number',
    description: '',
    version: 1,
  };
}

function asMap(...measures: MeasureDefinition[]): Map<string, MeasureDefinition> {
  return new Map(measures.map((meas) => [meas.name, meas]));
}

describe('validateMeasureName', () => {
  it('accepts snake_case names', () => {
    expect(validateMeasureName('revenue')).toBeNull();
    expect(validateMeasureName('total_amount')).toBeNull();
    expect(validateMeasureName('_internal')).toBeNull();
  });

  it('rejects names with uppercase / dashes / spaces / leading digits', () => {
    expect(validateMeasureName('Revenue')).not.toBeNull();
    expect(validateMeasureName('total-amount')).not.toBeNull();
    expect(validateMeasureName('total amount')).not.toBeNull();
    expect(validateMeasureName('1total')).not.toBeNull();
    expect(validateMeasureName('')).not.toBeNull();
  });

  it('caps name length at 64 chars', () => {
    expect(validateMeasureName('a'.repeat(64))).toBeNull();
    expect(validateMeasureName('a'.repeat(65))).not.toBeNull();
  });
});

describe('validateMeasureExpression', () => {
  it('accepts a simple aggregate', () => {
    expect(validateMeasureExpression('SUM(amount)')).toBeNull();
  });

  it('accepts FILTER(WHERE ...) form', () => {
    expect(validateMeasureExpression(`SUM(amount) FILTER (WHERE status = 'completed')`)).toBeNull();
  });

  it('rejects empty / whitespace-only', () => {
    expect(validateMeasureExpression('')).not.toBeNull();
    expect(validateMeasureExpression('   ')).not.toBeNull();
  });

  it('rejects semicolons (would close the outer SELECT)', () => {
    expect(validateMeasureExpression('SUM(amount); DROP TABLE')).not.toBeNull();
  });

  it('rejects write/DDL/session-mutating keywords', () => {
    expect(validateMeasureExpression('INSERT INTO foo VALUES (1)')).not.toBeNull();
    expect(validateMeasureExpression('SUM(amount) + DROP')).not.toBeNull();
    expect(validateMeasureExpression('SUM(amount) WHERE PRAGMA')).not.toBeNull();
  });

  it('allows keyword-like substrings inside string literals', () => {
    // The user might legitimately filter by a status string named "DROP"
    // (silly example, but the parser must not false-trip).
    expect(validateMeasureExpression(`SUM(amount) FILTER (WHERE status = 'DROP')`)).toBeNull();
  });

  it('allows keyword-like substrings inside line comments', () => {
    expect(validateMeasureExpression('SUM(amount) -- DROP this is a comment')).toBeNull();
  });

  it('allows a keyword as a double-quoted identifier (forward-pass M2)', () => {
    // A column literally named "insert" / "delete" is a quoted identifier,
    // not an executable keyword — must not false-trip.
    expect(validateMeasureExpression('SUM("insert")')).toBeNull();
    expect(validateMeasureExpression('COUNT("delete") FILTER (WHERE "update" > 0)')).toBeNull();
  });
});

describe('validateMeasuresFile', () => {
  it('flags duplicate names', () => {
    const file: MeasuresFile = {
      version: 1,
      measures: [m('revenue', 'SUM(a)'), m('revenue', 'SUM(b)')],
    };
    const errors = validateMeasuresFile(file);
    expect(errors.some((e) => e.includes('duplicate name'))).toBe(true);
  });

  it('flags invalid expressions per-measure', () => {
    const file: MeasuresFile = {
      version: 1,
      measures: [m('good', 'SUM(a)'), m('bad', 'INSERT INTO x')],
    };
    const errors = validateMeasuresFile(file);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('bad');
  });

  it('returns empty array on a fully-valid file', () => {
    const file: MeasuresFile = {
      version: 1,
      measures: [m('revenue', 'SUM(amount)'), m('orders', 'COUNT(*)')],
    };
    expect(validateMeasuresFile(file)).toEqual([]);
  });

  it('detects a direct cyclic MEASURE() reference (forward-pass M32)', () => {
    const file: MeasuresFile = {
      version: 1,
      measures: [m('a', 'MEASURE(b) + 1'), m('b', 'MEASURE(a) + 2')],
    };
    const errors = validateMeasuresFile(file);
    expect(errors.some((e) => /cyclic measure reference/.test(e))).toBe(true);
  });

  it('detects an indirect 3-measure cycle', () => {
    const file: MeasuresFile = {
      version: 1,
      measures: [m('a', 'MEASURE(b)'), m('b', 'MEASURE(c)'), m('c', 'MEASURE(a)')],
    };
    expect(validateMeasuresFile(file).some((e) => /cyclic/.test(e))).toBe(true);
  });

  it('does NOT flag a valid DAG of measure references', () => {
    const file: MeasuresFile = {
      version: 1,
      measures: [
        m('base', 'SUM(amount)'),
        m('a', 'MEASURE(base) * 2'),
        m('b', 'MEASURE(base) + MEASURE(a)'),
      ],
    };
    expect(validateMeasuresFile(file)).toEqual([]);
  });
});

describe('expandMeasures — single-level expansion', () => {
  it('expands a single MEASURE() call', () => {
    const measures = asMap(m('revenue', `SUM(amount) FILTER (WHERE status = 'completed')`));
    const result = expandMeasures('SELECT MEASURE(revenue) FROM invoices', measures);
    expect(result.sql).toBe(
      `SELECT (SUM(amount) FILTER (WHERE status = 'completed')) FROM invoices`,
    );
    expect(result.expansions).toEqual([
      { name: 'revenue', expression: `SUM(amount) FILTER (WHERE status = 'completed')` },
    ]);
    expect(result.unknownMeasures).toEqual([]);
  });

  it('expands multiple distinct MEASURE() calls in one SQL', () => {
    const measures = asMap(m('revenue', 'SUM(amount)'), m('order_count', 'COUNT(*)'));
    const result = expandMeasures(
      'SELECT MEASURE(revenue) AS r, MEASURE(order_count) AS n FROM orders',
      measures,
    );
    expect(result.sql).toBe('SELECT (SUM(amount)) AS r, (COUNT(*)) AS n FROM orders');
    expect(result.expansions).toHaveLength(2);
  });

  it('unknown measures become NULL with the name recorded', () => {
    const measures = asMap(m('revenue', 'SUM(amount)'));
    const result = expandMeasures('SELECT MEASURE(revenue), MEASURE(ghost) FROM x', measures);
    expect(result.sql).toBe('SELECT (SUM(amount)), NULL FROM x');
    expect(result.unknownMeasures).toEqual(['ghost']);
  });

  it('does not substitute lowercase `measure(` (function name collision)', () => {
    // Lowercase shouldn't match — preserves any future user-defined SQL
    // function named `measure`. The macro is upper-MEASURE only.
    const measures = asMap(m('revenue', 'SUM(amount)'));
    const result = expandMeasures('SELECT measure(revenue) FROM x', measures);
    expect(result.sql).toBe('SELECT measure(revenue) FROM x');
    expect(result.expansions).toEqual([]);
  });

  it('L16: does NOT expand a MEASURE() inside a string literal', () => {
    const measures = asMap(m('revenue', 'SUM(amount)'));
    // The literal must survive verbatim; the real MEASURE() still expands.
    const result = expandMeasures(
      `SELECT MEASURE(revenue), 'MEASURE(revenue)' AS note FROM x`,
      measures,
    );
    expect(result.sql).toBe(`SELECT (SUM(amount)), 'MEASURE(revenue)' AS note FROM x`);
    expect(result.expansions).toHaveLength(1);
    expect(result.unknownMeasures).toEqual([]);
  });

  it('L16: does NOT expand a MEASURE() inside a comment (and does not loop to the cap)', () => {
    const measures = asMap(m('revenue', 'SUM(amount)'));
    const result = expandMeasures('SELECT 1 -- MEASURE(ghost)\nFROM x', measures);
    expect(result.sql).toBe('SELECT 1 -- MEASURE(ghost)\nFROM x');
    expect(result.unknownMeasures).toEqual([]);
  });
});

describe('expandMeasures — CROSSFILTER macro (Facet crossfilter)', () => {
  const noMeasures = new Map();
  const xf = (entries: Record<string, string>) => new Map(Object.entries(entries));

  it('expands a known crossfilter to its predicate (parenthesised)', () => {
    const result = expandMeasures(
      'SELECT * FROM sales WHERE CROSSFILTER(day)',
      noMeasures,
      undefined,
      undefined,
      xf({
        day: `"d" BETWEEN TIMESTAMP '2020-01-01 00:00:00' AND TIMESTAMP '2020-02-01 00:00:00'`,
      }),
    );
    expect(result.sql).toBe(
      `SELECT * FROM sales WHERE ("d" BETWEEN TIMESTAMP '2020-01-01 00:00:00' AND TIMESTAMP '2020-02-01 00:00:00')`,
    );
    expect(result.unknownCrossfilters).toEqual([]);
  });

  it('an active-but-empty facet maps to TRUE (no-op filter)', () => {
    const result = expandMeasures(
      'SELECT * FROM sales WHERE CROSSFILTER(day) AND amount > 0',
      noMeasures,
      undefined,
      undefined,
      xf({ day: 'TRUE' }),
    );
    expect(result.sql).toBe('SELECT * FROM sales WHERE (TRUE) AND amount > 0');
    expect(result.unknownCrossfilters).toEqual([]);
  });

  it('unknown crossfilter → TRUE (never silently zeroes rows) + name recorded', () => {
    const result = expandMeasures(
      'SELECT * FROM sales WHERE CROSSFILTER(ghost)',
      noMeasures,
      undefined,
      undefined,
      xf({ day: 'TRUE' }),
    );
    // Unlike SEGMENT (unknown → FALSE), an unknown crossfilter must not drop all
    // rows; the caller aborts on the recorded name instead.
    expect(result.sql).toBe('SELECT * FROM sales WHERE TRUE');
    expect(result.unknownCrossfilters).toEqual(['ghost']);
  });

  it('does not expand CROSSFILTER inside a string literal or comment (L16)', () => {
    const result = expandMeasures(
      `SELECT 'CROSSFILTER(day)' AS note -- CROSSFILTER(day)\nFROM x`,
      noMeasures,
      undefined,
      undefined,
      xf({ day: 'TRUE' }),
    );
    expect(result.sql).toBe(`SELECT 'CROSSFILTER(day)' AS note -- CROSSFILTER(day)\nFROM x`);
    expect(result.unknownCrossfilters).toEqual([]);
  });

  it('coexists with MEASURE + SEGMENT in one statement', () => {
    const measures = asMap(m('rev', 'SUM(amount)'));
    const segments = new Map([['big', { name: 'big', expression: 'amount > 100' }]]);
    const result = expandMeasures(
      'SELECT MEASURE(rev) FROM sales WHERE SEGMENT(big) AND CROSSFILTER(region)',
      measures,
      undefined,
      segments,
      xf({ region: `"region" IN ('west')` }),
    );
    expect(result.sql).toBe(
      `SELECT (SUM(amount)) FROM sales WHERE (amount > 100) AND ("region" IN ('west'))`,
    );
    expect(result.unknownCrossfilters).toEqual([]);
    expect(result.unknownSegments).toEqual([]);
  });
});

describe('expandMeasures — nested expansion', () => {
  it('expands MEASURE() inside another measure recursively', () => {
    const measures = asMap(
      m('revenue', 'SUM(amount)'),
      m('revenue_per_order', 'MEASURE(revenue) / NULLIF(COUNT(*), 0)'),
    );
    const result = expandMeasures('SELECT MEASURE(revenue_per_order) FROM orders', measures);
    // After one pass: `(MEASURE(revenue) / NULLIF(COUNT(*), 0))`
    // After two passes: `((SUM(amount)) / NULLIF(COUNT(*), 0))`
    expect(result.sql).toBe('SELECT ((SUM(amount)) / NULLIF(COUNT(*), 0)) FROM orders');
    expect(result.expansions.length).toBeGreaterThanOrEqual(2);
  });

  it('throws on cyclic measure references (depth cap)', () => {
    // a → b → a → b → ... never terminates
    const measures = asMap(m('a', 'MEASURE(b) + 1'), m('b', 'MEASURE(a) + 1'));
    expect(() => expandMeasures('SELECT MEASURE(a) FROM x', measures)).toThrow(/depth cap/);
  });
});

describe('findReferencedMeasures', () => {
  it('returns the names of every MEASURE() call', () => {
    expect(findReferencedMeasures('SELECT MEASURE(a), MEASURE(b), MEASURE(a) FROM x')).toEqual([
      'a',
      'b',
    ]);
  });

  it('returns empty for SQL with no MEASURE() calls', () => {
    expect(findReferencedMeasures('SELECT * FROM x')).toEqual([]);
  });
});

describe('applicableMeasures', () => {
  it('measures with no requiredTypes are always applicable', () => {
    const all = [m('a', 'SUM(x)'), m('b', 'COUNT(*)')];
    expect(applicableMeasures(all, [])).toEqual(all);
  });

  it('measures with requiredTypes need ALL types present', () => {
    const revenue: MeasureDefinition = {
      ...m('revenue', 'SUM(amount)'),
      requiredTypes: ['amount'],
    };
    const orderRev: MeasureDefinition = {
      ...m('order_revenue', 'SUM(amount) GROUP BY order_id'),
      requiredTypes: ['amount', 'order_id'],
    };
    expect(applicableMeasures([revenue, orderRev], ['amount'])).toEqual([revenue]);
    expect(applicableMeasures([revenue, orderRev], ['amount', 'order_id'])).toEqual([
      revenue,
      orderRev,
    ]);
  });
});

describe('MeasuresStore', () => {
  it('set + get is round-trip', () => {
    const store = new MeasuresStore();
    const def = m('revenue', 'SUM(amount)');
    store.set(def);
    expect(store.get('revenue')).toEqual(def);
  });

  it('list returns alphabetically sorted measures', () => {
    const store = new MeasuresStore();
    store.set(m('zeta', 'SUM(z)'));
    store.set(m('alpha', 'SUM(a)'));
    store.set(m('mu', 'SUM(m)'));
    expect(store.list().map((m) => m.name)).toEqual(['alpha', 'mu', 'zeta']);
  });

  it('remove drops the measure', () => {
    const store = new MeasuresStore();
    store.set(m('temp', 'SUM(x)'));
    store.remove('temp');
    expect(store.get('temp')).toBeUndefined();
  });

  it('loadFromFile replaces the entire store', () => {
    const store = new MeasuresStore();
    store.set(m('to_be_replaced', 'SUM(x)'));
    store.loadFromFile({ version: 1, measures: [m('fresh', 'COUNT(*)')] });
    expect(store.list().map((m) => m.name)).toEqual(['fresh']);
  });

  it('loadFromFile(undefined) clears the store', () => {
    const store = new MeasuresStore();
    store.set(m('temp', 'SUM(x)'));
    store.loadFromFile(undefined);
    expect(store.list()).toEqual([]);
  });

  it('toFile snapshots to a serializable MeasuresFile', () => {
    const store = new MeasuresStore();
    store.set(m('revenue', 'SUM(amount)'));
    const file = store.toFile();
    expect(file.version).toBe(1);
    expect(file.measures.map((m) => m.name)).toEqual(['revenue']);
  });

  it('subscribe fires on set / remove / loadFromFile', () => {
    const store = new MeasuresStore();
    const calls: number[] = [];
    store.subscribe((measures) => calls.push(measures.length));
    store.set(m('a', 'SUM(x)'));
    store.set(m('b', 'COUNT(*)'));
    store.remove('a');
    store.loadFromFile({ version: 1, measures: [m('c', 'AVG(y)')] });
    expect(calls).toEqual([1, 2, 1, 1]);
  });

  it('set rejects invalid names', () => {
    const store = new MeasuresStore();
    expect(() => store.set(m('Bad-Name', 'SUM(x)'))).toThrow();
  });
});
