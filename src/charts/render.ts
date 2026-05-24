// Chart renderer. v1.0 ships 7 hand-rolled types (bar / line / area /
// scatter / histogram / stat / table) using canvas+SVG with the Rangrez
// palette. Theme 2 (v1.1) adds Plot-rendered types (stacked-bar /
// area-stacked / heatmap) via a lazy chunk so Observable Plot stays
// out of the inlined shell.
//
// Colors for the custom types are sourced exclusively from
// src/tokens/colors.ts (Rangrez subset). No D3, no Plotly.
//
// Per spec §3.9: chart cells render a hidden <table> sibling for screen
// readers / copy-paste.

import { loadChunk } from '../core/lazy-loader.ts';
import { Brickwork, Monsoon, Neutral, categorical } from '../tokens/colors.ts';
import type { ChartCellState, SqlResult } from '../ui/cells/types.ts';

const PLOT_TYPES = new Set<ChartCellState['chartType']>(['stacked-bar', 'area-stacked', 'heatmap']);

// Threshold below which we don't split the pie into faceted small-multiples.
const FACET_MIN_PARTITIONS = 2;
const FACET_MAX_PARTITIONS = 9;

export function renderChart(mount: HTMLElement, cell: ChartCellState, result: SqlResult): void {
  mount.innerHTML = '';
  mount.style.padding = '12px';

  if (result.rows.length === 0) {
    mount.innerHTML = `<div class="cell-output-empty">No rows to chart.</div>`;
    return;
  }

  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;';
  mount.append(wrap);

  if (PLOT_TYPES.has(cell.chartType)) {
    wrap.innerHTML = '<div class="cell-output-empty">Loading chart…</div>';
    // Fire-and-forget the lazy chunk load. Plot is heavy enough that
    // pulling it into the main bundle would push us past the 600 KB
    // shell budget; we accept a brief loading flash on first use.
    void loadChunk('observable-plot').then((mod) => {
      mod.mountPlotChart({ mount: wrap, cell, result });
    });
  } else {
    switch (cell.chartType) {
      case 'table':
        renderTable(wrap, result);
        break;
      case 'stat':
        renderStat(wrap, cell, result);
        break;
      case 'bar':
        renderBarOrColumn(wrap, cell, result);
        break;
      case 'line':
      case 'area':
        renderLine(wrap, cell, result);
        break;
      case 'scatter':
        renderScatter(wrap, cell, result);
        break;
      case 'histogram':
        renderHistogram(wrap, cell, result);
        break;
      case 'pie':
        renderPie(wrap, cell, result);
        break;
    }
  }

  // Accessible table mirror (spec §3.9).
  const a11y = document.createElement('table');
  a11y.className = 'visually-hidden';
  a11y.setAttribute('aria-label', 'Chart data table');
  const trh = document.createElement('tr');
  for (const c of result.columns) {
    const th = document.createElement('th');
    th.textContent = c;
    trh.appendChild(th);
  }
  const thead = document.createElement('thead');
  thead.appendChild(trh);
  a11y.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const row of result.rows) {
    const tr = document.createElement('tr');
    for (const c of result.columns) {
      const td = document.createElement('td');
      td.textContent = String(row[c] ?? '');
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  a11y.appendChild(tbody);
  mount.append(a11y);
}

function renderTable(mount: HTMLElement, result: SqlResult): void {
  const t = document.createElement('table');
  t.className = 'result-table';
  const head = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const c of result.columns) {
    const th = document.createElement('th');
    th.textContent = c;
    hr.appendChild(th);
  }
  head.appendChild(hr);
  t.appendChild(head);
  const body = document.createElement('tbody');
  for (const row of result.rows.slice(0, 100)) {
    const tr = document.createElement('tr');
    for (const c of result.columns) {
      const td = document.createElement('td');
      const v = row[c];
      td.textContent = v === null || v === undefined ? '∅' : String(v);
      if (typeof v === 'number' || typeof v === 'bigint') td.classList.add('numeric');
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
  t.appendChild(body);
  mount.append(t);
}

function renderStat(mount: HTMLElement, cell: ChartCellState, result: SqlResult): void {
  const valueCol = pickNumericCol(cell.y, result);
  if (!valueCol) {
    mount.innerHTML = `<div class="cell-output-empty">Pick a numeric column for "y".</div>`;
    return;
  }
  let sum = 0;
  let count = 0;
  for (const row of result.rows) {
    const n = Number(row[valueCol]);
    if (Number.isFinite(n)) {
      sum += n;
      count++;
    }
  }
  const avg = count ? sum / count : 0;
  const wrap = document.createElement('div');
  wrap.style.cssText =
    'display:flex;flex-direction:column;align-items:center;gap:6px;padding:24px;font-family:var(--font);';
  wrap.innerHTML = `
    <div style="font-size:36px;font-weight:600;color:${Brickwork[0]};">${formatNumber(sum)}</div>
    <div style="font-size:12px;color:${Neutral.textMuted};">sum of ${escapeHtml(valueCol)}</div>
    <div style="font-size:11px;color:${Neutral.textMuted};">avg ${formatNumber(avg)} • n=${count.toLocaleString()}</div>
  `;
  mount.append(wrap);
}

function renderBarOrColumn(mount: HTMLElement, cell: ChartCellState, result: SqlResult): void {
  const x = pickCategoricalCol(cell.x, result);
  const y = pickNumericCol(cell.y, result);
  if (!x || !y) {
    mount.innerHTML = `<div class="cell-output-empty">Pick x (category) and y (number).</div>`;
    return;
  }
  const data: Array<{ label: string; value: number }> = [];
  for (const row of result.rows.slice(0, 200)) {
    const lbl = String(row[x] ?? '');
    const v = Number(row[y]);
    if (Number.isFinite(v)) data.push({ label: lbl, value: v });
  }
  drawHorizontalBars(mount, data, y);
}

function drawHorizontalBars(
  mount: HTMLElement,
  data: Array<{ label: string; value: number }>,
  yLabel: string,
): void {
  const width = 720;
  const rowH = 22;
  const padL = 160;
  const padR = 24;
  const height = Math.max(rowH * data.length + 20, 80);
  const maxV = data.reduce((m, d) => Math.max(m, d.value), 0);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Bar chart of ${yLabel}`);
  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    if (!d) continue;
    const w = maxV > 0 ? ((width - padL - padR) * d.value) / maxV : 0;
    const y = i * rowH + 6;
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', String(padL - 8));
    label.setAttribute('y', String(y + rowH / 2 + 4));
    label.setAttribute('text-anchor', 'end');
    label.setAttribute('font-size', '11');
    label.setAttribute('fill', Neutral.text);
    label.textContent = d.label.length > 24 ? `${d.label.slice(0, 22)}…` : d.label;
    svg.appendChild(label);

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(padL));
    rect.setAttribute('y', String(y));
    rect.setAttribute('width', String(Math.max(w, 0.5)));
    rect.setAttribute('height', String(rowH - 8));
    rect.setAttribute('fill', categorical(i));
    svg.appendChild(rect);

    const val = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    val.setAttribute('x', String(padL + w + 4));
    val.setAttribute('y', String(y + rowH / 2 + 4));
    val.setAttribute('font-size', '11');
    val.setAttribute('fill', Neutral.textMuted);
    val.textContent = formatNumber(d.value);
    svg.appendChild(val);
  }
  mount.append(svg);
}

function renderLine(mount: HTMLElement, cell: ChartCellState, result: SqlResult): void {
  const x = cell.x ?? result.columns[0];
  const y = pickNumericCol(cell.y, result);
  if (!x || !y) {
    mount.innerHTML = `<div class="cell-output-empty">Pick x and y columns.</div>`;
    return;
  }
  const series: Array<{ x: number | string; y: number }> = [];
  for (const row of result.rows) {
    const xv = row[x];
    const yv = Number(row[y]);
    if (!Number.isFinite(yv)) continue;
    series.push({ x: typeof xv === 'number' ? xv : String(xv ?? ''), y: yv });
  }
  drawLine(mount, series, cell.chartType === 'area', String(y));
}

function drawLine(
  mount: HTMLElement,
  data: Array<{ x: number | string; y: number }>,
  area: boolean,
  yLabel: string,
): void {
  const width = 720;
  const height = 280;
  const padL = 48;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const ys = data.map((d) => d.y);
  const minY = Math.min(0, ...ys);
  const maxY = Math.max(1, ...ys);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Line chart of ${yLabel}`);

  const pts = data.map((d, i) => {
    const px = padL + (data.length === 1 ? innerW / 2 : (innerW * i) / (data.length - 1));
    const py = padT + innerH - ((d.y - minY) / (maxY - minY)) * innerH;
    return [px, py] as const;
  });

  if (area) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (first && last) {
      const d = `M ${first[0]} ${padT + innerH} ${pts.map((p) => `L ${p[0]} ${p[1]}`).join(' ')} L ${last[0]} ${padT + innerH} Z`;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', Monsoon[1] as string);
      path.setAttribute('stroke', 'none');
      svg.appendChild(path);
    }
  }
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('stroke', Brickwork[0] as string);
  path.setAttribute('stroke-width', '1.5');
  path.setAttribute('fill', 'none');
  svg.appendChild(path);

  // Axes
  const axis = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  axis.setAttribute('stroke', Neutral.border);
  const axisLine = (x1: number, y1: number, x2: number, y2: number) => {
    const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    l.setAttribute('x1', String(x1));
    l.setAttribute('y1', String(y1));
    l.setAttribute('x2', String(x2));
    l.setAttribute('y2', String(y2));
    axis.appendChild(l);
  };
  axisLine(padL, padT, padL, padT + innerH);
  axisLine(padL, padT + innerH, padL + innerW, padT + innerH);
  svg.appendChild(axis);

  // Y axis labels
  for (let i = 0; i <= 4; i++) {
    const v = minY + ((maxY - minY) * i) / 4;
    const y = padT + innerH - (innerH * i) / 4;
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', String(padL - 4));
    t.setAttribute('y', String(y + 3));
    t.setAttribute('font-size', '10');
    t.setAttribute('fill', Neutral.textMuted);
    t.setAttribute('text-anchor', 'end');
    t.textContent = formatNumber(v);
    svg.appendChild(t);
  }
  mount.append(svg);
}

