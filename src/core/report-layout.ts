// v1.3 M3 — Report layout types + serialisation.
//
// **Engine-boundary contract (v1.3 M0):** no DOM, no FSA, no browser
// globals. Pure data + helpers. The renderer (`ui/cells/report-cell.ts`)
// applies print CSS for pagination; the PDF export hop is the
// browser's print-to-PDF (handoff §M3 — prefer print CSS over
// pdf-lib).
//
// A report is a DESCRIPTION of a paginated document. It composes
// existing cells (charts, pivots, tables) by REFERENCE (the
// `@cellName` plumbing). Data is always re-queried at render — a
// report is never a data copy (handoff §M3).

export type ReportPageSize = 'A4' | 'Letter';

/**
 * One item in a report's body. KPI tiles compose a small grid of
 * measure values + labels; cell-refs embed an existing notebook cell
 * by name (the cell's normal renderer paints it into the report flow).
 */
export type ReportItem =
  | { kind: 'kpi-row'; tiles: ReadonlyArray<{ measure: string; label: string }> }
  | { kind: 'cell-ref'; cellName: string }
  | { kind: 'page-break' }
  | { kind: 'spacer'; height: number };

export interface ReportDefinition {
  /** Display title — shown in the report header + browser print dialog. */
  title: string;
  /** Page size — drives the @page CSS rule. */
  pageSize: ReportPageSize;
  /** Margins in mm. Top is also where the header lives. */
  margins: { top: number; right: number; bottom: number; left: number };
  /** Optional subtitle shown under the title in the header. */
  subtitle?: string;
  /** Body items in order. The renderer flows them with `page-break-
   *  inside: avoid` per item so a tall chart doesn't get clipped. */
  items: ReadonlyArray<ReportItem>;
}

/**
 * Default A4 / Letter margin presets — leave the body width roughly
 * 170mm wide on A4 (a comfortable column for text + charts).
 */
export const DEFAULT_MARGINS_MM = {
  top: 20,
  right: 20,
  bottom: 20,
  left: 20,
};

export function emptyReportDefinition(): ReportDefinition {
  return {
    title: 'Report',
    pageSize: 'A4',
    margins: DEFAULT_MARGINS_MM,
    items: [],
  };
}

/**
 * Validate a report definition. Returns an array of error strings
 * (empty when valid). The renderer expects every `cellName` to
 * resolve to an existing cell in the workbook; the caller passes
 * the available cell-name set.
 */
export function validateReport(
  report: ReportDefinition,
  availableCellNames: ReadonlyArray<string>,
): string[] {
  const errors: string[] = [];
  const names = new Set(availableCellNames);
  if (!report.title) errors.push('Report title is required.');
  if (report.pageSize !== 'A4' && report.pageSize !== 'Letter') {
    errors.push(`Unknown page size: ${report.pageSize}`);
  }
  for (let i = 0; i < report.items.length; i++) {
    const item = report.items[i] as ReportItem;
    if (item.kind === 'cell-ref' && !names.has(item.cellName)) {
      errors.push(
        `Item ${i + 1} references cell "${item.cellName}" which doesn't exist in the notebook.`,
      );
    }
    if (item.kind === 'kpi-row' && item.tiles.length === 0) {
      errors.push(`KPI row (item ${i + 1}) is empty.`);
    }
    if (item.kind === 'kpi-row' && item.tiles.length > 4) {
      errors.push(`KPI row (item ${i + 1}) has ${item.tiles.length} tiles; max is 4.`);
    }
    if (item.kind === 'spacer' && (item.height < 1 || item.height > 200)) {
      errors.push(`Spacer (item ${i + 1}) height must be in [1, 200] mm.`);
    }
  }
  return errors;
}

/**
 * Build the @page CSS rule for the report's page size + margins. The
 * renderer drops this into a `<style>` tag scoped to the report's
 * print mode. Browsers apply @page only at print time, so it doesn't
 * affect screen rendering.
 */
export function buildPageCss(report: ReportDefinition): string {
  const { pageSize, margins } = report;
  return `
    @media print {
      @page {
        size: ${pageSize === 'A4' ? 'A4' : 'Letter'};
        margin: ${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm;
      }
      body { background: #fff; }
      .report-cell { box-shadow: none; border: 0; }
      .report-item { page-break-inside: avoid; break-inside: avoid; }
      .report-page-break { page-break-after: always; break-after: page; }
      /* Hide everything but the ONE report being printed. The host sets
         [data-printing] on the target cell before window.print() so a
         notebook with several report cells doesn't print them stacked
         on top of each other (forward-pass H10). */
      body * { visibility: hidden; }
      .report-cell[data-printing], .report-cell[data-printing] * { visibility: visible; }
      .report-cell[data-printing] { position: absolute; left: 0; top: 0; width: 100%; }
      .report-cell:not([data-printing]) { display: none; }
    }
  `;
}
