// Temporal view — pure bucketing logic for the Facet Temporal cell. Coerces a
// result column's values to epoch-ms and buckets them into a fixed number of
// equal-width time bins (a histogram over time). Engine-boundary clean: no DOM,
// no globals — the cell renders the bins as an SVG timeline + brush.

/**
 * Coerce a query-result value into epoch milliseconds, or null if it isn't a
 * time. Handles the shapes DuckDB-wasm surfaces for DATE / TIMESTAMP columns:
 *   * Date object → getTime()
 *   * number → assumed epoch-ms (already what toJSON gives for many paths)
 *   * bigint → DuckDB timestamps are microseconds since epoch → /1000
 *   * ISO / parseable string → Date.parse
 * Non-finite results become null. Absolute unit only affects axis labels; the
 * histogram + brush are relative, so a slightly-off unit still reads correctly.
 */
export function coerceTime(value: unknown): number | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === 'bigint') {
    // DuckDB TIMESTAMP is microseconds since epoch.
    const ms = Number(value) / 1000;
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

export interface TimeBin {
  /** Bin start (epoch ms, inclusive). */
  t0: number;
  /** Bin end (epoch ms, exclusive — except the last bin, inclusive). */
  t1: number;
  count: number;
}

export interface TimeHistogram {
  bins: TimeBin[];
  /** Min / max coerced time across all rows (epoch ms). */
  min: number;
  max: number;
  /** Rows with a usable time value. */
  total: number;
  /** Rows whose value could not be coerced to a time. */
  skipped: number;
}

/**
 * Bucket coerced times into `binCount` equal-width bins spanning [min, max].
 * A degenerate span (all times equal, or <2 usable rows) collapses to a single
 * bin. Values are coerced with {@link coerceTime}; uncoercible rows are counted
 * in `skipped`, not placed.
 */
export function bucketTime(values: readonly unknown[], binCount = 30): TimeHistogram {
  const times: number[] = [];
  let skipped = 0;
  for (const v of values) {
    const t = coerceTime(v);
    if (t === null) skipped++;
    else times.push(t);
  }
  if (times.length === 0) {
    return { bins: [], min: 0, max: 0, total: 0, skipped };
  }
  let min = times[0] as number;
  let max = times[0] as number;
  for (const t of times) {
    if (t < min) min = t;
    if (t > max) max = t;
  }
  const n = Math.max(1, Math.floor(binCount));
  const span = max - min;
  if (span <= 0) {
    return {
      bins: [{ t0: min, t1: min, count: times.length }],
      min,
      max,
      total: times.length,
      skipped,
    };
  }
  const width = span / n;
  const bins: TimeBin[] = Array.from({ length: n }, (_, i) => ({
    t0: min + i * width,
    t1: i === n - 1 ? max : min + (i + 1) * width,
    count: 0,
  }));
  for (const t of times) {
    // Clamp the max into the last bin (its t1 is inclusive).
    const idx = t >= max ? n - 1 : Math.min(n - 1, Math.floor((t - min) / width));
    (bins[idx] as TimeBin).count++;
  }
  return { bins, min, max, total: times.length, skipped };
}

/** Count values (coerced) that fall within [start, end] inclusive. */
export function countInWindow(values: readonly unknown[], start: number, end: number): number {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  let count = 0;
  for (const v of values) {
    const t = coerceTime(v);
    if (t !== null && t >= lo && t <= hi) count++;
  }
  return count;
}
