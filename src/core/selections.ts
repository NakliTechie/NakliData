// v1.3 M1 — Associative Cross-Filter selection state.
//
// Qlik's associative engine, reimplemented on DuckDB. Selection state
// is a workbook-scoped set of `(table, column) → values` triples.
// When the user clicks values in any result / pivot / chart cell,
// the selection updates and every OTHER visible cell bound to related
// data computes per-value states:
//
//   - SELECTED  — the value is in the selection set.
//   - ASSOCIATED — the value co-occurs in the data with at least one
//     selected value (the cross-filter signal).
//   - EXCLUDED  — the value exists in the data but never co-occurs
//     with the selection (the absence-as-signal). Rendered greyed,
//     not hidden — the data is still visible.
//
// **Engine-boundary contract (v1.3 M0):** no DOM, no FSA, no browser
// globals. Pure data + the compute primitive. The DuckDB query for
// "values that co-occur with the selection" lives in the UI binder
// because it takes an Engine handle.

export type ValueState = 'selected' | 'associated' | 'excluded' | 'neutral';

export interface SelectionKey {
  /** Mounted table identifier (matches `MountedSource.tables[].name`). */
  table: string;
  /** Column identifier (matches the table's column name). */
  column: string;
}

/** String form of a SelectionKey, for use as Map keys. */
export function selectionKeyString(k: SelectionKey): string {
  return `${k.table}::${k.column}`;
}

export interface SelectionEntry {
  table: string;
  column: string;
  /** The set of currently-selected values, stringified. */
  values: ReadonlyArray<string>;
}

export interface SelectionsFile {
  version: 1;
  entries: SelectionEntry[];
}

export function emptySelectionsFile(): SelectionsFile {
  return { version: 1, entries: [] };
}

/**
 * Compute per-value states for an array of values, given a selection
 * set AND a set of co-occurring values from the data (computed by the
 * caller via an anti-join / EXISTS query against the engine).
 *
 * The compute is split into pure primitive + impure I/O so the
 * primitive is unit-testable without an engine.
 *
 *   - values: the values rendered in the current cell's column.
 *   - selectedValues: values in the selection set for THIS column
 *     (if the cell's column is the selected one).
 *   - associatedValues: values for THIS column that co-occur with
 *     the selection in some other column. Caller pre-computes via
 *     `SELECT DISTINCT <col> FROM <table> WHERE <selected_col> IN (...)`.
 *
 * When `selectedValues` is empty AND `associatedValues` is empty,
 * every value is `'neutral'` — no selection is active that touches
 * this column.
 */
export function computeValueStates(
  values: ReadonlyArray<string>,
  selectedValues: ReadonlySet<string>,
  associatedValues: ReadonlySet<string>,
  /** True when an active selection exists somewhere in the workbook
   *  (used to distinguish "no selection at all" from "selection
   *  doesn't touch this column" — the latter still greys excluded
   *  values; the former leaves everything neutral). */
  selectionActive: boolean,
): Map<string, ValueState> {
  const out = new Map<string, ValueState>();
  for (const v of values) {
    if (selectedValues.has(v)) {
      out.set(v, 'selected');
      continue;
    }
    if (associatedValues.has(v)) {
      out.set(v, 'associated');
      continue;
    }
    if (!selectionActive) {
      out.set(v, 'neutral');
      continue;
    }
    out.set(v, 'excluded');
  }
  return out;
}

/**
 * Singleton store for selection state. Same pattern as
 * `lineage-store.ts` + `measures-store.ts` (observable + IDB-
 * compatible toFile/loadFromFile pair).
 */
export class SelectionsStore {
  private entries = new Map<string, Set<string>>();
  private listeners = new Set<(entries: ReadonlyArray<SelectionEntry>) => void>();

  /** Snapshot of all current selections, ordered by table then column. */
  list(): ReadonlyArray<SelectionEntry> {
    return Array.from(this.entries.entries())
      .map(([key, values]) => {
        const [table, column] = key.split('::');
        return { table: table ?? '', column: column ?? '', values: Array.from(values) };
      })
      .sort((a, b) => a.table.localeCompare(b.table) || a.column.localeCompare(b.column));
  }

