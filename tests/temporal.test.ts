// core/temporal — time coercion + histogram bucketing for the Temporal view.

import { describe, expect, it } from 'vitest';
import { bucketTime, coerceTime, countInWindow } from '../src/core/temporal.ts';

describe('coerceTime', () => {
  it('handles Date, number, bigint microseconds, ISO string', () => {
    expect(coerceTime(new Date('2020-01-01T00:00:00Z'))).toBe(Date.parse('2020-01-01T00:00:00Z'));
    expect(coerceTime(1_600_000_000_000)).toBe(1_600_000_000_000);
    expect(coerceTime(1_600_000_000_000_000n)).toBe(1_600_000_000_000); // µs → ms
    expect(coerceTime('2021-06-15')).toBe(Date.parse('2021-06-15'));
  });

  it('returns null for non-times', () => {
    expect(coerceTime(null)).toBeNull();
    expect(coerceTime(undefined)).toBeNull();
    expect(coerceTime('not a date')).toBeNull();
    expect(coerceTime({})).toBeNull();
    expect(coerceTime(Number.NaN)).toBeNull();
  });
});

describe('bucketTime', () => {
  it('buckets evenly-spaced times across bins', () => {
    // 10 times spanning 0..9000ms, 3 bins.
    const values = Array.from({ length: 10 }, (_, i) => i * 1000);
    const h = bucketTime(values, 3);
    expect(h.bins.length).toBe(3);
    expect(h.total).toBe(10);
    expect(h.min).toBe(0);
    expect(h.max).toBe(9000);
    // All counts sum to total.
    expect(h.bins.reduce((s, b) => s + b.count, 0)).toBe(10);
  });

  it('counts uncoercible rows as skipped, not placed', () => {
    const h = bucketTime([0, 1000, 'bad', null, 2000], 2);
    expect(h.total).toBe(3);
    expect(h.skipped).toBe(2);
    expect(h.bins.reduce((s, b) => s + b.count, 0)).toBe(3);
  });

  it('collapses a zero-span input to a single bin', () => {
    const h = bucketTime([5000, 5000, 5000], 10);
    expect(h.bins.length).toBe(1);
    expect(h.bins[0]?.count).toBe(3);
  });

  it('empty / all-uncoercible input yields no bins', () => {
    expect(bucketTime([], 5).bins.length).toBe(0);
    expect(bucketTime(['x', null], 5).total).toBe(0);
  });

  it('places the max value in the last bin (inclusive upper edge)', () => {
    const values = [0, 100, 100]; // 100 == max
    const h = bucketTime(values, 2);
    expect(h.bins[h.bins.length - 1]?.count).toBe(2);
  });
});

describe('countInWindow', () => {
  it('counts inclusive of both edges, order-independent', () => {
    const values = [0, 1000, 2000, 3000, 4000];
    expect(countInWindow(values, 1000, 3000)).toBe(3);
    expect(countInWindow(values, 3000, 1000)).toBe(3); // reversed
    expect(countInWindow(values, -1, -1)).toBe(0);
  });

  it('ignores uncoercible values', () => {
    expect(countInWindow([0, 'x', 2000, null], 0, 3000)).toBe(2);
  });
});
