// v1.3 M1 Phase 2 — associations (cross-table links) tests.
//
// Covers the store CRUD + round-trip, the effective-selection
// propagation that powers inter-cell cross-filter, and the auto-suggest
// pass (by taxonomy type + by column name).

import { describe, expect, it } from 'vitest';
import {
  type Association,
  AssociationsStore,
  emptyAssociationsFile,
  resolveEffectiveSelectionsForTable,
  suggestAssociations,
} from '../src/core/associations.ts';
import type { SelectionEntry } from '../src/core/selections.ts';

const k = (table: string, column: string) => ({ table, column });

describe('AssociationsStore — CRUD', () => {
  it('adds + lists a link', () => {
    const s = new AssociationsStore();
    expect(s.add(k('cell_a', 'gstin'), k('cell_b', 'vendor_gstin'))).toBe(true);
    expect(s.size()).toBe(1);
    expect(s.has(k('cell_a', 'gstin'), k('cell_b', 'vendor_gstin'))).toBe(true);
    // order-independent
    expect(s.has(k('cell_b', 'vendor_gstin'), k('cell_a', 'gstin'))).toBe(true);
  });

  it('ignores self-links + exact duplicates', () => {
    const s = new AssociationsStore();
    expect(s.add(k('cell_a', 'x'), k('cell_a', 'x'))).toBe(false);
    s.add(k('cell_a', 'x'), k('cell_b', 'y'));
    expect(s.add(k('cell_b', 'y'), k('cell_a', 'x'))).toBe(false); // reversed dup
    expect(s.size()).toBe(1);
  });

  it('removes a link order-independently', () => {
    const s = new AssociationsStore();
    s.add(k('cell_a', 'x'), k('cell_b', 'y'));
    expect(s.remove(k('cell_b', 'y'), k('cell_a', 'x'))).toBe(true);
    expect(s.size()).toBe(0);
  });

  it('round-trips through toFile / loadFromFile', () => {
    const s = new AssociationsStore();
    s.add(k('cell_a', 'x'), k('cell_b', 'y'));
    s.add(k('cell_b', 'y'), k('cell_c', 'z'));
    const file = s.toFile();
    const t = new AssociationsStore();
    t.loadFromFile(file);
    expect(t.size()).toBe(2);
    expect(t.has(k('cell_a', 'x'), k('cell_b', 'y'))).toBe(true);
  });

  it('emptyAssociationsFile is a valid v1 file', () => {
    expect(emptyAssociationsFile()).toEqual({ version: 1, links: [] });
  });

  it('subscribe fires on add / remove / clearAll / loadFromFile', () => {
    const s = new AssociationsStore();
    const sizes: number[] = [];
    s.subscribe((links) => sizes.push(links.length));
    s.add(k('a', 'x'), k('b', 'y'));
    s.remove(k('a', 'x'), k('b', 'y'));
    s.add(k('a', 'x'), k('b', 'y'));
    s.clearAll();
    s.loadFromFile({ version: 1, links: [{ a: k('c', 'p'), b: k('d', 'q') }] });
    expect(sizes).toEqual([1, 0, 1, 0, 1]);
  });
});

describe('resolveEffectiveSelectionsForTable (inter-cell propagation)', () => {
  const links: Association[] = [{ a: k('cell_a', 'gstin'), b: k('cell_b', 'vendor_gstin') }];

  it('returns no entries when nothing is selected', () => {
    expect(resolveEffectiveSelectionsForTable('cell_b', [], links)).toEqual([]);
  });

  it('propagates cell_a.gstin selection onto cell_b.vendor_gstin', () => {
    const sel: SelectionEntry[] = [{ table: 'cell_a', column: 'gstin', values: ['G1', 'G2'] }];
    const eff = resolveEffectiveSelectionsForTable('cell_b', sel, links);
    expect(eff).toEqual([{ table: 'cell_b', column: 'vendor_gstin', values: ['G1', 'G2'] }]);
  });

  it("keeps the table's own selection AND unions in propagated values", () => {
    const sel: SelectionEntry[] = [
      { table: 'cell_b', column: 'vendor_gstin', values: ['G2', 'G3'] },
      { table: 'cell_a', column: 'gstin', values: ['G1'] },
    ];
    const eff = resolveEffectiveSelectionsForTable('cell_b', sel, links);
    expect(eff).toHaveLength(1);
    expect(eff[0]?.column).toBe('vendor_gstin');
    expect([...(eff[0]?.values ?? [])].sort()).toEqual(['G1', 'G2', 'G3']);
  });

  it('follows the cluster transitively (a↔b↔c)', () => {
    const chain: Association[] = [
      { a: k('cell_a', 'id'), b: k('cell_b', 'id') },
      { a: k('cell_b', 'id'), b: k('cell_c', 'id') },
    ];
    const sel: SelectionEntry[] = [{ table: 'cell_a', column: 'id', values: ['7'] }];
    const eff = resolveEffectiveSelectionsForTable('cell_c', sel, chain);
    expect(eff).toEqual([{ table: 'cell_c', column: 'id', values: ['7'] }]);
  });

  it('leaves an unrelated table untouched', () => {
    const sel: SelectionEntry[] = [{ table: 'cell_a', column: 'gstin', values: ['G1'] }];
    expect(resolveEffectiveSelectionsForTable('cell_z', sel, links)).toEqual([]);
  });
});

describe('suggestAssociations', () => {
  it('suggests links between same taxonomy type across tables', () => {
    const cols = [
      { table: 'cell_a', column: 'gstin', typeId: 'gstin' },
      { table: 'cell_b', column: 'vendor_gstin', typeId: 'gstin' },
    ];
    const out = suggestAssociations(cols, []);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      a: k('cell_a', 'gstin'),
      b: k('cell_b', 'vendor_gstin'),
    });
  });

  it('suggests links between same-named columns across tables', () => {
    const cols = [
      { table: 'cell_a', column: 'vendor', typeId: null },
      { table: 'cell_b', column: 'vendor', typeId: null },
    ];
    expect(suggestAssociations(cols, [])).toHaveLength(1);
  });

  it('never suggests within the same table', () => {
    const cols = [
      { table: 'cell_a', column: 'gstin', typeId: 'gstin' },
      { table: 'cell_a', column: 'gstin2', typeId: 'gstin' },
    ];
    expect(suggestAssociations(cols, [])).toEqual([]);
  });

  it('excludes pairs that are already linked', () => {
    const cols = [
      { table: 'cell_a', column: 'gstin', typeId: 'gstin' },
      { table: 'cell_b', column: 'vendor_gstin', typeId: 'gstin' },
    ];
    const existing: Association[] = [
      { a: k('cell_b', 'vendor_gstin'), b: k('cell_a', 'gstin') }, // reversed
    ];
    expect(suggestAssociations(cols, existing)).toEqual([]);
  });

  it('does not match on a null type with different names', () => {
    const cols = [
      { table: 'cell_a', column: 'foo', typeId: null },
      { table: 'cell_b', column: 'bar', typeId: null },
    ];
    expect(suggestAssociations(cols, [])).toEqual([]);
  });
});
