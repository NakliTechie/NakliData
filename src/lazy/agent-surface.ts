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
//   - 0b: proposeCell gated on `writesEnabled()`; reads always on. No agent verb
//     executes a notebook cell.
//   - 0c: query() redacts output columns whose sensitivity tier is not public;
//     describe() returns schema+semantics with no values (query is the redacted
//     value path).

import { describeToMarkdown } from '../core/agent/data-dictionary.ts';
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
import { validateAgentValueProjection, validateReadOnlySql } from '../core/agent/sql-validator.ts';
import type { Engine } from '../core/engine.ts';
import type { DirectResultProjection } from '../core/result-snapshots.ts';
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

/**
 * Reuse the agent boundary's strict direct-projection proof for notebook result
 * provenance. This stays in the already-lazy agent chunk: the shell records
 * `null` if the chunk or proof is unavailable, which is the fail-closed state.
 */
export function traceDirectResultProjection(sql: string): DirectResultProjection | null {
  const projection = validateAgentValueProjection(sql);
  return projection.ok ? { tableName: projection.table, columns: projection.columns } : null;
}

export interface AgentSurfaceDeps {
  engine: Engine;
  notebook: Notebook;
  /** Live read of the legacy `agentWritesEnabled` proposal gate. */
  isWritesEnabled: () => boolean;
  /** Live read of the shell's Workbook singleton state (injected, NOT imported —
   *  see the module header on singleton divergence). */
  getWorkbookState: () => WorkbookState;
  /** Live read of the shell's taxonomy bundle (injected). */
  getBundle: () => TaxonomyBundle | null;
}

