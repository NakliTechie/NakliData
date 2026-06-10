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

const VALID_CHART_TYPES: ReadonlySet<ChartType> = new Set([
  'bar',
  'line',
  'area',
  'scatter',
  'pie',
  'histogram',
  'stat',
  'table',
]);

/**
 * Type guard for `ChartConfig` — used by producers that accept
 * unknown JSON (e.g., the sidecar response parser, the .naklidata
 * load path). Returns false on missing fields or invalid chart type
 * or non-string title > 80 chars.
 *
 * Does NOT validate that the column names exist in any particular
 * result — that check belongs to the call site (which knows the
 * result's columns).
 */
export function isChartConfig(value: unknown): value is ChartConfig {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.chartType !== 'string') return false;
  if (!VALID_CHART_TYPES.has(v.chartType as ChartType)) return false;
  if (v.xColumn !== null && typeof v.xColumn !== 'string') return false;
  if (v.yColumn !== null && typeof v.yColumn !== 'string') return false;
  if (v.groupColumn !== null && typeof v.groupColumn !== 'string') return false;
  if (typeof v.title !== 'string') return false;
  if (v.title.length === 0 || v.title.length > 80) return false;
  return true;
}

/**
 * Validate a `ChartConfig` against an actual column allowlist. Returns
 * a list of error messages (empty when valid). The sidecar parser +
 * the chart cell's manual editor both call this to confirm a config
 * is actionable against the current result.
 */
export function validateAgainstColumns(cfg: ChartConfig, columns: ReadonlyArray<string>): string[] {
  const errors: string[] = [];
  const colSet = new Set(columns);
  if (cfg.xColumn !== null && !colSet.has(cfg.xColumn)) {
    errors.push(`xColumn "${cfg.xColumn}" is not in the result columns.`);
  }
  if (cfg.yColumn !== null && !colSet.has(cfg.yColumn)) {
    errors.push(`yColumn "${cfg.yColumn}" is not in the result columns.`);
  }
  if (cfg.groupColumn !== null && !colSet.has(cfg.groupColumn)) {
    errors.push(`groupColumn "${cfg.groupColumn}" is not in the result columns.`);
  }
  return errors;
}

/**
 * Empty/default config — used by the chart cell when no producer has
 * authored a config yet. The user picks chart type + columns manually.
 */
export function defaultChartConfig(): ChartConfig {
  return {
    chartType: 'bar',
    xColumn: null,
    yColumn: null,
    groupColumn: null,
    title: 'Chart',
  };
}
