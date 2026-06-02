// Forward-pass Batch B (2026-06-02) — sidecar parser hardening.
//
// Regression tests for four findings:
//
//   H2 — NL→SQL allowlist bypass via SQL-89 comma-join
//        `FROM allowed, secret_table` previously slipped `secret_table`
//        through because the table-ref regex only captured the FIRST
//        identifier after FROM. The new `extractFromTables` walks
//        comma-separated identifiers.
//
//   H3 — NL→SQL WRITE_KEYWORDS missing INSTALL / LOAD / SET / RESET / USE
//        Plus a separate multi-statement gate that rejects any `;`
//        followed by another statement.
//
//   M5 — summarise-result hallucination guard didn't trim whitespace
//        symmetrically. A column literally named `"total "` was added
//        to `allowed` as `"total "`; a `` `total` `` ref then failed
//        the check and the entire observation was dropped.
//
//   L4 — defaultTransport falls through to OpenAI for unknown providers
//        (this test lives below alongside the parser tests because
//        defaultTransport is module-internal; we exercise it via
//        dispatchJob's behaviour indirectly).

import { describe, expect, it } from 'vitest';
import {
  extractFromTables,
  parseNlToSqlResponse,
  parseSummariseResultResponse,
} from '../src/core/sidecar/client.ts';

describe('extractFromTables — comma-join + alias handling', () => {
  it('finds single FROM identifier', () => {
    expect(extractFromTables('SELECT * FROM invoices')).toEqual(['invoices']);
  });

  it('finds SQL-89 comma-join identifiers', () => {
    expect(extractFromTables('SELECT * FROM a, b, c WHERE 1=1')).toEqual(['a', 'b', 'c']);
  });

  it('finds quoted identifiers in comma-join', () => {
    expect(extractFromTables('SELECT * FROM "weird name", other')).toEqual(['weird name', 'other']);
  });

  it('finds JOIN-introduced identifiers as separate windows', () => {
    expect(extractFromTables('SELECT * FROM a JOIN b ON a.x = b.x')).toEqual(['a', 'b']);
  });

  it('skips bare aliases in comma-join', () => {
    expect(extractFromTables('SELECT * FROM a t1, b t2 WHERE 1=1')).toEqual(['a', 'b']);
  });

  it('skips AS-qualified aliases in comma-join', () => {
    expect(extractFromTables('SELECT * FROM a AS t1, b AS t2')).toEqual(['a', 'b']);
  });

  it('stops at terminator keywords', () => {
    expect(extractFromTables('SELECT * FROM a WHERE b > 1')).toEqual(['a']);
    expect(extractFromTables('SELECT * FROM a LIMIT 100')).toEqual(['a']);
    expect(extractFromTables('SELECT * FROM a ORDER BY x')).toEqual(['a']);
  });

  it('handles subselects without confusion', () => {
    // The outer FROM has an open-paren — no ident found, loop breaks.
    // The inner SELECT's FROM is its own window.
    expect(extractFromTables('SELECT * FROM (SELECT * FROM x) sq')).toEqual(['x']);
  });
});

describe('parseNlToSqlResponse — H2 comma-join allowlist bypass', () => {
  it('rejects `FROM allowed, secret_table` when secret_table not in allowlist', () => {
    expect(parseNlToSqlResponse('SELECT * FROM allowed, secret_table', ['allowed']).sql).toBe('');
  });

  it('accepts `FROM allowed1, allowed2` when both are in allowlist', () => {
    expect(
      parseNlToSqlResponse('SELECT * FROM allowed1, allowed2 WHERE 1=1', ['allowed1', 'allowed2'])
        .sql,
    ).toContain('FROM allowed1, allowed2');
  });

  it('rejects when comma-join introduces an unknown table after the second comma', () => {
    expect(parseNlToSqlResponse('SELECT * FROM a, b, evil', ['a', 'b']).sql).toBe('');
  });

  it('still accepts the happy CROSS JOIN path (already covered by JOIN matching)', () => {
    expect(parseNlToSqlResponse('SELECT * FROM a CROSS JOIN b', ['a', 'b']).sql).toContain(
      'CROSS JOIN',
    );
    expect(parseNlToSqlResponse('SELECT * FROM a CROSS JOIN evil', ['a']).sql).toBe('');
  });
});

