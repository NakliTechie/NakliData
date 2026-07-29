import { describe, expect, it } from 'vitest';
import {
  CHART_A11Y_ROW_LIMIT,
  chartAccessibleSubset,
  horizontalBarLayout,
  ownsAsyncChartMount,
} from '../src/charts/render.ts';
import type { SqlResult } from '../src/ui/cells/types.ts';

function result(rows: SqlResult['rows']): SqlResult {
  return { columns: ['id'], rows, rowCount: rows.length, elapsedMs: 1 };
}

describe('chart accessibility mirror', () => {
  it('uses a bounded sample spanning the full result and announces truncation', () => {
    const rows = Array.from({ length: 250 }, (_, id) => ({ id }));
    const accessible = chartAccessibleSubset(result(rows));

    expect(accessible.rows).toHaveLength(CHART_A11Y_ROW_LIMIT);
    expect(accessible.rows[0]?.id).toBe(0);
    expect(accessible.rows.at(-1)?.id).toBe(249);
    expect(accessible.announcement).toBe(
      'Chart data table: representative sample of 100 of 250 rows.',
    );
  });

  it('keeps every row when the result is already within the mirror limit', () => {
    const rows = [{ id: 1 }, { id: 2 }];
    const accessible = chartAccessibleSubset(result(rows));

    expect(accessible.rows).toBe(rows);
    expect(accessible.announcement).toBe('Chart data table: all 2 rows.');
  });
});

describe('horizontal bar geometry', () => {
  it('places negative bars left and positive bars right of a shared zero baseline', () => {
    const layout = horizontalBarLayout([-5, 10, 0]);
    const negative = layout.bars[0];
    const positive = layout.bars[1];

    expect(negative).toBeDefined();
    expect(positive).toBeDefined();
    expect(negative?.x).toBeLessThan(layout.zeroX);
    expect((negative?.x ?? 0) + (negative?.width ?? 0)).toBeCloseTo(layout.zeroX);
    expect(negative?.labelAnchor).toBe('end');
    expect(positive?.x).toBeCloseTo(layout.zeroX);
    expect(positive?.labelAnchor).toBe('start');
  });

  it('puts the zero baseline at the right edge for all-negative data', () => {
    const layout = horizontalBarLayout([-12, -3], 720, 160, 64);

    expect(layout.zeroX).toBeCloseTo(656);
    for (const bar of layout.bars) {
      expect(bar.x).toBeLessThan(layout.zeroX);
      expect(bar.x + bar.width).toBeCloseTo(layout.zeroX);
    }
  });
});

describe('async chart ownership', () => {
  it('only permits an async renderer to attach to its still-connected cell mount', () => {
    const cell = { dataset: { cellId: 'cell-a' } };
    const mount = {
      isConnected: true,
      closest: () => cell,
    } as unknown as HTMLElement;
    const wrap = { parentElement: mount } as unknown as HTMLElement;

    expect(ownsAsyncChartMount(mount, wrap, 'cell-a')).toBe(true);
    expect(ownsAsyncChartMount(mount, wrap, 'cell-b')).toBe(false);
    Object.assign(mount, { isConnected: false });
    expect(ownsAsyncChartMount(mount, wrap, 'cell-a')).toBe(false);
  });
});