function renderScatter(mount: HTMLElement, cell: ChartCellState, result: SqlResult): void {
  const x = pickNumericCol(cell.x, result);
  const y = pickNumericCol(cell.y, result);
  if (!x || !y) {
    mount.innerHTML = `<div class="cell-output-empty">Pick two numeric columns.</div>`;
    return;
  }
  const points: Array<{ x: number; y: number }> = [];
  for (const row of result.rows.slice(0, 5000)) {
    const xv = Number(row[x]);
    const yv = Number(row[y]);
    if (Number.isFinite(xv) && Number.isFinite(yv)) points.push({ x: xv, y: yv });
  }
  const width = 720;
  const height = 280;
  const padL = 48;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs, minX + 1);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys, minY + 1);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', '100%');
  for (const p of points) {
    const cx = padL + ((p.x - minX) / (maxX - minX)) * innerW;
    const cy = padT + innerH - ((p.y - minY) / (maxY - minY)) * innerH;
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', String(cx));
    c.setAttribute('cy', String(cy));
    c.setAttribute('r', '2.5');
    c.setAttribute('fill', Brickwork[0] as string);
    c.setAttribute('fill-opacity', '0.55');
    svg.appendChild(c);
  }
  mount.append(svg);
}

function renderHistogram(mount: HTMLElement, cell: ChartCellState, result: SqlResult): void {
  const col = pickNumericCol(cell.y ?? cell.x, result);
  if (!col) {
    mount.innerHTML = `<div class="cell-output-empty">Pick a numeric column.</div>`;
    return;
  }
  const vals: number[] = [];
  for (const row of result.rows) {
    const n = Number(row[col]);
    if (Number.isFinite(n)) vals.push(n);
  }
  if (vals.length === 0) {
    mount.innerHTML = `<div class="cell-output-empty">No numeric values.</div>`;
    return;
  }
  const min = Math.min(...vals);
  const max = Math.max(...vals, min + 1);
  const bins = 20;
  const counts = new Array(bins).fill(0);
  for (const v of vals) {
    let idx = Math.floor(((v - min) / (max - min)) * bins);
    if (idx === bins) idx = bins - 1;
    counts[idx] += 1;
  }
  drawHorizontalBars(
    mount,
    counts.map((c, i) => ({
      label: `${formatNumber(min + ((max - min) * i) / bins)}–${formatNumber(min + ((max - min) * (i + 1)) / bins)}`,
      value: c,
    })),
    col,
  );
}

