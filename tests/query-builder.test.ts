// M5 — Visual Query Builder tests.
//
// Gate artifacts per handoff §M5:
//   - Build "amount > 1000 AND vendor LIKE 'Foo%'" → emitted SQL has
//     those values as bound parameters, not concatenated raw.
//   - Empty form → emits `SELECT * FROM <table> LIMIT 100`.
//   - Build a single-key JOIN → emits `... FROM a JOIN b ON a.k =
//     b.k` (no subquery).
//   - Hostile column names + filter values: every identifier goes
//     through quoteIdent + every value through a type-validated
//     emitter. NO string-concat SQL injection regardless of input.

import { describe, expect, it } from 'vitest';
import {
  type QueryBuilderSpec,
  emitSql,
  emitValueLiteral,
  emptySpec,
  quoteIdent,
  quoteLiteral,
} from '../src/core/query-builder.ts';

describe('emptySpec + emitSql — gate case "empty form"', () => {
  it('empty spec for an orders table emits SELECT * FROM orders LIMIT 100', () => {
    const sql = emitSql(emptySpec('orders'));
    expect(sql).toBe('SELECT *\nFROM "orders"\nLIMIT 100');
  });
});

describe('emitSql — filter case', () => {
  it('numeric filter emits the value bare (not quoted)', () => {
    const spec: QueryBuilderSpec = {
      ...emptySpec('invoices'),
      filters: [
        {
          table: 'invoices',
          column: 'amount',
          columnType: 'numeric',
          op: '>',
          value: '1000',
        },
      ],
    };
    const sql = emitSql(spec);
    expect(sql).toContain('"invoices"."amount" > 1000');
  });

  it('string LIKE filter quotes the value via quoteLiteral', () => {
    const spec: QueryBuilderSpec = {
      ...emptySpec('invoices'),
      filters: [
        {
          table: 'invoices',
          column: 'vendor_name',
          columnType: 'string',
          op: 'LIKE',
          value: 'Foo%',
        },
      ],
    };
    const sql = emitSql(spec);
    expect(sql).toContain(`"invoices"."vendor_name" LIKE 'Foo%'`);
  });

  it('combined numeric + LIKE → AND-joined predicates with proper escapes', () => {
    const spec: QueryBuilderSpec = {
      ...emptySpec('invoices'),
      filters: [
        {
          table: 'invoices',
          column: 'amount',
          columnType: 'numeric',
          op: '>',
          value: '1000',
        },
        {
          table: 'invoices',
          column: 'vendor_name',
          columnType: 'string',
          op: 'LIKE',
          value: 'Foo%',
        },
      ],
    };
    const sql = emitSql(spec);
    expect(sql).toContain('WHERE "invoices"."amount" > 1000');
    expect(sql).toContain(`AND "invoices"."vendor_name" LIKE 'Foo%'`);
  });

  it('IS NULL / IS NOT NULL filters emit no literal', () => {
    const spec: QueryBuilderSpec = {
      ...emptySpec('orders'),
      filters: [
        {
          table: 'orders',
          column: 'shipped_at',
          columnType: 'date',
          op: 'IS NULL',
          value: '',
        },
      ],
    };
    const sql = emitSql(spec);
    expect(sql).toContain('"orders"."shipped_at" IS NULL');
  });
});

