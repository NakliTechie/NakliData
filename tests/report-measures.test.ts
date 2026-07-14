// A2 — auto-generated KPI measures + cached tile values. Pure module; the
// limb-object numeric path is exercised via computeKpiValues (reuses A1's
// coerceNumeric) so HUGEINT aggregates sum correctly.
import { describe, expect, it } from 'vitest';
import type { MeasureFormat } from '../src/core/measures.ts';
import {
  buildKpiTiles,
  computeKpiValues,
  deriveResultMeasures,
  formatMeasureValue,
  recomputeKpiTiles,
  sanitizeMeasureBase,
} from '../src/core/report-measures.ts';

// Little-endian limb object, as apache-arrow serialises Int128 (A1).
function limb(value: number): Record<string, number> {
  return { '0': value >>> 0, '1': 0, '2': 0, '3': 0 };
}

describe('sanitizeMeasureBase', () => {
  it('produces a valid snake_case measure-name stem', () => {
    expect(sanitizeMeasureBase('Invoice Totals')).toBe('invoice_totals');
    expect(sanitizeMeasureBase('sales-by-region!!')).toBe('sales_by_region');
    expect(sanitizeMeasureBase('123abc')).toBe('_123abc'); // must not start with a digit
    expect(sanitizeMeasureBase('   ')).toBe('result'); // fallback
    expect(sanitizeMeasureBase('')).toBe('result');
  });
});

describe('deriveResultMeasures', () => {
  it('derives total / average / count measures with quoted columns + valid names', () => {
    const { measures, bindings } = deriveResultMeasures('invoice_totals', 'total');
    expect(measures.map((m) => m.name)).toEqual([
      'invoice_totals_total',
      'invoice_totals_average',
      'invoice_totals_count',
    ]);
    expect(measures[0]?.expression).toBe('SUM("total")');
    expect(measures[1]?.expression).toBe('AVG("total")');
    expect(measures[2]?.expression).toBe('COUNT(*)');
    expect(measures.every((m) => /^[a-z_][a-z0-9_]*$/.test(m.name))).toBe(true);
    expect(bindings.map((b) => b.label)).toEqual(['Total', 'Average', 'Rows']);
  });
  it('escapes embedded quotes in the value column', () => {
    const { measures } = deriveResultMeasures('r', 'we"ird');
    expect(measures[0]?.expression).toBe('SUM("we""ird")');
  });
});

describe('computeKpiValues', () => {
  it('sums / averages / counts, treating arrow limb objects as numeric', () => {
    const rows = [
      { k: 'east', total: limb(30) },
      { k: 'west', total: limb(10) },
      { k: 'north', total: limb(20) },
    ];
    expect(computeKpiValues(rows, 'total')).toEqual({ total: 60, average: 20, count: 3 });
  });
  it('averages only over non-null numeric values; count is total rows', () => {
    const rows = [{ n: 10 }, { n: null }, { n: 20 }, { n: 'N/A' }];
    const v = computeKpiValues(rows, 'n');
    expect(v.total).toBe(30);
    expect(v.average).toBe(15); // 30 / 2 numeric
    expect(v.count).toBe(4); // 4 rows
  });
  it('average is null (not NaN) when no numeric values', () => {
    expect(computeKpiValues([{ n: 'x' }], 'n').average).toBeNull();
  });
});

describe('formatMeasureValue', () => {
  it('formats by hint and renders null as an em dash', () => {
    expect(formatMeasureValue(1234.5, 'number')).toBe(
      (1234.5).toLocaleString(undefined, { maximumFractionDigits: 2 }),
    );
    expect(formatMeasureValue(42, 'count')).toBe('42');
    expect(formatMeasureValue(0.25, 'percent')).toBe('25%');
    expect(formatMeasureValue(null, 'number')).toBe('—');
    expect(formatMeasureValue(Number.NaN, 'number')).toBe('—');
  });
});

describe('buildKpiTiles + recomputeKpiTiles', () => {
  it('binds tiles to measures with formatted cached values', () => {
    const { bindings } = deriveResultMeasures('r', 'total');
    const tiles = buildKpiTiles(bindings, { total: 60, average: 20, count: 3 });
    expect(tiles).toEqual([
      { measure: 'r_total', label: 'Total', value: '60' },
      { measure: 'r_average', label: 'Average', value: '20' },
      { measure: 'r_count', label: 'Rows', value: '3' },
    ]);
  });
  it('recompute updates cached values from fresh KpiValues + a format lookup', () => {
    const { bindings } = deriveResultMeasures('r', 'total');
    const tiles = buildKpiTiles(bindings, { total: 60, average: 20, count: 3 });
    const formatOf = (m: string): MeasureFormat => (m.endsWith('_count') ? 'count' : 'number');
    const next = recomputeKpiTiles(tiles, { total: 100, average: 25, count: 4 }, formatOf);
    expect(next.map((t) => t.value)).toEqual(['100', '25', '4']);
  });
});