type AgentColumnSensitivity = TypeSensitivity | 'unclassified' | 'unavailable';

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
            const term = b && typeId ? universalTermForType(b, typeId) : null;
            const sensitivity: AgentColumnSensitivity =
              !b || !hasSensitivityLayer(b)
                ? 'unavailable'
                : !typeId || !term
                  ? 'unclassified'
                  : sensitivityForType(b, typeId);
            return {
              name,
              sqlType: String(row.column_type),
              typeId,
              sensitivity,
              universalTerm: term ? term.id : null,
              // Shape stats (null%/cardinality) are always safe — they're counts,
              // not values. The min/max RANGE is a value, so it's filled only for
              // public columns (0c). sampleValues stays null in v1 (query is the
              // redacted value path).
              nullFraction: null,
              distinctCount: null,
              min: null,
              max: null,
              sampleValues: null,
            };
          });
          // One aggregate query per table fills null%/cardinality for every
          // column + min/max for the public numeric/date ones. Best-effort.
          await enrichColumnStats(t.name, columns);
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
          provenance: {
            sourceLabel: src.label,
            sourceKind: String(src.kind),
            origin: t.origin ?? null,
          },
          columns,
        });
      }
    }
    return {
      version: '1' as const,
      tables,
      taxonomyVersion: b?.version ?? null,
      sensitivityLayerLoaded: layerLoaded,
    };
  }

  /** Fill null%/cardinality (+ min/max for public numeric/date) via ONE
   *  aggregate query over the table. Mutates `columns` in place; best-effort —
   *  a stats failure leaves the nulls, it never fails describe. */
  async function enrichColumnStats(tableName: string, columns: DescribedColumn[]): Promise<void> {
    if (columns.length === 0) return;
    const parts: string[] = ['COUNT(*) AS _n'];
    columns.forEach((c, i) => {
      const q = quoteIdent(c.name);
      parts.push(`COUNT(${q}) AS c${i}_nn`);
      parts.push(`COUNT(DISTINCT ${q}) AS c${i}_d`);
      // Range is a VALUE — only for public columns (0c), and only where MIN/MAX
      // is meaningful (numeric / temporal).
      if (c.sensitivity === 'public' && isRangeable(c.sqlType)) {
        parts.push(`CAST(MIN(${q}) AS VARCHAR) AS c${i}_min`);
        parts.push(`CAST(MAX(${q}) AS VARCHAR) AS c${i}_max`);
      }
    });
    try {
      const [stats] = await deps.engine.query<Record<string, unknown>>(
        `SELECT ${parts.join(', ')} FROM ${quoteIdent(tableName)}`,
      );
      if (!stats) return;
      const n = Number(stats._n) || 0;
      columns.forEach((c, i) => {
        const nn = Number(stats[`c${i}_nn`]);
        if (n > 0 && Number.isFinite(nn)) {
          c.nullFraction = Math.round(((n - nn) / n) * 1000) / 1000;
        }
        const d = Number(stats[`c${i}_d`]);
        if (Number.isFinite(d)) c.distinctCount = d;
        if (`c${i}_min` in stats) {
          const mn = stats[`c${i}_min`];
          c.min = mn == null ? null : String(mn);
          const mx = stats[`c${i}_max`];
          c.max = mx == null ? null : String(mx);
        }
      });
    } catch {
      // Stats are best-effort; leave the nulls in place.
    }
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
    const b = bundle();
    if (!b || !hasSensitivityLayer(b)) {
      throw new Error(
        'Agent value query refused because the sensitivity layer is unavailable. Schema-only verbs remain available.',
      );
    }
    const projection = validateAgentValueProjection(sql, {
      allowedTables: allowedTableNames(),
    });
    if (!projection.ok) throw new Error(projection.reason);
    const matchingTables = workbook().sources.flatMap((source) =>
      source.tables
        .filter((table) => table.name.toLowerCase() === projection.table)
        .map((table) => ({ source, table })),
    );
    if (matchingTables.length !== 1) {
      throw new Error(
        `Agent value query refused because mounted table "${projection.table}" does not have unique ownership.`,
      );
    }
    const owned = matchingTables[0];
    if (!owned) throw new Error('Agent value query refused because its table is unavailable.');

    const runSql = boundedAgentQuerySql(sql);
    const raw = await deps.engine.query(runSql);
    const rows = raw.slice(0, AGENT_QUERY_ROW_CAP) as Array<Record<string, unknown>>;
    const columns = rows.length > 0 ? Object.keys(rows[0] as object) : [];

    const assignmentPrefix = `${owned.source.id}::${owned.table.id}::`;
    const tableAssignments = new Map(
      Object.entries(workbook().assignments)
        .filter(([key]) => key.startsWith(assignmentPrefix))
        .map(([, assignment]) => [assignment.columnName.toLowerCase(), assignment]),
    );
    const projected = projection.columns ? new Set(projection.columns) : null;
    const sensitivity = new Map<string, AgentColumnSensitivity>();
    for (const column of columns) {
      const sourceName = column.toLowerCase();
      if (projected && !projected.has(sourceName)) {
        throw new Error(
          `Agent value query refused because output column "${column}" cannot be traced to its source projection.`,
        );
      }
      const typeId = tableAssignments.get(sourceName)?.assigned.typeId ?? null;
      const term = typeId ? universalTermForType(b, typeId) : null;
      const tier: AgentColumnSensitivity =
        typeId && term ? sensitivityForType(b, typeId) : 'unclassified';
      sensitivity.set(sourceName, tier);
    }
    const redactedColumns = columns.filter(
      (column) => sensitivity.get(column.toLowerCase()) !== 'public',
    );
    if (redactedColumns.length > 0) {
      for (const row of rows) {
        for (const c of redactedColumns) {
          const tier = sensitivity.get(c.toLowerCase()) ?? 'unclassified';
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

  return {
    describe,
    listTables,
    listCells,
    query,
    proposeCell,
    writesEnabled: deps.isWritesEnabled,
  };
}

/** Put the row cap in the SQL handed to DuckDB, not only in result slicing.
 * The strict value-projection guard runs first and rejects non-SELECT forms.
 * Removing one tolerated trailing semicolon keeps the query valid inside the
 * bounded subquery. */
export function boundedAgentQuerySql(sql: string): string {
  const trimmed = sql.trim().replace(/;\s*$/, '');
  return `SELECT * FROM (${trimmed}) AS _agent_scope LIMIT ${AGENT_QUERY_ROW_CAP}`;
}

/** Minimal identifier quoting for the DESCRIBE calls in `describe`. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** True for SQL types where MIN/MAX (a range) is meaningful — numeric + temporal. */
function isRangeable(sqlType: string): boolean {
  const base = sqlType.toUpperCase().split('(')[0]?.trim() ?? '';
  return /INT|DECIMAL|NUMERIC|FLOAT|REAL|DOUBLE|HUGEINT|DATE|TIMESTAMP|TIME/.test(base);
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

/**
 * Render the workbook's data dictionary as Markdown — the human-facing half of
 * the "one artifact, two jobs" pair. Deliberately runs the SAME `describe()` an
 * agent calls (one core, not two codepaths): identical semantics, identical
 * tier-redaction, so the doc a human downloads can never disagree with the
 * grounding an agent reads. Lives in this chunk so the serializer stays off the
 * inlined shell.
 */
export async function exportDataDictionary(deps: AgentSurfaceDeps): Promise<string> {
  const result = await createAgentHost(deps).describe();
  return describeToMarkdown(result);
}

// ── WebMCP adapter (Chunk 7 — flag-gated SPIKE, DECISIONS EE-0d) ──────────────
// WebMCP (`document.modelContext.registerTool`) is the right shape for exposing
// tools to an in-browser agent, but it's Chrome-149-origin-trial-only and has
// churned its root object twice — so this ships NOTHING load-bearing: the bridge
// only calls it behind a `?webmcp=1` flag when `document.modelContext` exists.
// The registration is injected the root (not `document.*`) so it's unit-testable
// against a mock. Same tools + same host as `window.naklidata` — one surface, two
// front doors.

/** The slice of a WebMCP root we use. Kept minimal + local — there is no stable
 *  WebMCP type package (the API is a moving origin trial). */
export interface WebMcpToolDef {
  name: string;
  description: string;
  inputSchema: unknown;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (
    input: unknown,
  ) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>;
}
export interface WebMcpRoot {
  registerTool: (def: WebMcpToolDef, opts?: unknown) => unknown;
  unregisterTool?: (name: string) => void;
}

export interface WebMcpRegistration {
  registered: string[];
  unregister: () => void;
}

/**
 * Register every agent verb with a WebMCP root. Maps our tool contract to
 * WebMCP's: the `execute` runs our verb (validator + gate included) and wraps the
 * `{ ok, data | error }` result as an MCP text-content result. Returns the
 * registered names + an unregister fn. Injected the root, so a mock drives it.
 */
export function registerWithWebMcp(root: WebMcpRoot, deps: AgentSurfaceDeps): WebMcpRegistration {
  const registered: string[] = [];
  for (const tool of tools(deps)) {
    const def: WebMcpToolDef = {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: {
        readOnlyHint: tool.annotations.readOnlyHint,
        untrustedContentHint: tool.annotations.untrustedContentHint,
      },
      execute: async (input: unknown) => {
        const result = await tool.execute(input);
        const payload = result.ok ? result.data : { error: result.error };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
          isError: !result.ok,
        };
      },
    };
    root.registerTool(def);
    registered.push(tool.name);
  }
  return {
    registered,
    unregister: () => {
      if (!root.unregisterTool) return;
      for (const name of registered) root.unregisterTool(name);
    },
  };
}
