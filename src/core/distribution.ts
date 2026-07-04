// Distribution view — pure column-summary logic for the Facet Distribution
// cell. A column is auto-classified numeric vs categorical; numeric columns
// become an equal-width histogram, categorical columns become value-count bars
// (top-N + an "other" bucket). Engine-boundary clean: no DOM — the cell renders
// the result as SVG bars and drives click-to-select.

/** ≥ this share of non-null values must parse as finite numbers → numeric. */
const NUMERIC_THRESHOLD = 0.8;

/** True when the column is best shown as a numeric histogram. */
export function isNumericColumn(values: readonly unknown[]): boolean {
  let nonNull = 0;
  let numeric = 0;
  for (const v of values) {
    if (v == null || v === '') continue;
    nonNull++;
    if (typeof v === 'bigint') {
      numeric++;
    } else {
      const n = typeof v === 'number' ? v : Number(v);
      if (typeof v !== 'boolean' && Number.isFinite(n)) numeric++;
    }
  }
  return nonNull > 0 && numeric / nonNull >= NUMERIC_THRESHOLD;
}

export interface NumericBin {
  lo: number;
  hi: number;
  count: number;
}
export interface NumericSummary {
  kind: 'numeric';
  bins: NumericBin[];
  min: number;
  max: number;
  total: number;
  skipped: number;
}

/** Bucket numeric values into `binCount` equal-width bins over [min, max]. */
export function numericHistogram(values: readonly unknown[], binCount = 30): NumericSummary {
  const nums: number[] = [];
  let skipped = 0;
  for (const v of values) {
    if (v == null || v === '' || typeof v === 'boolean') {
      skipped++;
      continue;
    }
    const n = typeof v === 'bigint' ? Number(v) : typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n)) nums.push(n);
    else skipped++;
  }
  if (nums.length === 0) return { kind: 'numeric', bins: [], min: 0, max: 0, total: 0, skipped };
  let min = nums[0] as number;
  let max = nums[0] as number;
  for (const n of nums) {
    if (n < min) min = n;
    if (n > max) max = n;
  }
  const n = Math.max(1, Math.floor(binCount));
  const span = max - min;
  if (span <= 0) {
    return {
      kind: 'numeric',
      bins: [{ lo: min, hi: min, count: nums.length }],
      min,
      max,
      total: nums.length,
      skipped,
    };
  }
  const width = span / n;
  const bins: NumericBin[] = Array.from({ length: n }, (_, i) => ({
    lo: min + i * width,
    hi: i === n - 1 ? max : min + (i + 1) * width,
    count: 0,
  }));
  for (const val of nums) {
    const idx = val >= max ? n - 1 : Math.min(n - 1, Math.floor((val - min) / width));
    (bins[idx] as NumericBin).count++;
  }
  return { kind: 'numeric', bins, min, max, total: nums.length, skipped };
}

export interface CategoryItem {
  value: string;
  count: number;
}
export interface CategorySummary {
  kind: 'categorical';
  items: CategoryItem[];
  /** Distinct values beyond topN, folded into a single "other" count. */
  otherCount: number;
  /** Distinct value count (before top-N capping). */
  distinct: number;
  total: number;
  nullCount: number;
}

/** Count distinct values, sorted by frequency desc, capped at `topN` (+ other). */
export function categoryCounts(values: readonly unknown[], topN = 20): CategorySummary {
  const counts = new Map<string, number>();
  let nullCount = 0;
  let total = 0;
  for (const v of values) {
    if (v == null || v === '') {
      nullCount++;
      continue;
    }
    total++;
    const key = String(v);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const cap = Math.max(1, Math.floor(topN));
  const top = sorted.slice(0, cap);
  const otherCount = sorted.slice(cap).reduce((s, [, c]) => s + c, 0);
  return {
    kind: 'categorical',
    items: top.map(([value, count]) => ({ value, count })),
    otherCount,
    distinct: counts.size,
    total,
    nullCount,
  };
}

export type ColumnSummary = NumericSummary | CategorySummary;

/** Auto-classify then summarize: numeric → histogram, else category counts. */
export function summarizeColumn(
  values: readonly unknown[],
  opts: { binCount?: number; topN?: number } = {},
): ColumnSummary {
  return isNumericColumn(values)
    ? numericHistogram(values, opts.binCount ?? 30)
    : categoryCounts(values, opts.topN ?? 20);
}
