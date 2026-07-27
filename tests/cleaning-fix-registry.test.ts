// Cleaning surface — fix registry (C0). Pins the contract every later chunk
// plugs into, and the three ratified behaviours that are easy to erode:
// EJ-1 a fix emits SQL for a new cell (never a mutation), EJ-3 nothing is
// suggested below the impact floor, and the result is ranked by impact.

import { describe, expect, it } from 'vitest';
import { type ColumnFacts, knownFixIds, suggestFixes } from '../src/core/cleaning/fix-registry.ts';

const facts = (over: Partial<ColumnFacts> = {}): ColumnFacts => ({
  table: 'orders',
  column: 'city',
  sqlType: 'VARCHAR',
  typeId: null,
  sensitivity: 'public',
  rowCount: 100,
  sampledRows: 100,
  nullCount: 0,
  distinctCount: 10,
  sampleValues: [],
  ...over,
});

describe('suggestFixes — a clean column suggests nothing', () => {
  it('returns [] when values are already clean', () => {
    expect(suggestFixes(facts({ sampleValues: ['Mumbai', 'Delhi', 'Pune'] }))).toEqual([]);
  });
  it('returns [] with no sample to reason about', () => {
    expect(suggestFixes(facts({ sampleValues: [] }))).toEqual([]);
  });
});

describe('trim fix', () => {
  const dirty = facts({ sampleValues: [' Mumbai', 'Delhi ', 'Pune', 'Kochi'] });

  it('is suggested when values carry leading/trailing whitespace', () => {
    const fixes = suggestFixes(dirty);
    expect(fixes).toHaveLength(1);
    expect(fixes[0]?.id).toBe('trim');
    expect(fixes[0]?.label).toBe('Trim whitespace');
  });

  it('reports honest impact (2 of 4 = 50%)', () => {
    const f = suggestFixes(dirty)[0];
    expect(f?.affected).toBe(2);
    expect(f?.fraction).toBeCloseTo(0.5);
    expect(f?.rationale).toContain('2 of 4');
    expect(f?.rationale).toContain('50%');
  });

  it('EJ-1 — emits SQL for a new cell, and does not mutate anything', () => {
    const sql = suggestFixes(dirty)[0]?.sql ?? '';
    expect(sql).toContain('SELECT * REPLACE (TRIM("city") AS "city")');
    expect(sql).toContain('FROM "orders"');
    // No mutation verbs anywhere — a cleaning fix is a proposal, not a write.
    expect(sql).not.toMatch(/\b(UPDATE|DELETE|CREATE|ALTER|DROP|INSERT)\b/i);
  });

  it('quotes identifiers, so a hostile column name cannot break out', () => {
    const sql = suggestFixes(facts({ column: 'we"ird', sampleValues: [' a', 'b'] }))[0]?.sql ?? '';
    expect(sql).toContain('"we""ird"');
  });

  it('does not fire on a numeric column', () => {
    expect(suggestFixes(facts({ sqlType: 'BIGINT', sampleValues: [' 1', '2'] }))).toEqual([]);
  });
});

describe('EJ-3 — the impact floor', () => {
  // 1 dirty value in 200 = 0.5%, below the 1% default.
  const barelyDirty = facts({
    sampleValues: [' one', ...Array.from({ length: 199 }, (_, i) => `v${i}`)],
  });

  it('suppresses a fix below the default 1% floor', () => {
    expect(suggestFixes(barelyDirty)).toEqual([]);
  });
  it('surfaces it when the caller lowers the floor', () => {
    expect(suggestFixes(barelyDirty, { impactFloor: 0 })).toHaveLength(1);
  });
  it('a raised floor suppresses a mid-impact fix', () => {
    const mid = facts({ sampleValues: [' a', 'b', 'c', 'd'] }); // 25%
    expect(suggestFixes(mid)).toHaveLength(1);
    expect(suggestFixes(mid, { impactFloor: 0.5 })).toEqual([]);
  });
});

describe('C1 — placeholder missing values', () => {
  const withNa = facts({ sampleValues: ['Mumbai', 'N/A', '-', 'Pune', 'none'] });

  it('is suggested when placeholders stand in for NULL', () => {
    const f = suggestFixes(withNa).find((x) => x.id === 'normalize-missing');
    expect(f).toBeDefined();
    expect(f?.affected).toBe(3); // N/A, -, none
    expect(f?.rationale).toMatch(/not NULL/i);
  });

  it('emits a CASE that maps them to real NULL, and mutates nothing', () => {
    const sql = suggestFixes(withNa).find((x) => x.id === 'normalize-missing')?.sql ?? '';
    expect(sql).toContain('THEN NULL ELSE');
    expect(sql).toContain('SELECT * REPLACE');
    expect(sql).not.toMatch(/\b(UPDATE|DELETE|CREATE|ALTER|DROP|INSERT)\b/i);
  });

  it('does not fire on a column with no placeholders', () => {
    const ids = suggestFixes(facts({ sampleValues: ['Mumbai', 'Delhi'] })).map((f) => f.id);
    expect(ids).not.toContain('normalize-missing');
  });
});

