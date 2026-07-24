// Agent surfaces — adversarial tests for the read-only SQL validator (Chunk 3).
// "The model is never the safety boundary" — so this guard is where the safety
// actually lives, and it earns an adversarial suite: every write / DDL / session
// / file-access shape must be REJECTED, and legitimate read queries must PASS,
// including the string-literal and comment tricks that a naive keyword scan
// would fall for.

import { describe, expect, it } from 'vitest';
import { validateReadOnlySql } from '../src/core/agent/sql-validator.ts';

const ok = (sql: string, opts?: Parameters<typeof validateReadOnlySql>[1]) => {
  const r = validateReadOnlySql(sql, opts);
  if (!r.ok) throw new Error(`expected OK, got rejection: ${r.reason}`);
  return r;
};
const rejected = (sql: string, opts?: Parameters<typeof validateReadOnlySql>[1]) => {
  const r = validateReadOnlySql(sql, opts);
  expect(r.ok).toBe(false);
  return r as { ok: false; reason: string };
};

describe('validateReadOnlySql — accepts read queries', () => {
  it('plain SELECT', () => {
    expect(ok('SELECT * FROM orders').tables).toEqual(['orders']);
  });
  it('WITH … SELECT (CTE names are not treated as unknown tables)', () => {
    const r = ok('WITH t AS (SELECT 1 AS x) SELECT x FROM t', {
      allowedTables: new Set(['orders']),
    });
    expect(r.tables).toEqual([]); // t is a CTE, not a base table
  });
  it('DuckDB FROM-first query', () => {
    ok('FROM orders SELECT count(*)');
  });
  it('bare TABLE / VALUES / DESCRIBE read forms', () => {
    ok('TABLE orders');
    ok('VALUES (1), (2)');
    ok('DESCRIBE orders');
  });
  it('parenthesised SELECT', () => {
    ok('(SELECT 1)');
  });
  it('trailing semicolon is tolerated', () => {
    ok('SELECT 1;');
  });
  it('JOINs across allowed tables pass scoping', () => {
    ok('SELECT * FROM orders o JOIN customers c ON o.cid = c.id', {
      allowedTables: new Set(['orders', 'customers']),
    });
  });
  it('schema-qualified names scope on the final segment', () => {
    ok('SELECT * FROM main.orders', { allowedTables: new Set(['orders']) });
  });
});

describe('validateReadOnlySql — rejects writes / DDL / session', () => {
  for (const sql of [
    'INSERT INTO orders VALUES (1)',
    'UPDATE orders SET x = 1',
    'DELETE FROM orders',
    'DROP TABLE orders',
    'CREATE TABLE t (x int)',
    'CREATE VIEW v AS SELECT 1',
    'ALTER TABLE orders ADD COLUMN y int',
    'TRUNCATE orders',
    "ATTACH 'x.db' AS x",
    "COPY orders TO 'out.csv'",
    'INSTALL httpfs',
    'LOAD httpfs',
    'PRAGMA database_list',
    "SET memory_limit = '1GB'",
    'CALL pragma_version()',
    'CHECKPOINT',
    'BEGIN TRANSACTION',
    'VACUUM',
  ]) {
    it(`rejects: ${sql.slice(0, 32)}`, () => {
      rejected(sql);
    });
  }

  it('rejects a write hidden in a CTE', () => {
    rejected('WITH x AS (DELETE FROM orders RETURNING *) SELECT * FROM x');
  });
  it('rejects a trailing second statement', () => {
    rejected('SELECT 1; DROP TABLE orders');
  });
  it('rejects two SELECTs separated by a semicolon', () => {
    rejected('SELECT 1; SELECT 2');
  });
});

describe('validateReadOnlySql — rejects file / network / session functions', () => {
  for (const sql of [
    "SELECT * FROM read_csv('/etc/passwd')",
    "SELECT * FROM read_parquet('s3://x/y')",
    "SELECT * FROM read_json_auto('http://evil/x')",
    "SELECT read_text('/etc/hosts')",
    "SELECT * FROM glob('/**')",
    "SELECT nextval('seq')",
  ]) {
    it(`rejects: ${sql.slice(0, 40)}`, () => {
      rejected(sql);
    });
  }
});

describe('validateReadOnlySql — string/comment tricks do not fool the guard', () => {
  it('the word DROP inside a string literal is fine', () => {
    ok("SELECT 'DROP TABLE orders' AS note");
  });
  it('a forbidden keyword in a line comment is fine', () => {
    ok('SELECT 1 -- DELETE FROM orders\n');
  });
  it('a forbidden keyword in a block comment is fine', () => {
    ok('SELECT 1 /* INSERT INTO x */ FROM orders');
  });
  it('a column literally named "delete" (quoted) is fine', () => {
    ok('SELECT "delete" FROM orders', { allowedTables: new Set(['orders']) });
  });
  it('unterminated string is a parse rejection, not a pass', () => {
    rejected("SELECT 'oops");
  });
});

describe('validateReadOnlySql — table scoping', () => {
  it('rejects a table outside the allowed set', () => {
    const r = rejected('SELECT * FROM secrets', { allowedTables: new Set(['orders']) });
    expect(r.reason).toMatch(/secrets/);
  });
  it('rejects the second table in a JOIN when it is not allowed', () => {
    rejected('SELECT * FROM orders JOIN secrets USING (id)', {
      allowedTables: new Set(['orders']),
    });
  });
  it('with no allowedTables, scoping is skipped (keyword guards still apply)', () => {
    ok('SELECT * FROM anything_at_all');
    rejected('DROP TABLE anything_at_all');
  });
  it('a subquery in FROM is not mistaken for a base table', () => {
    ok('SELECT * FROM (SELECT 1 AS x) sub', { allowedTables: new Set(['orders']) });
  });
});

describe('validateReadOnlySql — degenerate input', () => {
  it('rejects empty / whitespace', () => {
    rejected('');
    rejected('   \n  ');
  });
  it('rejects a non-query leading token', () => {
    rejected('EXPLAIN SELECT 1'); // EXPLAIN is not in the read-query starter set
    rejected('garbage tokens here');
  });
});
