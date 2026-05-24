// Cell state types used by the notebook UI.

export type CellKind = 'sql' | 'chart' | 'markdown' | 'pivot' | 'map';

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
    | 'heatmap';
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

export type CellState =
  | SqlCellState
  | MarkdownCellState
  | ChartCellState
  | PivotCellState
  | MapCellState;

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
