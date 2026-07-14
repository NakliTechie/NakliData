// A4 — scoped report-refresh: reportRefreshOrder returns only the runnable
// cells a report depends on (its @name-upstream closure), in topo order, so
// refreshing one report doesn't re-run unrelated cells.
import { describe, expect, it } from 'vitest';
import type { ReportDefinition, ReportItem } from '../src/core/report-layout.ts';
import type {
  CellState,
  ChartCellState,
  MarkdownCellState,
  ReportCellState,
  SqlCellState,
} from '../src/ui/cells/types.ts';
import { reportRefreshOrder } from '../src/ui/notebook-graph.ts';

function sql(id: string, name: string | null, code: string, order = 0): SqlCellState {
  return { id, kind: 'sql', order, name, code, status: 'idle', lastError: null, lastResult: null };
}
function md(id: string, name: string, order = 0): MarkdownCellState {
  return { id, kind: 'markdown', order, name, code: `# ${name}` };
}
function chart(id: string, name: string, inputCell: string, order = 0): ChartCellState {
  return {
    id,
    kind: 'chart',
    order,
    name,
    inputCell,
    chartType: 'bar',
    x: null,
    y: null,
    facet: null,
  };
}
function report(id: string, items: ReportItem[]): ReportCellState {
  const definition: ReportDefinition = {
    title: 'R',
    pageSize: 'A4',
    margins: { top: 20, right: 20, bottom: 20, left: 20 },
    items,
  };
  return { id, kind: 'report', order: 99, name: null, definition };
}

describe('reportRefreshOrder', () => {
  it('returns the referenced cell + its @-upstream, in topo order, excluding unrelated cells', () => {
    const cells: CellState[] = [
      sql('c_up', 'base', 'SELECT * FROM t', 0),
      sql('c_mid', 'agg', 'SELECT k, SUM(n) FROM @base GROUP BY k', 1),
      sql('c_other', 'unrelated', 'SELECT * FROM other', 2),
      report('c_rep', [{ kind: 'cell-ref', cellName: 'agg' }]),
    ];
    // agg depends on base; unrelated is excluded; base runs before agg.
    expect(reportRefreshOrder(cells[3] as ReportCellState, cells)).toEqual(['c_up', 'c_mid']);
  });

  it('follows a kpi-row sourceCell as a seed', () => {
    const cells: CellState[] = [
      sql('c_src', 'totals', 'SELECT k, SUM(n) FROM t GROUP BY k'),
      sql('c_x', 'unrelated', 'SELECT 1'),
      report('c_rep', [
        {
          kind: 'kpi-row',
          tiles: [{ measure: 'totals_total', label: 'Total' }],
          sourceCell: 'totals',
          valueColumn: 'n',
        },
      ]),
    ];
    expect(reportRefreshOrder(cells[2] as ReportCellState, cells)).toEqual(['c_src']);
  });

  it('resolves a referenced chart cell to its inputCell (the data source)', () => {
    const cells: CellState[] = [
      sql('c_data', 'q', 'SELECT k, SUM(n) FROM t GROUP BY k'),
      chart('c_chart', 'q_chart', 'c_data'),
      report('c_rep', [{ kind: 'cell-ref', cellName: 'q_chart' }]),
    ];
    expect(reportRefreshOrder(cells[2] as ReportCellState, cells)).toEqual(['c_data']);
  });

  it('returns [] for a report of only markdown sections (a template scaffold)', () => {
    const cells: CellState[] = [
      md('c_s', 'sec_summary'),
      report('c_rep', [{ kind: 'cell-ref', cellName: 'sec_summary' }]),
    ];
    expect(reportRefreshOrder(cells[1] as ReportCellState, cells)).toEqual([]);
  });

  it('de-dups a diamond dependency (two refs sharing an upstream)', () => {
    const cells: CellState[] = [
      sql('c_base', 'base', 'SELECT * FROM t', 0),
      sql('c_a', 'a', 'SELECT * FROM @base WHERE x', 1),
      sql('c_b', 'b', 'SELECT * FROM @base WHERE y', 2),
      report('c_rep', [
        { kind: 'cell-ref', cellName: 'a' },
        { kind: 'cell-ref', cellName: 'b' },
      ]),
    ];
    const order = reportRefreshOrder(cells[3] as ReportCellState, cells);
    expect(order).toEqual(['c_base', 'c_a', 'c_b']);
    expect(order.filter((id) => id === 'c_base')).toHaveLength(1); // upstream once
  });
});
