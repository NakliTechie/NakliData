// Cell state types used by the notebook UI.

export type CellKind =
  | 'sql'
  | 'chart'
  | 'markdown'
  | 'pivot'
  | 'map'
  | 'cohort'
  | 'assertion'
  | 'input'
  | 'dashboard';

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

export type CellState =
  | SqlCellState
  | MarkdownCellState
  | ChartCellState
  | PivotCellState
  | MapCellState
  | CohortCellState
  | AssertionCellState
  | InputCellState
  | DashboardCellState;

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
