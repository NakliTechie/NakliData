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

import { getDimensionsStore } from '../core/dimensions.ts';
import type { Engine } from '../core/engine.ts';
import { getLineageStore } from '../core/lineage-store.ts';
import {
  extractInputsFromPlan,
  extractInputsFromSqlRegex,
  mergeLineageInputs,
} from '../core/lineage.ts';
import { getMeasuresStore } from '../core/measures-store.ts';
import { expandMeasures } from '../core/measures.ts';
import { emptyReportDefinition } from '../core/report-layout.ts';
import { getSegmentsStore } from '../core/segments.ts';
import { iconSvg } from '../tokens/icons.ts';
import { renderAssertionCell } from './cells/assertion-cell.ts';
import { renderChartCell } from './cells/chart-cell.ts';
import { renderCohortCell } from './cells/cohort-cell.ts';
import { renderDashboardCell } from './cells/dashboard-cell.ts';
import { renderDistributionCell } from './cells/distribution-cell.ts';
import { renderEmbeddingCell } from './cells/embedding-cell.ts';
import { inputAsSqlLiteral, renderInputCell } from './cells/input-cell.ts';
import { renderMapCell } from './cells/map-cell.ts';
import { renderMarkdownCell } from './cells/markdown-cell.ts';
import { renderNetworkCell } from './cells/network-cell.ts';
import { renderPivotCell } from './cells/pivot-cell.ts';
import { renderReportCell } from './cells/report-cell.ts';
import { type SqlCellExtra, disposeSqlCellEditor, renderSqlCell } from './cells/sql-cell.ts';
import { renderStatsCell } from './cells/stats-cell.ts';
import { renderTemporalCell } from './cells/temporal-cell.ts';
import type {
  AssertionCellState,
  CellHandlers,
  CellState,
  ChartCellState,
  CohortCellState,
  DashboardCellState,
  DistributionCellState,
  EmbeddingCellState,
  InputCellState,
  MapCellState,
  MarkdownCellState,
  NetworkCellState,
  PivotCellState,
  ReportCellState,
  SqlCellState,
  StatsCellState,
  TemporalCellState,
} from './cells/types.ts';
import { detectRefIssue, refIssueMessage, topoOrderRunnableCells } from './notebook-graph.ts';
import { notebookCss } from './notebook.css.ts';

let _idSeq = 1;
const genCellId = () => `c_${Date.now().toString(36)}_${_idSeq++}`;

// Statements that return a result set but CANNOT be wrapped in
// `CREATE VIEW AS …` — they must be executed directly. Read-only
// introspection only; DDL/side-effecting statements stay on the
// view-wrap path (where they fail loudly, as intended). Real-data
// test finding #4: `SHOW TABLES` / `DESCRIBE` / `PRAGMA` otherwise
// surfaced a baffling "syntax error at or near SHOW".
const DIRECT_RUN_KEYWORDS = new Set(['SHOW', 'DESCRIBE', 'DESC', 'PRAGMA', 'EXPLAIN', 'SUMMARIZE']);

/** Leading SQL keyword, uppercased, after stripping leading comments/space. */
function leadingKeyword(sql: string): string {
  let s = sql.trimStart();
  // Peel any run of leading line (`--`) / block (`/* */`) comments.
  for (;;) {
    if (s.startsWith('--')) {
      const nl = s.indexOf('\n');
      s = nl === -1 ? '' : s.slice(nl + 1).trimStart();
      continue;
    }
    if (s.startsWith('/*')) {
      const end = s.indexOf('*/');
      s = end === -1 ? '' : s.slice(end + 2).trimStart();
      continue;
    }
    break;
  }
  const m = s.match(/^[a-zA-Z_]+/);
  return m ? m[0].toUpperCase() : '';
}

