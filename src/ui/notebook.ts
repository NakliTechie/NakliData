// Notebook orchestrator. Renders cells, owns run() per cell against the
// engine, and resolves @cellName references via DuckDB views.
//
// Spec refs:
//   §3.3 — cell types (SQL / chart / markdown)
//   §3.8 — keyboard (Cmd/Ctrl+Enter run; Cmd/Ctrl+Shift+Enter run all)
//   §3.8 — Esc cancel
//
// Cells form a DAG by @cellName references; on run we replace @name with
// the saved view `cell_<id>` for the named cell, having created that view
// in the previous successful run.

import type { Engine } from '../core/engine.ts';
import { iconSvg } from '../tokens/icons.ts';
import { renderAssertionCell } from './cells/assertion-cell.ts';
import { renderChartCell } from './cells/chart-cell.ts';
import { renderCohortCell } from './cells/cohort-cell.ts';
import { renderMapCell } from './cells/map-cell.ts';
import { renderMarkdownCell } from './cells/markdown-cell.ts';
import { renderPivotCell } from './cells/pivot-cell.ts';
import { type SqlCellExtra, disposeSqlCellEditor, renderSqlCell } from './cells/sql-cell.ts';
import type {
  AssertionCellState,
  CellHandlers,
  CellState,
  ChartCellState,
  CohortCellState,
  MapCellState,
  MarkdownCellState,
  PivotCellState,
  SqlCellState,
} from './cells/types.ts';
import { notebookCss } from './notebook.css.ts';

let _idSeq = 1;
const genCellId = () => `c_${Date.now().toString(36)}_${_idSeq++}`;

export interface NotebookState {
  cells: CellState[];
}

export class Notebook {
  private state: NotebookState = { cells: [] };
  private engine: Engine;
  private listeners = new Set<(s: NotebookState) => void>();
  private aborts = new Map<string, AbortController>();

  constructor(engine: Engine) {
    this.engine = engine;
  }

  get(): NotebookState {
    return this.state;
  }

