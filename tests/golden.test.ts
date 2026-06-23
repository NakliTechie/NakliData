// Resolve track M3 — Golden-table survivorship SQL tests.
//
// The dedup/survivorship SELECT is the load-bearing surface: it must collapse
// to one row per entity with the right aggregate per rule, exclude the entity
// from the aggregates, and hold against hostile identifiers (every name flows
// through quoteIdent; the aggregate fn is allowlisted, never user input).

import { describe, expect, it } from 'vitest';
import {
  type GoldenColumnPlan,
  type GoldenSpec,
  buildGoldenSql,
  needsOrderColumn,
} from '../src/core/golden.ts';

const spec = (over: Partial<GoldenSpec> = {}): GoldenSpec => ({
  entityColumn: 'vendor__merged',
  columns: [
    { columnName: 'vendor__merged', rule: 'first' },
    { columnName: 'name', rule: 'first' },
    { columnName: 'amount', rule: 'max' },
    { columnName: 'status', rule: 'latest' },
  ],
  orderColumn: 'updated_at',
  format: 'csv',
  ...over,
});

describe('buildGoldenSql', () => {
  it('emits one row per entity, one aggregate per non-entity column', () => {
    expect(buildGoldenSql(spec(), 'cell_c1')).toBe(
      [
        'SELECT "vendor__merged", first("name") AS "name", max("amount") AS "amount", arg_max("status", "updated_at") AS "status"',
        'FROM "cell_c1"',
        'GROUP BY "vendor__merged"',
      ].join('\n'),
    );
  });

  it('excludes the entity column from the aggregate list (it is the GROUP BY key)', () => {
    const sql = buildGoldenSql(spec(), 'cell_c1');
    expect(sql).not.toContain('first("vendor__merged")');
    expect(sql).not.toContain('AS "vendor__merged"');
  });

  it('maps each survivorship rule to the right DuckDB aggregate', () => {
    const sql = buildGoldenSql(
      spec({
        columns: [
          { columnName: 'a', rule: 'first' },
          { columnName: 'b', rule: 'max' },
          { columnName: 'c', rule: 'min' },
          { columnName: 'd', rule: 'latest' },
        ],
      }),
      's',
    );
    expect(sql).toContain('first("a") AS "a"');
    expect(sql).toContain('max("b") AS "b"');
    expect(sql).toContain('min("c") AS "c"');
    expect(sql).toContain('arg_max("d", "updated_at") AS "d"');
  });

  it('emits a bare distinct-entity query when there are no other columns', () => {
    expect(
      buildGoldenSql(spec({ columns: [{ columnName: 'vendor__merged', rule: 'first' }] }), 's'),
    ).toBe('SELECT "vendor__merged"\nFROM "s"\nGROUP BY "vendor__merged"');
  });

  it('throws when a "latest" rule has no order column', () => {
    expect(() =>
      buildGoldenSql(
        spec({ columns: [{ columnName: 'x', rule: 'latest' }], orderColumn: null }),
        's',
      ),
    ).toThrow(/order column/);
  });
});

describe('buildGoldenSql — injection resistance', () => {
  it('escapes a hostile entity column via quoteIdent', () => {
    const sql = buildGoldenSql(
      spec({ entityColumn: 'e"; DROP TABLE t; --', columns: [], orderColumn: null }),
      's',
    );
    expect(sql).toContain('SELECT "e""; DROP TABLE t; --"');
    expect(sql).toContain('GROUP BY "e""; DROP TABLE t; --"');
  });

  it('escapes a hostile column name + order column', () => {
    const hostile: GoldenColumnPlan[] = [{ columnName: 'c"x', rule: 'latest' }];
    const sql = buildGoldenSql(
      spec({ entityColumn: 'ent', columns: hostile, orderColumn: 'o"y' }),
      's',
    );
    expect(sql).toContain('arg_max("c""x", "o""y") AS "c""x"');
  });
});

describe('needsOrderColumn', () => {
  it('is true only when some column uses latest', () => {
    expect(needsOrderColumn([{ columnName: 'a', rule: 'first' }])).toBe(false);
    expect(
      needsOrderColumn([
        { columnName: 'a', rule: 'max' },
        { columnName: 'b', rule: 'latest' },
      ]),
    ).toBe(true);
  });
});
