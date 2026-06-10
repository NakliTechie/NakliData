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
import { getLineageStore } from '../core/lineage-store.ts';
import { extractInputsFromPlan, extractInputsFromSqlRegex } from '../core/lineage.ts';
import { iconSvg } from '../tokens/icons.ts';
import { renderAssertionCell } from './cells/assertion-cell.ts';
import { renderChartCell } from './cells/chart-cell.ts';
import { renderCohortCell } from './cells/cohort-cell.ts';
import { renderDashboardCell } from './cells/dashboard-cell.ts';
import { inputAsSqlLiteral, renderInputCell } from './cells/input-cell.ts';
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
  DashboardCellState,
  InputCellState,
  MapCellState,
  MarkdownCellState,
  PivotCellState,
  SqlCellState,
} from './cells/types.ts';
import { detectRefIssue, refIssueMessage } from './notebook-graph.ts';
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
    } else if (kind === 'input') {
      // Seed a named input cell. Without a name, downstream @ref
      // resolution can't reach it. Default to 'text' inputType + empty
      // value; the user picks a type and types a value.
      cell = {
        id: genCellId(),
        kind: 'input',
        order,
        name: `input_${order + 1}`,
        label: null,
        inputType: 'text',
        value: '',
        options: [],
      } satisfies InputCellState;
    } else if (kind === 'dashboard') {
      // Default 2-column dashboard, empty items list. The user fills
      // the items via the inline name list in the cell-head.
      cell = {
        id: genCellId(),
        kind: 'dashboard',
        order,
        name: null,
        columns: 2,
        items: [],
      } satisfies DashboardCellState;
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
    // M2 — drop the cell's lineage entry so the lineage panel doesn't
    // surface orphaned references. Downstream edges (cells that read
    // FROM this cell) clean up when those cells re-run.
    getLineageStore().removeCell(id);
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
    // Static @-graph check — catches self-references, cycles, and
    // unknown @names before DuckDB sees them. The engine would
    // otherwise surface an opaque "table cell_<id> not found" error
    // that doesn't say which cell or why. We patch a clean error
    // message and skip the run.
    //
    // Use the latest code (codeOverride) by mutating the in-memory
    // cell view for the check — patchCell is async-via-notify, but
    // the validator only reads `code` + `name`, so a synthetic
    // copy keeps it pure.
    const checkCells = this.state.cells.map((c) => (c.id === id ? { ...c, code } : c));
    const issue = detectRefIssue(id, checkCells);
    if (issue) {
      this.patchCell(id, {
        code,
        status: 'error',
        lastError: refIssueMessage(issue),
        lastResult: null,
      });
      return;
    }
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
      // M2 — Cell Lineage Tracker. Fire-and-forget after the result
      // ships; lineage failures must NOT regress the cell to error.
      void this.recordLineageForCell(id, code, rewritten).catch(() => {
        /* lineage extraction is best-effort */
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
    //
    // Cells with empty `code` are skipped silently. The notebook seeds a
    // single empty SQL cell on first mount as a "type here" affordance;
    // letting Run-all hit it surfaces a noisy DuckDB "syntax error at
    // end of input" that has nothing to do with the user's intent. This
    // matches what every notebook (Jupyter, Hex, Observable) does — the
    // "Run all" affordance treats empty cells as no-ops.
    // (Demo-verification finding 2026-05-31; see plan/pending.md.)
    for (const c of this.state.cells) {
      if (c.kind === 'sql' || c.kind === 'cohort' || c.kind === 'assertion') {
        if (!c.code.trim()) continue;
        await this.runCell(c.id);
      }
    }
  }

  /**
   * M2 — After a successful cell run, extract upstream lineage and
   * update the singleton lineage store. Best-effort: any failure here
   * (EXPLAIN parse error, plan-walk shape mismatch) falls back to
   * the regex extractor.
   *
   * The rewritten SQL (post-@name substitution to `cell_<id>`) is fed
   * to EXPLAIN so the plan walker sees the right views. The original
   * code is also captured for `@name` references that resolve to
   * cells that haven't run yet.
   */
  private async recordLineageForCell(
    cellId: string,
    originalCode: string,
    rewritten: string,
  ): Promise<void> {
    const store = getLineageStore();
    const cell = this.state.cells.find((c) => c.id === cellId);
    const cellLabel = cell?.name?.trim() || `cell_${cellId}`;

    // Try EXPLAIN first. The plan walker is robust to CTE shadowing +
    // FROM read_parquet().
    const plan = await this.engine.explainPlan(`SELECT * FROM (${rewritten})`);
    let inputs: ReturnType<typeof extractInputsFromPlan> = [];
    let confidence: 'high' | 'low' = 'high';
    if (plan) {
      inputs = extractInputsFromPlan(plan);
    } else {
      // Regex fallback — confidence: low. Pass the known table names
      // from the workbook so we don't false-positive on function calls.
      const known = await this.knownTableNames();
      inputs = extractInputsFromSqlRegex(rewritten, known);
      confidence = 'low';
    }

    // @name references — captured from the ORIGINAL code (before
    // rewriting). These add cell-to-cell edges that survive even
    // when the upstream cell hasn't yet executed (so EXPLAIN can't
    // see its view).
    const cellRefs: Array<{ refCellId: string; refLabel: string }> = [];
    for (const match of originalCode.matchAll(/@([A-Za-z_][A-Za-z0-9_]*)/g)) {
      const refName = match[1];
      if (!refName) continue;
      const upstream = this.state.cells.find((c) => c.name === refName);
      if (upstream) {
        cellRefs.push({ refCellId: upstream.id, refLabel: refName });
      }
    }

    store.setCellInputs({
      cellId,
      cellLabel,
      inputs,
      cellRefs,
      confidence,
    });
  }

  /** Snapshot of currently-mounted-source view names — used by the
   *  regex fallback to filter for real tables.
   *
   *  Reads from DuckDB's information_schema rather than the workbook
   *  so the fallback covers ad-hoc CREATE VIEW statements the user
   *  may have run.
   */
  private async knownTableNames(): Promise<Set<string>> {
    try {
      const rows = await this.engine.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'`,
      );
      return new Set(rows.map((r) => r.table_name));
    } catch {
      return new Set();
    }
  }

  /**
   * Rewrites @name references to the corresponding `cell_<id>` view
   * or — for W6.1 input cells — the cell's current value as a SQL
   * literal. Cycles aren't checked here; a SELECT against a not-yet-
   * existing view will surface as a DuckDB error inline.
   */
  private rewriteReferences(sql: string): string {
    return sql.replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (_m, name) => {
      // W6.1 — Input cells inline their `value` as a SQL literal
      // (text → quoted, number → bare, date → DATE 'YYYY-MM-DD').
      // Checked first so they shadow same-named SQL cells (which
      // would be a user error to have both anyway).
      const inputRef = this.state.cells.find(
        (c): c is InputCellState => c.kind === 'input' && c.name === name,
      );
      if (inputRef) return inputAsSqlLiteral(inputRef);
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
    else if (cell.kind === 'input') root.append(renderInputCell(cell, handlers));
    else if (cell.kind === 'dashboard') root.append(renderDashboardCell(cell, cells, handlers));
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
    <button class="btn" data-nb-action="add-input" title="Interactive parameter (text / number / date / dropdown). Reference via @name in downstream SQL.">${iconSvg('plus', 12)} Input</button>
    <button class="btn" data-nb-action="add-dashboard" title="Grid layout for markdown / chart / pivot / map cells. Type the cell names to embed.">${iconSvg('plus', 12)} Dashboard</button>
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
  addRow
    .querySelector('[data-nb-action="add-input"]')
    ?.addEventListener('click', () => notebook.addCell('input'));
  addRow
    .querySelector('[data-nb-action="add-dashboard"]')
    ?.addEventListener('click', () => notebook.addCell('dashboard'));
  // The "Ask in plain English" button is wired up in main.ts (it needs
  // workbook + engine context to gather the schema and insert the
  // generated cell). The button itself is rendered here so its
  // visibility tracks the rest of the add-row.
  root.append(addRow);
}
