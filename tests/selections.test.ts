// v1.3 M1 — Associative Cross-Filter selection tests.
//
// Gate artifacts per handoff §M1:
//   - Selection round-trip via .naklidata (toFile / loadFromFile).
//   - The computeValueStates primitive correctly classifies values
//     into selected / associated / excluded / neutral.
//   - The intra-table predicate builder is injection-safe (every
//     identifier through quoteIdent; every literal through
//     quoteLiteral).

import { describe, expect, it } from 'vitest';
import {
  SelectionsStore,
  buildIntraTableSelectionPredicate,
  computeValueStates,
  emptySelectionsFile,
  selectionKeyString,
} from '../src/core/selections.ts';

describe('selectionKeyString', () => {
  it('joins table + column with double-colon', () => {
    expect(selectionKeyString({ table: 'orders', column: 'vendor_name' })).toBe(
      'orders::vendor_name',
    );
  });
});

describe('computeValueStates', () => {
  it('all neutral when no selection is active', () => {
    const states = computeValueStates(['a', 'b', 'c'], new Set(), new Set(), false);
    expect([...states.values()]).toEqual(['neutral', 'neutral', 'neutral']);
  });

  it('selected values flagged when selection touches this column', () => {
    const states = computeValueStates(['a', 'b', 'c'], new Set(['a']), new Set(), true);
    expect(states.get('a')).toBe('selected');
    expect(states.get('b')).toBe('excluded');
    expect(states.get('c')).toBe('excluded');
  });

  it('associated values flagged when they co-occur with the selection', () => {
    const states = computeValueStates(
      ['a', 'b', 'c'],
      new Set(), // this column itself isn't selected
      new Set(['a', 'b']), // a and b co-occur with the selection
      true,
    );
    expect(states.get('a')).toBe('associated');
    expect(states.get('b')).toBe('associated');
    expect(states.get('c')).toBe('excluded');
  });

  it('selected takes precedence over associated', () => {
    const states = computeValueStates(['a'], new Set(['a']), new Set(['a']), true);
    expect(states.get('a')).toBe('selected');
  });
});

describe('SelectionsStore — CRUD', () => {
  it('toggle adds + removes the value', () => {
    const store = new SelectionsStore();
    expect(store.toggle({ table: 'orders', column: 'vendor' }, 'Acme')).toBe(true);
    expect(store.getValues({ table: 'orders', column: 'vendor' }).has('Acme')).toBe(true);
    expect(store.toggle({ table: 'orders', column: 'vendor' }, 'Acme')).toBe(false);
    expect(store.getValues({ table: 'orders', column: 'vendor' }).has('Acme')).toBe(false);
  });

  it('toggle removes empty entries from the store', () => {
    const store = new SelectionsStore();
    store.toggle({ table: 'orders', column: 'vendor' }, 'Acme');
    store.toggle({ table: 'orders', column: 'vendor' }, 'Acme');
    expect(store.list()).toEqual([]);
  });

  it('setEntry replaces the whole value set for a key', () => {
    const store = new SelectionsStore();
    store.toggle({ table: 'orders', column: 'vendor' }, 'A');
    store.setEntry({ table: 'orders', column: 'vendor' }, ['B', 'C']);
    expect(Array.from(store.getValues({ table: 'orders', column: 'vendor' })).sort()).toEqual([
      'B',
      'C',
    ]);
  });

  it('setEntry with empty array clears the entry', () => {
    const store = new SelectionsStore();
    store.setEntry({ table: 'orders', column: 'vendor' }, ['A', 'B']);
    store.setEntry({ table: 'orders', column: 'vendor' }, []);
    expect(store.list()).toEqual([]);
  });

  it('clearAll wipes every selection', () => {
    const store = new SelectionsStore();
    store.toggle({ table: 'orders', column: 'vendor' }, 'A');
    store.toggle({ table: 'invoices', column: 'gstin' }, 'X');
    store.clearAll();
    expect(store.list()).toEqual([]);
  });

  it('hasAny + size reflect total selected values', () => {
    const store = new SelectionsStore();
    expect(store.hasAny()).toBe(false);
    expect(store.size()).toBe(0);
    store.toggle({ table: 'a', column: 'b' }, 'x');
    store.toggle({ table: 'a', column: 'b' }, 'y');
    store.toggle({ table: 'c', column: 'd' }, 'z');
    expect(store.hasAny()).toBe(true);
    expect(store.size()).toBe(3);
  });
});

