// M1 — Anonymized Export Sink — SQL projection + manifest tests.
//
// Handoff §10 explicitly rejects string-concat SQL builders ("the
// review's compileVisualQuery is a SQL injection and quoting bug
// factory; do not port it"). This file is the airtight-projection
// proof: hostile column names + hostile typeIds + hostile salts must
// all flow through the helpers without producing injectable SQL.

import { describe, expect, it } from 'vitest';
import {
  type AnonColumnPlan,
  buildAnonymizedProjection,
  buildManifest,
  defaultStrategyForSensitivity,
  generateSalt,
  isDateLikeType,
  isNumericType,
  quoteIdent,
  quoteLiteral,
} from '../src/core/anonymize.ts';

describe('defaultStrategyForSensitivity (handoff §M1 defaults)', () => {
  it('PII → hash', () => {
    expect(defaultStrategyForSensitivity('pii')).toBe('hash');
  });
  it('Financial → bucket', () => {
    expect(defaultStrategyForSensitivity('financial')).toBe('bucket');
  });
  it('Secret → redact (stricter than hash; even a hash is a fingerprint)', () => {
    expect(defaultStrategyForSensitivity('secret')).toBe('redact');
  });
  it('Public → keep', () => {
    expect(defaultStrategyForSensitivity('public')).toBe('keep');
  });
  it('undefined (no badge) → keep', () => {
    expect(defaultStrategyForSensitivity(undefined)).toBe('keep');
  });
});

describe('quoteIdent', () => {
  it('wraps in double quotes', () => {
    expect(quoteIdent('amount')).toBe('"amount"');
  });
  it('doubles internal double-quotes (DuckDB ident escape)', () => {
    expect(quoteIdent('a"b')).toBe('"a""b"');
  });
  it('preserves non-double-quote chars (single quotes, semicolons, commas, parens)', () => {
    expect(quoteIdent("a'b;c")).toBe(`"a'b;c"`);
    expect(quoteIdent('a,b)c(')).toBe('"a,b)c("');
  });
});

describe('quoteLiteral', () => {
  it('wraps in single quotes', () => {
    expect(quoteLiteral('abc')).toBe("'abc'");
  });
  it('doubles internal single quotes (DuckDB literal escape)', () => {
    expect(quoteLiteral("it's")).toBe("'it''s'");
  });
  it('handles empty string', () => {
    expect(quoteLiteral('')).toBe("''");
  });
});

describe('isNumericType / isDateLikeType', () => {
  it('recognises common DuckDB numeric types', () => {
    expect(isNumericType('INTEGER')).toBe(true);
    expect(isNumericType('BIGINT')).toBe(true);
    expect(isNumericType('DOUBLE')).toBe(true);
    expect(isNumericType('DECIMAL(18,2)')).toBe(true);
    expect(isNumericType('decimal(10, 4)')).toBe(true);
  });
  it('rejects non-numeric types', () => {
    expect(isNumericType('VARCHAR')).toBe(false);
    expect(isNumericType('DATE')).toBe(false);
    expect(isNumericType('BLOB')).toBe(false);
  });
  it('recognises date / timestamp types', () => {
    expect(isDateLikeType('DATE')).toBe(true);
    expect(isDateLikeType('TIMESTAMP')).toBe(true);
    expect(isDateLikeType('TIMESTAMPTZ')).toBe(true);
    expect(isDateLikeType('TIMESTAMP WITH TIME ZONE')).toBe(true);
  });
  it('rejects non-date types', () => {
    expect(isDateLikeType('INTEGER')).toBe(false);
    expect(isDateLikeType('VARCHAR')).toBe(false);
  });
});

describe('generateSalt', () => {
  it('produces a 32-char hex string', () => {
    const s = generateSalt();
    expect(s).toMatch(/^[0-9a-f]{32}$/);
  });
  it('returns a different value each call (cryptographically unique)', () => {
    const s1 = generateSalt();
    const s2 = generateSalt();
    const s3 = generateSalt();
    expect(s1).not.toBe(s2);
    expect(s2).not.toBe(s3);
    expect(s1).not.toBe(s3);
  });
});

