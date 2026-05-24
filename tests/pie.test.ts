import { describe, expect, it } from 'vitest';
import { aggregatePieSlices } from '../src/charts/render.ts';

type Row = Record<string, unknown>;

const VENDOR_SPEND: Row[] = [
  { vendor: 'Acharya', amount: 1200 },
  { vendor: 'Acharya', amount: 800 },
  { vendor: 'Bharat', amount: 500 },
  { vendor: 'Chola', amount: 250 },
  { vendor: 'Dakshin', amount: 100 },
];

describe('aggregatePieSlices', () => {
  it('sums values per category and sorts descending by total', () => {
    const slices = aggregatePieSlices(VENDOR_SPEND, 'vendor', 'amount');
    expect(slices).toEqual([
      { label: 'Acharya', value: 2000 },
      { label: 'Bharat', value: 500 },
      { label: 'Chola', value: 250 },
      { label: 'Dakshin', value: 100 },
    ]);
  });

  it('coerces numeric strings (DuckDB BIGINT-as-string) and drops non-numerics', () => {
    const slices = aggregatePieSlices(
      [
        { v: 'A', n: '100' },
        { v: 'A', n: 'not-a-number' },
        { v: 'B', n: 50 },
      ],
      'v',
      'n',
    );
    expect(slices).toEqual([
      { label: 'A', value: 100 },
      { label: 'B', value: 50 },
    ]);
  });

  it('drops non-positive values (zero, negative)', () => {
    const slices = aggregatePieSlices(
      [
        { c: 'pos', v: 10 },
        { c: 'zero', v: 0 },
        { c: 'neg', v: -5 },
      ],
      'c',
      'v',
    );
    expect(slices).toEqual([{ label: 'pos', value: 10 }]);
  });

  it('caps at 12 slices, rolling the tail into an "Other" bucket', () => {
    const rows: Row[] = [];
    for (let i = 0; i < 20; i++) {
      rows.push({ c: `cat${i}`, v: 20 - i }); // descending so cat0=20, cat19=1
    }
    const slices = aggregatePieSlices(rows, 'c', 'v');
    expect(slices).toHaveLength(12);
    expect(slices[slices.length - 1]).toEqual({
      label: 'Other',
      // cat11..cat19 → 9 + 8 + 7 + 6 + 5 + 4 + 3 + 2 + 1 = 45
      value: 45,
    });
    expect(slices[0]).toEqual({ label: 'cat0', value: 20 });
  });

  it('returns empty array when no positive values exist', () => {
    expect(aggregatePieSlices([{ c: 'x', v: 0 }], 'c', 'v')).toEqual([]);
    expect(aggregatePieSlices([], 'c', 'v')).toEqual([]);
  });

  it('handles null labels by stringifying (null becomes "null")', () => {
    const slices = aggregatePieSlices(
      [
        { c: null, v: 5 },
        { c: null, v: 3 },
        { c: 'Real', v: 100 },
      ],
      'c',
      'v',
    );
    expect(slices).toEqual([
      { label: 'Real', value: 100 },
      { label: '', value: 8 },
    ]);
  });
});
