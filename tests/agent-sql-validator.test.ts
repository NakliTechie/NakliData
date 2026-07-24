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

describe('validateReadOnlySql — adversarial bypasses (2026-07-24 review)', () => {
  const allowed = { allowedTables: new Set(['orders', 'customers']) };

  it('comma-join tables ARE scoped (FROM orders, secrets)', () => {
    const r = rejected('SELECT * FROM orders, secrets', allowed);
    expect(r.reason).toMatch(/secrets/);
  });
  it('three-way comma-join scopes every relation', () => {
    rejected('SELECT * FROM orders, customers, secrets', allowed);
    ok('SELECT * FROM orders, customers', allowed);
  });
  it('comma-join with aliases still scopes (FROM orders o, secrets s)', () => {
    rejected('SELECT * FROM orders o, secrets s', allowed);
  });
  it('string literal in table position is rejected (file/URL replacement scan)', () => {
    rejected("SELECT * FROM '/etc/passwd'", allowed);
    rejected("SELECT * FROM 'https://evil.example/x.csv'", allowed);
    rejected("SELECT * FROM orders JOIN '/etc/passwd' ON true", allowed);
  });
  it('file/connector table functions are rejected in table position', () => {
    for (const fn of [
      "parquet_metadata('/etc/passwd')",
      "parquet_schema('/x.parquet')",
      "st_read('/etc/passwd')",
      "read_xlsx('/x.xlsx')",
      "sqlite_scan('a.db', 'secrets')",
      "postgres_scan('conn', 'public', 'secrets')",
      "iceberg_scan('/x')",
      "delta_scan('/x')",
      'duckdb_settings()',
      "pragma_table_info('orders')",
    ]) {
      rejected(`SELECT * FROM ${fn}`, allowed);
    }
  });
  it('quoted / backtick identifier does not dodge the function denylist', () => {
    rejected(`SELECT * FROM "read_csv"('/etc/passwd')`, allowed);
    rejected("SELECT * FROM `read_csv`('/etc/passwd')", allowed);
    rejected(`SELECT "read_blob"('/etc/passwd')`, allowed);
  });
  it('file functions in a NON-table position (SELECT list) are still rejected', () => {
    rejected("SELECT read_blob('/etc/passwd') AS x FROM orders", allowed);
  });
  it('a SCHEMA-QUALIFIED forbidden function does not dodge the denylist (round-2)', () => {
    // system.main.read_blob is the canonical qualified path for a DuckDB builtin;
    // the function check must match the last dotted segment, not the raw word.
    rejected("SELECT system.main.read_blob('/etc/passwd') FROM orders", allowed);
    rejected("SELECT main.read_text('/etc/hosts') FROM orders", allowed);
    rejected("SELECT * FROM main.read_csv('/etc/passwd')", allowed);
  });

  // False positives the review flagged — these are legitimate reads that MUST pass.
  it('replace() is a core string function, not a write', () => {
    ok("SELECT replace(name, 'a', 'b') FROM orders", allowed);
  });
  it('columns named start / begin / end are fine', () => {
    ok('SELECT start FROM orders WHERE start < 5', allowed);
    ok('SELECT begin FROM orders', allowed);
  });
  it('an alias named analyze is fine', () => {
    ok('SELECT x AS analyze FROM orders', allowed);
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
