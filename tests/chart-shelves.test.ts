// v1.3 M5 — Shelf-based chart authoring tests.
//
// Gate artifacts per handoff §M5:
//   - "Shelf-built chart byte-identical in config to a hand-configured
//     equivalent" — round-trip identity test below.
//   - "Taxonomy default matrix demonstrated across temporal /
//     categorical / measure / identifier fields" — matrix tests below.
//   - "Identifier-typed fields rejected from y with an inline
//     explanation" — warning-emission tests.

import { describe, expect, it } from 'vitest';
import type { ChartConfig } from '../src/core/chart-config.ts';
import {
  type ShelfField,
  type ShelfState,
  compileShelvesToConfig,
  configToShelves,
  emptyShelfState,
  inferFieldClass,
  roundtripPreservesColumns,
} from '../src/core/chart-shelves.ts';

function f(name: string, cls: ShelfField['class']): ShelfField {
  return { name, class: cls };
}

function st(
  x: ShelfField | null,
  y: ShelfField | null,
  color: ShelfField | null = null,
): ShelfState {
  return { x, y, color };
}

describe('emptyShelfState + compile fallback', () => {
  it('empty shelves → table chartType', () => {
    const { config } = compileShelvesToConfig(emptyShelfState());
    expect(config.chartType).toBe('table');
    expect(config.xColumn).toBeNull();
    expect(config.yColumn).toBeNull();
  });
});

describe('Taxonomy default matrix (handoff §M5 gate artifact)', () => {
  it('temporal x + numeric y → line', () => {
    const { config } = compileShelvesToConfig(
      st(f('iso_date', 'temporal'), f('amount', 'numeric')),
    );
    expect(config.chartType).toBe('line');
  });

  it('temporal x + measure y → line (measure aggregates implicitly)', () => {
    const { config } = compileShelvesToConfig(
      st(f('iso_date', 'temporal'), f('revenue', 'measure')),
    );
    expect(config.chartType).toBe('line');
  });

  it('categorical x + numeric y → bar', () => {
    const { config } = compileShelvesToConfig(
      st(f('vendor_name', 'categorical'), f('amount', 'numeric')),
    );
    expect(config.chartType).toBe('bar');
  });

  it('categorical x + measure y → bar', () => {
    const { config } = compileShelvesToConfig(
      st(f('vendor_name', 'categorical'), f('revenue', 'measure')),
    );
    expect(config.chartType).toBe('bar');
  });

  it('numeric x + numeric y → scatter', () => {
    const { config } = compileShelvesToConfig(st(f('amount', 'numeric'), f('tax', 'numeric')));
    expect(config.chartType).toBe('scatter');
  });

  it('categorical x + (empty y) → bar (implicit COUNT)', () => {
    const { config } = compileShelvesToConfig(st(f('vendor_name', 'categorical'), null));
    expect(config.chartType).toBe('bar');
  });

  it('temporal x + (empty y) → line', () => {
    const { config } = compileShelvesToConfig(st(f('iso_date', 'temporal'), null));
    expect(config.chartType).toBe('line');
  });

  it('(empty x) + numeric y → histogram', () => {
    const { config } = compileShelvesToConfig(st(null, f('amount', 'numeric')));
    expect(config.chartType).toBe('histogram');
  });

  it('(empty x) + measure y → histogram', () => {
    const { config } = compileShelvesToConfig(st(null, f('revenue', 'measure')));
    expect(config.chartType).toBe('histogram');
  });

  it('(empty x) + categorical y → table fallback', () => {
    const { config } = compileShelvesToConfig(st(null, f('vendor_name', 'categorical')));
    expect(config.chartType).toBe('table');
  });
});

describe("Identifier-on-y warning (handoff §M5 — teach, don't silently fail)", () => {
  it('identifier on y emits a warning + falls back', () => {
    const { config, warnings } = compileShelvesToConfig(
      st(f('vendor_name', 'categorical'), f('gstin', 'identifier')),
    );
    expect(config.yColumn).toBeNull(); // identifier was rejected
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.shelf).toBe('y');
    expect(warnings[0]?.field).toBe('gstin');
    expect(warnings[0]?.reason).toMatch(/identifier/i);
  });

  it("numeric on color emits a warning (numerics don't split into clean series)", () => {
    const { warnings } = compileShelvesToConfig(
      st(f('vendor_name', 'categorical'), f('amount', 'numeric'), f('tax', 'numeric')),
    );
    expect(warnings.some((w) => w.shelf === 'color' && w.field === 'tax')).toBe(true);
  });

  it('categorical on color is silent (the happy path)', () => {
    const { warnings } = compileShelvesToConfig(
      st(f('iso_date', 'temporal'), f('amount', 'numeric'), f('vendor_name', 'categorical')),
    );
    expect(warnings).toEqual([]);
  });
});

