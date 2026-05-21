// Workbook state + persistence round-trip for "Theme 4 wave 2" override
// rules. The end-to-end "remember → apply on new mount" path is covered
// by tests/e2e/override-rules.spec.ts; this file pins the pure logic.

import { describe, expect, it } from 'vitest';
import { type NakliDataFile, parse, serialize } from '../src/core/persistence.ts';
import { type OverrideRule, getWorkbook } from '../src/core/workbook.ts';

const RULE_A: OverrideRule = {
  columnName: 'vendor_id',
  typeId: 'gstin',
  created: '2026-05-21T10:00:00.000Z',
};

const RULE_B: OverrideRule = {
  columnName: 'cust_id',
  typeId: 'employee_id',
  created: '2026-05-21T11:00:00.000Z',
  note: 'seeded from invoices.cust_id',
};

describe('Workbook override-rule mutators', () => {
  it('starts with an empty rules list', () => {
    const wb = getWorkbook();
    wb.clear();
    expect(wb.get().overrideRules).toEqual([]);
  });

  it('addOverrideRule appends', () => {
    const wb = getWorkbook();
    wb.clear();
    wb.addOverrideRule(RULE_A);
    wb.addOverrideRule(RULE_B);
    expect(wb.get().overrideRules).toHaveLength(2);
    expect(wb.get().overrideRules[0]?.columnName).toBe('vendor_id');
  });

  it('addOverrideRule replaces by columnName (re-add is idempotent on key)', () => {
    const wb = getWorkbook();
    wb.clear();
    wb.addOverrideRule(RULE_A);
    wb.addOverrideRule({ ...RULE_A, typeId: 'pan' });
    expect(wb.get().overrideRules).toHaveLength(1);
    expect(wb.get().overrideRules[0]?.typeId).toBe('pan');
  });

  it('removeOverrideRule drops by columnName', () => {
    const wb = getWorkbook();
    wb.clear();
    wb.addOverrideRule(RULE_A);
    wb.addOverrideRule(RULE_B);
    wb.removeOverrideRule('vendor_id');
    expect(wb.get().overrideRules).toHaveLength(1);
    expect(wb.get().overrideRules[0]?.columnName).toBe('cust_id');
  });

  it('setOverrideRules replaces the whole list', () => {
    const wb = getWorkbook();
    wb.clear();
    wb.addOverrideRule(RULE_A);
    wb.setOverrideRules([RULE_B]);
    expect(wb.get().overrideRules).toEqual([RULE_B]);
  });

  it('clear() resets the rules list', () => {
    const wb = getWorkbook();
    wb.addOverrideRule(RULE_A);
    wb.clear();
    expect(wb.get().overrideRules).toEqual([]);
  });

  it('notifies subscribers on rule changes', () => {
    const wb = getWorkbook();
    wb.clear();
    let calls = 0;
    const unsub = wb.subscribe(() => calls++);
    wb.addOverrideRule(RULE_A);
    wb.removeOverrideRule(RULE_A.columnName);
    wb.setOverrideRules([RULE_B]);
    unsub();
    expect(calls).toBeGreaterThanOrEqual(3);
  });
});

describe('.naklidata serialize/parse round-trip for override rules', () => {
  it('serialize emits override_rules from input.overrideRules', () => {
    const file = serialize({
      notebookName: 'Untitled',
      sources: [],
      assignments: {},
      cells: [],
      autoAcceptThreshold: 0.9,
      overrideRules: [RULE_A, RULE_B],
    });
    expect(file.override_rules).toHaveLength(2);
    expect(file.override_rules?.[0]).toEqual(RULE_A);
  });

  it('serialize defaults override_rules to [] when omitted', () => {
    const file = serialize({
      notebookName: 'Untitled',
      sources: [],
      assignments: {},
      cells: [],
      autoAcceptThreshold: 0.9,
    });
    expect(file.override_rules).toEqual([]);
  });

  it('parse round-trips a file with override_rules', () => {
    const original = serialize({
      notebookName: 'Untitled',
      sources: [],
      assignments: {},
      cells: [],
      autoAcceptThreshold: 0.9,
      overrideRules: [RULE_A],
    });
    const text = JSON.stringify(original);
    const restored = parse(text);
    expect(restored.override_rules).toEqual([RULE_A]);
  });

  it('parse tolerates a legacy v1.0 file without override_rules', () => {
    // Hand-craft a v1.0 file that doesn't carry the field at all — we
    // expect parse() to succeed and the consumer (main.ts#applyLoadedFile)
    // to default to [] via `file.override_rules ?? []`.
    const legacy: Omit<NakliDataFile, 'override_rules'> & { override_rules?: undefined } = {
      format: 'naklidata',
      version: '1.0',
      created: '2026-05-17T00:00:00.000Z',
      modified: '2026-05-17T00:00:00.000Z',
      name: 'Untitled',
      sources: [],
      assignments: [],
      cells: [],
      user_types: [],
      settings: { auto_accept_threshold: 0.9 },
    };
    const restored = parse(JSON.stringify(legacy));
    expect(restored.override_rules ?? []).toEqual([]);
  });
});
