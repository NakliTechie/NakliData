// core/distribution — column classification + numeric histogram + category counts.

import { describe, expect, it } from 'vitest';
import {
  categoryCounts,
  isNumericColumn,
  numericHistogram,
  summarizeColumn,
} from '../src/core/distribution.ts';

describe('isNumericColumn', () => {
  it('classifies mostly-numeric columns as numeric', () => {
    expect(isNumericColumn([1, 2, 3, 4])).toBe(true);
    expect(isNumericColumn([1, 2, '3', null, 5])).toBe(true); // numeric strings ok
    expect(isNumericColumn([1n, 2n, 3n])).toBe(true); // bigint
  });
  it('classifies text columns as categorical', () => {
    expect(isNumericColumn(['a', 'b', 'c'])).toBe(false);
    expect(isNumericColumn(['a', 'b', 1, 2])).toBe(false); // 50% < threshold
    expect(isNumericColumn([true, false])).toBe(false); // booleans aren't numeric
    expect(isNumericColumn([])).toBe(false);
  });
});

describe('numericHistogram', () => {
  it('bins numbers and counts skipped non-numeric', () => {
    const h = numericHistogram([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 5);
    expect(h.bins.length).toBe(5);
    expect(h.total).toBe(10);
    expect(h.bins.reduce((s, b) => s + b.count, 0)).toBe(10);
    expect(h.min).toBe(0);
    expect(h.max).toBe(9);
  });
  it('handles zero-span + puts max in last bin', () => {
    expect(numericHistogram([7, 7, 7], 4).bins.length).toBe(1);
    const h = numericHistogram([0, 10, 10], 2);
    expect(h.bins[h.bins.length - 1]?.count).toBe(2);
  });
  it('counts nulls/booleans as skipped', () => {
    const h = numericHistogram([1, 2, null, true, 3], 2);
    expect(h.total).toBe(3);
    expect(h.skipped).toBe(2);
  });
});

describe('categoryCounts', () => {
  it('counts + sorts by frequency, caps at topN with an other bucket', () => {
    const values = ['a', 'a', 'a', 'b', 'b', 'c', 'd'];
    const s = categoryCounts(values, 2);
    expect(s.items).toEqual([
      { value: 'a', count: 3 },
      { value: 'b', count: 2 },
    ]);
    expect(s.otherCount).toBe(2); // c + d
    expect(s.distinct).toBe(4);
    expect(s.total).toBe(7);
  });
  it('counts null / empty separately', () => {
    const s = categoryCounts(['x', null, '', 'x'], 10);
    expect(s.nullCount).toBe(2);
    expect(s.total).toBe(2);
    expect(s.items).toEqual([{ value: 'x', count: 2 }]);
  });
  it('breaks frequency ties by value for stable order', () => {
    const s = categoryCounts(['b', 'a', 'c'], 10);
    expect(s.items.map((i) => i.value)).toEqual(['a', 'b', 'c']);
  });
});

describe('summarizeColumn', () => {
  it('routes numeric vs categorical', () => {
    expect(summarizeColumn([1, 2, 3]).kind).toBe('numeric');
    expect(summarizeColumn(['a', 'b']).kind).toBe('categorical');
  });
});
