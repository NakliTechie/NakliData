// Round-trip persistence tests for every cell kind. Surfaced by the
// 2026-05-31 forward-pass audit (one finding: dashboard cell crashed
// on hand-edited .naklidata missing `items` because nothing pinned
// the save/load shape). These tests serialize → JSON → parse and
// verify the cell comes back field-equal (with transient runtime
// state stripped where expected).
//
// The same JSON-on-disk path is exercised by `Cmd+S` (save) and the
// load picker; if either side drifts (field renamed, shape changed,
// new field added without a default), these tests fail loudly.

import { describe, expect, it } from 'vitest';
import {
  type NakliDataFile,
  type SerializeInput,
  parse,
  serialize,
} from '../src/core/persistence.ts';
import type {
  AssertionCellState,
  CellState,
  ChartCellState,
  CohortCellState,
  DashboardCellState,
  InputCellState,
  MapCellState,
  MarkdownCellState,
  PivotCellState,
  ReportCellState,
  SqlCellState,
  StatsCellState,
} from '../src/ui/cells/types.ts';

const baseInput: Omit<SerializeInput, 'cells'> = {
  notebookName: 'test',
  sources: [],
  assignments: {},
  autoAcceptThreshold: 0.8,
};

function roundTripCells(cells: CellState[]): CellState[] {
  const file = serialize({ ...baseInput, cells });
  const json = JSON.stringify(file);
  const parsed = parse(json) as NakliDataFile;
  return parsed.cells as CellState[];
}

describe('persistence round-trip — SQL cell (W4 baseline)', () => {
  it('survives save/load with runtime state stripped', () => {
    const cell: SqlCellState = {
      id: 'c_sql_1',
      kind: 'sql',
      order: 0,
      name: 'vendors_top',
      code: 'SELECT * FROM vendors LIMIT 10',
      status: 'success', // runtime state — should NOT round-trip
      lastError: 'previous error', // runtime state — should NOT round-trip
      lastResult: {
        columns: ['vendor'],
        rows: [{ vendor: 'Acme' }],
        rowCount: 1,
        elapsedMs: 12,
      }, // runtime — should NOT round-trip
    };
    const [out] = roundTripCells([cell]);
    expect(out).toEqual({
      id: 'c_sql_1',
      kind: 'sql',
      order: 0,
      name: 'vendors_top',
      code: 'SELECT * FROM vendors LIMIT 10',
      status: 'idle',
      lastError: null,
      lastResult: null,
    });
  });
});

describe('persistence round-trip — markdown cell', () => {
  it('survives save/load including the cell name (added in W6.4)', () => {
    const cell: MarkdownCellState = {
      id: 'c_md_1',
      kind: 'markdown',
      order: 1,
      name: 'intro', // W6.4 — referenceable from dashboards
      code: '# Intro\n\nThis is a markdown note.',
    };
    const [out] = roundTripCells([cell]);
    expect(out).toEqual(cell);
  });

  it('survives with name=null (the legacy default)', () => {
    const cell: MarkdownCellState = {
      id: 'c_md_2',
      kind: 'markdown',
      order: 0,
      name: null,
      code: '## Plain',
    };
    const [out] = roundTripCells([cell]);
    expect(out).toEqual(cell);
  });
});

describe('persistence round-trip — chart cell', () => {
  it('survives all settable fields incl. the W6.4 name + facet', () => {
    const cell: ChartCellState = {
      id: 'c_chart_1',
      kind: 'chart',
      order: 2,
      name: 'spend_chart',
      inputCell: 'c_sql_1',
      chartType: 'bar',
      x: 'vendor',
      y: 'total',
      facet: 'region',
    };
    const [out] = roundTripCells([cell]);
    expect(out).toEqual(cell);
  });
});

describe('persistence round-trip — pivot cell', () => {
  it('survives full field set', () => {
    const cell: PivotCellState = {
      id: 'c_pivot_1',
      kind: 'pivot',
      order: 3,
      name: null,
      inputCell: 'c_sql_1',
      rowCol: 'vendor',
      colCol: 'month',
      valueCol: 'total',
      agg: 'sum',
    };
    const [out] = roundTripCells([cell]);
    expect(out).toEqual(cell);
  });
});

describe('persistence round-trip — map cell', () => {
  it('survives full field set', () => {
    const cell: MapCellState = {
      id: 'c_map_1',
      kind: 'map',
      order: 4,
      name: null,
      inputCell: 'c_sql_1',
      geometryCol: 'geom',
      colorBy: 'service_name',
    };
    const [out] = roundTripCells([cell]);
    expect(out).toEqual(cell);
  });
});

