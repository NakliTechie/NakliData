// Lazy chunk — the SVG renderers for the two chart-style Facet cells (Temporal
// timeline + Distribution bars). These are pure DOM/SVG (no heavy dep), but
// they're bundled here rather than in the always-loaded shell to keep the
// single-file core within budget (spec §7.1): a notebook that never opens a
// temporal / distribution cell never pays for them. The cell chrome (pickers)
// stays in the main bundle; only the render bodies load on first use. Bucketing
// + summary logic lives in core/{temporal,distribution}.ts (pure, tested); this
// file is DOM only.

import { type ColumnSummary, summarizeColumn } from '../core/distribution.ts';
import type { FacetSelection } from '../core/facet-crossfilter.ts';
import { type TimeHistogram, bucketTime, countInWindow } from '../core/temporal.ts';

/**
 * Crossfilter wiring passed to the Facet renderers. `selection` restores a
 * persisted brush/bar on (re-)render; `onSelect` fires when the user commits a
 * new selection (or `null` to clear) so the cell can persist + propagate it.
 */
export interface FacetSelectOptions {
  selection?: FacetSelection | null;
  onSelect?: (selection: FacetSelection | null) => void;
}

const TIMELINE_H = 130;
const DIST_H = 150;
const BIN_COUNT = 40;

// ── Temporal timeline ──────────────────────────────────────────────────────

/** Render a brushable time histogram into `mount`. */
export function renderTimeline(
  mount: HTMLElement,
  readout: HTMLElement | null,
  timeCol: string,
  rows: Array<Record<string, unknown>>,
  opts: FacetSelectOptions = {},
): void {
  const values = rows.map((r) => r[timeCol]);
  const hist = bucketTime(values, BIN_COUNT);
  if (hist.total === 0) {
    mount.innerHTML = `<div class="cell-output-empty">No usable dates in "${escapeHtml(timeCol)}" (${hist.skipped.toLocaleString()} rows had no parseable time).</div>`;
    if (readout) readout.textContent = '';
    return;
  }

  const width = mount.clientWidth || 600;
  const maxCount = Math.max(...hist.bins.map((b) => b.count), 1);
  const padX = 2;
  const plotW = Math.max(1, width - padX * 2);
  const barW = plotW / hist.bins.length;

  const bars = hist.bins
    .map((b, i) => {
      const h = (b.count / maxCount) * (TIMELINE_H - 20);
      const x = padX + i * barW;
      const y = TIMELINE_H - 16 - h;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(0.5, barW - 0.5).toFixed(1)}" height="${h.toFixed(1)}" fill="var(--accent)" opacity="0.85"><title>${new Date(b.t0).toISOString().slice(0, 10)} — ${b.count}</title></rect>`;
    })
    .join('');

  mount.innerHTML = `
    <svg data-region="temporal-svg" width="100%" height="${TIMELINE_H}" viewBox="0 0 ${width} ${TIMELINE_H}" preserveAspectRatio="none" style="display:block;cursor:crosshair;user-select:none;">
      <rect x="0" y="0" width="${width}" height="${TIMELINE_H}" fill="var(--surface-alt)" />
      ${bars}
      <line x1="0" y1="${TIMELINE_H - 16}" x2="${width}" y2="${TIMELINE_H - 16}" stroke="var(--border)" stroke-width="1" />
      <rect data-region="temporal-brush" x="0" y="0" width="0" height="${TIMELINE_H - 16}" fill="var(--accent)" opacity="0.18" style="pointer-events:none;" />
      <text x="4" y="${TIMELINE_H - 4}" font-size="10" fill="var(--text-muted)">${fmtDate(hist.min)}</text>
      <text x="${width - 4}" y="${TIMELINE_H - 4}" font-size="10" fill="var(--text-muted)" text-anchor="end">${fmtDate(hist.max)}</text>
    </svg>`;

  wireBrush(mount, readout, hist, values, padX, plotW, timeCol, opts);
}

