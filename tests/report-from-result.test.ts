import { describe, expect, it } from 'vitest';
import { buildReportScaffold } from '../src/core/report-from-result.ts';

describe('buildReportScaffold', () => {
  it('builds a report that embeds notes then the (named) result', () => {
    const s = buildReportScaffold({
      cellId: 'c_abc',
      sqlName: 'invoice_totals',
      sqlCode: 'SELECT vendor, SUM(amount) AS total FROM invoices GROUP BY 1',
      rowCount: 1234,
      today: '2026-07-11',
    });
    expect(s.sqlName).toBe('invoice_totals');
    expect(s.notesName).toBe('invoice_totals_notes');
    expect(s.definition.title).toBe('Invoice totals');
    expect(s.definition.subtitle).toBe('1,234 rows · 2026-07-11');
    expect(s.definition.items).toEqual([
      { kind: 'cell-ref', cellName: 'invoice_totals_notes' },
      { kind: 'cell-ref', cellName: 'invoice_totals' },
    ]);
    // A valid ReportDefinition carries page + margins (from the empty base).
    expect(s.definition.pageSize).toBe('A4');
    expect(s.definition.margins).toBeDefined();
  });

  it('provenance notes carry row count, date, the query, and a Key-notes area', () => {
    const s = buildReportScaffold({
      cellId: 'c_1',
      sqlName: 'q',
      sqlCode: 'SELECT 1',
      rowCount: 5,
      today: '2026-07-11',
    });
    expect(s.notesMarkdown).toContain('**5 rows** · generated 2026-07-11');
    expect(s.notesMarkdown).toContain('```sql\nSELECT 1\n```');
    expect(s.notesMarkdown).toContain('### Key notes');
  });

  it('names an unnamed cell deterministically and titles it "Report"', () => {
    const s = buildReportScaffold({
      cellId: 'c_xyz',
      sqlName: null,
      sqlCode: 'SELECT 1',
      rowCount: 0,
      today: '2026-07-11',
    });
    expect(s.sqlName).toBe('result_c_xyz');
    expect(s.notesName).toBe('result_c_xyz_notes');
    expect(s.definition.title).toBe('Report');
  });

  it('no chart by default — chartName is null, items are notes + result only', () => {
    const s = buildReportScaffold({
      cellId: 'c_1',
      sqlName: 'q',
      sqlCode: 'SELECT 1',
      rowCount: 5,
      today: '2026-07-11',
    });
    expect(s.chartName).toBeNull();
    expect(s.definition.items).toHaveLength(2);
  });

  it('A1 — a chartable result cell-refs an auto chart cell after the table', () => {
    const s = buildReportScaffold({
      cellId: 'c_abc',
      sqlName: 'invoice_totals',
      sqlCode: 'SELECT vendor, SUM(amount) AS total FROM invoices GROUP BY 1',
      rowCount: 12,
      today: '2026-07-11',
      chart: { category: 'vendor', value: 'total' },
    });
    expect(s.chartName).toBe('invoice_totals_chart');
    expect(s.definition.items).toEqual([
      { kind: 'cell-ref', cellName: 'invoice_totals_notes' },
      { kind: 'cell-ref', cellName: 'invoice_totals' },
      { kind: 'cell-ref', cellName: 'invoice_totals_chart' },
    ]);
  });

  it('A2 — a KPI row leads the report when kpis are supplied', () => {
    const s = buildReportScaffold({
      cellId: 'c_abc',
      sqlName: 'invoice_totals',
      sqlCode: 'SELECT vendor, SUM(amount) AS total FROM invoices GROUP BY 1',
      rowCount: 3,
      today: '2026-07-11',
      chart: { category: 'vendor', value: 'total' },
      kpis: {
        valueColumn: 'total',
        tiles: [
          { measure: 'invoice_totals_total', label: 'Total', value: '65,000' },
          { measure: 'invoice_totals_count', label: 'Rows', value: '3' },
        ],
      },
    });
    // KPI row is FIRST, then notes, result, chart.
    expect(s.definition.items[0]).toEqual({
      kind: 'kpi-row',
      sourceCell: 'invoice_totals',
      valueColumn: 'total',
      tiles: [
        { measure: 'invoice_totals_total', label: 'Total', value: '65,000' },
        { measure: 'invoice_totals_count', label: 'Rows', value: '3' },
      ],
    });
    expect(s.definition.items.map((i) => i.kind)).toEqual([
      'kpi-row',
      'cell-ref',
      'cell-ref',
      'cell-ref',
    ]);
  });

  it('pluralises row count correctly (1 row)', () => {
    const s = buildReportScaffold({
      cellId: 'c_1',
      sqlName: 'q',
      sqlCode: 'SELECT 1',
      rowCount: 1,
      today: '2026-07-11',
    });
    expect(s.definition.subtitle).toBe('1 row · 2026-07-11');
  });
});
