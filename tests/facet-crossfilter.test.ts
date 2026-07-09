// core/facet-crossfilter — the Facet selection → SQL predicate compiler and the
// persisted-selection guard. Pure logic, no DOM.

import { describe, expect, it } from 'vitest';
import {
  type FacetSelection,
  isFacetSelection,
  selectionToPredicate,
} from '../src/core/facet-crossfilter.ts';

describe('selectionToPredicate', () => {
  it('timeRange → TRY_CAST BETWEEN two TIMESTAMP literals (inclusive)', () => {
    const lo = Date.UTC(2020, 0, 1); // 2020-01-01T00:00:00Z
    const hi = Date.UTC(2020, 1, 1); // 2020-02-01T00:00:00Z
    const pred = selectionToPredicate({ kind: 'timeRange', col: 'created_at', lo, hi });
    expect(pred).toBe(
      `TRY_CAST("created_at" AS TIMESTAMP) BETWEEN TIMESTAMP '2020-01-01 00:00:00.000' AND TIMESTAMP '2020-02-01 00:00:00.000'`,
    );
  });

  it('timeRange normalises reversed bounds (lo/hi swapped)', () => {
    const a = Date.UTC(2021, 5, 1);
    const b = Date.UTC(2021, 0, 1);
    const pred = selectionToPredicate({ kind: 'timeRange', col: 't', lo: a, hi: b });
    // The earlier date must appear first regardless of argument order.
    expect(pred).toContain(`TIMESTAMP '2021-01-01 00:00:00.000' AND TIMESTAMP '2021-06-01`);
  });

  it('numRange → BETWEEN numeric literals', () => {
    expect(selectionToPredicate({ kind: 'numRange', col: 'amount', lo: 10, hi: 20.5 })).toBe(
      '"amount" BETWEEN 10 AND 20.5',
    );
  });

  it('valueSet → IN with quoted, escaped literals', () => {
    expect(
      selectionToPredicate({ kind: 'valueSet', col: 'status', values: ['paid', "o'brien"] }),
    ).toBe(`"status" IN ('paid', 'o''brien')`);
  });

  it('empty valueSet → FALSE (matches nothing, still well-formed)', () => {
    expect(selectionToPredicate({ kind: 'valueSet', col: 'status', values: [] })).toBe('FALSE');
  });

  it('quotes an identifier containing a double quote', () => {
    expect(selectionToPredicate({ kind: 'numRange', col: 'we"ird', lo: 0, hi: 1 })).toBe(
      '"we""ird" BETWEEN 0 AND 1',
    );
  });
});

describe('isFacetSelection', () => {
  const ok = (s: FacetSelection) => expect(isFacetSelection(s)).toBe(true);

  it('accepts each valid selection kind', () => {
    ok({ kind: 'timeRange', col: 't', lo: 0, hi: 1 });
    ok({ kind: 'numRange', col: 'n', lo: -5, hi: 5 });
    ok({ kind: 'valueSet', col: 'c', values: ['a'] });
    ok({ kind: 'valueSet', col: 'c', values: [] });
  });

  it('rejects malformed / foreign shapes', () => {
    expect(isFacetSelection(null)).toBe(false);
    expect(isFacetSelection({})).toBe(false);
    expect(isFacetSelection({ kind: 'timeRange', col: '', lo: 0, hi: 1 })).toBe(false); // empty col
    expect(isFacetSelection({ kind: 'timeRange', col: 't', lo: Number.NaN, hi: 1 })).toBe(false);
    expect(isFacetSelection({ kind: 'numRange', col: 't', lo: 0 })).toBe(false); // missing hi
    expect(isFacetSelection({ kind: 'valueSet', col: 'c', values: [1, 2] })).toBe(false); // non-string
    expect(isFacetSelection({ kind: 'bogus', col: 'c' })).toBe(false);
  });
});
