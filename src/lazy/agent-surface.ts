// Agent surfaces — the LAZY host implementation (Chunk 2 binder, moved off the
// shell in the Chunks 4-7 run to reclaim bundle headroom). The thin shell stub
// (`src/ui/agent-bridge.ts`) binds `window.naklidata` to proxies that load this
// chunk on the first verb call; the pure registry + read-only validator ride
// here with it, out of the inlined bundle.
//
// CRITICAL: this chunk must NOT import the workbook / taxonomy STORE SINGLETONS
// (`getWorkbook`, `getTaxonomyClient`). A self-contained chunk would bundle its
// OWN copies and diverge from the shell's live instances (the footgun that
// retired the measures-panel chunk — see lazy-loader.ts). Instead the shell
// INJECTS accessors (`getWorkbookState`, `getBundle`) that read its singletons.
// Only pure, stateless modules (registry, sql-validator, the taxonomy resolvers)
// are imported here — safe to duplicate because they hold no state.
//
// The three safety properties (DECISIONS EE) live here at the boundary:
//   - 0a: query() validates every SQL (read-only, scoped to the mounted tables)
//     before the engine runs it; writes are proposals.
//   - 0b: proposeCell/runCell gated on `writesEnabled()`; reads always on.
//   - 0c: query() redacts output columns whose sensitivity tier is not public;
//     describe() returns schema+semantics with no values (query is the redacted
//     value path).

import {
  type AgentHost,
  type AgentTool,
  type CellSummary,
  type DescribeResult,
  type DescribedColumn,
  type DescribedTable,
  type QueryResult,
  type TableSummary,
  buildAgentTools,
  dispatchAgentTool,
} from '../core/agent/registry.ts';
import { validateReadOnlySql } from '../core/agent/sql-validator.ts';
import type { Engine } from '../core/engine.ts';
import type { WorkbookState } from '../core/workbook.ts';
import type { TaxonomyBundle, TypeSensitivity } from '../taxonomy/types.ts';
import {
  hasSensitivityLayer,
  sensitivityForType,
  universalTermForType,
} from '../taxonomy/universal.ts';
import type { Notebook } from '../ui/notebook.ts';

/** Cap on rows returned to an agent — enough to be useful, bounded so a verb
 *  can't flood the caller's context with a whole table. */
const AGENT_QUERY_ROW_CAP = 1000;

/** Assignment key format — mirrors `assignmentKey` in schema-panel.ts (kept
 *  inline to avoid pulling the schema panel into this chunk). */
const assignmentKey = (sourceId: string, tableId: string, columnName: string): string =>
  `${sourceId}::${tableId}::${columnName}`;

export interface AgentSurfaceDeps {
  engine: Engine;
  notebook: Notebook;
  /** Live read of the `agentWritesEnabled` setting (the 0b gate). */
  isWritesEnabled: () => boolean;
  /** Live read of the shell's Workbook singleton state (injected, NOT imported —
   *  see the module header on singleton divergence). */
  getWorkbookState: () => WorkbookState;
  /** Live read of the shell's taxonomy bundle (injected). */
  getBundle: () => TaxonomyBundle | null;
}

/** Sensitivity ranking — higher is stricter, so the "worst tier wins" when a
 *  column name maps to more than one classification. */
const TIER_RANK: Record<TypeSensitivity, number> = { public: 0, financial: 1, pii: 2, secret: 3 };

function stricter(a: TypeSensitivity | undefined, b: TypeSensitivity): TypeSensitivity {
  if (!a) return b;
  return TIER_RANK[b] > TIER_RANK[a] ? b : a;
}

/**
 * Build the `AgentHost` — the capability surface the registry verbs orchestrate.
 * Reads the live workbook/engine/notebook on every call (never a stale snapshot).
 */
