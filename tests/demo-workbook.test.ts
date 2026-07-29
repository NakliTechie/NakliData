import { describe, expect, it } from 'vitest';
import type { MountedSource } from '../src/core/mount.ts';
import { buildDemoScaffold } from '../src/lazy/demo-workbook.ts';

function financeSource(tableName = 'invoices'): MountedSource {
  return {
    id: 'source-1',
    kind: 'example-bundle',
    label: 'SMB Finance',
    ref: 'finance',
    tables: [
      {
        id: 'table-1',
        sourceId: 'source-1',
        name: tableName,
        format: 'csv',
        origin: 'examples/finance/invoices.csv',
        rowCount: 10,
        registered: true,
      },
    ],
  };
}

describe('deterministic demo scaffold', () => {
  it('creates a result, chart, and quality check without an AI job', () => {
    const scaffold = buildDemoScaffold([financeSource()]);
    expect(scaffold?.cells.map((cell) => cell.kind)).toEqual([
      'markdown',
      'sql',
      'chart',
      'assertion',
    ]);
    expect(scaffold?.runnableCellIds).toEqual(['demo_vendor_spend', 'demo_quality']);
    const serialised = JSON.stringify(scaffold);
    expect(serialised).toContain('vendor_spend');
    expect(serialised).not.toMatch(/sidecar|openai|anthropic/i);
  });

  it('quotes a collision-suffixed physical table name', () => {
    const scaffold = buildDemoScaffold([financeSource('invoices_2')]);
    const sql = scaffold?.cells.find((cell) => cell.kind === 'sql');
    expect(sql?.kind === 'sql' ? sql.code : '').toContain('FROM "invoices_2"');
  });

  it('does not create a misleading scaffold when invoices are absent', () => {
    expect(buildDemoScaffold([])).toBeNull();
  });
});