describe('emitSql — JOIN case', () => {
  it('builds a single-key join, no subquery', () => {
    const spec: QueryBuilderSpec = {
      ...emptySpec('orders'),
      join: {
        table: 'vendors',
        leftColumn: 'vendor_id',
        rightColumn: 'id',
      },
    };
    const sql = emitSql(spec);
    expect(sql).toContain('FROM "orders" JOIN "vendors" ON "orders"."vendor_id" = "vendors"."id"');
    // No nested subquery in FROM — the FROM clause uses an identifier-form join, not `FROM (SELECT ...)`.
    expect(sql).not.toMatch(/FROM\s*\(/);
    // Exactly one SELECT (the top-level one) — no nested SELECT either.
    expect(sql.match(/SELECT/g)?.length).toBe(1);
  });

  it('JOIN + filter + select with table-qualified columns', () => {
    const spec: QueryBuilderSpec = {
      ...emptySpec('orders'),
      selectColumns: [
        { table: 'orders', column: 'id' },
        { table: 'vendors', column: 'name' },
      ],
      join: {
        table: 'vendors',
        leftColumn: 'vendor_id',
        rightColumn: 'id',
      },
      filters: [
        {
          table: 'orders',
          column: 'amount',
          columnType: 'numeric',
          op: '>=',
          value: '500',
        },
      ],
    };
    const sql = emitSql(spec);
    expect(sql).toContain('SELECT "orders"."id", "vendors"."name"');
    expect(sql).toContain('FROM "orders" JOIN "vendors"');
    expect(sql).toContain('WHERE "orders"."amount" >= 500');
  });
});

describe('emitSql — aggregation', () => {
  it('SUM by GROUP BY emits aggregate + groupBy', () => {
    const spec: QueryBuilderSpec = {
      ...emptySpec('invoices'),
      groupBy: [{ table: 'invoices', column: 'vendor_name' }],
      aggregates: [
        {
          fn: 'SUM',
          table: 'invoices',
          column: 'amount',
          alias: 'total_amount',
        },
      ],
    };
    const sql = emitSql(spec);
    expect(sql).toContain(
      'SELECT "invoices"."vendor_name", SUM("invoices"."amount") AS "total_amount"',
    );
    expect(sql).toContain('GROUP BY "invoices"."vendor_name"');
  });

  it('multiple aggregates compose with comma joins', () => {
    const spec: QueryBuilderSpec = {
      ...emptySpec('invoices'),
      groupBy: [{ table: 'invoices', column: 'vendor_name' }],
      aggregates: [
        { fn: 'COUNT', table: 'invoices', column: 'id', alias: 'n' },
        { fn: 'AVG', table: 'invoices', column: 'amount', alias: 'avg_amount' },
      ],
    };
    const sql = emitSql(spec);
    expect(sql).toContain('COUNT("invoices"."id") AS "n"');
    expect(sql).toContain('AVG("invoices"."amount") AS "avg_amount"');
  });
});

describe('emitSql — sort + limit', () => {
  it('ORDER BY emits column + direction', () => {
    const spec: QueryBuilderSpec = {
      ...emptySpec('orders'),
      orderBy: { table: 'orders', column: 'amount', direction: 'DESC' },
    };
    const sql = emitSql(spec);
    expect(sql).toContain('ORDER BY "orders"."amount" DESC');
  });

  it('LIMIT defaults to 100, capped at 1M, floored', () => {
    expect(emitSql(emptySpec('t'))).toContain('LIMIT 100');
    expect(emitSql({ ...emptySpec('t'), limit: 5_000_000 })).toContain('LIMIT 1000000');
    expect(emitSql({ ...emptySpec('t'), limit: 7.5 })).toContain('LIMIT 7');
  });

  it('LIMIT throws when explicitly < 1 (defensive)', () => {
    expect(() => emitSql({ ...emptySpec('t'), limit: 0 })).toThrow();
    expect(() => emitSql({ ...emptySpec('t'), limit: -1 })).toThrow();
  });

  it('LIMIT throws on non-finite values (NaN / Infinity) — forward-pass H5', () => {
    // `< 1` alone misses these (both compare false), so buildLimit would
    // emit `LIMIT NaN` / a silently-clamped Infinity.
    expect(() => emitSql({ ...emptySpec('t'), limit: Number.NaN })).toThrow();
    expect(() => emitSql({ ...emptySpec('t'), limit: Number.POSITIVE_INFINITY })).toThrow();
    expect(() => emitSql({ ...emptySpec('t'), limit: Number.NEGATIVE_INFINITY })).toThrow();
  });
});

describe('emitSql — INJECTION RESISTANCE (handoff §10 / §M5 critical)', () => {
  it('hostile table name with internal " is escaped (no SQL escape)', () => {
    const spec: QueryBuilderSpec = emptySpec('a"; DROP TABLE users; --');
    const sql = emitSql(spec);
    // The entire hostile string lands INSIDE a quoted identifier;
    // DuckDB parses the whole thing as one weird table name.
    expect(sql).toContain(`FROM "a""; DROP TABLE users; --"`);
    // Structural check: every appearance of FROM is followed by a "
    // (quoted ident), never a bare token.
    const fromMatches = sql.match(/FROM\s+\S/g) ?? [];
    for (const m of fromMatches) {
      expect(m).toMatch(/FROM\s+"/);
    }
  });

  it('hostile column name with internal " is escaped', () => {
    const spec: QueryBuilderSpec = {
      ...emptySpec('orders'),
      selectColumns: [{ table: 'orders', column: 'name"; DROP TABLE users; --' }],
    };
    const sql = emitSql(spec);
    expect(sql).toContain(`"orders"."name""; DROP TABLE users; --"`);
  });

  it('hostile string filter value with single-quote is doubled', () => {
    const spec: QueryBuilderSpec = {
      ...emptySpec('orders'),
      filters: [
        {
          table: 'orders',
          column: 'note',
          columnType: 'string',
          op: '=',
          value: "' OR 1=1; --",
        },
      ],
    };
    const sql = emitSql(spec);
    expect(sql).toContain(`"orders"."note" = ''' OR 1=1; --'`);
    // Verify the escaping holds: the value is one logical SQL string
    // literal. The 'OR' is inside quotes (escaped), not a free clause.
    expect(sql).not.toMatch(/=\s*''\s+OR\b/);
  });

  it('hostile NUMERIC filter value is rejected (NaN drops the filter)', () => {
    const spec: QueryBuilderSpec = {
      ...emptySpec('orders'),
      filters: [
        {
          table: 'orders',
          column: 'amount',
          columnType: 'numeric',
          op: '>',
          value: '1; DROP TABLE users',
        },
      ],
    };
    const sql = emitSql(spec);
    // The filter is silently dropped (NaN value); WHERE clause is absent.
    expect(sql).not.toContain('WHERE');
    expect(sql).not.toContain('DROP');
  });

  it('hostile DATE filter value is rejected (non-ISO drops the filter)', () => {
    const spec: QueryBuilderSpec = {
      ...emptySpec('orders'),
      filters: [
        {
          table: 'orders',
          column: 'iso_date',
          columnType: 'date',
          op: '=',
          value: "2026-01-01'; DROP TABLE users; --",
        },
      ],
    };
    const sql = emitSql(spec);
    expect(sql).not.toContain('WHERE');
    expect(sql).not.toContain('DROP');
  });

  it('control characters in identifiers throw (defence in depth)', () => {
    const spec: QueryBuilderSpec = emptySpec('a\x00b');
    expect(() => emitSql(spec)).toThrow();
  });
});

describe('quoteIdent + quoteLiteral helpers', () => {
  it('quoteIdent wraps in " and doubles internal "', () => {
    expect(quoteIdent('simple')).toBe('"simple"');
    expect(quoteIdent('with"quote')).toBe('"with""quote"');
  });
  it("quoteLiteral wraps in ' and doubles internal '", () => {
    expect(quoteLiteral('simple')).toBe("'simple'");
    expect(quoteLiteral("with'quote")).toBe("'with''quote'");
  });
});

describe('emitValueLiteral — type-validated emission', () => {
  it('numeric accepts integers and floats', () => {
    expect(emitValueLiteral('numeric', '42')).toBe('42');
    expect(emitValueLiteral('numeric', '3.14')).toBe('3.14');
    expect(emitValueLiteral('numeric', '-5')).toBe('-5');
  });

  it('numeric rejects non-numeric strings', () => {
    expect(emitValueLiteral('numeric', 'abc')).toBeNull();
    expect(emitValueLiteral('numeric', '1; DROP TABLE')).toBeNull();
    expect(emitValueLiteral('numeric', 'Infinity')).toBeNull();
    expect(emitValueLiteral('numeric', 'NaN')).toBeNull();
  });

  it('string emits via quoteLiteral', () => {
    expect(emitValueLiteral('string', 'hello')).toBe("'hello'");
    expect(emitValueLiteral('string', "with'quote")).toBe("'with''quote'");
  });

  it('date accepts ISO-8601 dates and timestamps', () => {
    expect(emitValueLiteral('date', '2026-01-01')).toBe("'2026-01-01'");
    expect(emitValueLiteral('date', '2026-01-01T12:34:56Z')).toBe("'2026-01-01T12:34:56Z'");
  });

  it('date rejects non-ISO strings', () => {
    expect(emitValueLiteral('date', '01/01/2026')).toBeNull();
    expect(emitValueLiteral('date', "2026-01-01'; DROP")).toBeNull();
  });

  it('boolean accepts true / false (case-insensitive)', () => {
    expect(emitValueLiteral('boolean', 'true')).toBe('TRUE');
    expect(emitValueLiteral('boolean', 'TRUE')).toBe('TRUE');
    expect(emitValueLiteral('boolean', 'False')).toBe('FALSE');
  });

  it('boolean rejects anything else', () => {
    expect(emitValueLiteral('boolean', 'yes')).toBeNull();
    expect(emitValueLiteral('boolean', '1')).toBeNull();
  });
});

describe('emitSql — GROUP BY consistency (forward-pass H7)', () => {
  it('throws when a SELECT column is neither grouped nor aggregated', () => {
    const spec: QueryBuilderSpec = {
      ...emptySpec('orders'),
      selectColumns: [{ table: 'orders', column: 'amount' }],
      groupBy: [{ table: 'orders', column: 'vendor' }],
      aggregates: [{ fn: 'SUM', table: 'orders', column: 'total', alias: 'sum_total' }],
    };
    expect(() => emitSql(spec)).toThrow(/GROUP BY/);
  });

  it('accepts a SELECT column that is itself grouped', () => {
    const spec: QueryBuilderSpec = {
      ...emptySpec('orders'),
      selectColumns: [{ table: 'orders', column: 'vendor' }],
      groupBy: [{ table: 'orders', column: 'vendor' }],
      aggregates: [{ fn: 'SUM', table: 'orders', column: 'total', alias: 'sum_total' }],
    };
    expect(() => emitSql(spec)).not.toThrow();
  });

  it('accepts a SELECT column that matches an aggregated column', () => {
    const spec: QueryBuilderSpec = {
      ...emptySpec('orders'),
      selectColumns: [{ table: 'orders', column: 'total' }],
      groupBy: [{ table: 'orders', column: 'vendor' }],
      aggregates: [{ fn: 'SUM', table: 'orders', column: 'total', alias: 'sum_total' }],
    };
    expect(() => emitSql(spec)).not.toThrow();
  });
});

describe('emitSql — date filter TZ offset (forward-pass M15)', () => {
  it('accepts an ISO datetime with a numeric TZ offset', () => {
    const spec: QueryBuilderSpec = {
      ...emptySpec('orders'),
      filters: [
        {
          table: 'orders',
          column: 'created_at',
          columnType: 'date',
          op: '>=',
          value: '2026-01-01T00:00:00+05:30',
        },
      ],
    };
    expect(emitSql(spec)).toContain("'2026-01-01T00:00:00+05:30'");
  });
});