export function createAgentHost(deps: AgentSurfaceDeps): AgentHost {
  const workbook = () => deps.getWorkbookState();
  const bundle = () => deps.getBundle();

  /** Lowercased names of every mounted table — the validator's allow-set. */
  function allowedTableNames(): Set<string> {
    const names = new Set<string>();
    for (const src of workbook().sources) {
      for (const t of src.tables) names.add(t.name.toLowerCase());
    }
    return names;
  }

  /** Lowercased column name → strictest non-public sensitivity tier across all
   *  classified columns. Drives output redaction (0c). Empty when no sensitivity
   *  layer is loaded (redaction then can't apply — describe flags this). */
  function sensitiveColumns(): Map<string, TypeSensitivity> {
    const map = new Map<string, TypeSensitivity>();
    const b = bundle();
    if (!b || !hasSensitivityLayer(b)) return map;
    const { assignments } = workbook();
    for (const key of Object.keys(assignments)) {
      const a = assignments[key];
      const typeId = a?.assigned?.typeId;
      if (!a || !typeId) continue;
      const tier = sensitivityForType(b, typeId);
      if (tier === 'public') continue;
      const col = a.columnName.toLowerCase();
      map.set(col, stricter(map.get(col), tier));
    }
    return map;
  }

  async function describe(): Promise<DescribeResult> {
    const b = bundle();
    const layerLoaded = b ? hasSensitivityLayer(b) : false;
    const { assignments } = workbook();
    const tables: DescribedTable[] = [];
    for (const src of workbook().sources) {
      for (const t of src.tables) {
        let columns: DescribedColumn[] = [];
        try {
          const described = await deps.engine.query<{ column_name: string; column_type: string }>(
            `DESCRIBE ${quoteIdent(t.name)}`,
          );
          columns = described.map((row) => {
            const name = String(row.column_name);
            const a = assignments[assignmentKey(src.id, t.id, name)];
            const typeId = a?.assigned?.typeId ?? null;
            const sensitivity: TypeSensitivity =
              b && typeId ? sensitivityForType(b, typeId) : 'public';
            const term = b && typeId ? universalTermForType(b, typeId) : null;
            return {
              name,
              sqlType: String(row.column_type),
              typeId,
              sensitivity,
              universalTerm: term ? term.id : null,
              // v1: describe carries NO values (schema + semantics only). The
              // value path is `query`, redacted by tier (0c). The field is here
              // for when per-column public-sampling lands.
              sampleValues: null,
            };
          });
        } catch {
          // A table that won't DESCRIBE (mid-mount, dropped) contributes no
          // columns rather than failing the whole describe.
          columns = [];
        }
        tables.push({
          sourceId: src.id,
          tableId: t.id,
          name: t.name,
          rowCount: t.rowCount ?? null,
          columns,
        });
      }
    }
    return { tables, taxonomyVersion: b?.version ?? null, sensitivityLayerLoaded: layerLoaded };
  }

  function listTables(): TableSummary[] {
    const { assignments } = workbook();
    const out: TableSummary[] = [];
    for (const src of workbook().sources) {
      for (const t of src.tables) {
        const prefix = `${src.id}::${t.id}::`;
        const columnCount = Object.keys(assignments).filter((k) => k.startsWith(prefix)).length;
        out.push({
          sourceId: src.id,
          tableId: t.id,
          name: t.name,
          rowCount: t.rowCount ?? null,
          columnCount,
        });
      }
    }
    return out;
  }

  function listCells(): CellSummary[] {
    return deps.notebook.get().cells.map((c) => ({
      id: c.id,
      kind: c.kind,
      name: c.name ?? null,
      code:
        'code' in c && typeof (c as { code?: unknown }).code === 'string'
          ? (c as { code: string }).code
          : null,
    }));
  }

  async function query(sql: string): Promise<QueryResult> {
    const verdict = validateReadOnlySql(sql, { allowedTables: allowedTableNames() });
    if (!verdict.ok) throw new Error(verdict.reason);

    // Row cap. SELECT/WITH wrap cleanly in a bounding subquery; the FROM-first /
    // TABLE / VALUES / DESCRIBE forms run as-is and are sliced in JS.
    const wrappable = /^\s*(select|with)\b/i.test(sql);
    const runSql = wrappable
      ? `SELECT * FROM (${sql}) AS _agent_scope LIMIT ${AGENT_QUERY_ROW_CAP}`
      : sql;
    const raw = await deps.engine.query(runSql);
    const rows = raw.slice(0, AGENT_QUERY_ROW_CAP) as Array<Record<string, unknown>>;
    const columns = rows.length > 0 ? Object.keys(rows[0] as object) : [];

    // Redact output columns whose name maps to a non-public classified column
    // (0c). Name-based: over-redacts a same-named public column rather than
    // under-redacting a sensitive one — the safer default.
    const sensitive = sensitiveColumns();
    const redactedColumns = columns.filter((c) => sensitive.has(c.toLowerCase()));
    if (redactedColumns.length > 0) {
      for (const row of rows) {
        for (const c of redactedColumns) {
          const tier = sensitive.get(c.toLowerCase());
          row[c] = `[redacted:${tier}]`;
        }
      }
    }
    return { columns, rows, rowCount: rows.length, redactedColumns };
  }

  async function proposeCell(sql: string): Promise<{ id: string; sql: string; editable: true }> {
    const cell = deps.notebook.addCell('sql');
    // Set the code + re-render so the proposed cell SHOWS the SQL, un-run.
    deps.notebook.patchCell(cell.id, { code: sql });
    return { id: cell.id, sql, editable: true };
  }

  async function runCell(id: string): Promise<{ id: string; status: string }> {
    const exists = deps.notebook.get().cells.some((c) => c.id === id);
    if (!exists) throw new Error(`No cell with id "${id}".`);
    await deps.notebook.runCell(id);
    const cell = deps.notebook.get().cells.find((c) => c.id === id);
    const status =
      cell && 'status' in cell ? String((cell as { status?: unknown }).status) : 'unknown';
    return { id, status };
  }

  return {
    describe,
    listTables,
    listCells,
    query,
    proposeCell,
    runCell,
    writesEnabled: deps.isWritesEnabled,
  };
}

/** Minimal identifier quoting for the DESCRIBE calls in `describe`. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Tool catalogue (name/description/inputSchema/annotations) — for discovery /
 *  a WebMCP adapter. Built from the host so the metadata is authoritative. */
export type ToolCatalogue = Array<
  Pick<AgentTool, 'name' | 'description' | 'inputSchema' | 'annotations'>
>;

// The tool list is stable per session (deps don't change), so build once.
let _tools: AgentTool[] | null = null;
function tools(deps: AgentSurfaceDeps): AgentTool[] {
  _tools ??= buildAgentTools(createAgentHost(deps));
  return _tools;
}

/** Dispatch a verb by name. The shell's `window.naklidata.<verb>` proxies route
 *  here after loading this chunk. */
export function dispatch(deps: AgentSurfaceDeps, verb: string, input: unknown) {
  return dispatchAgentTool(tools(deps), verb, input);
}

/** The verb catalogue (WebMCP-shaped metadata). */
export function catalogue(deps: AgentSurfaceDeps): ToolCatalogue {
  return tools(deps).map(({ name, description, inputSchema, annotations }) => ({
    name,
    description,
    inputSchema,
    annotations,
  }));
}

/** Build the tool list for a WebMCP adapter (Chunk 7) — same tools, so the
 *  adapter and `window.naklidata` share one catalogue + one host. */
export function buildTools(deps: AgentSurfaceDeps): AgentTool[] {
  return tools(deps);
}
