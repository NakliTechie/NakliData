// Temporal cell (Facet track). Buckets an upstream SQL cell's time column into
// a histogram over time and draws it as an SVG bar timeline. Dragging across the
// timeline brushes a window; the readout shows the selected range + the number
// of rows inside it. Bucketing + coercion live in core/temporal.ts (pure,
// tested); this file is DOM/SVG only. No lazy chunk — the timeline is light SVG,
// so it renders straight from the main bundle. Mirrors embedding-cell.ts's shape.

import { type TimeHistogram, bucketTime, countInWindow } from '../../core/temporal.ts';
import { iconSvg } from '../../tokens/icons.ts';
import type { CellHandlers, SqlCellState, TemporalCellState } from './types.ts';

const BIN_COUNT = 40;
const SVG_H = 130;

export function renderTemporalCell(
  cell: TemporalCellState,
  upstreamCells: SqlCellState[],
  handlers: CellHandlers,
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cell';
  el.dataset.cellId = cell.id;
  el.dataset.cellKind = 'temporal';

  const input = upstreamCells.find((c) => c.id === cell.inputCell);
  const cols = input?.lastResult?.columns ?? [];

  el.innerHTML = `
    <div class="cell-head">
      <span class="cell-kind">TIME</span>
      <input class="cell-name" data-region="cell-name" value="${escapeHtml(cell.name ?? '')}"
             placeholder="@name (optional)" aria-label="Temporal cell name"
             style="border:0;background:transparent;width:140px;outline:none;font-family:var(--font-mono);font-size:11px;" />
      <span style="color: var(--text-muted); font-size:11px;">of</span>
      <select data-action="temporal-input" aria-label="Input cell" style="font-size:12px;">
        <option value="">— pick a SQL cell —</option>
        ${upstreamCells
          .map(
            (c) =>
              `<option value="${c.id}" ${c.id === cell.inputCell ? 'selected' : ''}>${escapeHtml(c.name ?? c.id)}</option>`,
          )
          .join('')}
      </select>
      ${cols.length > 0 ? renderTimePicker(cell, cols) : ''}
      <div class="cell-actions">
        <button class="btn btn-ghost" data-action="cell-delete" title="Delete cell" aria-label="Delete cell">
          ${iconSvg('trash', 12)}
        </button>
      </div>
    </div>
    <div class="cell-output" data-region="temporal-canvas">
      ${input?.lastResult ? '' : '<div class="cell-output-empty">Pick a SQL cell that has a date / timestamp column.</div>'}
    </div>
    <div data-region="temporal-readout" style="font-size:11px;color:var(--text-muted);padding:2px 4px;min-height:15px;"></div>
  `;

  const nameInput = el.querySelector<HTMLInputElement>('[data-region="cell-name"]');
  nameInput?.addEventListener('change', () => {
    handlers.onChange(cell.id, { name: nameInput.value.trim() || null });
  });

  for (const sel of el.querySelectorAll<HTMLSelectElement>('select')) {
    sel.addEventListener('change', () => {
      const patch: Record<string, unknown> = {};
      if (sel.dataset.action === 'temporal-input') patch.inputCell = sel.value || null;
      else if (sel.dataset.action === 'temporal-time') patch.timeCol = sel.value || null;
      handlers.onChange(cell.id, patch);
    });
  }

  el.querySelector('[data-action="cell-delete"]')?.addEventListener('click', () =>
    handlers.onDelete(cell.id),
  );

  const mount = el.querySelector<HTMLElement>('[data-region="temporal-canvas"]');
  const readout = el.querySelector<HTMLElement>('[data-region="temporal-readout"]');
  if (mount && input?.lastResult && cell.timeCol) {
    renderTimeline(mount, readout, cell.timeCol, input.lastResult.rows);
  } else if (mount && input?.lastResult) {
    mount.innerHTML = '<div class="cell-output-empty">Pick the time column.</div>';
  }

  return el;
}

function renderTimePicker(cell: TemporalCellState, cols: string[]): string {
  return `
    <label style="font-size:11px;color:var(--text-muted);display:inline-flex;align-items:center;gap:4px;">
      time
      <select data-action="temporal-time" style="font-size:12px;">
        <option value="">—</option>
        ${cols
          .map(
            (c) =>
              `<option value="${escapeHtml(c)}" ${cell.timeCol === c ? 'selected' : ''}>${escapeHtml(c)}</option>`,
          )
          .join('')}
      </select>
    </label>`;
}