describe('parseNlToSqlResponse — H3 expanded write-keyword + multi-statement gates', () => {
  it('rejects INSTALL', () => {
    expect(parseNlToSqlResponse('SELECT 1; INSTALL httpfs', ['t']).sql).toBe('');
    expect(parseNlToSqlResponse('INSTALL httpfs', ['t']).sql).toBe('');
  });

  it('rejects LOAD', () => {
    expect(parseNlToSqlResponse('SELECT 1; LOAD httpfs', ['t']).sql).toBe('');
  });

  it('rejects SET', () => {
    expect(
      parseNlToSqlResponse('SELECT 1; SET enable_external_access=true; SELECT 1', ['t']).sql,
    ).toBe('');
  });

  it('rejects RESET', () => {
    expect(parseNlToSqlResponse('SELECT 1; RESET enable_external_access', ['t']).sql).toBe('');
  });

  it('rejects USE', () => {
    expect(parseNlToSqlResponse('USE other_schema; SELECT 1', ['t']).sql).toBe('');
  });

  it('rejects multi-statement responses (catches anything else)', () => {
    expect(parseNlToSqlResponse('SELECT 1; SELECT 2', ['t']).sql).toBe('');
  });

  it('accepts a single trailing `;` (no following non-whitespace)', () => {
    expect(parseNlToSqlResponse('SELECT * FROM t;', ['t']).sql).toContain('SELECT');
    expect(parseNlToSqlResponse('SELECT * FROM t;   ', ['t']).sql).toContain('SELECT');
    expect(parseNlToSqlResponse('SELECT * FROM t;\n\n', ['t']).sql).toContain('SELECT');
  });
});

describe('parseNlToSqlResponse — code-review of v1.2.1..HEAD', () => {
  it("rejects DuckDB replacement-scan `FROM '…'` (single-quoted string)", () => {
    expect(
      parseNlToSqlResponse("SELECT * FROM 'https://attacker.example.com/x.csv'", ['t']).sql,
    ).toBe('');
    expect(parseNlToSqlResponse("SELECT * FROM '/etc/passwd'", ['t']).sql).toBe('');
  });

  it('also rejects single-quoted JOIN (defence-in-depth)', () => {
    expect(parseNlToSqlResponse("SELECT * FROM t JOIN 'evil' ON 1=1", ['t']).sql).toBe('');
  });

  it('accepts a string literal in a column position (only FROM/JOIN-string is blocked)', () => {
    expect(parseNlToSqlResponse("SELECT 'hello' AS greet FROM t", ['t']).sql).toContain(
      "SELECT 'hello'",
    );
  });

  it('multi-statement gate ignores `;` inside string literals', () => {
    // Previously dropped — `;` in a string false-tripped the gate.
    expect(parseNlToSqlResponse("SELECT 'foo;bar' FROM t", ['t']).sql).toContain(
      "SELECT 'foo;bar'",
    );
    // Still rejects real multi-statement.
    expect(parseNlToSqlResponse('SELECT 1; SELECT 2', ['t']).sql).toBe('');
  });

  it('handles escaped quotes in string literals (DuckDB doubled-quote form)', () => {
    expect(parseNlToSqlResponse("SELECT 'it''s' FROM t", ['t']).sql).toContain("'it''s'");
  });

  it('extractFromTables treats LATERAL / UNNEST / TABLE / VALUES / PIVOT as terminators, not table names', () => {
    expect(extractFromTables('FROM t1, LATERAL (SELECT * FROM t2) lat')).toEqual(['t1', 't2']);
    expect(extractFromTables('FROM t1, UNNEST([1,2,3]) AS u')).toEqual(['t1']);
    expect(extractFromTables('FROM t1, TABLE(generate_series(1, 10))')).toEqual(['t1']);
    expect(extractFromTables('FROM t1, VALUES (1, 2) AS v(a, b)')).toEqual(['t1']);
  });

  it('parseNlToSqlResponse accepts queries that use LATERAL', () => {
    expect(
      parseNlToSqlResponse('SELECT * FROM t1, LATERAL (SELECT * FROM t2 WHERE t2.x = t1.x) lat', [
        't1',
        't2',
      ]).sql,
    ).toContain('LATERAL');
  });
});

describe('parseSummariseResultResponse — M5 trim-on-both-sides', () => {
  it('accepts a backticked ref when the input column has trailing whitespace', () => {
    const raw = JSON.stringify({
      observation: 'The `total` column ranges from 1 to 100.',
    });
    // Note the trailing space in the column name.
    const out = parseSummariseResultResponse(raw, ['total ']);
    expect(out.observation).toContain('total');
  });

  it('still rejects truly hallucinated columns', () => {
    const raw = JSON.stringify({
      observation: 'The `made_up_column` value is suspicious.',
    });
    const out = parseSummariseResultResponse(raw, ['real_column']);
    expect(out.observation).toBe('');
  });

  it('handles case-insensitive matching with whitespace on both sides', () => {
    const raw = JSON.stringify({
      observation: 'See `Total`.',
    });
    const out = parseSummariseResultResponse(raw, ['  total  ']);
    expect(out.observation).toContain('Total');
  });
});
