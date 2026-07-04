// Distribution cell (Facet track). Summarizes one column of an upstream SQL
// cell as SVG bars: numeric → equal-width histogram, categorical → value-count
// bars (top-N). Clicking a bar selects it (highlights, dims the rest) and the
// readout reports the bin/value + its share of rows. Classification + counting
// live in core/distribution.ts (pure, tested); this file is DOM/SVG only. No
// lazy chunk. Mirrors temporal-cell.ts's shape.

import { type ColumnSummary, summarizeColumn } from '../../core/distribution.ts';
import { iconSvg } from '../../tokens/icons.ts';
import type { CellHandlers, DistributionCellState, SqlCellState } from './types.ts';

const SVG_H = 150;

export function renderDistributionCell(
  cell: DistributionCellState,
  upstreamCells: SqlCellState[],
  handlers: CellHandlers,
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cell';
  el.dataset.cellId = cell.id;
  el.dataset.cellKind = 'distribution';

  const input = upstreamCells.find((c) => c.id === cell.inputCell);
  const cols = input?.lastResult?.columns ?? [];

  el.innerHTML = `
    <div class="cell-head">
      <span class="cell-kind">DIST</span>
      <input class="cell-name" data-region="cell-name" value="${escapeHtml(cell.name ?? '')}"
             placeholder="@name (optional)" aria-label="Distribution cell name"
             style="border:0;background:transparent;width:140px;outline:none;font-family:var(--font-mono);font-size:11px;" />
      <span style="color: var(--text-muted); font-size:11px;">of</span>
      <select data-action="dist-input" aria-label="Input cell" style="font-size:12px;">
        <option value="">— pick a SQL cell —</option>
        ${upstreamCells
          .map(
            (c) =>
              `<option value="${c.id}" ${c.id === cell.inputCell ? 'selected' : ''}>${escapeHtml(c.name ?? c.id)}</option>`,
          )
          .join('')}
      </select>
      ${cols.length > 0 ? renderColumnPicker(cell, cols) : ''}
      <div class="cell-actions">
        <button class="btn btn-ghost" data-action="cell-delete" title="Delete cell" aria-label="Delete cell">
          ${iconSvg('trash', 12)}
        </button>
      </div>
    </div>
    <div class="cell-output" data-region="dist-canvas">
      ${input?.lastResult ? '' : '<div class="cell-output-empty">Pick a SQL cell, then a column to summarize.</div>'}
    </div>
    <div data-region="dist-readout" style="font-size:11px;color:var(--text-muted);padding:2px 4px;min-height:15px;"></div>
  `;

  const nameInput = el.querySelector<HTMLInputElement>('[data-region="cell-name"]');
  nameInput?.addEventListener('change', () => {
    handlers.onChange(cell.id, { name: nameInput.value.trim() || null });
  });

  for (const sel of el.querySelectorAll<HTMLSelectElement>('select')) {
    sel.addEventListener('change', () => {
      const patch: Record<string, unknown> = {};
      if (sel.dataset.action === 'dist-input') patch.inputCell = sel.value || null;
      else if (sel.dataset.action === 'dist-column') patch.column = sel.value || null;
      handlers.onChange(cell.id, patch);
    });
  }

  el.querySelector('[data-action="cell-delete"]')?.addEventListener('click', () =>
    handlers.onDelete(cell.id),
  );

  const mount = el.querySelector<HTMLElement>('[data-region="dist-canvas"]');
  const readout = el.querySelector<HTMLElement>('[data-region="dist-readout"]');
  if (mount && input?.lastResult && cell.column) {
    renderBars(mount, readout, cell.column, input.lastResult.rows);
  } else if (mount && input?.lastResult) {
    mount.innerHTML = '<div class="cell-output-empty">Pick a column.</div>';
  }

  return el;
}

function renderColumnPicker(cell: DistributionCellState, cols: string[]): string {
  return `
    <label style="font-size:11px;color:var(--text-muted);display:inline-flex;align-items:center;gap:4px;">
      column
      <select data-action="dist-column" style="font-size:12px;">
        <option value="">—</option>
        ${cols
          .map(
            (c) =>
              `<option value="${escapeHtml(c)}" ${cell.column === c ? 'selected' : ''}>${escapeHtml(c)}</option>`,
          )
          .join('')}
      </select>
    </label>`;
}

interface Bar {
  count: number;
  /** Bar label (bin range or category value). */
  label: string;
}

function renderBars(
  mount: HTMLElement,
  readout: HTMLElement | null,
  column: string,
  rows: Array<Record<string, unknown>>,
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
      const h = (b.count / maxCount) * (SVG_H - 22);
      const x = padX + i * barW;
      const y = SVG_H - 18 - h;
      return `<rect data-bar="${i}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(0.5, barW - 1).toFixed(1)}" height="${h.toFixed(1)}" fill="var(--accent)" opacity="0.85" style="cursor:pointer;"><title>${escapeHtml(b.label)} — ${b.count}</title></rect>`;
    })
    .join('');

  const kindLabel =
    summary.kind === 'numeric'
      ? `numeric · ${summary.total.toLocaleString()} rows`
      : `${summary.distinct.toLocaleString()} distinct · top ${bars.length}${summary.otherCount > 0 ? ` (+${summary.otherCount.toLocaleString()} other)` : ''}`;

  mount.innerHTML = `
    <svg data-region="dist-svg" width="100%" height="${SVG_H}" viewBox="0 0 ${width} ${SVG_H}" preserveAspectRatio="none" style="display:block;user-select:none;">
      <rect x="0" y="0" width="${width}" height="${SVG_H}" fill="var(--surface-alt)" />
      ${rects}
      <line x1="0" y1="${SVG_H - 18}" x2="${width}" y2="${SVG_H - 18}" stroke="var(--border)" stroke-width="1" />
      <text x="4" y="${SVG_H - 5}" font-size="10" fill="var(--text-muted)">${escapeHtml(kindLabel)}</text>
    </svg>`;

  wireSelect(mount, readout, bars, total);
}

/** Normalize either summary shape to a flat [{count, label}] bar list. */
function toBars(summary: ColumnSummary): Bar[] {
  if (summary.kind === 'numeric') {
    return summary.bins.map((b) => ({
      count: b.count,
      label: b.lo === b.hi ? fmtNum(b.lo) : `${fmtNum(b.lo)}–${fmtNum(b.hi)}`,
    }));
  }
  return summary.items.map((it) => ({ count: it.count, label: it.value }));
}

/** Click a bar → highlight it (dim the rest) + report its share; click again clears. */
function wireSelect(
  mount: HTMLElement,
  readout: HTMLElement | null,
  bars: Bar[],
  total: number,
): void {
  const svg = mount.querySelector<SVGSVGElement>('[data-region="dist-svg"]');
  if (!svg) return;
  const rects = Array.from(svg.querySelectorAll<SVGRectElement>('[data-bar]'));
  let active: number | null = null;

  const select = (i: number | null) => {
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
  };

  for (const r of rects) {
    r.addEventListener('click', () => {
      const idx = Number(r.dataset.bar);
      select(active === idx ? null : idx);
    });
  }

  // Automation seam for the smoke (click coords across the SVG viewBox are fiddly).
  (mount as HTMLElement & { __distributionSelect?: unknown }).__distributionSelect = {
    selectBar: (i: number | null) => select(i),
    barCount: bars.length,
  };
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
