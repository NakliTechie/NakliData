// v1.3 M3 — Report cell renderer.
//
// Print-to-PDF via browser's window.print() — handoff §M3 prefers
// print CSS over pdf-lib. The renderer composes the report's items
// (KPI rows, cell-refs, page-breaks, spacers) into a flow with
// page-break-inside: avoid per item, so charts and tables don't
// clip across pages.

import { type ReportItem, buildPageCss, clampMm } from '../../core/report-layout.ts';
import { Neutral, OverlayColor } from '../../tokens/colors.ts';
import { iconSvg } from '../../tokens/icons.ts';
import type { CellHandlers, ReportCellState } from './types.ts';

export function renderReportCell(cell: ReportCellState, handlers: CellHandlers): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'cell cell-report report-cell';
  wrap.dataset.cellId = cell.id;
  wrap.dataset.cellKind = 'report';

  const itemsHtml =
    cell.definition.items.length === 0
      ? renderTemplatePicker(cell.id)
      : cell.definition.items.map(renderItem).join('');
  const today = new Date().toISOString().slice(0, 10);

  wrap.innerHTML = `
    <style>${buildPageCss(cell.definition)}</style>
    <div class="cell-head">
      <span class="cell-kind">${iconSvg('file', 12)} report</span>
      <input class="cell-name-input" placeholder="name (optional)" value="${cell.name ? escapeAttr(cell.name) : ''}" data-action="cell-name-edit" />
      <span style="flex:1;"></span>
      <button class="btn btn-ghost" data-action="report-refresh" data-cell-id="${cell.id}" title="Re-run all cells (in dependency order) so this report's embedded results are fresh">${iconSvg('play', 12)} <span>Refresh data</span></button>
      <button class="btn btn-primary" data-action="report-print" data-cell-id="${cell.id}" title="Open the browser's print dialog → Save as PDF">${iconSvg('download', 12)} <span>Print to PDF</span></button>
      <button class="btn btn-ghost" data-action="cell-delete" data-cell-id="${cell.id}" aria-label="Delete cell">${iconSvg('x', 12)}</button>
    </div>
    <div class="report-paper" style="background:${Neutral.surface};padding:24mm;max-width:210mm;margin:var(--space-3) auto;box-shadow:0 1px 4px ${OverlayColor.reportShadow};border-radius:4px;font-family:'Helvetica Neue', Arial, sans-serif;">
      <header style="border-bottom:2px solid ${Neutral.textStrong};padding-bottom:8mm;margin-bottom:8mm;">
        <h1 style="margin:0;font-size:24px;font-weight:700;color:${Neutral.textStrong};">${escapeHtml(cell.definition.title)}</h1>
        ${cell.definition.subtitle ? `<p style="margin:4px 0 0 0;font-size:14px;color:${Neutral.textSecondary};">${escapeHtml(cell.definition.subtitle)}</p>` : ''}
        <p style="margin:6px 0 0 0;font-size:11px;color:${Neutral.textFaint};">${today}</p>
      </header>
      <div class="report-body">${itemsHtml}</div>
      <footer style="position:relative;border-top:1px solid ${Neutral.borderMuted};padding-top:6mm;margin-top:8mm;font-size:10px;color:${Neutral.textFaint};text-align:center;">
        NakliData report — printed ${today}
      </footer>
    </div>
  `;
  wrap
    .querySelector<HTMLInputElement>('[data-action="cell-name-edit"]')
    ?.addEventListener('change', (ev) => {
      const next = (ev.target as HTMLInputElement).value.trim() || null;
      handlers.onChange(cell.id, { name: next });
    });
  // H3: the global dispatcher skips cell-delete expecting a local handler; wire it.
  wrap
    .querySelector<HTMLButtonElement>('[data-action="cell-delete"]')
    ?.addEventListener('click', () => handlers.onDelete(cell.id));
  return wrap;
}

// A3 — the empty-report picker. Only the id/name live in the shell; picking one
// lazy-loads the `report-templates` chunk to build the scaffold (main.ts).
const EXEC_TEMPLATE_PICKER: ReadonlyArray<{ id: string; name: string }> = [
  { id: 'briefing_memo', name: 'Briefing memo' },
  { id: 'operating_review', name: 'Operating review' },
  { id: 'dataset_audit', name: 'Dataset audit' },
];

function renderTemplatePicker(cellId: string): string {
  const btns = EXEC_TEMPLATE_PICKER.map(
    (t) =>
      `<button class="btn btn-ghost" data-action="report-template" data-cell-id="${escapeAttr(cellId)}" data-template-id="${t.id}" style="border:1px solid ${Neutral.borderCool};background:${Neutral.surface};color:${Neutral.textCool};">${escapeHtml(t.name)}</button>`,
  ).join('');
  return `
    <div class="report-item report-empty-picker" style="text-align:center;color:${Neutral.textCoolMuted};padding:14mm 0;">
      <p style="margin:0 0 10px 0;font-size:13px;">Empty report — add cells from the toolbar, or start from an executive template:</p>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">${btns}</div>
    </div>
  `;
}

function renderItem(item: ReportItem): string {
  if (item.kind === 'page-break') {
    return `<div class="report-page-break"></div>`;
  }
  if (item.kind === 'spacer') {
    // H2: coerce+clamp the height numerically — a string height from a hostile
    // .naklidata would otherwise inject markup here (validateReport also gates
    // this on load, but the render site must be safe regardless).
    return `<div class="report-item" style="height:${clampMm(item.height, 200)}mm;"></div>`;
  }
  if (item.kind === 'kpi-row') {
    const tilesHtml = item.tiles
      .map(
        (t) => `
          <div class="report-kpi-tile" style="flex:1;padding:12px;background:${Neutral.surfaceSubtle};border:1px solid ${Neutral.borderLight};border-radius:6px;text-align:center;">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:${Neutral.textCoolMuted};font-weight:600;margin-bottom:6px;">${escapeHtml(t.label)}</div>
            <div style="font-size:24px;font-weight:700;color:${Neutral.textStrong};" data-measure="${escapeAttr(t.measure)}">${t.value ? escapeHtml(t.value) : '…'}</div>
          </div>
        `,
      )
      .join('');
    return `
      <div class="report-item" style="display:flex;gap:12px;margin-bottom:10mm;">${tilesHtml}</div>
    `;
  }
  // cell-ref: a placeholder slot. Wired up at print time by the
  // host (which clones the referenced cell's rendered output into
  // the placeholder).
  return `
    <div class="report-item report-cell-ref" data-cell-ref="${escapeAttr(item.cellName)}" style="margin-bottom:10mm;border:1px dashed ${Neutral.borderCool};padding:8mm;border-radius:4px;color:${Neutral.placeholder};font-style:italic;">
      [@${escapeHtml(item.cellName)} — content embedded at render]
    </div>
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
