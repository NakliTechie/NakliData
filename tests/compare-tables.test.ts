// Pure-function tests for the compare-tables modal's join-key finder.
// The engine round-trip is covered by tests/e2e/compare-tables.spec.ts.

import { describe, expect, it } from 'vitest';
import type { MountedSource, MountedTable } from '../src/core/mount.ts';
import { findJoinKeyCandidates } from '../src/ui/compare-tables-modal.ts';
import { type ColumnAssignment, assignmentKey } from '../src/ui/schema-panel.ts';

function mountedTable(id: string, sourceId: string, name: string): MountedTable {
  return {
    id,
    sourceId,
    name,
    format: 'csv',
    origin: `examples/${name}.csv`,
    rowCount: 10,
    registered: true,
  };
}

function source(id: string, label: string, tables: MountedTable[]): MountedSource {
  return { id, kind: 'example-bundle', label, tables };
}

/**
 * Build a pre-typed source + table pair so test cases can write
 * `pair.table` without non-null assertions on `source.tables[0]`. Keeps
 * the test bodies readable while satisfying biome's noNonNullAssertion.
 */
function pair(
  sourceId: string,
  tableId: string,
  tableName: string,
): { source: MountedSource; table: MountedTable } {
  const t = mountedTable(tableId, sourceId, tableName);
  return { source: source(sourceId, sourceId.toUpperCase(), [t]), table: t };
}

function assignment(
  columnName: string,
  typeId: string,
  displayName: string,
  origin: ColumnAssignment['assigned']['origin'] = 'detector',
): ColumnAssignment {
  return {
    columnName,
    sqlType: 'VARCHAR',
    candidates: [{ typeId, displayName, confidence: 0.95, evidence: [] }],
    resolution: { kind: 'auto_accept' },
    assigned: { typeId, origin, confidence: 0.95 },
    status: 'classified',
  };
}

describe('findJoinKeyCandidates', () => {
  it('returns an empty list when no shared types exist', () => {
    const a = pair('s1', 't1', 'vendors');
    const b = pair('s2', 't2', 'payments');
    const ass: Record<string, ColumnAssignment> = {
      [assignmentKey('s1', 't1', 'vendor_id')]: assignment('vendor_id', 'gstin', 'GSTIN'),
      [assignmentKey('s2', 't2', 'amount')]: assignment('amount', 'money', 'Money'),
    };
    const cands = findJoinKeyCandidates(ass, a.source, a.table, b.source, b.table);
    expect(cands).toEqual([]);
  });

  it('finds one candidate per shared typeId', () => {
    const a = pair('s1', 't1', 'vendors');
    const b = pair('s2', 't2', 'invoices');
    const ass: Record<string, ColumnAssignment> = {
      [assignmentKey('s1', 't1', 'gstin')]: assignment('gstin', 'gstin', 'GSTIN'),
      [assignmentKey('s2', 't2', 'vendor_gstin')]: assignment('vendor_gstin', 'gstin', 'GSTIN'),
    };
    const cands = findJoinKeyCandidates(ass, a.source, a.table, b.source, b.table);
    expect(cands).toHaveLength(1);
    expect(cands[0]?.typeId).toBe('gstin');
    expect(cands[0]?.columnA).toBe('gstin');
    expect(cands[0]?.columnB).toBe('vendor_gstin');
    expect(cands[0]?.typeLabel).toBe('GSTIN');
  });

  it('returns one candidate per type even with multiple columns on each side', () => {
    // Both tables have two columns of the same typeId — the finder
    // picks the first match on each side (insertion order via
    // assignmentKey iteration).
    const a = pair('s1', 't1', 'vendors');
    const b = pair('s2', 't2', 'invoices');
    const ass: Record<string, ColumnAssignment> = {
      [assignmentKey('s1', 't1', 'primary_gstin')]: assignment('primary_gstin', 'gstin', 'GSTIN'),
      [assignmentKey('s1', 't1', 'secondary_gstin')]: assignment(
        'secondary_gstin',
        'gstin',
        'GSTIN',
      ),
      [assignmentKey('s2', 't2', 'vendor_gstin')]: assignment('vendor_gstin', 'gstin', 'GSTIN'),
      [assignmentKey('s2', 't2', 'customer_gstin')]: assignment('customer_gstin', 'gstin', 'GSTIN'),
    };
    const cands = findJoinKeyCandidates(ass, a.source, a.table, b.source, b.table);
    expect(cands).toHaveLength(1);
    // First insertion on each side wins.
    expect(cands[0]?.columnA).toBe('primary_gstin');
    expect(cands[0]?.columnB).toBe('vendor_gstin');
  });

  it('lists candidates for multiple shared types', () => {
    const a = pair('s1', 't1', 'vendors');
    const b = pair('s2', 't2', 'invoices');
    const ass: Record<string, ColumnAssignment> = {
      [assignmentKey('s1', 't1', 'gstin')]: assignment('gstin', 'gstin', 'GSTIN'),
      [assignmentKey('s1', 't1', 'pan')]: assignment('pan', 'pan', 'PAN'),
      [assignmentKey('s2', 't2', 'vendor_gstin')]: assignment('vendor_gstin', 'gstin', 'GSTIN'),
      [assignmentKey('s2', 't2', 'vendor_pan')]: assignment('vendor_pan', 'pan', 'PAN'),
    };
    const cands = findJoinKeyCandidates(ass, a.source, a.table, b.source, b.table);
    const typeIds = cands.map((c) => c.typeId).sort();
    expect(typeIds).toEqual(['gstin', 'pan']);
  });

  it('skips columns with no assigned typeId (unknown / null)', () => {
    const a = pair('s1', 't1', 'vendors');
    const b = pair('s2', 't2', 'invoices');
    const ass: Record<string, ColumnAssignment> = {
      [assignmentKey('s1', 't1', 'vendor_id')]: {
        columnName: 'vendor_id',
        sqlType: 'VARCHAR',
        candidates: [],
        resolution: { kind: 'unknown' },
        assigned: { typeId: null, origin: 'unknown', confidence: 0 },
        status: 'classified',
      },
      [assignmentKey('s2', 't2', 'vendor_id')]: {
        columnName: 'vendor_id',
        sqlType: 'VARCHAR',
        candidates: [],
        resolution: { kind: 'unknown' },
        assigned: { typeId: null, origin: 'unknown', confidence: 0 },
        status: 'classified',
      },
    };
    const cands = findJoinKeyCandidates(ass, a.source, a.table, b.source, b.table);
    expect(cands).toEqual([]);
  });
});