describe('buildAnonymizedProjection — strategy → SQL expression', () => {
  const SALT = 'deadbeef1234';
  const col = (
    name: string,
    sqlType: string,
    strategy: AnonColumnPlan['strategy'],
  ): AnonColumnPlan => ({
    columnName: name,
    sqlType,
    strategy,
    sensitivity: null,
    typeId: null,
  });

  it('keep emits the column verbatim with alias', () => {
    expect(buildAnonymizedProjection([col('amount', 'INTEGER', 'keep')], SALT)).toBe(
      '"amount" AS "amount"',
    );
  });

  it('hash uses md5 with COALESCE+CAST and the quoted salt', () => {
    expect(buildAnonymizedProjection([col('email', 'VARCHAR', 'hash')], SALT)).toBe(
      `md5(COALESCE(CAST("email" AS VARCHAR), '') || 'deadbeef1234') AS "email"`,
    );
  });

  it('redact emits a literal mask', () => {
    expect(buildAnonymizedProjection([col('ssn', 'VARCHAR', 'redact')], SALT)).toBe(
      `'[REDACTED]' AS "ssn"`,
    );
  });

  it('bucket numeric → FLOOR/100 generalisation', () => {
    expect(buildAnonymizedProjection([col('amount', 'INTEGER', 'bucket')], SALT)).toBe(
      `(FLOOR(CAST("amount" AS DOUBLE) / 100) * 100) AS "amount"`,
    );
  });

  it('bucket date → DATE_TRUNC to month', () => {
    expect(buildAnonymizedProjection([col('txn_date', 'DATE', 'bucket')], SALT)).toBe(
      `DATE_TRUNC('month', CAST("txn_date" AS DATE)) AS "txn_date"`,
    );
  });

  it('bucket on a string-typed column falls back to redact (so misbadge does not error at runtime)', () => {
    expect(buildAnonymizedProjection([col('vendor', 'VARCHAR', 'bucket')], SALT)).toBe(
      `'[REDACTED]' AS "vendor"`,
    );
  });

  it('drop omits the column from the projection', () => {
    expect(
      buildAnonymizedProjection(
        [col('a', 'INTEGER', 'keep'), col('b', 'VARCHAR', 'drop'), col('c', 'INTEGER', 'keep')],
        SALT,
      ),
    ).toBe(`"a" AS "a", "c" AS "c"`);
  });

  it('all-drop plan returns the sentinel NULL projection (caller surfaces error)', () => {
    expect(
      buildAnonymizedProjection([col('a', 'INTEGER', 'drop'), col('b', 'VARCHAR', 'drop')], SALT),
    ).toBe('NULL AS _empty');
  });

  it('mixed strategies compose into one projection clause', () => {
    const out = buildAnonymizedProjection(
      [
        col('id', 'BIGINT', 'keep'),
        col('email', 'VARCHAR', 'hash'),
        col('amount', 'DOUBLE', 'bucket'),
        col('notes', 'VARCHAR', 'redact'),
      ],
      SALT,
    );
    expect(out).toContain('"id" AS "id"');
    expect(out).toContain(`md5(COALESCE(CAST("email" AS VARCHAR), '') || 'deadbeef1234')`);
    expect(out).toContain('(FLOOR(CAST("amount" AS DOUBLE) / 100) * 100)');
    expect(out).toContain(`'[REDACTED]' AS "notes"`);
    // 4 columns kept → 4 `AS "..."` aliases (note: total count of `AS`
    // in the output. Each expression ends in `AS "<col>"`.)
    expect((out.match(/ AS "/g) ?? []).length).toBe(4);
  });
});

describe('buildAnonymizedProjection — injection resistance', () => {
  const SALT = 'feed1234';
  const col = (
    name: string,
    sqlType: string,
    strategy: AnonColumnPlan['strategy'],
  ): AnonColumnPlan => ({
    columnName: name,
    sqlType,
    strategy,
    sensitivity: null,
    typeId: null,
  });

  it('hostile column name with single quote survives via quoteIdent', () => {
    const out = buildAnonymizedProjection(
      [col(`x'; DROP TABLE users; --`, 'VARCHAR', 'keep')],
      SALT,
    );
    expect(out).toBe(`"x'; DROP TABLE users; --" AS "x'; DROP TABLE users; --"`);
    // Structural injection-proof: the entire output matches
    // `"<ident>" AS "<ident>"` — both halves are double-quoted
    // identifiers, so the `'` and `;` inside are content, not
    // delimiters. There is no naked `'` (string-literal opener) and
    // no naked `;` (statement separator) outside the `"..."` scopes.
    expect(out).toMatch(/^"[^"]*" AS "[^"]*"$/);
  });

  it('hostile column name with double quote is escaped (DuckDB ident rule)', () => {
    const out = buildAnonymizedProjection([col(`x"; DROP TABLE x; --`, 'VARCHAR', 'keep')], SALT);
    expect(out).toBe(`"x""; DROP TABLE x; --" AS "x""; DROP TABLE x; --"`);
    // Doubled `""` is the escape; no naked closing `"` survives.
    expect(out.match(/"/g)?.length).toBe(8); // 2 outer * 2 sides = 4, plus 2 escapes * 2 = 4
  });

  it('hash strategy with hostile column name escapes inside CAST + outer alias', () => {
    const out = buildAnonymizedProjection([col(`a"b'c`, 'VARCHAR', 'hash')], SALT);
    expect(out).toBe(`md5(COALESCE(CAST("a""b'c" AS VARCHAR), '') || 'feed1234') AS "a""b'c"`);
  });

  it('salt with single quote is escaped (defence in depth — generateSalt is hex-only)', () => {
    // generateSalt never produces a quote, but the API accepts any
    // string (custom paste path). Hand-crafted salt with `'` must not
    // escape the literal.
    const out = buildAnonymizedProjection(
      [col('email', 'VARCHAR', 'hash')],
      `evil'; DROP TABLE users; --`,
    );
    expect(out).toBe(
      `md5(COALESCE(CAST("email" AS VARCHAR), '') || 'evil''; DROP TABLE users; --') AS "email"`,
    );
    // The hostile `'` inside the salt is doubled (`''`), so DuckDB
    // parses the literal as one string `evil'; DROP TABLE users; --`.
    // Total `'` count: 2 (empty-string literal) + 2 (salt
    // literal open/close) + 2 (escaped `''` inside the salt) = 6.
    expect(out.match(/'/g)?.length).toBe(6);
  });

  it('redact strategy ignores user-supplied content (literal mask is fixed)', () => {
    const out = buildAnonymizedProjection([col(`x'; DROP TABLE x; --`, 'VARCHAR', 'redact')], SALT);
    expect(out).toBe(`'[REDACTED]' AS "x'; DROP TABLE x; --"`);
  });
});

describe('buildManifest — schema + salt omission', () => {
  const plan: AnonColumnPlan[] = [
    {
      columnName: 'email',
      sqlType: 'VARCHAR',
      strategy: 'hash',
      sensitivity: 'pii',
      typeId: 'email',
    },
    {
      columnName: 'amount',
      sqlType: 'INTEGER',
      strategy: 'bucket',
      sensitivity: 'financial',
      typeId: 'amount',
    },
  ];

  it('records columns + strategies + taxonomy version + saltUsed flag', () => {
    const m = buildManifest({
      plan,
      taxonomyVersion: 'v0.1',
      saltUsed: true,
      exportedAtIso: '2026-06-03T12:00:00.000Z',
    });
    expect(m.format).toBe('naklidata-anonymize-manifest');
    expect(m.version).toBe('1');
    expect(m.exportedAt).toBe('2026-06-03T12:00:00.000Z');
    expect(m.taxonomyVersion).toBe('v0.1');
    expect(m.saltUsed).toBe(true);
    expect(m.columns).toHaveLength(2);
    expect(m.columns[0]).toEqual({
      name: 'email',
      strategy: 'hash',
      sensitivity: 'pii',
      typeId: 'email',
    });
  });

  it('NEVER includes the salt value itself (handoff §M1: "NOT the salt")', () => {
    // The word "salt" DOES appear in the manifest (in the saltUsed
    // flag name + the notes blurb explaining the strategy). What
    // must never appear is a salt VALUE.
    const distinctiveSaltValue = '__sentinel_salt_xyz_must_not_appear__';
    const m = buildManifest({
      plan,
      taxonomyVersion: 'v0.1',
      saltUsed: true,
    });
    // Build manifest never sees the salt value; that's the contract.
    const json = JSON.stringify(m);
    expect(json).not.toContain(distinctiveSaltValue);
    // Also: the manifest does not have a `salt` key (only `saltUsed`).
    expect(m).not.toHaveProperty('salt');
  });

  it('exportedAt defaults to now when not provided', () => {
    const m = buildManifest({ plan, taxonomyVersion: 'v0.1', saltUsed: false });
    expect(m.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
