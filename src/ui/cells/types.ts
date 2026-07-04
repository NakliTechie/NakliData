// Cell state types used by the notebook UI.
//
// (There is no standalone `CellKind` union — it was unused and drifted
// out of date; each cell kind is the literal `kind` field on its state
// interface, and `CellState['kind']` is the authoritative union.)

export interface SqlCellState {
  id: string;
  kind: 'sql';
  order: number;
  name: string | null;
  code: string;
  status: 'idle' | 'running' | 'success' | 'error';
  lastError: string | null;
  lastResult: SqlResult | null;
  pinned: boolean;
}

export interface MarkdownCellState {
  id: string;
  kind: 'markdown';
  order: number;
  name: string | null;
  code: string;
}

export interface ChartCellState {
  id: string;
  kind: 'chart';
  order: number;
  name: string | null;
  inputCell: string | null;
  chartType:
    | 'bar'
    | 'line'
    | 'area'
    | 'scatter'
    | 'table'
    | 'stat'
    | 'histogram'
    | 'pie'
    | 'stacked-bar'
    | 'area-stacked'
    | 'heatmap'
    | 'funnel'
    | 'path';
  x: string | null;
  y: string | null;
  /** Optional column whose values drive small-multiples faceting. */
  facet: string | null;
}

export interface PivotCellState {
  id: string;
  kind: 'pivot';
  order: number;
  name: string | null;
  /** Upstream SQL cell id whose lastResult is pivoted. */
  inputCell: string | null;
  /** Column whose values become row labels (down the left). */
  rowCol: string | null;
  /** Column whose values become column labels (across the top). */
  colCol: string | null;
  /** Numeric column to aggregate. Optional for `count`. */
  valueCol: string | null;
  agg: 'sum' | 'avg' | 'min' | 'max' | 'count';
}

export interface MapCellState {
  id: string;
  kind: 'map';
  order: number;
  name: string | null;
  /** Upstream SQL cell id whose lastResult provides the rows. */
  inputCell: string | null;
  /** Column containing GeoJSON geometries (object or string). */
  geometryCol: string | null;
  /** Optional categorical property to drive feature colors. */
  colorBy: string | null;
}

/**
 * Embedding / semantic-map cell (Facet track). Renders an upstream SQL cell's
 * precomputed (x, y) coordinate columns as a deck.gl scatter on an abstract
 * plane — the "x, y (precomputed) → embedding map" view type. No geography, no
 * force layout; the coordinates are already 2-D (e.g. a UMAP/t-SNE projection of
 * an embedding column materialised into the result).
 */
export interface EmbeddingCellState {
  id: string;
  kind: 'embedding';
  order: number;
  name: string | null;
  /** Upstream SQL cell id whose lastResult provides the rows. */
  inputCell: string | null;
  /** Numeric column for the x coordinate. */
  xCol: string | null;
  /** Numeric column for the y coordinate. */
  yCol: string | null;
  /** Optional categorical column driving point color. */
  colorBy: string | null;
  /** Optional column shown on hover. */
  labelCol: string | null;
  /**
   * Optional embedding-vector column (FLOAT[dim]). Enables click-to-find-
   * similar (in-memory cosine over the result's vectors) and — when x/y are
   * unset — an automatic PCA 2-D projection, so no offline precompute is
   * needed. Older files lack the key; read with `?? null`.
   */
  embCol: string | null;
}

/**
 * Network / force-graph cell (Facet track). Renders an upstream SQL cell whose
 * rows are EDGES (a source-id column + a target-id column) as a force-directed
 * graph: nodes are the distinct ids, laid out by a GPU force sim
 * (`@antv/layout-gpu` — WebGL GPGPU, no COOP/COEP; DECISIONS BS) and drawn with
 * deck.gl (LineLayer edges + ScatterplotLayer nodes sized by degree). The
 * computed layout is derived data — recomputed on render, cached in-memory by
 * input signature — so it is NOT persisted (like stats descriptives). Only the
 * config below round-trips in `.naklidata`.
 */
export interface NetworkCellState {
  id: string;
  kind: 'network';
  order: number;
  name: string | null;
  /** Upstream SQL cell id whose rows are edges. */
  inputCell: string | null;
  /** Edge source node-id column. */
  sourceCol: string | null;
  /** Edge target node-id column. */
  targetCol: string | null;
}

/**
 * Cohort cell — Wave 4 W4.4. Structurally a SQL cell whose result is
 * a single `user_id` column. Downstream cells reference the cohort
 * via `@<cohort_name>` using the same machinery that resolves any
 * `@cellName` SQL ref. The separate kind exists only to:
 *   - render distinct UI chrome (header label, count badge),
 *   - hint the user that the cell defines a reusable user filter.
 * Runs the same DuckDB query path as a regular SQL cell.
 */
export interface CohortCellState {
  id: string;
  kind: 'cohort';
  order: number;
  /** Cohort name — required to be reference-able via @<name>. */
  name: string | null;
  /** SQL predicate returning a `user_id` column. */
  code: string;
  status: 'idle' | 'running' | 'success' | 'error';
  lastError: string | null;
  lastResult: SqlResult | null;
}

/**
 * Assertion cell — Wave 5 W5.5. A SQL query that should return zero
 * rows under healthy data conditions; any returned row is a counter-
 * example to the assertion (the cell goes red). Reuses the SQL
 * execution path entirely; differs from `SqlCellState` only in:
 *   - render chrome ("ASSERTION" label, pass/fail status badge,
 *     count of counter-examples instead of result-table),
 *   - intent — assertions document invariants ("no negative amounts",
 *     "every invoice has a vendor_id", "no duplicate user_ids").
 * dbt's `tests:` block is the closest analog.
 */
