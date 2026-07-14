import { describe, expect, it } from 'vitest';
import {
  CORRELATION_GRAPH_DEFAULT_THRESHOLD,
  CorrelationGraphError,
  buildCorrelationGraphPlan,
} from '../src/core/correlation-graph.ts';

describe('buildCorrelationGraphPlan', () => {
  it('emits one row per unordered column pair (i<j)', () => {
    const plan = buildCorrelationGraphPlan('t', ['a', 'b', 'c']);
    // 3 columns → 3 pairs: a-b, a-c, b-c.
    expect(plan.pairCount).toBe(3);
    expect(plan.columns).toEqual(['a', 'b', 'c']);
    expect(plan.sql).toContain("'a' AS source, 'b' AS target");
    expect(plan.sql).toContain("'a' AS source, 'c' AS target");
    expect(plan.sql).toContain("'b' AS source, 'c' AS target");
    // No self-pairs or reversed duplicates.
    expect(plan.sql).not.toContain("'a' AS source, 'a' AS target");
    expect(plan.sql).not.toContain("'b' AS source, 'a' AS target");
  });

  it('uses corr() and thresholds on absolute weight', () => {
    const plan = buildCorrelationGraphPlan('t', ['a', 'b'], { threshold: 0.7 });
    expect(plan.threshold).toBe(0.7);
    expect(plan.sql).toContain('corr("a", "b") AS weight');
    expect(plan.sql).toContain('abs(weight) >= 0.7');
    expect(plan.sql).toContain('weight IS NOT NULL');
    expect(plan.sql).toContain('ORDER BY abs(weight) DESC');
  });

  it('defaults the threshold to 0.5', () => {
    const plan = buildCorrelationGraphPlan('t', ['a', 'b']);
    expect(plan.threshold).toBe(CORRELATION_GRAPH_DEFAULT_THRESHOLD);
    expect(plan.sql).toContain('abs(weight) >= 0.5');
  });

  it('quotes identifiers and escapes quotes in table + column names', () => {
    const plan = buildCorrelationGraphPlan('my table', ['a "x"', 'b']);
    expect(plan.sql).toContain('FROM "my table"');
    // Identifier: embedded double-quote doubled.
    expect(plan.sql).toContain('corr("a ""x""", "b")');
    // Literal: the raw column name appears single-quoted as the node id.
    expect(plan.sql).toContain(`'a "x"' AS source`);
  });

  it("escapes a single-quote in a column name's string literal", () => {
    const plan = buildCorrelationGraphPlan('t', ["o'brien", 'b']);
    expect(plan.sql).toContain("'o''brien' AS source");
  });

  it('throws when fewer than two columns are usable', () => {
    expect(() => buildCorrelationGraphPlan('t', ['only'])).toThrow(CorrelationGraphError);
    expect(() => buildCorrelationGraphPlan('t', [])).toThrow(CorrelationGraphError);
  });

  it('de-dupes columns before pairing', () => {
    const plan = buildCorrelationGraphPlan('t', ['a', 'a', 'b']);
    expect(plan.columns).toEqual(['a', 'b']);
    expect(plan.pairCount).toBe(1);
  });

  it('caps at maxColumns and flags truncation', () => {
    const cols = Array.from({ length: 5 }, (_, i) => `c${i}`);
    const plan = buildCorrelationGraphPlan('t', cols, { maxColumns: 3 });
    expect(plan.truncated).toBe(true);
    expect(plan.columns).toEqual(['c0', 'c1', 'c2']);
    expect(plan.pairCount).toBe(3); // C(3,2)
  });

  it('n columns → C(n,2) pairs', () => {
    const cols = Array.from({ length: 6 }, (_, i) => `c${i}`);
    const plan = buildCorrelationGraphPlan('t', cols);
    expect(plan.pairCount).toBe(15); // 6*5/2
    expect(plan.truncated).toBe(false);
  });
});