describe('persistence round-trip — cohort cell (W4.4)', () => {
  it('survives full field set with runtime state stripped', () => {
    const cell: CohortCellState = {
      id: 'c_cohort_1',
      kind: 'cohort',
      order: 5,
      name: 'active_users',
      code: 'SELECT DISTINCT user_id FROM events WHERE event_name = $current_year',
      status: 'success',
      lastError: null,
      lastResult: {
        columns: ['user_id'],
        rows: [{ user_id: 'u1' }],
        rowCount: 1,
        elapsedMs: 8,
      },
    };
    const [out] = roundTripCells([cell]);
    expect(out).toEqual({
      ...cell,
      status: 'idle',
      lastError: null,
      lastResult: null,
    });
  });
});

describe('persistence round-trip — assertion cell (W5.5)', () => {
  it('survives full field set with runtime state stripped', () => {
    const cell: AssertionCellState = {
      id: 'c_assert_1',
      kind: 'assertion',
      order: 6,
      name: 'no_negative_amounts',
      code: 'SELECT * FROM invoices WHERE amount < 0',
      status: 'error',
      lastError: 'connection lost',
      lastResult: null,
    };
    const [out] = roundTripCells([cell]);
    expect(out).toEqual({
      ...cell,
      status: 'idle',
      lastError: null,
      lastResult: null,
    });
  });
});

describe('persistence round-trip — stats cell (v1.3 M4, forward-pass H9)', () => {
  it('strips the engine snapshot (descriptives/correlations/status/error)', () => {
    const cell: StatsCellState = {
      id: 'c_stats_1',
      kind: 'stats',
      order: 5,
      name: 'invoice_stats',
      inputCell: 'c_sql_1',
      descriptives: [
        {
          name: 'amount',
          type: 'numeric',
          count: 100,
          nulls: 0,
          distinct: 90,
          mean: 42.5,
          stddev: 3.1,
          median: 40,
        },
      ],
      correlations: [{ a: 'amount', b: 'qty', value: 0.8 }],
      status: 'success',
      lastError: 'stale error',
    };
    const [out] = roundTripCells([cell]);
    expect(out).toEqual({
      id: 'c_stats_1',
      kind: 'stats',
      order: 5,
      name: 'invoice_stats',
      inputCell: 'c_sql_1',
      descriptives: null,
      correlations: null,
      status: 'idle',
      lastError: null,
    });
  });
});

describe('persistence round-trip — report cell (v1.3 M3)', () => {
  it('survives the full report definition', () => {
    const cell: ReportCellState = {
      id: 'c_report_1',
      kind: 'report',
      order: 6,
      name: 'monthly',
      definition: {
        title: 'Monthly spend',
        pageSize: 'A4',
        margins: { top: 20, right: 15, bottom: 20, left: 15 },
        subtitle: 'FY26',
        items: [
          { kind: 'kpi-row', tiles: [{ measure: 'revenue', label: 'Revenue' }] },
          { kind: 'cell-ref', cellName: 'spend_chart' },
          { kind: 'page-break' },
          { kind: 'spacer', height: 24 },
        ],
      },
    };
    const [out] = roundTripCells([cell]);
    expect(out).toEqual(cell);
  });
});

describe('persistence round-trip — input cell (W6.1)', () => {
  it('survives every inputType + value combination', () => {
    const cells: InputCellState[] = [
      {
        id: 'c_input_text',
        kind: 'input',
        order: 7,
        name: 'vendor',
        label: 'Vendor name',
        inputType: 'text',
        value: 'Acme',
        options: [],
      },
      {
        id: 'c_input_num',
        kind: 'input',
        order: 8,
        name: 'min_amt',
        label: null,
        inputType: 'number',
        value: '5000',
        options: [],
      },
      {
        id: 'c_input_date',
        kind: 'input',
        order: 9,
        name: 'from',
        label: 'From date',
        inputType: 'date',
        value: '2026-05-31',
        options: [],
      },
      {
        id: 'c_input_sel',
        kind: 'input',
        order: 10,
        name: 'mode',
        label: 'Payment mode',
        inputType: 'select',
        value: 'UPI',
        options: ['UPI', 'Card', 'Cash', 'Bank'],
      },
    ];
    const out = roundTripCells(cells);
    expect(out).toEqual(cells);
  });

  it('survives empty options + empty value (the seed shape)', () => {
    const cell: InputCellState = {
      id: 'c_input_seed',
      kind: 'input',
      order: 0,
      name: 'input_1',
      label: null,
      inputType: 'text',
      value: '',
      options: [],
    };
    const [out] = roundTripCells([cell]);
    expect(out).toEqual(cell);
  });
});