describe('configToShelves + Transparency-Rule round trip', () => {
  it('configToShelves recovers the field names from a manual config', () => {
    const config: ChartConfig = {
      chartType: 'bar',
      xColumn: 'vendor_name',
      yColumn: 'amount',
      groupColumn: 'region',
      title: 'Test',
    };
    const shelves = configToShelves(config);
    expect(shelves.x?.name).toBe('vendor_name');
    expect(shelves.y?.name).toBe('amount');
    expect(shelves.color?.name).toBe('region');
  });

  it('round-trip preserves columns (handoff §M5 + §end Transparency Rule)', () => {
    const configs: ChartConfig[] = [
      { chartType: 'bar', xColumn: 'vendor', yColumn: 'amount', groupColumn: null, title: 'A' },
      {
        chartType: 'line',
        xColumn: 'iso_date',
        yColumn: 'amount',
        groupColumn: 'region',
        title: 'B',
      },
      { chartType: 'scatter', xColumn: 'tax', yColumn: 'amount', groupColumn: null, title: 'C' },
      { chartType: 'pie', xColumn: 'vendor', yColumn: 'amount', groupColumn: null, title: 'D' },
      { chartType: 'histogram', xColumn: null, yColumn: 'amount', groupColumn: null, title: 'E' },
      { chartType: 'table', xColumn: null, yColumn: null, groupColumn: null, title: 'F' },
    ];
    for (const config of configs) {
      expect(roundtripPreservesColumns(config)).toBe(true);
    }
  });

  it('field class inference defaults to unknown when classOf not provided', () => {
    const config: ChartConfig = {
      chartType: 'bar',
      xColumn: 'x',
      yColumn: 'y',
      groupColumn: null,
      title: 'T',
    };
    const shelves = configToShelves(config);
    expect(shelves.x?.class).toBe('unknown');
    expect(shelves.y?.class).toBe('unknown');
  });

  it('classOf is consulted when provided', () => {
    const config: ChartConfig = {
      chartType: 'line',
      xColumn: 'iso_date',
      yColumn: 'amount',
      groupColumn: null,
      title: 'T',
    };
    const classOf = (name: string) => {
      if (name === 'iso_date') return 'temporal' as const;
      if (name === 'amount') return 'numeric' as const;
      return 'unknown' as const;
    };
    const shelves = configToShelves(config, classOf);
    expect(shelves.x?.class).toBe('temporal');
    expect(shelves.y?.class).toBe('numeric');
  });
});

describe('Byte-identical config from shelves and manual mode (gate artifact)', () => {
  it('manual { bar, vendor, amount } === shelves { categorical vendor, numeric amount }', () => {
    const manual: ChartConfig = {
      chartType: 'bar',
      xColumn: 'vendor',
      yColumn: 'amount',
      groupColumn: null,
      title: 'Sales by vendor',
    };
    const { config: fromShelves } = compileShelvesToConfig(
      st(f('vendor', 'categorical'), f('amount', 'numeric')),
      'Sales by vendor',
    );
    expect(fromShelves).toEqual(manual);
  });

  it('manual { line, iso_date, amount } === shelves { temporal iso_date, numeric amount }', () => {
    const manual: ChartConfig = {
      chartType: 'line',
      xColumn: 'iso_date',
      yColumn: 'amount',
      groupColumn: null,
      title: 'Trend',
    };
    const { config: fromShelves } = compileShelvesToConfig(
      st(f('iso_date', 'temporal'), f('amount', 'numeric')),
      'Trend',
    );
    expect(fromShelves).toEqual(manual);
  });
});

describe('inferFieldClass (Phase 2 shelf field classifier)', () => {
  const rows = [
    { amount: 100, status: 'paid', day: '2026-01-02', vendor_id: 7, flag: true, note: null },
    { amount: 250, status: 'open', day: '2026-01-03', vendor_id: 8, flag: false, note: null },
  ];

  it('numeric column → numeric', () => {
    expect(inferFieldClass('amount', rows)).toBe('numeric');
  });

  it('categorical string column → categorical', () => {
    expect(inferFieldClass('status', rows)).toBe('categorical');
  });

  it('ISO date string column → temporal', () => {
    expect(inferFieldClass('day', rows)).toBe('temporal');
  });

  it('id-named column → identifier even when numeric (kept off y)', () => {
    expect(inferFieldClass('vendor_id', rows)).toBe('identifier');
  });

  it('boolean column → categorical', () => {
    expect(inferFieldClass('flag', rows)).toBe('categorical');
  });

  it('all-null / absent column → unknown', () => {
    expect(inferFieldClass('note', rows)).toBe('unknown');
    expect(inferFieldClass('missing', rows)).toBe('unknown');
  });

  it('mixed-type column falls back to categorical', () => {
    expect(inferFieldClass('m', [{ m: 1 }, { m: 'two' }])).toBe('categorical');
  });

  it('feeds compileShelvesToConfig: id on y warns + drops, then COUNT bar', () => {
    const x = { name: 'status', class: inferFieldClass('status', rows) };
    const y = { name: 'vendor_id', class: inferFieldClass('vendor_id', rows) };
    const { config, warnings } = compileShelvesToConfig({ x, y, color: null });
    expect(warnings.some((w) => w.shelf === 'y' && w.field === 'vendor_id')).toBe(true);
    expect(config.yColumn).toBeNull();
    expect(config.chartType).toBe('bar'); // categorical x, no y → bar (COUNT)
  });
});
