// Cell state types used by the notebook UI.

export type CellKind = 'sql' | 'chart' | 'markdown';

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
    | 'stacked-bar'
    | 'area-stacked'
    | 'heatmap';
  x: string | null;
  y: string | null;
}

export type CellState = SqlCellState | MarkdownCellState | ChartCellState;

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
