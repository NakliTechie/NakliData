// A2 (Tier-2 reporting) — auto-generate named measures for a report's KPI row
// and compute their (cached) tile values. Pure: no DOM, no engine.
//
// "Create report from result" (A1) already picks a numeric measure column. A2
// turns that into a KPI row: three named measures — total / average / count —
// registered in the measures-store (so they show in the Measures panel and are
// reusable, DECISION), plus their computed values cached onto the report tiles
// so the report displays correctly on reload/print without an async re-query
// (matches the result-snapshot posture, DC). The Refresh-data path recomputes
// the cached values from the re-run result.

import { coerceNumeric } from './chart-columns.ts';
import type { MeasureDefinition, MeasureFormat } from './measures.ts';

/** Double-quote a SQL identifier, escaping embedded quotes. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Sanitize an arbitrary cell/result name into a snake_case measure-name base
 * (`[a-z_][a-z0-9_]*`, ≤ 48 chars to leave room for the `_average` suffix).
 * Falls back to `result` when nothing usable survives.
 */
export function sanitizeMeasureBase(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^([0-9])/, '_$1')
    .slice(0, 48)
    .replace(/_+$/g, '');
  return base || 'result';
}

export interface DerivedMeasures {
  /** The measures to upsert into the store, in tile order. */
  measures: MeasureDefinition[];
  /** Tile bindings (measure name + human label + format) for the kpi-row. */
  bindings: Array<{ measure: string; label: string; format: MeasureFormat }>;
}

/**
 * Derive the total / average / count measures for a result's numeric measure
 * column. `baseName` is the (already sanitized) measure-name stem; `valueColumn`
 * is the raw result column the total/average aggregate over.
 */
export function deriveResultMeasures(baseName: string, valueColumn: string): DerivedMeasures {
  const col = quoteIdent(valueColumn);
  const measures: MeasureDefinition[] = [
    {
      name: `${baseName}_total`,
      expression: `SUM(${col})`,
      format: 'number',
      description: `Total of ${valueColumn}.`,
      version: 1,
    },
    {
      name: `${baseName}_average`,
      expression: `AVG(${col})`,
      format: 'number',
      description: `Average of ${valueColumn}.`,
      version: 1,
    },
    {
      name: `${baseName}_count`,
      expression: 'COUNT(*)',
      format: 'count',
      description: 'Number of rows in the result.',
      version: 1,
    },
  ];
  const bindings = [
    { measure: `${baseName}_total`, label: 'Total', format: 'number' as MeasureFormat },
    { measure: `${baseName}_average`, label: 'Average', format: 'number' as MeasureFormat },
    { measure: `${baseName}_count`, label: 'Rows', format: 'count' as MeasureFormat },
  ];
  return { measures, bindings };
}

export interface KpiValues {
  total: number;
  /** null when no numeric values (avoid a 0/0 NaN). */
  average: number | null;
  count: number;
}

/**
 * Compute total / average / count over a result's rows in pure JS, reusing the
 * A1 limb-aware `coerceNumeric` so HUGEINT/Int128 aggregate cells sum correctly.
 * `count` is the number of rows (categories); `average` is over non-null
 * numeric values only.
 */
export function computeKpiValues(
  rows: ReadonlyArray<Record<string, unknown>>,
  valueColumn: string,
): KpiValues {
  let total = 0;
  let numericCount = 0;
  for (const r of rows) {
    const n = coerceNumeric(r[valueColumn]);
    if (n === null) continue;
    total += n;
    numericCount++;
  }
  return {
    total,
    average: numericCount > 0 ? total / numericCount : null,
    count: rows.length,
  };
}

/** Format a measure value for a KPI tile per its format hint. */
export function formatMeasureValue(n: number | null, format: MeasureFormat): string {
  if (n === null || !Number.isFinite(n)) return '—';
  switch (format) {
    case 'count':
      return Math.round(n).toLocaleString();
    case 'percent':
      return `${(n * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
    case 'currency_inr':
      return `₹${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    case 'currency_usd':
      return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    case 'currency_eur':
      return `€${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    default:
      return Number.isInteger(n)
        ? n.toLocaleString()
        : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
}

export interface KpiTile {
  measure: string;
  label: string;
  /** Cached display value (formatted); recomputed on Refresh. */
  value: string;
}

/** Pick the raw value a tile's label maps to (Total / Average / Rows→count). */
function valueForLabel(label: string, values: KpiValues): number | null {
  if (label === 'Total') return values.total;
  if (label === 'Average') return values.average;
  return values.count;
}

/**
 * Build the kpi-row tiles: bind each derived measure to its computed + formatted
 * value. Kept to ≤ 4 tiles (report-layout cap).
 */
export function buildKpiTiles(bindings: DerivedMeasures['bindings'], values: KpiValues): KpiTile[] {
  return bindings.slice(0, 4).map((b) => ({
    measure: b.measure,
    label: b.label,
    value: formatMeasureValue(valueForLabel(b.label, values), b.format),
  }));
}

/**
 * Recompute the cached `value` on an existing kpi-row's tiles from fresh
 * KpiValues (the Refresh-data path). `formatOf` resolves each tile's measure to
 * its format (looked up in the measures-store); defaults to 'number'.
 */
export function recomputeKpiTiles(
  tiles: ReadonlyArray<{ measure: string; label: string; value?: string }>,
  values: KpiValues,
  formatOf: (measure: string) => MeasureFormat,
): KpiTile[] {
  return tiles.map((t) => ({
    measure: t.measure,
    label: t.label,
    value: formatMeasureValue(valueForLabel(t.label, values), formatOf(t.measure)),
  }));
}