/** True when the statement must run directly rather than via a `cell_<id>` view. */
function isDirectRunStatement(sql: string): boolean {
  return DIRECT_RUN_KEYWORDS.has(leadingKeyword(sql));
}

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
    // SQL-backed cells unconditionally. Cohort + assertion cells render
    // via renderSqlCell too, so they hold CM6 editors keyed by the same
    // cell id and must be disposed here as well (forward-pass L12).
    for (const old of this.state.cells) {
      if (old.kind === 'sql' || old.kind === 'cohort' || old.kind === 'assertion') {
        disposeSqlCellEditor(old.id);
      }
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
    } else if (kind === 'embedding') {
      cell = {
        id: genCellId(),
        kind: 'embedding',
        order,
        name: null,
        inputCell: null,
        xCol: null,
        yCol: null,
        colorBy: null,
        labelCol: null,
        embCol: null,
      } satisfies EmbeddingCellState;
    } else if (kind === 'network') {
      cell = {
        id: genCellId(),
        kind: 'network',
        order,
        name: null,
        inputCell: null,
        sourceCol: null,
        targetCol: null,
        edgeColorCol: null,
        edgeWidthCol: null,
      } satisfies NetworkCellState;
    } else if (kind === 'temporal') {
      cell = {
        id: genCellId(),
        kind: 'temporal',
        order,
        name: null,
        inputCell: null,
        timeCol: null,
      } satisfies TemporalCellState;
    } else if (kind === 'distribution') {
      cell = {
        id: genCellId(),
        kind: 'distribution',
        order,
        name: null,
        inputCell: null,
        column: null,
      } satisfies DistributionCellState;
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
    } else if (kind === 'stats') {
      // v1.3 M4 — stats cell. Defaults bound to no input; user picks
      // an upstream SQL cell + clicks Run.
      cell = {
        id: genCellId(),
        kind: 'stats',
        order,
        name: null,
        inputCell: null,
        descriptives: null,
        correlations: null,
        status: 'idle',
        lastError: null,
      } satisfies StatsCellState;
    } else if (kind === 'report') {
      // v1.3 M3 — report cell. Defaults to an A4 empty report; user
      // adds items via JSON edits to definition.items for v1.
      cell = {
        id: genCellId(),
        kind: 'report',
        order,
        name: null,
        definition: emptyReportDefinition(),
      } satisfies ReportCellState;
    } else if (kind === 'chart') {
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
    } else {
      // Exhaustiveness guard (forward-pass M12). The if/else-if chain
      // covered every typed kind; `chart` used to be the unconditional
      // `else`, so a typo'd kind from a non-type-checked `data-nb-action`
      // string silently produced a chart cell. Now an unknown kind throws.
      const _exhaustive: never = kind;
      throw new Error(`addCell: unknown cell kind "${String(_exhaustive)}"`);
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
      // v1.3 M2 / v1.4 F1 — Expand MEASURE(name) + DIM(name) macros BEFORE
      // @-name rewriting so a measure/dimension expression that references
      // @cells still resolves those references in the second pass.
      const measuresMap = getMeasuresStore().asMap();
      const dimensionsMap = getDimensionsStore().asMap();
      const segmentsMap = getSegmentsStore().asMap();
      const measureExpanded = expandMeasures(code, measuresMap, dimensionsMap, segmentsMap);
      const unknownMacros = [
        ...measureExpanded.unknownMeasures.map((m) => `MEASURE(${m})`),
        ...measureExpanded.unknownDimensions.map((d) => `DIM(${d})`),
        ...measureExpanded.unknownSegments.map((s) => `SEGMENT(${s})`),
      ];
      if (unknownMacros.length > 0) {
        this.patchCell(id, {
          status: 'error',
          lastError: `Unknown ${unknownMacros.join(', ')}. Define them in the Semantic panel or remove the reference.`,
          lastResult: null,
        });
        return;
      }
      const rewritten = this.rewriteReferences(measureExpanded.sql);
      // Read-only introspection statements (SHOW / DESCRIBE / PRAGMA /
      // EXPLAIN / SUMMARIZE) can't be wrapped in `CREATE VIEW AS …` — that
      // wrap gave a confusing "syntax error at or near SHOW" (real-data
      // test finding #4). Run those directly and return their rows; skip
      // the view + lineage (nothing references an introspection cell).
      let rows: Array<Record<string, unknown>>;
      if (isDirectRunStatement(rewritten)) {
        rows = (await this.engine.query(rewritten, { signal: ac.signal })) as Array<
          Record<string, unknown>
        >;
      } else {
        const viewName = `cell_${id}`;
        await this.engine.exec(`CREATE OR REPLACE VIEW "${viewName}" AS ${rewritten}`);
        rows = (await this.engine.query(`SELECT * FROM "${viewName}"`, {
          signal: ac.signal,
        })) as Array<Record<string, unknown>>;
        // M2 — Cell Lineage Tracker. Fire-and-forget after the result
        // ships; lineage failures must NOT regress the cell to error.
        // Scan the MEASURE-expanded SQL (not the raw code) for @refs so a
        // measure whose body references @cells contributes those edges too
        // (forward-pass M5). Only meaningful for view-materialised cells.
        void this.recordLineageForCell(id, measureExpanded.sql, rewritten).catch(() => {
          /* lineage extraction is best-effort */
        });
      }
      const elapsed = performance.now() - t0;
      const columns = rows.length > 0 ? Object.keys(rows[0] as Record<string, unknown>) : [];
      this.patchCell(id, {
        status: 'success',
        lastResult: {
          columns,
          rows,
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
    // Run in @name-dependency (topological) order, not raw document order,
    // so a cell that references a @name defined LATER in the notebook
    // still runs after its input (forward-pass M14). Cycle-safe — cells in
    // a cycle fall back to document order and runCell's detectRefIssue
    // surfaces the cycle error.
    //
    // Cells with empty `code` are skipped silently. The notebook seeds a
    // single empty SQL cell on first mount as a "type here" affordance;
    // letting Run-all hit it surfaces a noisy DuckDB "syntax error at
    // end of input" that has nothing to do with the user's intent. This
    // matches what every notebook (Jupyter, Hex, Observable) does — the
    // "Run all" affordance treats empty cells as no-ops.
    // (Demo-verification finding 2026-05-31; see plan/pending.md.)
    const byId = new Map(this.state.cells.map((c) => [c.id, c]));
    for (const id of topoOrderRunnableCells(this.state.cells)) {
      const c = byId.get(id);
      if (!c || (c.kind !== 'sql' && c.kind !== 'cohort' && c.kind !== 'assertion')) continue;
      if (!c.code.trim()) continue;
      await this.runCell(id);
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
    // SQL with MEASURE() already expanded but @refs not yet rewritten —
    // scanning this captures @refs introduced by a measure body (M5).
    preRewriteSql: string,
    rewritten: string,
  ): Promise<void> {
    const store = getLineageStore();
    const cell = this.state.cells.find((c) => c.id === cellId);
    const cellLabel = cell?.name?.trim() || `cell_${cellId}`;

    // Try EXPLAIN first. The plan walker is robust to CTE shadowing +
    // FROM read_parquet().
    const plan = await this.engine.explainPlan(`SELECT * FROM (${rewritten})`);
    const known = await this.knownTableNames();
    let inputs: ReturnType<typeof extractInputsFromPlan> = [];
    let confidence: 'high' | 'low' = 'high';
    if (plan) {
      // The physical-plan walk catches base-table scans (Arrow-IPC mounts)
      // and inline file paths. But DuckDB inlines VIEWs at bind time, and
      // every CSV/JSON/Parquet/Iceberg source is mounted as a view
      // (engine.registerCsv et al.); the optimized physical plan discards
      // both the view name AND the underlying file path (duckdb-wasm 1.29.0
      // emits a bare `READ_CSV_AUTO` node with no File field). A plan-only
      // walk therefore records NO lineage for any view-backed source — the
      // empty-graph bug. Union in a catalog-filtered, CTE-aware SQL sniff to
      // recover those source names from the query text. The sniff's CTE
      // exclusion preserves the §M2 CTE-shadow guarantee even though it now
      // runs on a successful EXPLAIN (not just on parse failure).
      // See tests/lineage.test.ts — "live duckdb-wasm 1.29.0 plan" block.
      inputs = mergeLineageInputs(
        extractInputsFromPlan(plan),
        extractInputsFromSqlRegex(rewritten, known),
      );
    } else {
      // EXPLAIN itself errored (SQL didn't parse) — regex-only fallback,
      // confidence: low. `known` filters out function calls + typos.
      inputs = extractInputsFromSqlRegex(rewritten, known);
      confidence = 'low';
    }

    // @name references — captured from the pre-rewrite SQL (MEASURE()
    // already expanded, @refs not yet rewritten). These add cell-to-cell
    // edges that survive even when the upstream cell hasn't yet executed
    // (so EXPLAIN can't see its view), and now include @refs a measure
    // body introduced (M5).
    const cellRefs: Array<{ refCellId: string; refLabel: string }> = [];
    for (const match of preRewriteSql.matchAll(/@([A-Za-z_][A-Za-z0-9_]*)/g)) {
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
    else if (cell.kind === 'embedding') root.append(renderEmbeddingCell(cell, sqlCells, handlers));
    else if (cell.kind === 'network') root.append(renderNetworkCell(cell, sqlCells, handlers));
    else if (cell.kind === 'temporal') root.append(renderTemporalCell(cell, sqlCells, handlers));
    else if (cell.kind === 'distribution')
      root.append(renderDistributionCell(cell, sqlCells, handlers));
    else if (cell.kind === 'cohort') root.append(renderCohortCell(cell, handlers, sqlExtra));
    else if (cell.kind === 'assertion') root.append(renderAssertionCell(cell, handlers, sqlExtra));
    else if (cell.kind === 'input') root.append(renderInputCell(cell, handlers));
    else if (cell.kind === 'dashboard') root.append(renderDashboardCell(cell, cells, handlers));
    else if (cell.kind === 'stats') root.append(renderStatsCell(cell, cells, handlers));
    else if (cell.kind === 'report') root.append(renderReportCell(cell, handlers));
  }

  const addRow = document.createElement('div');
  addRow.className = 'cell-add-row';
  addRow.innerHTML = `
    <button class="btn" data-nb-action="add-sql">${iconSvg('plus', 12)} SQL</button>
    <button class="btn" data-nb-action="add-markdown">${iconSvg('plus', 12)} Markdown</button>
    <button class="btn" data-nb-action="add-chart">${iconSvg('plus', 12)} Chart</button>
    <button class="btn" data-nb-action="add-pivot">${iconSvg('plus', 12)} Pivot</button>
    <button class="btn" data-nb-action="add-map">${iconSvg('plus', 12)} Map</button>
    <button class="btn" data-nb-action="add-embedding" title="Semantic map — scatter precomputed x / y (e.g. an embedding projection) with colour + hover labels.">${iconSvg('plus', 12)} Embedding</button>
    <button class="btn" data-nb-action="add-network" title="Force graph — an edge list (source-id + target-id columns) laid out on the GPU; nodes sized by degree, click to highlight neighbours.">${iconSvg('plus', 12)} Network</button>
    <button class="btn" data-nb-action="add-temporal" title="Timeline — bucket a date / timestamp column into a histogram over time; drag to brush a window and count rows inside it.">${iconSvg('plus', 12)} Temporal</button>
    <button class="btn" data-nb-action="add-distribution" title="Distribution — summarize one column: numeric → histogram, categorical → top-value bars; click a bar to select it.">${iconSvg('plus', 12)} Distribution</button>
    <button class="btn" data-nb-action="add-cohort" title="A reusable user-id list. Reference via @cohort_name in downstream cells.">${iconSvg('plus', 12)} Cohort</button>
    <button class="btn" data-nb-action="add-assertion" title="SQL that should return 0 rows when an invariant holds. Any row → assertion fails.">${iconSvg('plus', 12)} Assertion</button>
    <button class="btn" data-nb-action="add-input" title="Interactive parameter (text / number / date / dropdown). Reference via @name in downstream SQL.">${iconSvg('plus', 12)} Input</button>
    <button class="btn" data-nb-action="add-dashboard" title="Grid layout for markdown / chart / pivot / map cells. Type the cell names to embed.">${iconSvg('plus', 12)} Dashboard</button>
    <button class="btn" data-nb-action="add-stats" title="Descriptive statistics + correlation matrix over an upstream cell's result.">${iconSvg('plus', 12)} Stats</button>
    <button class="btn" data-nb-action="add-report" title="Paginated report: KPI tiles + cell embeds. Print to PDF via the browser.">${iconSvg('plus', 12)} Report</button>
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
    .querySelector('[data-nb-action="add-embedding"]')
    ?.addEventListener('click', () => notebook.addCell('embedding'));
  addRow
    .querySelector('[data-nb-action="add-network"]')
    ?.addEventListener('click', () => notebook.addCell('network'));
  addRow
    .querySelector('[data-nb-action="add-temporal"]')
    ?.addEventListener('click', () => notebook.addCell('temporal'));
  addRow
    .querySelector('[data-nb-action="add-distribution"]')
    ?.addEventListener('click', () => notebook.addCell('distribution'));
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
  addRow
    .querySelector('[data-nb-action="add-stats"]')
    ?.addEventListener('click', () => notebook.addCell('stats'));
  addRow
    .querySelector('[data-nb-action="add-report"]')
    ?.addEventListener('click', () => notebook.addCell('report'));
  // The "Ask in plain English" button is wired up in main.ts (it needs
  // workbook + engine context to gather the schema and insert the
  // generated cell). The button itself is rendered here so its
  // visibility tracks the rest of the add-row.
  root.append(addRow);
}
