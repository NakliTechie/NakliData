// v1.3 M4 — Stats cell SQL emitter tests.
//
// Gate artifacts per handoff §M4:
//   - Stats cell on a sample with mixed types shows correct exclusion
//     of identifier columns (no numeric stats for them).
//   - Correlation matrix verified against a known fixture.
//   - Null-heavy column handled without NaN leakage.

import { describe, expect, it } from 'vitest';
import {
  type StatsColumnSpec,
  emitCorrelationMatrixSql,
  emitDescriptivesSql,
  parseCorrelationRow,
  parseDescriptivesRow,
} from '../src/core/stats.ts';

describe('emitDescriptivesSql', () => {
  it('numeric column gets count + nulls + distinct + min + max + mean + stddev + median', () => {
    // Aliases are index-prefixed (c0__*) for injectivity — M1.
    const cols: StatsColumnSpec[] = [{ name: 'amount', type: 'numeric' }];
    const sql = emitDescriptivesSql('invoices', cols);
    expect(sql).toContain('COUNT("amount") AS "c0__count"');
    expect(sql).toContain('SUM(CASE WHEN "amount" IS NULL THEN 1 ELSE 0 END) AS "c0__nulls"');
    expect(sql).toContain('COUNT(DISTINCT "amount") AS "c0__distinct"');
    expect(sql).toContain('MIN("amount") AS "c0__min"');
    expect(sql).toContain('MAX("amount") AS "c0__max"');
    expect(sql).toContain('AVG(CAST("amount" AS DOUBLE)) AS "c0__mean"');
    expect(sql).toContain('STDDEV(CAST("amount" AS DOUBLE)) AS "c0__stddev"');
    expect(sql).toContain('quantile_cont(CAST("amount" AS DOUBLE), 0.5) AS "c0__median"');
    expect(sql).toContain('FROM "invoices"');
  });

  it('identifier column gets ONLY count + nulls + distinct (no numeric stats)', () => {
    const cols: StatsColumnSpec[] = [{ name: 'gstin', type: 'identifier' }];
    const sql = emitDescriptivesSql('invoices', cols);
    expect(sql).toContain('"c0__count"');
    expect(sql).toContain('"c0__nulls"');
    expect(sql).toContain('"c0__distinct"');
    expect(sql).not.toContain('"c0__mean"');
    expect(sql).not.toContain('"c0__stddev"');
    expect(sql).not.toContain('"c0__median"');
    expect(sql).not.toContain('"c0__min"');
    expect(sql).not.toContain('"c0__max"');
  });

  it('"other" column type behaves like identifier — no numeric stats', () => {
    const cols: StatsColumnSpec[] = [{ name: 'created_at', type: 'other' }];
    const sql = emitDescriptivesSql('orders', cols);
    expect(sql).toContain('"c0__count"');
    expect(sql).not.toContain('"c0__mean"');
  });

  it('handles mixed column types in one SELECT', () => {
    const cols: StatsColumnSpec[] = [
      { name: 'amount', type: 'numeric' },
      { name: 'gstin', type: 'identifier' },
      { name: 'created_at', type: 'other' },
    ];
    const sql = emitDescriptivesSql('invoices', cols);
    expect(sql).toContain('"c0__mean"'); // numeric column (index 0) has mean
    expect(sql).not.toContain('"c1__mean"'); // identifier (index 1) doesn't
    expect(sql).not.toContain('"c2__mean"'); // other (index 2) doesn't
  });

  it('uses index-based aliases so __-containing names cannot collide (M1)', () => {
    // Under the old `<name>__<stat>` scheme these names produced
    // overlapping alias strings; index prefixes make collision impossible.
    const cols: StatsColumnSpec[] = [
      { name: 'a', type: 'numeric' },
      { name: 'a__mean', type: 'numeric' },
    ];
    const sql = emitDescriptivesSql('t', cols);
    expect(sql).toContain('AVG(CAST("a" AS DOUBLE)) AS "c0__mean"');
    expect(sql).toContain('AVG(CAST("a__mean" AS DOUBLE)) AS "c1__mean"');
    // No alias is derived from the column name, so no name can shadow another.
    expect(sql).not.toContain('AS "a__mean"');
  });

  it('empty column list emits a safe placeholder query', () => {
    const sql = emitDescriptivesSql('invoices', []);
    expect(sql).toContain('LIMIT 0');
  });

  it('escapes hostile column names', () => {
    const cols: StatsColumnSpec[] = [{ name: `a"col"`, type: 'identifier' }];
    const sql = emitDescriptivesSql('orders', cols);
    expect(sql).toContain(`COUNT("a""col""")`);
  });

  it('throws on column with control character (defence in depth)', () => {
    const cols: StatsColumnSpec[] = [{ name: 'a\x00b', type: 'identifier' }];
    expect(() => emitDescriptivesSql('orders', cols)).toThrow();
  });
});

