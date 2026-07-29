import type { MountedSource } from '../core/mount.ts';
import { quoteIdent } from '../core/query-builder.ts';
import type { CellState } from '../ui/cells/types.ts';

export interface DemoScaffold {
  cells: CellState[];
  runnableCellIds: string[];
}

/**
 * One coherent, deterministic first-value story across the bundled extracts:
 * a governed-operations analyst inspects vendor spend and a basic quality
 * invariant. No model call, randomness, or remote source is involved.
 */
export function buildDemoScaffold(sources: readonly MountedSource[]): DemoScaffold | null {
  const invoiceTable = sources
    .flatMap((source) => source.tables)
    .find((table) => /(?:^|\/)finance\/invoices\.csv$/i.test(table.origin));
  if (!invoiceTable) return null;

  const invoices = quoteIdent(invoiceTable.name);
  const cells: CellState[] = [
    {
      id: 'demo_intro',
      kind: 'markdown',
      order: 0,
      name: 'demo_context',
      code: [
        '# Governed operations demo',
        '',
        'A deterministic, AI-free first pass over synthetic finance, product-event, and service-log extracts.',
        'Start with vendor spend, inspect classified and sensitive fields in the Schema rail, then review the quality check.',
      ].join('\n'),
    },
    {
      id: 'demo_vendor_spend',
      kind: 'sql',
      order: 1,
      name: 'vendor_spend',
      code: [
        'SELECT',
        '  vendor_name,',
        '  COUNT(*) AS invoice_count,',
        '  ROUND(SUM(total_amount), 2) AS total_billed,',
        "  SUM(CASE WHEN payment_status <> 'paid' THEN 1 ELSE 0 END) AS open_invoices",
        `FROM ${invoices}`,
        'GROUP BY vendor_name',
        'ORDER BY total_billed DESC',
        'LIMIT 10',
      ].join('\n'),
      status: 'idle',
      lastError: null,
      lastResult: null,
    },
    {
      id: 'demo_vendor_chart',
      kind: 'chart',
      order: 2,
      name: 'vendor_spend_chart',
      inputCell: 'demo_vendor_spend',
      chartType: 'bar',
      x: 'vendor_name',
      y: 'total_billed',
      facet: null,
    },
    {
      id: 'demo_quality',
      kind: 'assertion',
      order: 3,
      name: 'invoice_quality',
      code: [
        `SELECT invoice_no, vendor_gstin, total_amount FROM ${invoices}`,
        'WHERE invoice_no IS NULL',
        '   OR vendor_gstin IS NULL',
        '   OR total_amount < 0',
      ].join('\n'),
      status: 'idle',
      lastError: null,
      lastResult: null,
    },
  ];
  return {
    cells,
    runnableCellIds: ['demo_vendor_spend', 'demo_quality'],
  };
}
