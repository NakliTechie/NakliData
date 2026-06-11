// v1.3 M1 Phase 2 — manual + auto associations (Qlik's cross-table links).
//
// An association declares that two `(table, column)` keys are the SAME
// logical field. Selecting values in one then cross-filters every cell
// bound to an associated column.
//
// **Compute model (DECISIONS AE):** the inter-cell cross-filter REUSES
// the intra-cell engine. An association just *propagates* a column's
// selected values onto its associated columns; each cell then paints
// from its own materialised rows via `computeValueStates`. No engine
// round-trip — same in-memory posture as the M1 grey-out.
//
// **Engine-boundary contract (v1.3 M0):** no DOM, no FSA, no browser
// globals. Pure data + the resolve/suggest primitives.

import type { SelectionEntry, SelectionKey } from './selections.ts';
import { selectionKeyString } from './selections.ts';

/** A bidirectional link declaring two columns are the same field. */
export interface Association {
  a: SelectionKey;
  b: SelectionKey;
}

export interface AssociationsFile {
  version: 1;
  links: Association[];
}

export function emptyAssociationsFile(): AssociationsFile {
  return { version: 1, links: [] };
}

/** Order-independent canonical key for a link (so a↔b == b↔a). */
function linkKey(l: Association): string {
  const ka = selectionKeyString(l.a);
  const kb = selectionKeyString(l.b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

/**
 * Compute the EFFECTIVE selection entries for one table: the table's own
 * selections, UNIONED with values selected on any column transitively
 * associated with one of this table's columns.
 *
 * This is the whole inter-cell cross-filter: for a target column `col`
 * of `table`, walk the association graph from `(table, col)`, collect
 * every selected value across the reachable cluster (in any table), and
 * emit a synthetic `SelectionEntry { table, column: col, values }`. The
 * caller feeds the result straight to `computeIntraCellValueStates`,
 * which then paints the cell from its own rows. Pure.
 */
export function resolveEffectiveSelectionsForTable(
  table: string,
  allSelections: ReadonlyArray<SelectionEntry>,
  links: ReadonlyArray<Association>,
): SelectionEntry[] {
  // Selected values indexed by key string.
  const selByKey = new Map<string, ReadonlySet<string>>();
  for (const s of allSelections) {
    if (s.values.length > 0) selByKey.set(selectionKeyString(s), new Set(s.values));
  }

  // Undirected adjacency over the link graph.
  const adj = new Map<string, Set<string>>();
  const connect = (x: string, y: string) => {
    (adj.get(x) ?? adj.set(x, new Set()).get(x))?.add(y);
    (adj.get(y) ?? adj.set(y, new Set()).get(y))?.add(x);
  };
  for (const l of links) connect(selectionKeyString(l.a), selectionKeyString(l.b));

  // Candidate columns of `table`: any with an own selection or a link.
  const cols = new Set<string>();
  for (const s of allSelections) if (s.table === table) cols.add(s.column);
  for (const l of links) {
    if (l.a.table === table) cols.add(l.a.column);
    if (l.b.table === table) cols.add(l.b.column);
  }

  const out: SelectionEntry[] = [];
  for (const col of cols) {
    const start = selectionKeyString({ table, column: col });
    // BFS the cluster; union every selected value reachable.
    const seen = new Set([start]);
    const queue = [start];
    const values = new Set<string>();
    while (queue.length > 0) {
      const k = queue.shift();
      if (k === undefined) continue;
      for (const v of selByKey.get(k) ?? []) values.add(v);
      for (const n of adj.get(k) ?? []) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    if (values.size > 0) out.push({ table, column: col, values: Array.from(values) });
  }
  return out;
}

/** Column descriptor for the auto-suggest pass. */
export interface AssocColumn {
  table: string;
  column: string;
  /** Resolved taxonomy type id, if the column was classified. */
  typeId?: string | null;
}

/**
 * Propose associations between columns in DIFFERENT tables that look
 * like the same field — same non-null taxonomy `typeId`, OR (failing a
 * type match) the same column name. Excludes pairs already linked and
 * same-table pairs. Deterministic order; deduped by canonical link key.
 */
export function suggestAssociations(
  columns: ReadonlyArray<AssocColumn>,
  existing: ReadonlyArray<Association>,
): Association[] {
  const have = new Set(existing.map(linkKey));
  const out = new Map<string, Association>();
  for (let i = 0; i < columns.length; i++) {
    for (let j = i + 1; j < columns.length; j++) {
      const x = columns[i];
      const y = columns[j];
      if (!x || !y) continue;
      if (x.table === y.table) continue;
      const sameType = !!x.typeId && !!y.typeId && x.typeId === y.typeId;
      const sameName = x.column === y.column;
      if (!sameType && !sameName) continue;
      const link: Association = {
        a: { table: x.table, column: x.column },
        b: { table: y.table, column: y.column },
      };
      const key = linkKey(link);
      if (have.has(key) || out.has(key)) continue;
      out.set(key, link);
    }
  }
  return Array.from(out.values());
}

/**
 * Singleton store for associations. Same observable + IDB-compatible
 * shape as `SelectionsStore` / `lineage-store` / `measures-store`.
 */
export class AssociationsStore {
  private links = new Map<string, Association>();
  private listeners = new Set<(links: ReadonlyArray<Association>) => void>();

  list(): ReadonlyArray<Association> {
    return Array.from(this.links.values());
  }

  size(): number {
    return this.links.size;
  }

  has(a: SelectionKey, b: SelectionKey): boolean {
    return this.links.has(linkKey({ a, b }));
  }

  /** Add a link. No-op for a self-link or an exact duplicate. Returns
   *  true when a new link was added. */
  add(a: SelectionKey, b: SelectionKey): boolean {
    if (a.table === b.table && a.column === b.column) return false;
    const link: Association = { a, b };
    const key = linkKey(link);
    if (this.links.has(key)) return false;
    this.links.set(key, link);
    this.notify();
    return true;
  }

  /** Remove a link (order-independent). Returns true when one was removed. */
  remove(a: SelectionKey, b: SelectionKey): boolean {
    const removed = this.links.delete(linkKey({ a, b }));
    if (removed) this.notify();
    return removed;
  }

  clearAll(): void {
    if (this.links.size === 0) return;
    this.links.clear();
    this.notify();
  }

  loadFromFile(file: AssociationsFile | undefined): void {
    this.links.clear();
    if (file && file.version === 1) {
      for (const l of file.links) {
        if (l.a.table === l.b.table && l.a.column === l.b.column) continue;
        this.links.set(linkKey(l), { a: l.a, b: l.b });
      }
    }
    this.notify();
  }

  toFile(): AssociationsFile {
    return { version: 1, links: this.list() as Association[] };
  }

  subscribe(fn: (links: ReadonlyArray<Association>) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    const snapshot = this.list();
    for (const fn of this.listeners) fn(snapshot);
  }
}

let _store: AssociationsStore | null = null;

export function getAssociationsStore(): AssociationsStore {
  if (!_store) _store = new AssociationsStore();
  return _store;
}