function wireBrush(
  mount: HTMLElement,
  readout: HTMLElement | null,
  hist: TimeHistogram,
  values: readonly unknown[],
  padX: number,
  plotW: number,
  timeCol: string,
  opts: FacetSelectOptions,
): void {
  const svg = mount.querySelector<SVGSVGElement>('[data-region="temporal-svg"]');
  const brush = mount.querySelector<SVGRectElement>('[data-region="temporal-brush"]');
  if (!svg || !brush) return;

  const xToTime = (clientX: number): number => {
    const rect = svg.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left - padX) / plotW));
    return hist.min + frac * (hist.max - hist.min);
  };
  const timeToViewX = (t: number): number => {
    const frac = hist.max > hist.min ? (t - hist.min) / (hist.max - hist.min) : 0;
    return padX + frac * plotW;
  };

  let anchorT: number | null = null;

  const setBrush = (t0: number, t1: number) => {
    const x0 = timeToViewX(Math.min(t0, t1));
    const x1 = timeToViewX(Math.max(t0, t1));
    brush.setAttribute('x', String(x0));
    brush.setAttribute('width', String(Math.max(0, x1 - x0)));
  };

  // Paint the readout for a window. `emit` distinguishes a user commit (persist +
  // propagate downstream) from a silent restore of a persisted brush on render
  // (paint only — emitting there would loop through the re-render that follows).
  const paint = (t0: number, t1: number, emit: boolean) => {
    const lo = Math.min(t0, t1);
    const hi = Math.max(t0, t1);
    const count = countInWindow(values, lo, hi);
    if (readout) {
      readout.dataset.windowStart = String(lo);
      readout.dataset.windowEnd = String(hi);
      readout.dataset.windowCount = String(count);
      readout.textContent = `${fmtDate(lo)} → ${fmtDate(hi)} · ${count.toLocaleString()} of ${hist.total.toLocaleString()} rows — click to clear`;
    }
    if (emit) opts.onSelect?.({ kind: 'timeRange', col: timeCol, lo, hi });
  };

  const clear = (emit: boolean) => {
    brush.setAttribute('width', '0');
    if (readout) {
      for (const k of ['windowStart', 'windowEnd', 'windowCount']) delete readout.dataset[k];
      readout.textContent = '';
    }
    if (emit) opts.onSelect?.(null);
  };

  svg.addEventListener('pointerdown', (ev) => {
    anchorT = xToTime(ev.clientX);
    svg.setPointerCapture(ev.pointerId);
    setBrush(anchorT, anchorT);
  });
  svg.addEventListener('pointermove', (ev) => {
    if (anchorT === null) return;
    setBrush(anchorT, xToTime(ev.clientX));
  });
  svg.addEventListener('pointerup', (ev) => {
    if (anchorT === null) return;
    const t = xToTime(ev.clientX);
    if (Math.abs(timeToViewX(t) - timeToViewX(anchorT)) < 3) {
      clear(true);
    } else {
      setBrush(anchorT, t);
      paint(anchorT, t, true);
    }
    anchorT = null;
  });

  // Restore a persisted window on (re-)render — draw it, don't re-emit.
  const restore = opts.selection;
  if (restore && restore.kind === 'timeRange') {
    setBrush(restore.lo, restore.hi);
    paint(restore.lo, restore.hi, false);
  }

  // Automation seam — the smoke brushes a window programmatically (CDP pointer
  // coords across the SVG viewBox are fiddly).
  (mount as HTMLElement & { __temporalBrush?: unknown }).__temporalBrush = {
    brushTimeWindow(t0: number, t1: number) {
      setBrush(t0, t1);
      paint(t0, t1, true);
    },
    clear: () => clear(true),
    range: [hist.min, hist.max] as [number, number],
  };
}

// ── Distribution bars ──────────────────────────────────────────────────────

interface Bar {
  count: number;
  label: string;
  /** Underlying selection this bar stands for — a numeric bin range or a
   *  categorical value — carried so a click can build a real predicate. */
  sel: { kind: 'numRange'; lo: number; hi: number } | { kind: 'valueSet'; value: string };
}

/** Render a column's distribution (histogram or category bars) into `mount`. */
export function renderDistribution(
  mount: HTMLElement,
  readout: HTMLElement | null,
  column: string,
  rows: Array<Record<string, unknown>>,
  opts: FacetSelectOptions = {},
): void {
  const values = rows.map((r) => r[column]);
  const summary = summarizeColumn(values, { binCount: 30, topN: 24 });
  const bars = toBars(summary);
  const total = summary.total;
  if (bars.length === 0 || total === 0) {
    mount.innerHTML = `<div class="cell-output-empty">No summarizable values in "${escapeHtml(column)}".</div>`;
    if (readout) readout.textContent = '';
    return;
  }

  const width = mount.clientWidth || 600;
  const maxCount = Math.max(...bars.map((b) => b.count), 1);
  const padX = 2;
  const plotW = Math.max(1, width - padX * 2);
  const barW = plotW / bars.length;

  const rects = bars
    .map((b, i) => {
      const h = (b.count / maxCount) * (DIST_H - 22);
      const x = padX + i * barW;
      const y = DIST_H - 18 - h;
      return `<rect data-bar="${i}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(0.5, barW - 1).toFixed(1)}" height="${h.toFixed(1)}" fill="var(--accent)" opacity="0.85" style="cursor:pointer;"><title>${escapeHtml(b.label)} — ${b.count}</title></rect>`;
    })
    .join('');

  const kindLabel =
    summary.kind === 'numeric'
      ? `numeric · ${summary.total.toLocaleString()} rows`
      : `${summary.distinct.toLocaleString()} distinct · top ${bars.length}${summary.otherCount > 0 ? ` (+${summary.otherCount.toLocaleString()} other)` : ''}`;

  mount.innerHTML = `
    <svg data-region="dist-svg" width="100%" height="${DIST_H}" viewBox="0 0 ${width} ${DIST_H}" preserveAspectRatio="none" style="display:block;user-select:none;">
      <rect x="0" y="0" width="${width}" height="${DIST_H}" fill="var(--surface-alt)" />
      ${rects}
      <line x1="0" y1="${DIST_H - 18}" x2="${width}" y2="${DIST_H - 18}" stroke="var(--border)" stroke-width="1" />
      <text x="4" y="${DIST_H - 5}" font-size="10" fill="var(--text-muted)">${escapeHtml(kindLabel)}</text>
    </svg>`;

  wireSelect(mount, readout, bars, total, column, opts);
}

