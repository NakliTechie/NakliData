// v1.3 M5 — Shelf-based chart authoring (VizQL reinterpreted).
//
// Tableau's interaction model, compiled to NakliData's existing
// substrate. The shelf state COMPILES TO the canonical
// `src/core/chart-config.ts` ChartConfig — one schema, three
// producers (manual config / sidecar proposal / shelves).
//
// **Engine-boundary contract (v1.3 M0):** no DOM, no FSA, no browser
// globals. Pure data + the compile function + tests.
//
// **Transparency Rule (handoff v1.3 §end):** the chart cell renders
// the SAME `ChartConfig` regardless of producer. Shelves are a
// projection of the cell model, never a second source of truth. The
// "view config / view SQL" affordance on the chart cell shows what
// the shelves produced; editing the config directly switches to
// manual mode losslessly because both modes write to the SAME
// underlying state.

import type { ChartConfig, ChartType } from './chart-config.ts';

/**
 * Field semantic class derived from taxonomy assignments. Drives the
 * default-chart-type matrix (handoff §M5):
 *   - temporal on x → line
 *   - categorical on x → bar
 *   - measure on y → auto-aggregated per measure definition
 *   - identifier on y → REJECTED with an inline explanation
 *     (teach, don't silently fail)
 */
export type FieldClass =
  | 'temporal'
  | 'categorical'
  | 'numeric'
  | 'measure'
  | 'identifier'
  | 'unknown';

export interface ShelfField {
  /** Column name in the result, OR a measure name if `class` is 'measure'. */
  name: string;
  /** Semantic class — drives shelf-default behaviour. */
  class: FieldClass;
}

/**
 * A shelf state — what the user has dragged onto each shelf. Each
 * shelf holds at most one field today (size deferred per handoff).
 */
export interface ShelfState {
  x: ShelfField | null;
  y: ShelfField | null;
  /** Color/series shelf — splits the chart into multiple series. */
  color: ShelfField | null;
}

export function emptyShelfState(): ShelfState {
  return { x: null, y: null, color: null };
}

/**
 * Column names that read as identifiers regardless of value type — kept
 * off the y axis so the shelf compile warns instead of plotting an id.
 */
const IDENTIFIER_NAME_RE = /(^|_)(id|ids|uuid|guid|gstin|pan|isbn|sku|email|key|hash)$/i;

function isDateLike(s: string): boolean {
  // ISO date or datetime prefix — `2026-01-02` or `2026-01-02T09:00`.
  return /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}|$)/.test(s);
}

/**
 * Heuristically classify a result column into a `FieldClass` from its
 * materialised values + name. The shelf UI uses this to seed shelf
 * defaults + drive the "teach, don't fail" warnings.
 *
 * This reads the ACTUAL result data, NOT the source-table taxonomy: a
 * SQL result often holds transformed/aggregated columns absent from any
 * mounted table (`COUNT(*) AS n`, `date_trunc(...) AS month`), which a
 * by-name taxonomy lookup would stub as unknown. The data is the right
 * signal for charting a result. Pure: no DOM, no globals (v1.3 M0).
 *
 * Never returns `'measure'` — measures are a separate layer (M2) with
 * their own panel; a raw result column is numeric, not a measure.
 */
export function inferFieldClass(
  column: string,
  rows: ReadonlyArray<Record<string, unknown>>,
  sampleSize = 50,
): FieldClass {
  const sample: unknown[] = [];
  for (const r of rows) {
    const v = r[column];
    if (v !== null && v !== undefined) {
      sample.push(v);
      if (sample.length >= sampleSize) break;
    }
  }
  if (sample.length === 0) return 'unknown';
  // Name-based identifier wins even over a numeric type (an integer id
  // is still an id, and must not land on the y axis).
  if (IDENTIFIER_NAME_RE.test(column)) return 'identifier';
  if (sample.every((v) => typeof v === 'number' || typeof v === 'bigint')) return 'numeric';
  if (sample.every((v) => typeof v === 'boolean')) return 'categorical';
  if (sample.every((v) => typeof v === 'string' && isDateLike(v))) return 'temporal';
  return 'categorical';
}

/**
 * Reasons a shelf-to-config compilation might emit a warning the UI
 * surfaces inline. These are "teach, don't silently fail" signals —
 * the compile still returns a valid `ChartConfig`, but the warning
 * tells the user why it isn't what they might have expected.
 */
export interface ShelfWarning {
  shelf: 'x' | 'y' | 'color';
  field: string;
  reason: string;
}

export interface ShelfCompileResult {
  config: ChartConfig;
  warnings: ReadonlyArray<ShelfWarning>;
}

