// In-memory workbook state — sources, tables, column assignments, (later)
// cells. Single instance per tab. Subscribers are notified on any mutation.

import type { ColumnAssignment } from '../ui/schema-panel.ts';
import type { MountedSource } from './mount.ts';

/**
 * User-defined semantic type. Lives on the workbook (per `.naklidata`
 * file). When saved, joins the override menu alongside built-in
 * taxonomy types. Wave 1 doesn't re-run the classifier with user
 * types — that's a future enhancement.
 */
export interface UserType {
  id: string;
  display_name: string;
  category: string;
  regex: string;
  /** ISO timestamp; informational only. */
  created: string;
  /** Free-form note (e.g., the column it was seeded from). */
  note?: string;
}

export interface WorkbookState {
  sources: MountedSource[];
  /** Keyed by `${sourceId}::${tableId}::${columnName}`. */
  assignments: Record<string, ColumnAssignment>;
  autoAcceptThreshold: number;
  /** User-defined semantic types — local to this workbook. */
  userTypes: UserType[];
}

type Listener = (state: WorkbookState) => void;

class Workbook {
  private state: WorkbookState = {
    sources: [],
    assignments: {},
    autoAcceptThreshold: 0.9,
    userTypes: [],
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
    this.state = {
      sources: [],
      assignments: {},
      autoAcceptThreshold: 0.9,
      userTypes: [],
    };
    this.notify();
  }

  addUserType(type: UserType): void {
    // Replace if id collides — caller is responsible for picking a fresh id.
    const filtered = this.state.userTypes.filter((t) => t.id !== type.id);
    this.state = { ...this.state, userTypes: [...filtered, type] };
    this.notify();
  }

  removeUserType(id: string): void {
    this.state = {
      ...this.state,
      userTypes: this.state.userTypes.filter((t) => t.id !== id),
    };
    this.notify();
  }

  setUserTypes(types: UserType[]): void {
    this.state = { ...this.state, userTypes: [...types] };
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
