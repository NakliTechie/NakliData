// v1.3 M3 — Report layout tests.
//
// Gate artifacts per handoff §M3:
//   - Two-page report with header/footer/KPI tiles/table/chart
//     (UI tested via smoke; this file tests the pure layout layer).
//   - Pagination correct across page breaks (validated by
//     buildPageCss + page-break-inside avoid).

import { describe, expect, it } from 'vitest';
import {
  type ReportDefinition,
  buildPageCss,
  emptyReportDefinition,
  validateReport,
} from '../src/core/report-layout.ts';

describe('emptyReportDefinition', () => {
  it('returns A4 + default margins + empty items', () => {
    const r = emptyReportDefinition();
    expect(r.title).toBe('Report');
    expect(r.pageSize).toBe('A4');
    expect(r.margins).toEqual({ top: 20, right: 20, bottom: 20, left: 20 });
    expect(r.items).toEqual([]);
  });
});

describe('validateReport', () => {
  it('returns [] on a valid empty report', () => {
    expect(validateReport(emptyReportDefinition(), [])).toEqual([]);
  });

  it('flags missing title', () => {
    const r: ReportDefinition = { ...emptyReportDefinition(), title: '' };
    expect(validateReport(r, [])).toContain('Report title is required.');
  });

  it('flags unknown page size', () => {
    const r = { ...emptyReportDefinition(), pageSize: 'A3' as unknown as 'A4' };
    expect(validateReport(r, [])[0]).toContain('Unknown page size');
  });

  it('flags cell-ref to a missing cell name', () => {
    const r: ReportDefinition = {
      ...emptyReportDefinition(),
      items: [{ kind: 'cell-ref', cellName: 'q_revenue' }],
    };
    expect(validateReport(r, [])[0]).toContain('q_revenue');
  });

  it('accepts cell-ref to an available cell', () => {
    const r: ReportDefinition = {
      ...emptyReportDefinition(),
      items: [{ kind: 'cell-ref', cellName: 'q_revenue' }],
    };
    expect(validateReport(r, ['q_revenue'])).toEqual([]);
  });

  it('flags empty kpi-row', () => {
    const r: ReportDefinition = {
      ...emptyReportDefinition(),
      items: [{ kind: 'kpi-row', tiles: [] }],
    };
    expect(validateReport(r, [])[0]).toContain('empty');
  });

  it('flags kpi-row with > 4 tiles', () => {
    const r: ReportDefinition = {
      ...emptyReportDefinition(),
      items: [
        {
          kind: 'kpi-row',
          tiles: [
            { measure: 'a', label: 'A' },
            { measure: 'b', label: 'B' },
            { measure: 'c', label: 'C' },
            { measure: 'd', label: 'D' },
            { measure: 'e', label: 'E' },
          ],
        },
      ],
    };
    expect(validateReport(r, [])[0]).toContain('max is 4');
  });

  it('flags out-of-range spacer height', () => {
    const r: ReportDefinition = {
      ...emptyReportDefinition(),
      items: [{ kind: 'spacer', height: 999 }],
    };
    expect(validateReport(r, [])[0]).toContain('must be in [1, 200] mm');
  });
});

describe('buildPageCss', () => {
  it('A4 size emits @page A4', () => {
    const css = buildPageCss(emptyReportDefinition());
    expect(css).toContain('size: A4;');
    expect(css).toContain('margin: 20mm 20mm 20mm 20mm;');
  });

  it('Letter size emits @page Letter', () => {
    const r: ReportDefinition = { ...emptyReportDefinition(), pageSize: 'Letter' };
    const css = buildPageCss(r);
    expect(css).toContain('size: Letter;');
  });

  it('includes page-break-inside: avoid on report-item (no clipped rows)', () => {
    const css = buildPageCss(emptyReportDefinition());
    expect(css).toContain('page-break-inside: avoid');
  });

  it('includes page-break-after: always on report-page-break', () => {
    const css = buildPageCss(emptyReportDefinition());
    expect(css).toContain('page-break-after: always');
  });

  it('scopes the print-only rules under @media print', () => {
    const css = buildPageCss(emptyReportDefinition());
    expect(css).toMatch(/@media\s+print\s*{/);
  });

  it('scopes visibility to the [data-printing] report only (forward-pass H10)', () => {
    const css = buildPageCss(emptyReportDefinition());
    // The visible-region rule must require [data-printing], not match every
    // .report-cell (which would stack multiple reports on print).
    expect(css).toContain('.report-cell[data-printing], .report-cell[data-printing] *');
    expect(css).toContain('.report-cell:not([data-printing]) { display: none; }');
    // The old unscoped rule must be gone.
    expect(css).not.toMatch(/\.report-cell,\s*\.report-cell \* { visibility: visible/);
  });
});