function renderPie(mount: HTMLElement, cell: ChartCellState, result: SqlResult): void {
  const cat = pickCategoricalCol(cell.x, result);
  const num = pickNumericCol(cell.y, result);
  if (!cat || !num) {
    mount.innerHTML = `<div class="cell-output-empty">Pick x (category) and y (number).</div>`;
    return;
  }

  const facetCol =
    cell.facet && result.columns.includes(cell.facet) && cell.facet !== cat && cell.facet !== num
      ? cell.facet
      : null;

  if (!facetCol) {
    const slices = aggregatePieSlices(result.rows, cat, num);
    if (slices.length === 0) {
      mount.innerHTML = `<div class="cell-output-empty">No positive values to plot.</div>`;
      return;
    }
    mount.append(buildPieSvg(slices, num, null));
    return;
  }

  const partitions = new Map<string, Array<Record<string, unknown>>>();
  for (const row of result.rows) {
    const key = String(row[facetCol] ?? '');
    let arr = partitions.get(key);
    if (!arr) {
      arr = [];
      partitions.set(key, arr);
    }
    arr.push(row);
  }
  if (partitions.size < FACET_MIN_PARTITIONS) {
    const slices = aggregatePieSlices(result.rows, cat, num);
    if (slices.length === 0) {
      mount.innerHTML = `<div class="cell-output-empty">No positive values to plot.</div>`;
      return;
    }
    mount.append(buildPieSvg(slices, num, null));
    return;
  }

  const ranked = [...partitions.entries()]
    .map(([key, rows]) => ({
      key,
      rows,
      total: rows.reduce((s, r) => s + (Number(r[num]) || 0), 0),
    }))
    .sort((a, b) => b.total - a.total);
  const top = ranked.slice(0, FACET_MAX_PARTITIONS);
  const hidden = ranked.length - top.length;

  const grid = document.createElement('div');
  grid.style.cssText =
    'display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px;';
  for (const p of top) {
    const slices = aggregatePieSlices(p.rows, cat, num);
    if (slices.length === 0) continue;
    const wrap = document.createElement('div');
    wrap.style.cssText = `border:1px solid ${Neutral.border};border-radius:4px;padding:6px;background:${Neutral.surface};`;
    wrap.append(buildPieSvg(slices, num, p.key || '(empty)'));
    grid.append(wrap);
  }
  mount.append(grid);

  if (hidden > 0) {
    const note = document.createElement('div');
    note.className = 'cell-output-empty';
    note.style.marginTop = '6px';
    note.textContent = `+${hidden} more facet${hidden === 1 ? '' : 's'} hidden (showing top ${FACET_MAX_PARTITIONS} by total).`;
    mount.append(note);
  }
}

