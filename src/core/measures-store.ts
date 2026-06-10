// v1.3 M2 — Measures store (singleton, in-memory).
//
// Workbook-scoped state for the measures panel. Persists into
// `.naklidata` via the persistence layer.
//
// Engine boundary (v1.3 M0): no DOM, no FSA. The store is observable
// via a tiny subscribe API the same shape as the workbook store.

import { type MeasureDefinition, type MeasuresFile, emptyMeasuresFile } from './measures.ts';

export class MeasuresStore {
  private measures = new Map<string, MeasureDefinition>();
  private listeners = new Set<(measures: ReadonlyArray<MeasureDefinition>) => void>();

  /** Get every measure, ordered alphabetically by name. */
  list(): ReadonlyArray<MeasureDefinition> {
    return Array.from(this.measures.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Get one measure by name; undefined if not defined. */
  get(name: string): MeasureDefinition | undefined {
    return this.measures.get(name);
  }

  /** Snapshot the store as a read-only Map for the expander. */
  asMap(): ReadonlyMap<string, MeasureDefinition> {
    return this.measures;
  }

  /**
   * Upsert a measure by name. Replaces any existing definition with
   * the same name. Throws if `def.name` doesn't match
   * `[a-z_][a-z0-9_]*` — the UI is expected to validate first.
   */
  set(def: MeasureDefinition): void {
    if (!/^[a-z_][a-z0-9_]*$/.test(def.name)) {
      throw new Error(`Invalid measure name: ${def.name}`);
    }
    this.measures.set(def.name, def);
    this.notify();
  }

  /** Delete one measure by name. Idempotent. */
  remove(name: string): void {
    if (this.measures.delete(name)) this.notify();
  }

  /**
   * Replace the entire store contents from a `MeasuresFile` — used
   * by the `.naklidata` load path.
   */
  loadFromFile(file: MeasuresFile | undefined): void {
    this.measures.clear();
    if (file && file.version === 1) {
      for (const m of file.measures) {
        this.measures.set(m.name, m);
      }
    }
    this.notify();
  }

  /** Snapshot to a `MeasuresFile` shape for serialisation. */
  toFile(): MeasuresFile {
    return { version: 1, measures: this.list() as MeasureDefinition[] };
  }

  /** Subscribe to changes; returns an unsubscribe thunk. */
  subscribe(fn: (measures: ReadonlyArray<MeasureDefinition>) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    const snapshot = this.list();
    for (const fn of this.listeners) fn(snapshot);
  }
}

let _store: MeasuresStore | null = null;

export function getMeasuresStore(): MeasuresStore {
  if (!_store) _store = new MeasuresStore();
  return _store;
}

/** Test-only: reset the singleton between tests. */
export function _resetMeasuresStoreForTests(): void {
  _store = null;
}

export { emptyMeasuresFile };
export type { MeasureDefinition, MeasuresFile };