describe('SelectionsStore — round-trip (handoff §M1 gate artifact)', () => {
  it('toFile + loadFromFile round-trips the same state', () => {
    const a = new SelectionsStore();
    a.toggle({ table: 'orders', column: 'vendor' }, 'Acme');
    a.toggle({ table: 'orders', column: 'vendor' }, 'Foo');
    a.toggle({ table: 'invoices', column: 'gstin' }, '12ABCDE3456F7Z8');
    const file = a.toFile();

    const b = new SelectionsStore();
    b.loadFromFile(file);

    expect(b.toFile()).toEqual(file);
    expect(b.size()).toBe(3);
  });

  it('emptySelectionsFile is a valid v1 file', () => {
    const file = emptySelectionsFile();
    expect(file.version).toBe(1);
    expect(file.entries).toEqual([]);
  });

  it('loadFromFile(undefined) clears the store', () => {
    const store = new SelectionsStore();
    store.toggle({ table: 'orders', column: 'vendor' }, 'Acme');
    store.loadFromFile(undefined);
    expect(store.list()).toEqual([]);
  });

  it('loadFromFile with v!=1 ignores the data', () => {
    const store = new SelectionsStore();
    store.loadFromFile({
      version: 99 as 1,
      entries: [{ table: 'a', column: 'b', values: ['x'] }],
    });
    expect(store.list()).toEqual([]);
  });

  it('subscribe fires on toggle / setEntry / clearAll / loadFromFile', () => {
    const store = new SelectionsStore();
    const sizes: number[] = [];
    store.subscribe((entries) => sizes.push(entries.length));
    store.toggle({ table: 'a', column: 'b' }, 'x');
    store.setEntry({ table: 'c', column: 'd' }, ['y']);
    store.clearAll();
    store.loadFromFile({
      version: 1,
      entries: [{ table: 'e', column: 'f', values: ['z'] }],
    });
    expect(sizes).toEqual([1, 2, 0, 1]);
  });
});

describe('buildIntraTableSelectionPredicate', () => {
  it('returns null when no selection touches the target table', () => {
    expect(
      buildIntraTableSelectionPredicate({ table: 'orders', column: 'vendor' }, [
        { table: 'invoices', column: 'gstin', values: ['X'] },
      ]),
    ).toBeNull();
  });

  it('emits a single-clause WHERE fragment for a single (other) column selection', () => {
    const pred = buildIntraTableSelectionPredicate({ table: 'orders', column: 'order_total' }, [
      { table: 'orders', column: 'vendor', values: ['Acme', 'Foo'] },
    ]);
    expect(pred).toBe(`"vendor" IN ('Acme', 'Foo')`);
  });

  it('emits AND-joined clauses across multiple other-column selections', () => {
    const pred = buildIntraTableSelectionPredicate({ table: 'orders', column: 'order_total' }, [
      { table: 'orders', column: 'vendor', values: ['Acme'] },
      { table: 'orders', column: 'status', values: ['completed', 'pending'] },
    ]);
    expect(pred).toBe(`"vendor" IN ('Acme') AND "status" IN ('completed', 'pending')`);
  });

  it('skips the target column itself (self-selection produces no constraint)', () => {
    const pred = buildIntraTableSelectionPredicate({ table: 'orders', column: 'vendor' }, [
      { table: 'orders', column: 'vendor', values: ['Acme'] },
    ]);
    expect(pred).toBeNull();
  });

  it('escapes hostile column names + literal values (injection guard)', () => {
    const pred = buildIntraTableSelectionPredicate({ table: 'orders', column: 'note' }, [
      { table: 'orders', column: `nasty"col`, values: [`'); DROP TABLE x; --`] },
    ]);
    expect(pred).toBe(`"nasty""col" IN ('''); DROP TABLE x; --')`);
    // The DROP TABLE token lives inside the quoted SQL literal, never
    // as a free SQL fragment.
  });
});