export interface AssertionCellState {
  id: string;
  kind: 'assertion';
  order: number;
  name: string | null;
  /** SQL that should return 0 rows when the invariant holds. */
  code: string;
  status: 'idle' | 'running' | 'success' | 'error';
  lastError: string | null;
  lastResult: SqlResult | null;
}

/**
 * Stats cell — v1.3 M4. Bound to an upstream cell's result; renders
 * descriptive statistics (count / nulls / min / max / mean / median /
 * stddev / distinct) per column, plus a Pearson correlation matrix
 * over numeric columns. All computation in DuckDB SQL.
 *
 * Spotfire / SAS's instinct, browser-sized. No regression / modelling
 * in v1.3 (handoff §M4 hard NOT).
 */
export interface StatsCellState {
  id: string;
  kind: 'stats';
  order: number;
  name: string | null;
  /** Upstream cell id (resolves to `cell_<id>` view). */
  inputCell: string | null;
  /** Last computed descriptives (snapshot from the engine; refreshed
   *  on Run or when the input cell's result changes). */
  descriptives: Array<{
    name: string;
    type: 'numeric' | 'identifier' | 'other';
    count: number | null;
    nulls: number | null;
    distinct: number | null;
    min?: unknown;
    max?: unknown;
    mean?: number | null;
    stddev?: number | null;
    median?: number | null;
  }> | null;
  /** Pearson correlation matrix in {a, b, value} entries (upper
   *  triangle; the renderer mirrors). */
  correlations: Array<{ a: string; b: string; value: number | null }> | null;
  status: 'idle' | 'running' | 'success' | 'error';
  lastError: string | null;
}

/**
 * Input cell — Wave 6 W6.1. An interactive parameter widget
 * (text / number / date / select) whose current `value` is
 * substituted into downstream SQL via `@<name>` reference resolution.
 *
 * Observable's `viewof` + Briefer's interactive-input pattern. A
 * downstream SQL cell like:
 *   SELECT * FROM events WHERE event_name = @event
 * becomes (when event input has value 'purchase'):
 *   SELECT * FROM events WHERE event_name = 'purchase'
 *
 * Unlike SQL/cohort/assertion cells, input cells don't materialise
 * a DuckDB view — there's nothing to query, just a literal to
 * inline. Reference resolution lives in notebook.ts.
 */
export interface InputCellState {
  id: string;
  kind: 'input';
  order: number;
  /** Required: the @reference name. Without it, the cell is unreachable. */
  name: string | null;
  /** Display label shown next to the widget. Defaults to `name`. */
  label: string | null;
  /** Widget kind. Drives both render + SQL-literal coercion. */
  inputType: 'text' | 'number' | 'date' | 'select';
  /** Current value. Always serialised as string; coerced at substitution. */
  value: string;
  /** For inputType='select': allowed options. */
  options: string[];
}

/**
 * Dashboard cell — Wave 6 W6.4. Arranges other cells (markdown,
 * chart, pivot, map) in a CSS grid. Closes the "linear notebook can't
 * show a real dashboard" gap that Superset / Power BI fill.
 *
 * `items` is a list of cell names (@refs). Each name resolves to a
 * cell in the notebook; the dashboard re-renders that cell's output
 * inside its grid slot WITHOUT the editing chrome (no name input,
 * no delete/run buttons — those still live on the original cell in
 * the notebook).
 *
 * Only markdown / chart / pivot / map cells are valid items. SQL,
 * cohort, assertion, and input cells are queries / parameters, not
 * presentation surfaces. A reference to an unsupported kind renders
 * a small "not supported" note in the slot.
 */
export interface DashboardCellState {
  id: string;
  kind: 'dashboard';
  order: number;
  name: string | null;
  /** Grid columns. UI clamps to 1–4. */
  columns: number;
  /** Ordered list of @names; each resolves to a cell in the notebook. */
  items: string[];
}

/**
 * Report cell — v1.3 M3. Embeds a `ReportDefinition` (from
 * `src/core/report-layout.ts`) and offers a print-to-PDF button.
 * On Print, the browser's print dialog opens with the report
 * window's @page CSS controlling page size + margins.
 *
 * Per handoff §M3: print CSS + browser print-to-PDF preferred over
 * pdf-lib. Cell-refs embed existing notebook cells by name; data is
 * always re-queried at render (report is a description, never a
 * data copy).
 */
export interface ReportCellState {
  id: string;
  kind: 'report';
  order: number;
  name: string | null;
  /** Serialised ReportDefinition (validated at render). */
  definition: import('../../core/report-layout.ts').ReportDefinition;
}

export type CellState =
  | SqlCellState
  | MarkdownCellState
  | ChartCellState
  | PivotCellState
  | MapCellState
  | EmbeddingCellState
  | NetworkCellState
  | CohortCellState
  | AssertionCellState
  | InputCellState
  | DashboardCellState
  | StatsCellState
  | ReportCellState;

export interface SqlResult {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  elapsedMs: number;
}

export type CellPatch = Record<string, unknown>;

export interface CellHandlers {
  onRun: (id: string, payload?: { code?: string }) => void;
  onChange: (id: string, patch: CellPatch) => void;
  onDelete: (id: string) => void;
}