/**
 * Compile a shelf state into a `ChartConfig`. The result is the SAME
 * schema the manual config + sidecar proposal produce. The chart cell
 * renders from this config; the shelf UI is a projection that writes
 * back to the same cell state.
 *
 * **Taxonomy default matrix (handoff §M5 gate artifact):**
 *
 *   x shelf   | y shelf      | chartType  | notes
 *   ----------|--------------|------------|-----------------
 *   temporal  | numeric/meas | line       | time series
 *   categorical | numeric/meas | bar       | bar chart
 *   numeric   | numeric/meas | scatter    | scatterplot
 *   categorical | (nothing)  | bar        | counts on y (the chart
 *                                          renderer interprets null y
 *                                          as COUNT(*))
 *   (nothing) | numeric/meas | histogram  | distribution
 *   (nothing) | (nothing)    | table      | default fallback
 *   identifier on y → warning + fallback to numeric/count + warning
 */
export function compileShelvesToConfig(state: ShelfState, title = 'Chart'): ShelfCompileResult {
  const warnings: ShelfWarning[] = [];
  const x = state.x;
  let y = state.y;

  // Reject identifier on y — teach, don't silently fail.
  if (y && y.class === 'identifier') {
    warnings.push({
      shelf: 'y',
      field: y.name,
      reason: `Identifier fields like "${y.name}" don't aggregate cleanly on the y axis. Try a measure (COUNT DISTINCT) or pick a numeric column.`,
    });
    y = null;
  }

  const chartType = pickChartType(x, y);

  const config: ChartConfig = {
    chartType,
    xColumn: x?.name ?? null,
    yColumn: y?.name ?? null,
    groupColumn: state.color?.name ?? null,
    title,
  };

  // color on a numeric / measure column → warn (it'll bucket weirdly).
  if (state.color && (state.color.class === 'numeric' || state.color.class === 'measure')) {
    warnings.push({
      shelf: 'color',
      field: state.color.name,
      reason: `Numeric or measure fields don't split cleanly into series. Pick a categorical column for color.`,
    });
  }

  return { config, warnings };
}

function pickChartType(x: ShelfField | null, y: ShelfField | null): ChartType {
  // Both empty → table fallback.
  if (!x && !y) return 'table';

  // y only → histogram (distribution of one numeric column).
  if (!x && y) {
    return y.class === 'numeric' || y.class === 'measure' ? 'histogram' : 'table';
  }

  // x only → bar (treat the implicit y as a COUNT(*)).
  if (x && !y) {
    if (x.class === 'temporal') return 'line';
    return 'bar';
  }

  // Both populated.
  if (x && y) {
    if (x.class === 'temporal') return 'line';
    if (x.class === 'numeric' && (y.class === 'numeric' || y.class === 'measure')) return 'scatter';
    return 'bar';
  }

  return 'bar';
}

/**
 * Reverse compile — given a `ChartConfig`, infer the shelf state +
 * field classes (best-effort; the original taxonomy info is lost in
 * the config, so the reverse uses a heuristic).
 *
 * Used by the chart cell's "switch to shelf mode" toggle to seed
 * shelves from an existing manual config. The round-trip
 * `shelves → config → shelves` is lossless when field classes are
 * provided; without them, the inferred class defaults to 'unknown'
 * (the UI rendering still works; only the warnings differ).
 */
export function configToShelves(
  config: ChartConfig,
  classOf?: (name: string) => FieldClass,
): ShelfState {
  const cls = (name: string | null): FieldClass => {
    if (name === null) return 'unknown';
    return classOf?.(name) ?? 'unknown';
  };
  return {
    x: config.xColumn ? { name: config.xColumn, class: cls(config.xColumn) } : null,
    y: config.yColumn ? { name: config.yColumn, class: cls(config.yColumn) } : null,
    color: config.groupColumn ? { name: config.groupColumn, class: cls(config.groupColumn) } : null,
  };
}

/**
 * The Transparency-Rule invariant (handoff §end + §M5): for any
 * `ChartConfig`, going through `configToShelves` and then
 * `compileShelvesToConfig` produces an EQUIVALENT config (same
 * xColumn, yColumn, groupColumn). The chartType may differ when the
 * config was produced by sidecar/manual and the shelves recompute
 * from defaults — that's expected (the shelf logic doesn't preserve
 * the original chartType decision).
 *
 * `roundtripPreservesColumns` is the test predicate used by the
 * round-trip tests.
 */
export function roundtripPreservesColumns(config: ChartConfig): boolean {
  const shelves = configToShelves(config);
  const { config: rebuilt } = compileShelvesToConfig(shelves, config.title);
  return (
    rebuilt.xColumn === config.xColumn &&
    rebuilt.yColumn === config.yColumn &&
    rebuilt.groupColumn === config.groupColumn
  );
}