function toBars(summary: ColumnSummary): Bar[] {
  if (summary.kind === 'numeric') {
    return summary.bins.map((b) => ({
      count: b.count,
      label: b.lo === b.hi ? fmtNum(b.lo) : `${fmtNum(b.lo)}–${fmtNum(b.hi)}`,
      sel: { kind: 'numRange', lo: b.lo, hi: b.hi },
    }));
  }
  return summary.items.map((it) => ({
    count: it.count,
    label: it.value,
    sel: { kind: 'valueSet', value: it.value },
  }));
}

/** Which bar (if any) a persisted selection corresponds to, so a re-render can
 *  re-highlight it. Matches a numeric bin by its [lo, hi] and a category by value. */
function selectionToBarIndex(bars: Bar[], selection: FacetSelection | null | undefined): number {
  if (!selection) return -1;
  return bars.findIndex((b) => {
    if (b.sel.kind === 'numRange' && selection.kind === 'numRange') {
      return b.sel.lo === selection.lo && b.sel.hi === selection.hi;
    }
    if (b.sel.kind === 'valueSet' && selection.kind === 'valueSet') {
      return selection.values.length === 1 && selection.values[0] === b.sel.value;
    }
    return false;
  });
}

function barToSelection(bar: Bar, column: string): FacetSelection {
  return bar.sel.kind === 'numRange'
    ? { kind: 'numRange', col: column, lo: bar.sel.lo, hi: bar.sel.hi }
    : { kind: 'valueSet', col: column, values: [bar.sel.value] };
}

function wireSelect(
  mount: HTMLElement,
  readout: HTMLElement | null,
  bars: Bar[],
  total: number,
  column: string,
  opts: FacetSelectOptions,
): void {
  const svg = mount.querySelector<SVGSVGElement>('[data-region="dist-svg"]');
  if (!svg) return;
  const rects = Array.from(svg.querySelectorAll<SVGRectElement>('[data-bar]'));
  let active: number | null = null;

  // `emit` false = silent restore of a persisted bar on render (paint only).
  const select = (i: number | null, emit: boolean) => {
    active = i;
    for (const r of rects) {
      const idx = Number(r.dataset.bar);
      r.setAttribute('opacity', i === null || idx === i ? '0.85' : '0.25');
    }
    if (readout) {
      if (i === null) {
        delete readout.dataset.selectedBar;
        delete readout.dataset.selectedCount;
        readout.textContent = '';
      } else {
        const b = bars[i] as Bar;
        const pct = total > 0 ? ((b.count / total) * 100).toFixed(1) : '0';
        readout.dataset.selectedBar = String(i);
        readout.dataset.selectedCount = String(b.count);
        readout.textContent = `${b.label} · ${b.count.toLocaleString()} rows (${pct}%) — click again to clear`;
      }
    }
    if (emit) opts.onSelect?.(i === null ? null : barToSelection(bars[i] as Bar, column));
  };

  for (const r of rects) {
    r.addEventListener('click', () => {
      const idx = Number(r.dataset.bar);
      select(active === idx ? null : idx, true);
    });
  }

  // Restore a persisted bar selection on (re-)render — highlight it, don't emit.
  const restoreIdx = selectionToBarIndex(bars, opts.selection);
  if (restoreIdx >= 0) select(restoreIdx, false);

  (mount as HTMLElement & { __distributionSelect?: unknown }).__distributionSelect = {
    selectBar: (i: number | null) => select(i, true),
    barCount: bars.length,
  };
}

// ── shared helpers ─────────────────────────────────────────────────────────

function fmtDate(ms: number): string {
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? String(ms) : d.toISOString().slice(0, 10);
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const abs = Math.abs(n);
  if (abs !== 0 && (abs < 0.01 || abs >= 1e6)) return n.toExponential(1);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
