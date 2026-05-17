import { describe, expect, it } from 'vitest';
import { type PivotComputed, computePivot } from '../src/ui/cells/pivot-cell.ts';

type Row = Record<string, unknown>;

const VENDOR_DATA: Row[] = [
  { vendor: 'Acharya', status: 'paid', amount: 1200 },
  { vendor: 'Acharya', status: 'paid', amount: 800 },
  { vendor: 'Acharya', status: 'open', amount: 300 },
  { vendor: 'Bharat', status: 'paid', amount: 500 },
  { vendor: 'Bharat', status: 'open', amount: 100 },
  { vendor: 'Bharat', status: 'open', amount: 200 },
];

describe('computePivot', () => {
  it('sums values across the rowCol × colCol grid', () => {
    const piv = computePivot(
      { rowCol: 'vendor', colCol: 'status', valueCol: 'amount', agg: 'sum' },
      VENDOR_DATA,
    );
    expect(piv).not.toBeNull();
    const p = piv as PivotComputed;
    expect(p.rowKeys).toEqual(['Acharya', 'Bharat']);
    expect(p.colKeys).toEqual(['open', 'paid']);
    expect(p.values.Acharya?.paid).toBe(2000);
    expect(p.values.Acharya?.open).toBe(300);
    expect(p.values.Bharat?.paid).toBe(500);
    expect(p.values.Bharat?.open).toBe(300);
    expect(p.rowTotals.Acharya).toBe(2300);
    expect(p.rowTotals.Bharat).toBe(800);
    expect(p.colTotals.paid).toBe(2500);
    expect(p.colTotals.open).toBe(600);
    expect(p.grandTotal).toBe(3100);
    expect(p.hasMeaningfulTotals).toBe(true);
  });

  it('count agg works without a value column', () => {
    const piv = computePivot(
      { rowCol: 'vendor', colCol: 'status', valueCol: null, agg: 'count' },
      VENDOR_DATA,
    );
    expect(piv).not.toBeNull();
    const p = piv as PivotComputed;
    expect(p.values.Acharya?.paid).toBe(2);
    expect(p.values.Acharya?.open).toBe(1);
    expect(p.values.Bharat?.paid).toBe(1);
    expect(p.values.Bharat?.open).toBe(2);
    expect(p.grandTotal).toBe(6);
    expect(p.hasMeaningfulTotals).toBe(true);
  });

  it('avg, min, max', () => {
    const avg = computePivot(
      { rowCol: 'vendor', colCol: 'status', valueCol: 'amount', agg: 'avg' },
      VENDOR_DATA,
    ) as PivotComputed;
    // Acharya/paid: (1200+800)/2 = 1000
    expect(avg.values.Acharya?.paid).toBe(1000);
    // Bharat/open: (100+200)/2 = 150
    expect(avg.values.Bharat?.open).toBe(150);
    // avg has no meaningful totals
    expect(avg.hasMeaningfulTotals).toBe(false);

    const min = computePivot(
      { rowCol: 'vendor', colCol: 'status', valueCol: 'amount', agg: 'min' },
      VENDOR_DATA,
    ) as PivotComputed;
    expect(min.values.Acharya?.paid).toBe(800);
    expect(min.values.Bharat?.open).toBe(100);

    const max = computePivot(
      { rowCol: 'vendor', colCol: 'status', valueCol: 'amount', agg: 'max' },
      VENDOR_DATA,
    ) as PivotComputed;
    expect(max.values.Acharya?.paid).toBe(1200);
    expect(max.values.Bharat?.open).toBe(200);
  });

  it('coerces numeric strings + bigint, ignores non-numeric for sum/avg', () => {
    const data: Row[] = [
      { vendor: 'A', status: 'x', amount: '50' },
      { vendor: 'A', status: 'x', amount: 50n },
      { vendor: 'A', status: 'x', amount: 'oops' },
      { vendor: 'A', status: 'x', amount: null },
    ];
    const piv = computePivot(
      { rowCol: 'vendor', colCol: 'status', valueCol: 'amount', agg: 'sum' },
      data,
    ) as PivotComputed;
    // 'oops' and null dropped; '50' → 50, 50n → 50 → total 100
    expect(piv.values.A?.x).toBe(100);
  });

  it('returns null when rowCol or colCol is unset', () => {
    expect(
      computePivot({ rowCol: null, colCol: 'status', valueCol: 'amount', agg: 'sum' }, VENDOR_DATA),
    ).toBeNull();
    expect(
      computePivot({ rowCol: 'vendor', colCol: null, valueCol: 'amount', agg: 'sum' }, VENDOR_DATA),
    ).toBeNull();
  });

  it('returns null when valueCol is unset and agg is not count', () => {
    expect(
      computePivot({ rowCol: 'vendor', colCol: 'status', valueCol: null, agg: 'sum' }, VENDOR_DATA),
    ).toBeNull();
  });

  it('returns an empty grid for empty input', () => {
    const piv = computePivot(
      { rowCol: 'vendor', colCol: 'status', valueCol: 'amount', agg: 'sum' },
      [],
    ) as PivotComputed;
    expect(piv.rowKeys).toEqual([]);
    expect(piv.colKeys).toEqual([]);
    expect(piv.grandTotal).toBe(0);
  });
});