describe('persistence round-trip — dashboard cell (W6.4)', () => {
  it('survives full field set', () => {
    const cell: DashboardCellState = {
      id: 'c_dash_1',
      kind: 'dashboard',
      order: 11,
      name: 'overview',
      columns: 3,
      items: ['intro', 'spend_chart', 'top_vendors_table'],
    };
    const [out] = roundTripCells([cell]);
    expect(out).toEqual(cell);
  });

  it('survives empty items list (just-created dashboard)', () => {
    const cell: DashboardCellState = {
      id: 'c_dash_2',
      kind: 'dashboard',
      order: 0,
      name: null,
      columns: 2,
      items: [],
    };
    const [out] = roundTripCells([cell]);
    expect(out).toEqual(cell);
  });
});

describe('persistence round-trip — mixed notebook', () => {
  it('preserves order across a notebook of every kind', () => {
    // One of each kind, in order, so we also verify the array order
    // isn't accidentally re-sorted somewhere.
    const cells: CellState[] = [
      { id: 'c1', kind: 'markdown', order: 0, name: 'a', code: 'x' },
      {
        id: 'c2',
        kind: 'sql',
        order: 1,
        name: 'b',
        code: 'SELECT 1',
        status: 'idle',
        lastError: null,
        lastResult: null,
      },
      {
        id: 'c3',
        kind: 'chart',
        order: 2,
        name: null,
        inputCell: 'c2',
        chartType: 'bar',
        x: null,
        y: null,
        facet: null,
      },
      {
        id: 'c4',
        kind: 'pivot',
        order: 3,
        name: null,
        inputCell: 'c2',
        rowCol: null,
        colCol: null,
        valueCol: null,
        agg: 'count',
      },
      {
        id: 'c5',
        kind: 'map',
        order: 4,
        name: null,
        inputCell: 'c2',
        geometryCol: null,
        colorBy: null,
      },
      {
        id: 'c6',
        kind: 'cohort',
        order: 5,
        name: 'cohort_1',
        code: 'SELECT 1',
        status: 'idle',
        lastError: null,
        lastResult: null,
      },
      {
        id: 'c7',
        kind: 'assertion',
        order: 6,
        name: 'assertion_1',
        code: 'SELECT 1',
        status: 'idle',
        lastError: null,
        lastResult: null,
      },
      {
        id: 'c8',
        kind: 'input',
        order: 7,
        name: 'input_1',
        label: null,
        inputType: 'text',
        value: '',
        options: [],
      },
      {
        id: 'c9',
        kind: 'dashboard',
        order: 8,
        name: null,
        columns: 2,
        items: [],
      },
    ];
    const out = roundTripCells(cells);
    expect(out.map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9']);
    expect(out.map((c) => c.kind)).toEqual([
      'markdown',
      'sql',
      'chart',
      'pivot',
      'map',
      'cohort',
      'assertion',
      'input',
      'dashboard',
    ]);
  });
});

describe('persistence — parse error paths', () => {
  it('rejects a non-naklidata file', () => {
    expect(() => parse(JSON.stringify({ format: 'something-else' }))).toThrow(/Not a \.naklidata/);
  });

  it('rejects a file with no version', () => {
    expect(() => parse(JSON.stringify({ format: 'naklidata' }))).toThrow(/Missing version/);
  });

  it('rejects a file saved by a newer NakliData', () => {
    expect(() => parse(JSON.stringify({ format: 'naklidata', version: '99.0' }))).toThrow(
      /newer version of NakliData/,
    );
  });

  it('rejects a malformed version string (forward-pass M25)', () => {
    // "1.x" → compareVersion returns NaN, NaN > 0 is false, so without
    // the regex guard this would slip past the "newer version" check.
    expect(() => parse(JSON.stringify({ format: 'naklidata', version: '1.x' }))).toThrow(
      /Invalid version/,
    );
    expect(() => parse(JSON.stringify({ format: 'naklidata', version: 'latest' }))).toThrow(
      /Invalid version/,
    );
  });
});
