// Lazy chunk for Observable Plot. Loaded only when a chart cell picks
// one of the Plot-rendered chart types (stacked-bar, area-stacked,
// heatmap) — keeps Plot out of the inlined shell.
//
// The main bundle's renderChart() in src/charts/render.ts dispatches
// here via loadChunk('observable-plot') for those chart types.

import * as Plot from '@observablehq/plot';
import { Neutral } from '../tokens/colors.ts';
import type { ChartCellState, SqlResult } from '../ui/cells/types.ts';

export interface PlotRenderOpts {
  mount: HTMLElement;
  cell: ChartCellState;
  result: SqlResult;
}

export function mountPlotChart({ mount, cell, result }: PlotRenderOpts): void {
  mount.innerHTML = '';
  if (result.rows.length === 0) {
    mount.innerHTML = '<div class="cell-output-empty">No rows to chart.</div>';
    return;
  }
  const x = cell.x ?? result.columns[0];
  const y = cell.y ?? result.columns[1] ?? result.columns[0];
  if (!x || !y) {
    mount.innerHTML = '<div class="cell-output-empty">Pick x and y columns.</div>';
    return;
  }

  // Plot operates on plain JS objects. Our SqlResult.rows already is
  // Array<Record<string, unknown>>; coerce numeric strings on the y
  // channel so DuckDB BIGINT-as-string doesn't break stack math.
  const data = result.rows.map((r) => ({
    ...r,
    [y]: coerceNumeric(r[y]),
  }));

  let svg: SVGElement | HTMLElement;
  try {
    switch (cell.chartType) {
      case 'stacked-bar':
        svg = Plot.plot({
          marginLeft: 80,
          color: { scheme: 'tableau10', legend: true },
          marks: [
            Plot.barX(data, {
              x: y,
              y: x,
              fill: pickCategory(data, [x, y]) ?? x,
              sort: { y: '-x' },
            }),
            Plot.ruleX([0], { stroke: Neutral.border }),
          ],
        });
        break;
      case 'area-stacked':
        svg = Plot.plot({
          marginLeft: 60,
          color: { scheme: 'tableau10', legend: true },
          marks: [
            Plot.areaY(data, {
              x,
              y,
              fill: pickCategory(data, [x, y]) ?? x,
              curve: 'monotone-x',
            }),
            Plot.ruleY([0], { stroke: Neutral.border }),
          ],
        });
        break;
      case 'heatmap': {
        // Heatmap needs three channels: x, y, value. We auto-pick value
        // as the first numeric column that's neither x nor y, falling
        // back to count.
        const valueCol = result.columns.find(
          (c) => c !== x && c !== y && data.some((r) => typeof r[c] === 'number'),
        );
        svg = Plot.plot({
          marginLeft: 80,
          color: { scheme: 'OrRd', legend: true, label: valueCol ?? 'count' },
          marks: [
            valueCol
              ? Plot.cell(data, { x, y, fill: valueCol })
              : Plot.cell(data, Plot.group({ fill: 'count' }, { x, y })),
          ],
        });
        break;
      }
      default:
        mount.innerHTML = `<div class="cell-output-empty">Chart type "${cell.chartType}" is not handled by the Plot chunk.</div>`;
        return;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    mount.innerHTML = `<div class="cell-output-empty">Couldn't render: ${escapeHtml(msg)}</div>`;
    return;
  }
  mount.append(svg);
}

function coerceNumeric(v: unknown): unknown {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string' && v !== '' && !Number.isNaN(Number(v))) return Number(v);
  return v;
}

/**
 * Pick a categorical column for the fill channel — first column that
 * isn't already mapped to x or y and has more than 1 distinct value
 * but isn't a degenerate id (cardinality ≈ row count).
 */
function pickCategory(rows: Array<Record<string, unknown>>, exclude: string[]): string | null {
  if (rows.length === 0) return null;
  const cols = Object.keys(rows[0] ?? {});
  for (const c of cols) {
    if (exclude.includes(c)) continue;
    const vals = new Set(rows.map((r) => String(r[c] ?? '')));
    if (vals.size <= 1) continue;
    if (vals.size > rows.length * 0.8) continue; // looks like an id
    return c;
  }
  return null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