/**
 * Aggregate rows into pie slices. Sums `num` per distinct `cat` value,
 * drops non-positive totals, sorts descending, caps at 12 slices + an
 * "Other" bucket for the tail. Exported for unit testing.
 */
export function aggregatePieSlices(
  rows: ReadonlyArray<Record<string, unknown>>,
  cat: string,
  num: string,
): Array<{ label: string; value: number }> {
  const acc = new Map<string, number>();
  for (const r of rows) {
    const label = String(r[cat] ?? '');
    const v = Number(r[num]);
    if (!Number.isFinite(v) || v <= 0) continue;
    acc.set(label, (acc.get(label) ?? 0) + v);
  }
  const entries = [...acc.entries()].sort((a, b) => b[1] - a[1]);
  const cap = 12;
  if (entries.length > cap) {
    const head = entries.slice(0, cap - 1).map(([label, value]) => ({ label, value }));
    const tail = entries.slice(cap - 1).reduce((s, [, v]) => s + v, 0);
    return [...head, { label: 'Other', value: tail }];
  }
  return entries.map(([label, value]) => ({ label, value }));
}

function buildPieSvg(
  slices: Array<{ label: string; value: number }>,
  numLabel: string,
  title: string | null,
): SVGElement {
  const width = 360;
  const height = 240;
  const cx = 110;
  const cy = title ? height / 2 + 8 : height / 2;
  const r = 86;
  const total = slices.reduce((s, sl) => s + sl.value, 0);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Pie chart of ${numLabel}${title ? ` for ${title}` : ''}`);

  if (title) {
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', String(width / 2));
    t.setAttribute('y', '14');
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('font-size', '12');
    t.setAttribute('fill', Neutral.text);
    t.textContent = title.length > 36 ? `${title.slice(0, 34)}…` : title;
    svg.appendChild(t);
  }

  if (slices.length === 1) {
    // Degenerate single-slice: render a full disc so we don't draw a 0° arc.
    const single = slices[0];
    if (single) {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', String(cx));
      circle.setAttribute('cy', String(cy));
      circle.setAttribute('r', String(r));
      circle.setAttribute('fill', categorical(0));
      circle.setAttribute('stroke', Neutral.surface);
      circle.setAttribute('stroke-width', '1');
      svg.appendChild(circle);
    }
  } else {
    let angle = -Math.PI / 2;
    for (let i = 0; i < slices.length; i++) {
      const slice = slices[i];
      if (!slice) continue;
      const frac = slice.value / total;
      const next = angle + frac * 2 * Math.PI;
      const x1 = cx + Math.cos(angle) * r;
      const y1 = cy + Math.sin(angle) * r;
      const x2 = cx + Math.cos(next) * r;
      const y2 = cy + Math.sin(next) * r;
      const large = frac > 0.5 ? 1 : 0;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`);
      path.setAttribute('fill', categorical(i));
      path.setAttribute('stroke', Neutral.surface);
      path.setAttribute('stroke-width', '1');
      svg.appendChild(path);
      angle = next;
    }
  }

  const legendX = 218;
  const legendStart = title ? 34 : 20;
  const itemH = 16;
  const legendCap = 9;
  const shown = slices.slice(0, legendCap);
  const overflow = slices.length - shown.length;
  for (let i = 0; i < shown.length; i++) {
    const item = shown[i];
    if (!item) continue;
    const pct = (item.value / total) * 100;
    const y = legendStart + i * itemH;
    const swatch = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    swatch.setAttribute('x', String(legendX));
    swatch.setAttribute('y', String(y - 9));
    swatch.setAttribute('width', '10');
    swatch.setAttribute('height', '10');
    swatch.setAttribute('fill', categorical(i));
    svg.appendChild(swatch);
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', String(legendX + 14));
    text.setAttribute('y', String(y));
    text.setAttribute('font-size', '11');
    text.setAttribute('fill', Neutral.text);
    const labelTrim = item.label.length > 14 ? `${item.label.slice(0, 13)}…` : item.label;
    text.textContent = `${labelTrim} ${pct.toFixed(1)}%`;
    svg.appendChild(text);
  }
  if (overflow > 0) {
    const more = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    more.setAttribute('x', String(legendX));
    more.setAttribute('y', String(legendStart + shown.length * itemH));
    more.setAttribute('font-size', '10');
    more.setAttribute('fill', Neutral.textMuted);
    more.textContent = `+${overflow} more`;
    svg.appendChild(more);
  }
  return svg;
}

function pickNumericCol(hint: string | null | undefined, result: SqlResult): string | null {
  if (hint && result.columns.includes(hint)) return hint;
  for (const c of result.columns) {
    for (const row of result.rows.slice(0, 10)) {
      const v = row[c];
      if (typeof v === 'number' || typeof v === 'bigint') return c;
      if (typeof v === 'string' && Number.isFinite(Number(v))) return c;
    }
  }
  return null;
}

function pickCategoricalCol(hint: string | null | undefined, result: SqlResult): string | null {
  if (hint && result.columns.includes(hint)) return hint;
  for (const c of result.columns) {
    const sample = result.rows[0]?.[c];
    if (typeof sample === 'string') return c;
  }
  return result.columns[0] ?? null;
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toFixed(2);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