describe('emitCorrelationMatrixSql', () => {
  it('emits Pearson correlation for upper triangle', () => {
    const sql = emitCorrelationMatrixSql('invoices', ['amount', 'tax']);
    // self-pairs (i==j) AND (amount, tax) BUT NOT (tax, amount) — only upper triangle.
    expect(sql).toContain(
      `corr(CAST("amount" AS DOUBLE), CAST("amount" AS DOUBLE)) AS "corr__amount__amount"`,
    );
    expect(sql).toContain(
      `corr(CAST("amount" AS DOUBLE), CAST("tax" AS DOUBLE)) AS "corr__amount__tax"`,
    );
    expect(sql).toContain(`corr(CAST("tax" AS DOUBLE), CAST("tax" AS DOUBLE)) AS "corr__tax__tax"`);
    expect(sql).not.toContain(`AS "corr__tax__amount"`); // lower triangle skipped
  });

  it('< 2 numeric columns emits placeholder', () => {
    expect(emitCorrelationMatrixSql('invoices', [])).toContain('LIMIT 0');
    expect(emitCorrelationMatrixSql('invoices', ['amount'])).toContain('LIMIT 0');
  });

  it('escapes hostile column names', () => {
    const sql = emitCorrelationMatrixSql('orders', [`a"b`, `c"d`]);
    expect(sql).toContain(`CAST("a""b" AS DOUBLE)`);
    expect(sql).toContain(`CAST("c""d" AS DOUBLE)`);
  });
});

describe('parseDescriptivesRow', () => {
  it('parses a numeric column row into structured descriptives', () => {
    const cols: StatsColumnSpec[] = [{ name: 'amount', type: 'numeric' }];
    const row = {
      c0__count: 100,
      c0__nulls: 5,
      c0__distinct: 80,
      c0__min: 10,
      c0__max: 1000,
      c0__mean: 200.5,
      c0__stddev: 50.2,
      c0__median: 150,
    };
    const parsed = parseDescriptivesRow(row, cols);
    expect(parsed).toEqual([
      {
        name: 'amount',
        count: 100,
        nulls: 5,
        distinct: 80,
        min: 10,
        max: 1000,
        mean: 200.5,
        stddev: 50.2,
        median: 150,
      },
    ]);
  });

  it('identifier column row omits numeric stats', () => {
    const cols: StatsColumnSpec[] = [{ name: 'gstin', type: 'identifier' }];
    const row = {
      c0__count: 100,
      c0__nulls: 0,
      c0__distinct: 50,
    };
    const parsed = parseDescriptivesRow(row, cols);
    expect(parsed).toEqual([{ name: 'gstin', count: 100, nulls: 0, distinct: 50 }]);
  });

  it('null values are preserved as null (no NaN leakage)', () => {
    // Null-heavy column: COUNT == 0, every numeric agg returns null.
    const cols: StatsColumnSpec[] = [{ name: 'sparse', type: 'numeric' }];
    const row = {
      c0__count: 0,
      c0__nulls: 1000,
      c0__distinct: 0,
      c0__min: null,
      c0__max: null,
      c0__mean: null,
      c0__stddev: null,
      c0__median: null,
    };
    const parsed = parseDescriptivesRow(row, cols);
    expect(parsed[0]).toEqual({
      name: 'sparse',
      count: 0,
      nulls: 1000,
      distinct: 0,
      min: null,
      max: null,
      mean: null,
      stddev: null,
      median: null,
    });
    // Critically: no NaN, no undefined.
    expect(parsed[0]?.mean).toBeNull();
    expect(Number.isNaN(parsed[0]?.mean as number)).toBe(false);
  });

  it('coerces non-finite mean/stddev/median to null (forward-pass M31)', () => {
    const cols: StatsColumnSpec[] = [{ name: 'x', type: 'numeric' }];
    const row = {
      c0__count: 1,
      c0__nulls: 0,
      c0__distinct: 1,
      c0__min: 5,
      c0__max: 5,
      c0__mean: Number.NaN,
      c0__stddev: Number.POSITIVE_INFINITY,
      c0__median: 5,
    };
    const parsed = parseDescriptivesRow(row, cols);
    expect(parsed[0]?.mean).toBeNull();
    expect(parsed[0]?.stddev).toBeNull();
    expect(parsed[0]?.median).toBe(5);
  });
});

describe('parseCorrelationRow', () => {
  it('returns the upper triangle as {a, b, value} entries', () => {
    const numericCols = ['amount', 'tax'];
    const row = {
      corr__amount__amount: 1.0,
      corr__amount__tax: 0.85,
      corr__tax__tax: 1.0,
    };
    const parsed = parseCorrelationRow(row, numericCols);
    expect(parsed).toEqual([
      { a: 'amount', b: 'amount', value: 1.0 },
      { a: 'amount', b: 'tax', value: 0.85 },
      { a: 'tax', b: 'tax', value: 1.0 },
    ]);
  });

  it('null correlation (insufficient pairs) parses as null, not NaN', () => {
    const row = {
      corr__a__a: null,
      corr__a__b: null,
      corr__b__b: null,
    };
    const parsed = parseCorrelationRow(row, ['a', 'b']);
    expect(parsed.every((p) => p.value === null)).toBe(true);
  });

  it('NaN correlation is sanitized to null (defence in depth)', () => {
    // DuckDB shouldn't return NaN for corr() but the parser handles
    // the edge case so a bad fixture doesn't leak NaN into the UI.
    const row = {
      corr__a__a: Number.NaN,
      corr__a__b: 0.5,
      corr__b__b: 1.0,
    };
    const parsed = parseCorrelationRow(row, ['a', 'b']);
    expect(parsed[0]?.value).toBeNull(); // NaN → null
    expect(parsed[1]?.value).toBe(0.5);
    expect(parsed[2]?.value).toBe(1.0);
  });
});