function renderTimeline(
  mount: HTMLElement,
  readout: HTMLElement | null,
  timeCol: string,
  rows: Array<Record<string, unknown>>,
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
      const h = (b.count / maxCount) * (SVG_H - 20);
      const x = padX + i * barW;
      const y = SVG_H - 16 - h;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(0.5, barW - 0.5).toFixed(1)}" height="${h.toFixed(1)}" fill="var(--accent)" opacity="0.85"><title>${new Date(b.t0).toISOString().slice(0, 10)} — ${b.count}</title></rect>`;
    })
    .join('');

  mount.innerHTML = `
    <svg data-region="temporal-svg" width="100%" height="${SVG_H}" viewBox="0 0 ${width} ${SVG_H}" preserveAspectRatio="none" style="display:block;cursor:crosshair;user-select:none;">
      <rect x="0" y="0" width="${width}" height="${SVG_H}" fill="var(--surface-alt)" />
      ${bars}
      <line x1="0" y1="${SVG_H - 16}" x2="${width}" y2="${SVG_H - 16}" stroke="var(--border)" stroke-width="1" />
      <rect data-region="temporal-brush" x="0" y="0" width="0" height="${SVG_H - 16}" fill="var(--accent)" opacity="0.18" style="pointer-events:none;" />
      <text x="4" y="${SVG_H - 4}" font-size="10" fill="var(--text-muted)">${fmt(hist.min)}</text>
      <text x="${width - 4}" y="${SVG_H - 4}" font-size="10" fill="var(--text-muted)" text-anchor="end">${fmt(hist.max)}</text>
    </svg>`;

  wireBrush(mount, readout, hist, values, padX, plotW);
}

/** Drag across the SVG to brush a window; report [start, end] + in-window count. */
function wireBrush(
  mount: HTMLElement,
  readout: HTMLElement | null,
  hist: TimeHistogram,
  values: readonly unknown[],
  padX: number,
  plotW: number,
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

  const report = (t0: number, t1: number) => {
    const lo = Math.min(t0, t1);
    const hi = Math.max(t0, t1);
    const count = countInWindow(values, lo, hi);
    if (readout) {
      readout.dataset.windowStart = String(lo);
      readout.dataset.windowEnd = String(hi);
      readout.dataset.windowCount = String(count);
      readout.textContent = `${fmt(lo)} → ${fmt(hi)} · ${count.toLocaleString()} of ${hist.total.toLocaleString()} rows — click to clear`;
    }
  };

  svg.addEventListener('pointerdown', (ev) => {
    anchorT = xToTime(ev.clientX);
    svg.setPointerCapture(ev.pointerId);
    setBrush(anchorT, anchorT);
  });
  svg.addEventListener('pointermove', (ev) => {
    if (anchorT === null) return;
    const t = xToTime(ev.clientX);
    setBrush(anchorT, t);
  });
  svg.addEventListener('pointerup', (ev) => {
    if (anchorT === null) return;
    const t = xToTime(ev.clientX);
    if (Math.abs(timeToViewX(t) - timeToViewX(anchorT)) < 3) {
      // A click, not a drag → clear.
      brush.setAttribute('width', '0');
      if (readout) {
        delete readout.dataset.windowStart;
        delete readout.dataset.windowEnd;
        delete readout.dataset.windowCount;
        readout.textContent = '';
      }
    } else {
      setBrush(anchorT, t);
      report(anchorT, t);
    }
    anchorT = null;
  });

  // Automation seam — the smoke test brushes a window programmatically (pointer
  // events through CDP are fiddly across coordinate spaces).
  (mount as HTMLElement & { __temporalBrush?: unknown }).__temporalBrush = {
    brushTimeWindow(t0: number, t1: number) {
      setBrush(t0, t1);
      report(t0, t1);
    },
    range: [hist.min, hist.max] as [number, number],
  };
}

function fmt(ms: number): string {
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? String(ms) : d.toISOString().slice(0, 10);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