describe('C1 — case normalisation', () => {
  it('fires when values differ only by case', () => {
    const f = suggestFixes(facts({ sampleValues: ['Mumbai', 'MUMBAI', 'Delhi', 'Pune'] })).find(
      (x) => x.id === 'normalize-case',
    );
    expect(f).toBeDefined();
    expect(f?.affected).toBe(1);
    expect(f?.sql).toContain('LOWER("city")');
  });
  it('does not fire when casing is already consistent', () => {
    const ids = suggestFixes(facts({ sampleValues: ['Mumbai', 'Delhi', 'Pune'] })).map((f) => f.id);
    expect(ids).not.toContain('normalize-case');
  });
});

describe('C1 — nulls (fill and drop are offered together)', () => {
  const nully = facts({ sampledRows: 100, nullCount: 30, sampleValues: ['Mumbai', 'Delhi'] });

  it('offers both fill and drop for the same condition', () => {
    const ids = suggestFixes(nully).map((f) => f.id);
    expect(ids).toContain('fill-nulls');
    expect(ids).toContain('drop-null-rows');
  });
  it('reports the fraction against SAMPLED rows, not the table row count', () => {
    // rowCount is 100 here too, but the point is the denominator is sampledRows:
    // mixing a sample-scoped numerator with a table-scoped denominator would lie.
    const f = suggestFixes(facts({ rowCount: 1_000_000, sampledRows: 100, nullCount: 30 })).find(
      (x) => x.id === 'fill-nulls',
    );
    expect(f?.fraction).toBeCloseTo(0.3);
    expect(f?.rationale).toContain('30 of 100');
  });
  it('fill emits COALESCE; drop emits a WHERE IS NOT NULL', () => {
    const fill = suggestFixes(nully).find((f) => f.id === 'fill-nulls')?.sql ?? '';
    const drop = suggestFixes(nully).find((f) => f.id === 'drop-null-rows')?.sql ?? '';
    expect(fill).toContain('COALESCE("city", \'\')');
    expect(drop).toContain('WHERE "city" IS NOT NULL');
    expect(drop).not.toMatch(/\bDELETE\b/i);
  });
  it('fills numeric columns with 0, not an empty string', () => {
    const sql =
      suggestFixes(
        facts({ sqlType: 'BIGINT', sampledRows: 10, nullCount: 5, sampleValues: [] }),
      ).find((f) => f.id === 'fill-nulls')?.sql ?? '';
    expect(sql).toContain('COALESCE("city", 0)');
  });
  it('stays quiet when there are no nulls', () => {
    const ids = suggestFixes(facts({ sampledRows: 100, nullCount: 0 })).map((f) => f.id);
    expect(ids).not.toContain('fill-nulls');
    expect(ids).not.toContain('drop-null-rows');
  });
  it('stays quiet when the sample size is unknown (no honest denominator)', () => {
    const ids = suggestFixes(facts({ sampledRows: null, nullCount: 30 })).map((f) => f.id);
    expect(ids).not.toContain('fill-nulls');
  });
});

describe('ranking — the most impactful fix comes first', () => {
  it('sorts by affected fraction descending', () => {
    // 3/4 placeholders vs 1/4 needing trim.
    const f = suggestFixes(facts({ sampleValues: [' a', 'N/A', '-', 'none'] }));
    expect(f.length).toBeGreaterThan(1);
    for (let i = 1; i < f.length; i++) {
      expect(f[i - 1]!.fraction).toBeGreaterThanOrEqual(f[i]!.fraction);
    }
  });
});

describe('registry contract (what later chunks plug into)', () => {
  it('exposes its known fix ids', () => {
    expect(knownFixIds()).toContain('trim');
  });
  it('every suggestion carries the full shape', () => {
    for (const f of suggestFixes(facts({ sampleValues: [' a', 'b'] }))) {
      expect(typeof f.id).toBe('string');
      expect(typeof f.label).toBe('string');
      expect(typeof f.rationale).toBe('string');
      expect(typeof f.sql).toBe('string');
      expect(f.affected).toBeGreaterThan(0);
      expect(f.fraction).toBeGreaterThan(0);
    }
  });
  it('is pure — the same facts give the same answer', () => {
    const f = facts({ sampleValues: [' a', 'b'] });
    expect(suggestFixes(f)).toEqual(suggestFixes(f));
  });
});