  /** Total selected-value count across all entries. */
  size(): number {
    let n = 0;
    for (const set of this.entries.values()) n += set.size;
    return n;
  }

  /** True when any selection is active. */
  hasAny(): boolean {
    return this.entries.size > 0 && this.size() > 0;
  }

  /** Get the values for one (table, column) — empty set if none. */
  getValues(key: SelectionKey): ReadonlySet<string> {
    const set = this.entries.get(selectionKeyString(key));
    return set ?? new Set<string>();
  }

  /**
   * Toggle a value's membership in the selection for (table, column).
   * Returns true if the value is now SELECTED, false if cleared.
   */
  toggle(key: SelectionKey, value: string): boolean {
    const k = selectionKeyString(key);
    let set = this.entries.get(k);
    if (!set) {
      set = new Set<string>();
      this.entries.set(k, set);
    }
    if (set.has(value)) {
      set.delete(value);
      if (set.size === 0) this.entries.delete(k);
      this.notify();
      return false;
    }
    set.add(value);
    this.notify();
    return true;
  }

  /** Replace the entire value set for one (table, column). */
  setEntry(key: SelectionKey, values: ReadonlyArray<string>): void {
    const k = selectionKeyString(key);
    if (values.length === 0) {
      this.entries.delete(k);
    } else {
      this.entries.set(k, new Set(values));
    }
    this.notify();
  }

  /** Clear one (table, column) entry. */
  clearEntry(key: SelectionKey): void {
    if (this.entries.delete(selectionKeyString(key))) this.notify();
  }

  /** Clear EVERY selection. */
  clearAll(): void {
    if (this.entries.size === 0) return;
    this.entries.clear();
    this.notify();
  }

  /**
   * Replace the entire store from a `SelectionsFile` — used by the
   * `.naklidata` load path. v1 only.
   */
  loadFromFile(file: SelectionsFile | undefined): void {
    this.entries.clear();
    if (file && file.version === 1) {
      for (const e of file.entries) {
        if (e.values.length > 0) {
          this.entries.set(
            selectionKeyString({ table: e.table, column: e.column }),
            new Set(e.values),
          );
        }
      }
    }
    this.notify();
  }

  /** Snapshot to a `SelectionsFile` shape for serialisation. */
  toFile(): SelectionsFile {
    return { version: 1, entries: this.list() as SelectionEntry[] };
  }

  /** Subscribe to changes; returns an unsubscribe thunk. */
  subscribe(fn: (entries: ReadonlyArray<SelectionEntry>) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    const snapshot = this.list();
    for (const fn of this.listeners) fn(snapshot);
  }
}

let _store: SelectionsStore | null = null;

export function getSelectionsStore(): SelectionsStore {
  if (!_store) _store = new SelectionsStore();
  return _store;
}

/** Test-only: reset the singleton between tests. */
export function _resetSelectionsStoreForTests(): void {
  _store = null;
}

/**
 * Build the SQL fragment for the "values that co-occur with the
 * selection" query for one target (table, column). The caller wraps
 * this in `SELECT DISTINCT <col> FROM ...` and runs against the
 * engine.
 *
 * Returns null if no selection is active OR if every selected entry
 * targets a different table than `target.table` AND there are no
 * known relationships (caller layer handles relationship resolution
 * — this primitive only emits intra-table WHERE clauses).
 *
 * Identifier + literal safety: every identifier flows through
 * `quoteIdent`; every literal value through `quoteLiteral`.
 */
export function buildIntraTableSelectionPredicate(
  target: SelectionKey,
  selections: ReadonlyArray<SelectionEntry>,
): string | null {
  const sameTable = selections.filter((s) => s.table === target.table);
  if (sameTable.length === 0) return null;
  const clauses: string[] = [];
  for (const sel of sameTable) {
    if (sel.column === target.column) continue; // self-selection doesn't change the value set
    if (sel.values.length === 0) continue;
    const literals = sel.values.map(quoteLiteral).join(', ');
    clauses.push(`${quoteIdent(sel.column)} IN (${literals})`);
  }
  if (clauses.length === 0) return null;
  return clauses.join(' AND ');
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function quoteLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}
