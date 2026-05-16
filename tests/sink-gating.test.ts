import { describe, expect, it } from 'vitest';
import type { SqlResult } from '../src/ui/cells/types.ts';
import type { ColumnAssignment } from '../src/ui/schema-panel.ts';
import { type Requirement, blockReasonFor, evaluateRequirements } from '../src/ui/sinks/gating.ts';

function assign(columnName: string, typeId: string | null, sqlType = 'VARCHAR'): ColumnAssignment {
  return {
    columnName,
    sqlType,
    candidates: [],
    resolution: { kind: typeId ? 'auto_accept' : 'unknown' },
    assigned: { typeId, origin: typeId ? 'detector' : 'unknown', confidence: typeId ? 0.9 : 0 },
    status: 'classified',
  };
}

function result(columns: string[]): SqlResult {
  return { columns, rows: [], rowCount: 0, elapsedMs: 0 };
}

describe('evaluateRequirements', () => {
  it('passes when no requirements', () => {
    const r = evaluateRequirements(undefined, result(['x']), [assign('x', null)]);
    expect(r.ok).toBe(true);
    expect(r.missing).toHaveLength(0);
  });

  it('passes when single typeId is present in result columns', () => {
    const requires: Requirement[] = [{ any: ['gstin'], label: 'GSTIN' }];
    const r = evaluateRequirements(requires, result(['vendor_gstin']), [
      assign('vendor_gstin', 'gstin'),
    ]);
    expect(r.ok).toBe(true);
    expect(r.satisfiedBy[0]?.satisfiedBy).toBe('gstin');
  });

  it('fails when required typeId is not assigned', () => {
    const requires: Requirement[] = [{ any: ['gstin'], label: 'GSTIN' }];
    const r = evaluateRequirements(requires, result(['col_a']), [assign('col_a', null)]);
    expect(r.ok).toBe(false);
    expect(r.missing).toHaveLength(1);
    expect(r.missing[0]?.label).toBe('GSTIN');
  });

  it('any-of: passes when any one typeId is present', () => {
    const requires: Requirement[] = [
      { any: ['vendor_name', 'gl_account'], label: 'vendor or account' },
    ];
    const r = evaluateRequirements(requires, result(['acct']), [assign('acct', 'gl_account')]);
    expect(r.ok).toBe(true);
    expect(r.satisfiedBy[0]?.satisfiedBy).toBe('gl_account');
  });

  it('only counts assignments whose column appears in this result', () => {
    // gstin is assigned in another table's column not present in this result.
    const requires: Requirement[] = [{ any: ['gstin'], label: 'GSTIN' }];
    const r = evaluateRequirements(requires, result(['amount']), [
      assign('vendor_gstin', 'gstin'),
      assign('amount', 'amount'),
    ]);
    expect(r.ok).toBe(false);
  });

  it('multi-requirement: reports all missing', () => {
    const requires: Requirement[] = [
      { any: ['iso_date'], label: 'date' },
      { any: ['amount'], label: 'amount' },
      { any: ['vendor_name', 'gl_account'], label: 'vendor or account' },
    ];
    const r = evaluateRequirements(requires, result(['date_col']), [
      assign('date_col', 'iso_date'),
    ]);
    expect(r.ok).toBe(false);
    expect(r.missing.map((m) => m.label)).toEqual(['amount', 'vendor or account']);
  });
});

describe('blockReasonFor', () => {
  it('returns null when requirements satisfied and no custom check', () => {
    const sink = {
      id: 's',
      name: 's',
      description: 's',
      requires: [{ any: ['gstin'], label: 'GSTIN' }],
    };
    const reason = blockReasonFor(sink, result(['g']), [assign('g', 'gstin')]);
    expect(reason).toBeNull();
  });

  it('formats missing requirements as a "Need X + Y." sentence', () => {
    const sink = {
      id: 's',
      name: 's',
      description: 's',
      requires: [
        { any: ['iso_date'], label: 'date' },
        { any: ['amount'], label: 'amount' },
      ],
    };
    const reason = blockReasonFor(sink, result(['x']), [assign('x', null)]);
    expect(reason).toBe('Need date + amount.');
  });

  it('runs customBlockReason after requirements pass', () => {
    const sink = {
      id: 's',
      name: 's',
      description: 's',
      requires: [{ any: ['amount'], label: 'amount' }],
      customBlockReason: () => 'extra check failed',
    };
    const reason = blockReasonFor(sink, result(['amt']), [assign('amt', 'amount')]);
    expect(reason).toBe('extra check failed');
  });
});
