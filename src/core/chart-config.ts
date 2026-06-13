// v1.3 M0 — Chart-config schema (extracted from sidecar/types.ts).
//
// **Single source of truth** for chart configuration across THREE
// producers (handoff v1.3 §M5 Transparency Rule + "one schema, three
// producers"):
//
//   1. Manual config (chart cell's existing field-by-field controls).
//   2. Sidecar proposal (Job 7 — propose-chart; v1.2 M4).
//   3. Shelves (v1.3 M5 — drag fields onto x/y/color shelves).
//
// All three produce the SAME `ChartConfig`. The chart cell renders
// from a `ChartConfig` regardless of which producer authored it.
//
// **Boundary rules (v1.3 M0 lint boundary):** this module has NO DOM
// imports, NO browser globals, NO FSA. It's pure data + validators.

/**
 * The eight chart types every producer supports. Aligned with the
 * chart cell's own renderer + the M4 sidecar proposal allowlist.
 *
 * Excluded by design: stacked-bar, area-stacked, heatmap, funnel,
 * path. Those need extra knobs (the second grouping column, the
 * bucket count, the threshold) that aren't expressible in this
 * minimal schema. Producers needing those types fall back to the
 * chart cell's existing manual-config path.
 */
export type ChartType =
  | 'bar'
  | 'line'
  | 'area'
  | 'scatter'
  | 'pie'
  | 'histogram'
  | 'stat'
  | 'table';

export interface ChartConfig {
  /** Required: one of the 8 supported types. */
  chartType: ChartType;
  /** Column name from the result. null if the chart type doesn't
   *  use an X axis (e.g., histogram, stat). */
  xColumn: string | null;
  /** Column name from the result. null if the chart type doesn't
   *  use a Y axis. */
  yColumn: string | null;
  /** Optional column whose values split the chart into series. The
   *  chart cell maps this to its `facet` field (small-multiples). */
  groupColumn: string | null;
  /** Display title — short string for the cell header. */
  title: string;
}

// Note: `isChartConfig`, `validateAgainstColumns`, and `defaultChartConfig`
// validators were removed as dead code (forward-pass S1) — they were
// exported but never wired to any producer. This module's job is the
// shared ChartConfig type ("one schema, three producers"); re-add a
// validator here if a load-path / sidecar-parser check is ever wired.