  subscribe(fn: (s: NotebookState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  load(cells: CellState[]): void {
    // Dispose any CM6 instances attached to cells we're replacing so the
    // EditorViews don't leak across .naklidata loads + session switches.
    // Cell ids are timestamp-prefixed (see genCellId) so the incoming
    // set never collides with the outgoing set — we can dispose all old
    // SQL cells unconditionally.
    for (const old of this.state.cells) {
      if (old.kind === 'sql') disposeSqlCellEditor(old.id);
    }
    this.state = { cells };
    this.notify();
  }

  addCell(kind: CellState['kind']): CellState {
    const order = this.state.cells.length;
    let cell: CellState;
    if (kind === 'sql') {
      cell = {
        id: genCellId(),
        kind: 'sql',
        order,
        name: null,
        code: '',
        status: 'idle',
        lastError: null,
        lastResult: null,
        pinned: false,
      } satisfies SqlCellState;
    } else if (kind === 'markdown') {
      cell = {
        id: genCellId(),
        kind: 'markdown',
        order,
        name: null,
        code: '',
      } satisfies MarkdownCellState;
    } else if (kind === 'pivot') {
      cell = {
        id: genCellId(),
        kind: 'pivot',
        order,
        name: null,
        inputCell: null,
        rowCol: null,
        colCol: null,
        valueCol: null,
        agg: 'sum',
      } satisfies PivotCellState;
    } else if (kind === 'map') {
      cell = {
        id: genCellId(),
        kind: 'map',
        order,
        name: null,
        inputCell: null,
        geometryCol: null,
        colorBy: null,
      } satisfies MapCellState;
    } else if (kind === 'cohort') {
      cell = {
        id: genCellId(),
        kind: 'cohort',
        order,
        // Cohorts must be named to be reference-able via @name. Seed
        // a placeholder; user edits via the name input.
        name: `cohort_${order + 1}`,
        code: `-- Cohort: define the user set this template applies to.
-- Result must have a \`user_id\` column. Reference downstream via @cohort_${order + 1}.
SELECT DISTINCT user_id
FROM events  -- adjust to your event table
WHERE event_name = 'signup'  -- adjust to your criterion`,
        status: 'idle',
        lastError: null,
        lastResult: null,
      } satisfies CohortCellState;
    } else if (kind === 'assertion') {
      cell = {
        id: genCellId(),
        kind: 'assertion',
        order,
        name: `assertion_${order + 1}`,
        code: `-- Assertion: SQL that should return 0 rows when the invariant holds.
-- Any returned row is a counter-example; the cell goes red.
-- Adjust the SELECT to encode the invariant you want to enforce.
SELECT *
FROM invoices  -- adjust to your table
WHERE amount IS NULL OR amount < 0  -- adjust to your invariant
LIMIT 100`,
        status: 'idle',
        lastError: null,
        lastResult: null,
      } satisfies AssertionCellState;
    } else {
      cell = {
        id: genCellId(),
        kind: 'chart',
        order,
        name: null,
        inputCell: null,
        chartType: 'bar',
        x: null,
        y: null,
        facet: null,
      } satisfies ChartCellState;
    }
    this.state = { cells: [...this.state.cells, cell] };
    this.notify();
    return cell;
  }

  deleteCell(id: string): void {
    // Release the CM6 editor instance if any (the registry is per-cell-id).
    disposeSqlCellEditor(id);
    this.state = {
      cells: this.state.cells.filter((c) => c.id !== id),
    };
    this.notify();
  }

  patchCell(id: string, patch: Record<string, unknown>): void {
    const next = this.state.cells.map((c) => {
      if (c.id !== id) return c;
      return { ...c, ...patch } as CellState;
    });
    this.state = { cells: next };
    this.notify();
  }

  cancel(id: string): void {
    this.aborts.get(id)?.abort();
  }

  async runCell(id: string, codeOverride?: string): Promise<void> {
    const cell = this.state.cells.find((c) => c.id === id);
    // Cohort cells (W4.4) and assertion cells (W5.5) run the same
    // path as SQL cells — same view creation, same result shape;
    // only the rendered chrome differs.
    if (!cell || (cell.kind !== 'sql' && cell.kind !== 'cohort' && cell.kind !== 'assertion'))
      return;
    const code = codeOverride ?? cell.code;
    this.patchCell(id, { code, status: 'running', lastError: null });
    const ac = new AbortController();
    this.aborts.set(id, ac);
    const t0 = performance.now();
    try {
      const rewritten = this.rewriteReferences(code);
      const viewName = `cell_${id}`;
      await this.engine.exec(`CREATE OR REPLACE VIEW "${viewName}" AS ${rewritten}`);
      const rows = await this.engine.query(`SELECT * FROM "${viewName}"`, { signal: ac.signal });
      const elapsed = performance.now() - t0;
      const columns = rows.length > 0 ? Object.keys(rows[0] as Record<string, unknown>) : [];
      this.patchCell(id, {
        status: 'success',
        lastResult: {
          columns,
          rows: rows as Array<Record<string, unknown>>,
          rowCount: rows.length,
          elapsedMs: elapsed,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.patchCell(id, { status: 'error', lastError: msg, lastResult: null });
    } finally {
      this.aborts.delete(id);
    }
  }

  async runAll(): Promise<void> {
    // Topologically sort by @name dependencies — simple version: just run
    // in document order; cells reference views which are created by prior
    // cells, so document-order matches DAG order in the common case.
    for (const c of this.state.cells) {
      if (c.kind === 'sql' || c.kind === 'cohort' || c.kind === 'assertion') {
        await this.runCell(c.id);
      }
    }
  }

  /**
   * Rewrites @name references to the corresponding `cell_<id>` view.
   * Cycles aren't checked here; a SELECT against a not-yet-existing view
   * will surface as a DuckDB error inline.
   */
  private rewriteReferences(sql: string): string {
    return sql.replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (_m, name) => {
      // SQL, Cohort (W4.4), and Assertion (W5.5) cells all
      // materialise as `cell_<id>` views and are valid @-reference
      // targets — assertions are rarely referenced downstream but
      // there's no reason to forbid it.
      const ref = this.state.cells.find(
        (c) =>
          (c.kind === 'sql' || c.kind === 'cohort' || c.kind === 'assertion') && c.name === name,
      );
      if (!ref) return `"${name}"`;
      return `"cell_${ref.id}"`;
    });
  }

  private notify(): void {
    for (const fn of this.listeners) {
      try {
        fn(this.state);
      } catch (err) {
        console.error('[notebook] listener error', err);
      }
    }
  }
}

let _notebook: Notebook | null = null;
export function getNotebook(engine: Engine): Notebook {
  if (!_notebook) _notebook = new Notebook(engine);
  return _notebook;
}

export function injectNotebookCss(): void {
  if (document.getElementById('naklidata-notebook-css')) return;
  const tag = document.createElement('style');
  tag.id = 'naklidata-notebook-css';
  tag.textContent = notebookCss;
  document.head.appendChild(tag);
}

export function renderNotebook(
  mount: HTMLElement,
  notebook: Notebook,
  sqlExtra?: SqlCellExtra,
): void {
  injectNotebookCss();
  const cells = notebook.get().cells;
  const sqlCells = cells.filter((c): c is SqlCellState => c.kind === 'sql');

  const handlers: CellHandlers = {
    onRun: (id, payload) => {
      void notebook.runCell(id, payload?.code);
    },
    onChange: (id, patch) => {
      notebook.patchCell(id, patch as Partial<CellState>);
    },
    onDelete: (id) => {
      notebook.deleteCell(id);
    },
  };

  mount.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'notebook';
  mount.append(root);

  const toolbar = document.createElement('div');
  toolbar.className = 'notebook-toolbar';
  toolbar.innerHTML = `
    <strong style="font-size:13px;">Notebook</strong>
    <span style="color: var(--text-muted); font-size:12px;">${cells.length} cell${cells.length === 1 ? '' : 's'}</span>
    <div style="margin-left:auto;display:flex;gap:6px;">
      <button class="btn" data-nb-action="run-all" title="Run all (Ctrl+Shift+Enter)">${iconSvg('play', 12)} Run all</button>
    </div>
  `;
  toolbar.querySelector('[data-nb-action="run-all"]')?.addEventListener('click', () => {
    void notebook.runAll();
  });
  root.append(toolbar);

  for (const cell of cells) {
    if (cell.kind === 'sql') root.append(renderSqlCell(cell, handlers, sqlExtra));
    else if (cell.kind === 'markdown') root.append(renderMarkdownCell(cell, handlers));
    else if (cell.kind === 'chart') root.append(renderChartCell(cell, sqlCells, handlers));
    else if (cell.kind === 'pivot') root.append(renderPivotCell(cell, sqlCells, handlers));
    else if (cell.kind === 'map') root.append(renderMapCell(cell, sqlCells, handlers));
    else if (cell.kind === 'cohort') root.append(renderCohortCell(cell, handlers, sqlExtra));
    else if (cell.kind === 'assertion') root.append(renderAssertionCell(cell, handlers, sqlExtra));
  }

  const addRow = document.createElement('div');
  addRow.className = 'cell-add-row';
  addRow.innerHTML = `
    <button class="btn" data-nb-action="add-sql">${iconSvg('plus', 12)} SQL</button>
    <button class="btn" data-nb-action="add-markdown">${iconSvg('plus', 12)} Markdown</button>
    <button class="btn" data-nb-action="add-chart">${iconSvg('plus', 12)} Chart</button>
    <button class="btn" data-nb-action="add-pivot">${iconSvg('plus', 12)} Pivot</button>
    <button class="btn" data-nb-action="add-map">${iconSvg('plus', 12)} Map</button>
    <button class="btn" data-nb-action="add-cohort" title="A reusable user-id list. Reference via @cohort_name in downstream cells.">${iconSvg('plus', 12)} Cohort</button>
    <button class="btn" data-nb-action="add-assertion" title="SQL that should return 0 rows when an invariant holds. Any row → assertion fails.">${iconSvg('plus', 12)} Assertion</button>
    <button class="btn cell-sidecar-trigger" data-action="ask-nl-to-sql" title="Ask the sidecar to write a SQL cell from a plain-English question. Never auto-executed.">${iconSvg('info', 12)} Ask in plain English</button>
  `;
  addRow
    .querySelector('[data-nb-action="add-sql"]')
    ?.addEventListener('click', () => notebook.addCell('sql'));
  addRow
    .querySelector('[data-nb-action="add-markdown"]')
    ?.addEventListener('click', () => notebook.addCell('markdown'));
  addRow
    .querySelector('[data-nb-action="add-chart"]')
    ?.addEventListener('click', () => notebook.addCell('chart'));
  addRow
    .querySelector('[data-nb-action="add-pivot"]')
    ?.addEventListener('click', () => notebook.addCell('pivot'));
  addRow
    .querySelector('[data-nb-action="add-map"]')
    ?.addEventListener('click', () => notebook.addCell('map'));
  addRow
    .querySelector('[data-nb-action="add-cohort"]')
    ?.addEventListener('click', () => notebook.addCell('cohort'));
  addRow
    .querySelector('[data-nb-action="add-assertion"]')
    ?.addEventListener('click', () => notebook.addCell('assertion'));
  // The "Ask in plain English" button is wired up in main.ts (it needs
  // workbook + engine context to gather the schema and insert the
  // generated cell). The button itself is rendered here so its
  // visibility tracks the rest of the add-row.
  root.append(addRow);
}
