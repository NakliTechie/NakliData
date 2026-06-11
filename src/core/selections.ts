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

/**
 * Value type of a selected column — drives type-correct SQL literal
 * emission in the cross-filter predicate (forward-pass H13). A numeric
 * column must emit `IN (42)`, not `IN ('42')`, or DuckDB compares a
 * number column against a string. Absent ⇒ treated as `'string'` for
 * back-compat with pre-H13 selections.
 */
export type SelectionValueType = 'string' | 'number' | 'date' | 'boolean';

export interface SelectionEntry {
  table: string;
  column: string;
  /** The set of currently-selected values, stringified. */
  values: ReadonlyArray<string>;
  /** Column value type. Optional; absent ⇒ `'string'`. */
  type?: SelectionValueType;
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
 * Compute per-(column, value) states for an intra-cell associative
 * cross-filter, over a single result's already-display-formatted rows.
 *
 * v1 scope is intra-cell (handoff §M1): the "table" is the cell's own
 * result, materialised in memory, so co-occurrence is computed in JS
 * over the rows — no engine round-trip. (Inter-cell association via
 * taxonomy-type matching is the documented Phase 2+ follow-up.)
 *
 * `selections` must already be filtered to THIS cell's table; when it
 * is empty (or holds only empty value sets) the function returns null
 * and the caller paints nothing / clears prior classes.
 *
 * For a target column T:
 *   - selected   — the value is in T's own selection set.
 *   - associated — T-values appearing in rows that satisfy EVERY other
 *     selected column's constraint (the cross-filter co-occurrence).
 *   - excluded   — T-values that never co-occur — greyed, not hidden.
 *
 * A selection on T itself does not constrain T's own associated set
 * (self-selection adds no cross-filter — mirrors the predicate builder,
 * which skips `sel.column === target.column`).
 *
 * Rows must be keyed by display text — the same text the UI renders and
 * stores as the selected value — so state lookups match by string.
 */
export function computeIntraCellValueStates(
  columns: ReadonlyArray<string>,
  rows: ReadonlyArray<Record<string, string>>,
  selections: ReadonlyArray<SelectionEntry>,
): Map<string, Map<string, ValueState>> | null {
  const selByCol = new Map<string, ReadonlySet<string>>();
  for (const s of selections) {
    if (s.values.length > 0) selByCol.set(s.column, new Set(s.values));
  }
  if (selByCol.size === 0) return null;

  const out = new Map<string, Map<string, ValueState>>();
  for (const col of columns) {
    const selected = selByCol.get(col) ?? new Set<string>();
    // Every OTHER selected column constrains this column's associated
    // set. A self-selection on `col` is excluded from the constraints.
    const constraints = Array.from(selByCol.entries()).filter(([c]) => c !== col);
    const allValues = new Set<string>();
    const associated = new Set<string>();
    for (const row of rows) {
      const v = row[col];
      if (v === undefined) continue;
      allValues.add(v);
      // The value co-occurs iff its row satisfies every other-column
      // constraint. With no other-column selection, `constraints` is
      // empty ⇒ every value co-occurs ⇒ nothing is excluded.
      let coOccurs = true;
      for (const [c, set] of constraints) {
        const rv = row[c];
        if (rv === undefined || !set.has(rv)) {
          coOccurs = false;
          break;
        }
      }
      if (coOccurs) associated.add(v);
    }
    out.set(col, computeValueStates(Array.from(allValues), selected, associated, true));
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
  /** Per-key column value type (H13). Only set when the caller knows it. */
  private types = new Map<string, SelectionValueType>();
  private listeners = new Set<(entries: ReadonlyArray<SelectionEntry>) => void>();

  /** Snapshot of all current selections, ordered by table then column. */
  list(): ReadonlyArray<SelectionEntry> {
    return Array.from(this.entries.entries())
      .map(([key, values]) => {
        const [table, column] = key.split('::');
        const type = this.types.get(key);
        const entry: SelectionEntry = {
          table: table ?? '',
          column: column ?? '',
          values: Array.from(values),
        };
        return type ? { ...entry, type } : entry;
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
  toggle(key: SelectionKey, value: string, type?: SelectionValueType): boolean {
    const k = selectionKeyString(key);
    let set = this.entries.get(k);
    if (!set) {
      set = new Set<string>();
      this.entries.set(k, set);
    }
    if (type) this.types.set(k, type);
    if (set.has(value)) {
      set.delete(value);
      if (set.size === 0) {
        this.entries.delete(k);
        this.types.delete(k);
      }
      this.notify();
      return false;
    }
    set.add(value);
    this.notify();
    return true;
  }

  /** Replace the entire value set for one (table, column). */
  setEntry(key: SelectionKey, values: ReadonlyArray<string>, type?: SelectionValueType): void {
    const k = selectionKeyString(key);
    if (values.length === 0) {
      this.entries.delete(k);
      this.types.delete(k);
    } else {
      this.entries.set(k, new Set(values));
      if (type) this.types.set(k, type);
    }
    this.notify();
  }

  /** Clear one (table, column) entry. */
  clearEntry(key: SelectionKey): void {
    const k = selectionKeyString(key);
    const had = this.entries.delete(k);
    this.types.delete(k);
    if (had) this.notify();
  }

  /** Clear EVERY selection. */
  clearAll(): void {
    if (this.entries.size === 0) return;
    this.entries.clear();
    this.types.clear();
    this.notify();
  }

  /**
   * Replace the entire store from a `SelectionsFile` — used by the
   * `.naklidata` load path. v1 only.
   */
  loadFromFile(file: SelectionsFile | undefined): void {
    this.entries.clear();
    this.types.clear();
    if (file && file.version === 1) {
      for (const e of file.entries) {
        if (e.values.length > 0) {
          const k = selectionKeyString({ table: e.table, column: e.column });
          this.entries.set(k, new Set(e.values));
          if (e.type) this.types.set(k, e.type);
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
    // Emit type-correct literals (H13): numeric/boolean/date columns get
    // bare/typed literals, not quoted strings. Values that don't fit the
    // declared type are dropped (defensive — same posture as the query
    // builder); a clause with no surviving literals is skipped entirely.
    const literals = sel.values
      .map((v) => emitSelectionLiteral(sel.type ?? 'string', v))
      .filter((lit): lit is string => lit !== null);
    if (literals.length === 0) continue;
    clauses.push(`${quoteIdent(sel.column)} IN (${literals.join(', ')})`);
  }
  if (clauses.length === 0) return null;
  return clauses.join(' AND ');
}

/**
 * Emit a single SQL literal for a selected value, type-correct for the
 * column. Returns null when the value can't be represented as the
 * declared type (so the caller drops it).
 */
function emitSelectionLiteral(type: SelectionValueType, value: string): string | null {
  if (type === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? String(n) : null;
  }
  if (type === 'boolean') {
    if (value === 'true') return 'TRUE';
    if (value === 'false') return 'FALSE';
    return null;
  }
  if (type === 'date') {
    // ISO `YYYY-MM-DD` → a typed DATE literal; anything else falls back to
    // a quoted string (DuckDB casts in comparison context).
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `DATE '${value.replace(/'/g, "''")}'`;
    return quoteLiteral(value);
  }
  return quoteLiteral(value);
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function quoteLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}
