// In-memory workbook state — sources, tables, (later) cells. Single
// instance per tab. Subscribers are notified on any mutation.

import type { MountedSource } from './mount.ts';

export interface WorkbookState {
  sources: MountedSource[];
}

type Listener = (state: WorkbookState) => void;

class Workbook {
  private state: WorkbookState = { sources: [] };
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
    this.state = {
      ...this.state,
      sources: this.state.sources.filter((s) => s.id !== sourceId),
    };
    this.notify();
  }

  clear(): void {
    this.state = { sources: [] };
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
