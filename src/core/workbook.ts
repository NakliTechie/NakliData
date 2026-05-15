// In-memory workbook state — sources, tables, column assignments, (later)
// cells. Single instance per tab. Subscribers are notified on any mutation.

import type { ColumnAssignment } from '../ui/schema-panel.ts';
import type { MountedSource } from './mount.ts';

export interface WorkbookState {
  sources: MountedSource[];
  /** Keyed by `${sourceId}::${tableId}::${columnName}`. */
  assignments: Record<string, ColumnAssignment>;
  autoAcceptThreshold: number;
}

type Listener = (state: WorkbookState) => void;

class Workbook {
  private state: WorkbookState = {
    sources: [],
    assignments: {},
    autoAcceptThreshold: 0.9,
  };
  private listeners = new Set<Listener>();

  get(): WorkbookState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  addSources(sources: MountedSource[]): void {
    this.state = { ...this.state, sources: [...this.state.sources, ...sources] };
    this.notify();
  }

  removeSource(sourceId: string): void {
    const prefix = `${sourceId}::`;
    const assignments: Record<string, ColumnAssignment> = {};
    for (const [k, v] of Object.entries(this.state.assignments)) {
      if (!k.startsWith(prefix)) assignments[k] = v;
    }
    this.state = {
      ...this.state,
      sources: this.state.sources.filter((s) => s.id !== sourceId),
      assignments,
    };
    this.notify();
  }

  setAssignment(key: string, assignment: ColumnAssignment): void {
    this.state = {
      ...this.state,
      assignments: { ...this.state.assignments, [key]: assignment },
    };
    this.notify();
  }

  setAutoAcceptThreshold(v: number): void {
    this.state = { ...this.state, autoAcceptThreshold: v };
    this.notify();
  }

  clear(): void {
    this.state = { sources: [], assignments: {}, autoAcceptThreshold: 0.9 };
    this.notify();
  }

  hasMounts(): boolean {
    return this.state.sources.length > 0;
  }

  private notify(): void {
    for (const fn of this.listeners) {
      try {
        fn(this.state);
      } catch (err) {
        console.error('[workbook] listener error', err);
      }
    }
  }
}

let _workbook: Workbook | null = null;
export function getWorkbook(): Workbook {
  if (!_workbook) _workbook = new Workbook();
  return _workbook;
}
