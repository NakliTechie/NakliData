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

import {
  AGENT_ADAPTERS,
  AGENT_BOUNDS,
  AGENT_CONTRACT_VERSION,
  AGENT_V3_TOOL_SCOPES,
  type AgentScope,
} from '../core/agent/contract.ts';
import { describeToMarkdown } from '../core/agent/data-dictionary.ts';
import {
  type AgentArtifactKind,
  type AgentArtifactValidation,
  type AgentChartProposalInput,
  type AgentCleaningProposalInput,
  type AgentProposalResult,
  type AgentV3Host,
  type AgentV3Tool,
  buildAgentV3Tools,
  dispatchAgentV3Tool,
} from '../core/agent/registry-v3.ts';
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
import { AgentPermissionError, type AgentRequest, AgentSession } from '../core/agent/session.ts';
import { validateAgentValueProjection, validateReadOnlySql } from '../core/agent/sql-validator.ts';
import { validateChartConfig } from '../core/chart-config.ts';
import { inferChartBindings, inferFieldClass } from '../core/chart-shelves.ts';
import type { SuggestedTableFix } from '../core/cleaning/fix-registry.ts';
import type { Engine } from '../core/engine.ts';
import { loadChunk } from '../core/lazy-loader.ts';
import type { LineageGraph } from '../core/lineage-store.ts';
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
const AGENT_QUERY_ROW_CAP = AGENT_BOUNDS.queryRows;

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
  /** Shell-owned epoch; increments without loading this chunk when the current
   * workspace is replaced or the engine enters a fatal state. */
  getWorkspaceEpoch: () => number;
  /** Live read of the shell's Workbook singleton state (injected, NOT imported —
   *  see the module header on singleton divergence). */
  getWorkbookState: () => WorkbookState;
  /** Live read of the shell's taxonomy bundle (injected). */
  getBundle: () => TaxonomyBundle | null;
  getLineageGraph: () => LineageGraph;
  getCleaningSuggestions: (sourceId: string, tableId: string) => SuggestedTableFix[];
  /** Test seam for the artifact validators. Production uses the lazy validators
   * below so their orchestration does not consume shell bytes. */
  validateArtifact?: (
    kind: AgentArtifactKind,
    artifact: unknown,
  ) => Promise<AgentArtifactValidation>;
}

type AgentColumnSensitivity = TypeSensitivity | 'unclassified' | 'unavailable';

/**
 * Build the `AgentHost` — the capability surface the registry verbs orchestrate.
 * Reads the live workbook/engine/notebook on every call (never a stale snapshot).
 */
export function createAgentHost(
  deps: AgentSurfaceDeps,
  access: { has(scope: AgentScope): boolean } = { has: () => true },
): AgentHost {
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

  async function describe(signal?: AbortSignal): Promise<DescribeResult> {
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
            signal ? { signal } : {},
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
          await enrichColumnStats(t.name, columns, signal);
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
  async function enrichColumnStats(
    tableName: string,
    columns: DescribedColumn[],
    signal?: AbortSignal,
  ): Promise<void> {
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
        signal ? { signal } : {},
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

  async function query(sql: string, signal?: AbortSignal): Promise<QueryResult> {
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
    const raw = await deps.engine.query(runSql, signal ? { signal } : {});
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
    return {
      columns,
      rows,
      rowCount: rows.length,
      redactedColumns,
      sourceId: owned.source.id,
      tableId: owned.table.id,
      truncated: rows.length >= AGENT_QUERY_ROW_CAP,
    };
  }

  async function proposeSqlCell(sql: string): Promise<{ id: string; sql: string; editable: true }> {
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
    proposeCell: proposeSqlCell,
    valuesEnabled: () => access.has('values:read'),
    proposalsEnabled: () => access.has('workspace:propose'),
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
let _v3Tools: AgentV3Tool[] | null = null;
let _session: AgentSession | null = null;

function session(deps: AgentSurfaceDeps): AgentSession {
  _session ??= new AgentSession(
    deps.getWorkspaceEpoch,
    AGENT_BOUNDS.activityEntries,
    AGENT_BOUNDS.requestDeadlineMs,
  );
  return _session;
}

function tools(deps: AgentSurfaceDeps): AgentTool[] {
  _tools ??= buildAgentTools(createAgentHost(deps, session(deps)));
  return _tools;
}

function v3Tools(deps: AgentSurfaceDeps): AgentV3Tool[] {
  _v3Tools ??= buildAgentV3Tools(createAgentV3Host(deps));
  return _v3Tools;
}

function createAgentV3Host(deps: AgentSurfaceDeps): AgentV3Host {
  const legacy = createAgentHost(deps, session(deps));
  return {
    ...legacy,
    getLineage: deps.getLineageGraph,
    validateArtifact: deps.validateArtifact ?? validateArtifact,
    proposeSqlCell: async (sql, signal) => {
      abortIfNeeded(signal);
      const proposed = await legacy.proposeCell(sql);
      return {
        proposalType: 'sql-cell',
        createdCell: { id: proposed.id, kind: 'sql', status: 'un-run' },
        preview: { sql },
        affectedObjects: [{ kind: 'cell', id: proposed.id, label: proposed.id }],
        warnings: ['Proposed SQL is editable and has not been executed.'],
        editable: true,
        humanAction: 'Review and edit the SQL, then click Run on the new cell.',
      };
    },
    proposeChart: (input, signal) => proposeChart(deps, input, signal),
    proposeQualityCheck: (check, signal) => proposeQualityCheck(deps, check, signal),
    proposeCleaningStep: (input, signal) => proposeCleaningStep(deps, input, signal),
  };
}

async function proposeChart(
  deps: AgentSurfaceDeps,
  input: AgentChartProposalInput,
  signal: AbortSignal,
): Promise<AgentProposalResult> {
  abortIfNeeded(signal);
  const source = deps.notebook.get().cells.find((cell) => cell.id === input.inputCellId);
  if (!source || !('lastResult' in source) || !source.lastResult) {
    throw new Error(
      'Invalid chart input: inputCellId must own a currently materialized notebook result.',
    );
  }
  const columns = source.lastResult.columns;
  const rows = source.lastResult.rows;
  const resolved = inferChartBindings(input.config, columns, (name) => inferFieldClass(name, rows));
  const errors = validateChartConfig(resolved, columns);
  if (errors.length) throw new Error(`Invalid chart proposal: ${errors.join(' ')}`);
  abortIfNeeded(signal);
  const cell = deps.notebook.addCell('chart');
  deps.notebook.patchCell(cell.id, {
    inputCell: source.id,
    chartType: resolved.chartType,
    x: resolved.xColumn,
    y: resolved.yColumn,
    facet: resolved.groupColumn,
    name: resolved.title.slice(0, 40),
  });
  const inferred =
    resolved.xColumn !== input.config.xColumn || resolved.yColumn !== input.config.yColumn;
  return {
    proposalType: 'chart',
    createdCell: { id: cell.id, kind: 'chart', status: 'un-run' },
    preview: {
      inputCellId: source.id,
      config: resolved,
    },
    affectedObjects: [
      { kind: 'cell', id: source.id, label: source.name ?? source.id },
      { kind: 'cell', id: cell.id, label: resolved.title },
    ],
    warnings: inferred
      ? ['Missing or stale axis bindings were resolved through the chart inference path.']
      : [],
    editable: true,
    humanAction:
      'Review the chart type and bindings in the new cell; run its upstream cell if the result is stale.',
  };
}

async function proposeQualityCheck(
  deps: AgentSurfaceDeps,
  input: unknown,
  signal: AbortSignal,
): Promise<AgentProposalResult> {
  const quality = await loadChunk('data-quality');
  const check = quality.parseDataQualityCheck(input);
  const owners = deps
    .getWorkbookState()
    .sources.flatMap((source) =>
      source.tables
        .filter((table) => table.name === check.table)
        .map((table) => ({ source, table })),
    );
  if (owners.length !== 1) {
    throw new Error(
      'Invalid quality-check ownership: table must name exactly one mounted workspace table.',
    );
  }
  const owner = owners[0];
  if (!owner) throw new Error('Invalid quality-check ownership.');
  const assignmentKey = `${owner.source.id}::${owner.table.id}::${check.column}`;
  if (!Object.hasOwn(deps.getWorkbookState().assignments, assignmentKey)) {
    throw new Error(
      'Invalid quality-check ownership: column must name an exact column on the mounted table.',
    );
  }
  const code = quality.encodeDataQualityAssertion(check);
  abortIfNeeded(signal);
  const cell = deps.notebook.addCell('assertion');
  deps.notebook.patchCell(cell.id, { name: check.name, code });
  return {
    proposalType: 'quality-check',
    createdCell: { id: cell.id, kind: 'assertion', status: 'un-run' },
    preview: { check, taggedAssertion: code },
    affectedObjects: [
      { kind: 'source', id: owner.source.id, label: owner.source.label },
      { kind: 'table', id: owner.table.id, label: owner.table.name },
      { kind: 'cell', id: cell.id, label: check.name },
    ],
    warnings: ['The assertion is editable and has not been run.'],
    editable: true,
    humanAction: 'Review the tagged assertion, then click Run on the new assertion cell.',
  };
}

async function proposeCleaningStep(
  deps: AgentSurfaceDeps,
  input: AgentCleaningProposalInput,
  signal: AbortSignal,
): Promise<AgentProposalResult> {
  const owner = deps
    .getWorkbookState()
    .sources.find((source) => source.id === input.sourceId)
    ?.tables.find((table) => table.id === input.tableId);
  if (!owner) {
    throw new Error('Invalid cleaning-step ownership: sourceId and tableId must name one table.');
  }
  const suggestion = deps
    .getCleaningSuggestions(input.sourceId, input.tableId)
    .find((candidate) => candidate.id === input.suggestionId);
  if (!suggestion) {
    throw new Error(
      'Invalid cleaning suggestion: suggestionId must name a current table-context suggestion.',
    );
  }
  abortIfNeeded(signal);
  const cell = deps.notebook.addCell('sql');
  deps.notebook.patchCell(cell.id, {
    name: `clean_${suggestion.id.split(':')[0] ?? 'table'}`.slice(0, 40),
    code: suggestion.sql,
  });
  return {
    proposalType: 'cleaning-step',
    createdCell: { id: cell.id, kind: 'sql', status: 'un-run' },
    preview: {
      suggestionId: suggestion.id,
      label: suggestion.label,
      rationale: suggestion.rationale,
      columns: suggestion.columns,
      rows: suggestion.preview,
      sql: suggestion.sql,
    },
    affectedObjects: [
      { kind: 'source', id: input.sourceId, label: input.sourceId },
      { kind: 'table', id: input.tableId, label: owner.name },
      { kind: 'cell', id: cell.id, label: suggestion.label },
    ],
    warnings: ['The cleaning SQL is editable and has not been run.'],
    editable: true,
    humanAction: 'Review the preview and SQL, then click Run on the new cell.',
  };
}

function abortIfNeeded(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Agent request cancelled.');
}

async function validateArtifact(
  kind: AgentArtifactKind,
  artifact: unknown,
): Promise<AgentArtifactValidation> {
  try {
    if (kind === 'naklidata') {
      const validator = await loadChunk('persistence-validation');
      const file =
        typeof artifact === 'string'
          ? validator.parse(artifact)
          : validator.validateNakliDataFile(artifact);
      return {
        kind,
        valid: true,
        errors: [],
        summary: {
          format: file.format,
          version: file.version,
          name: file.name,
          sourceCount: file.sources.length,
          cellCount: file.cells.length,
        },
      };
    }
    if (kind === 'portable-semantic-model') {
      const semantic = await loadChunk('semantic-model');
      const errors = semantic.validatePortableSemanticModel(artifact as never);
      return {
        kind,
        valid: errors.length === 0,
        errors,
        summary: {
          tableCount:
            typeof artifact === 'object' &&
            artifact !== null &&
            Array.isArray((artifact as Record<string, unknown>).tables)
              ? ((artifact as Record<string, unknown>).tables as unknown[]).length
              : 0,
        },
      };
    }
    const quality = await loadChunk('data-quality');
    if (typeof artifact !== 'string') {
      throw new Error('A data-quality assertion artifact must be a tagged SQL string.');
    }
    const parsed = quality.parseDataQualityAssertion(artifact);
    if (!parsed) throw new Error('The SQL is missing the naklidata-quality metadata tag.');
    const errors = quality.validateDataQualityCheck(parsed.check);
    return {
      kind,
      valid: errors.length === 0,
      errors,
      summary: {
        checkId: parsed.check.id,
        checkKind: parsed.check.kind,
        table: parsed.check.table,
        column: parsed.check.column,
      },
    };
  } catch (error) {
    return {
      kind,
      valid: false,
      errors: [boundedValidationMessage(error)],
      summary: {},
    };
  }
}

function boundedValidationMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, ' ').trim().slice(0, 500) || 'Artifact validation failed.';
}

/** Dispatch a verb by name. The shell's `window.naklidata.<verb>` proxies route
 *  here after loading this chunk. */
export async function dispatch(deps: AgentSurfaceDeps, verb: string, input: unknown) {
  const scope = scopeForLegacyVerb(verb);
  let request: AgentRequest;
  try {
    request = session(deps).begin(scope, verb);
  } catch (err) {
    if (err instanceof AgentPermissionError) return { ok: false as const, error: err.message };
    throw err;
  }
  const result = await dispatchAgentTool(tools(deps), verb, input, request.signal);
  const cancelled = request.signal.aborted;
  const queryResult = result.ok && verb === 'query' ? (result.data as QueryResult) : null;
  request.finish(result.ok ? 'ok' : 'error', {
    rowsReturned: queryResult?.rowCount ?? null,
    redactedColumns: queryResult?.redactedColumns.length ?? null,
  });
  return cancelled
    ? {
        ok: false as const,
        error: 'Agent request cancelled because its per-tab access was revoked.',
      }
    : result;
}

function scopeForLegacyVerb(verb: string): AgentScope {
  if (verb === 'query') return 'values:read';
  if (verb === 'proposeCell') return 'workspace:propose';
  return 'metadata:read';
}

export async function dispatchV3(deps: AgentSurfaceDeps, name: string, input: unknown) {
  const found = v3Tools(deps).find((tool) => tool.name === name);
  const declaredScope = Object.hasOwn(AGENT_V3_TOOL_SCOPES, name)
    ? AGENT_V3_TOOL_SCOPES[name as keyof typeof AGENT_V3_TOOL_SCOPES]
    : null;
  const scope = found?.scope ?? declaredScope ?? 'metadata:read';
  const state = session(deps).snapshot();
  let request: AgentRequest | null = null;
  try {
    request = session(deps).begin(scope, name);
  } catch (error) {
    if (!(error instanceof AgentPermissionError)) throw error;
  }
  const fallbackController = new AbortController();
  const result = await dispatchAgentV3Tool(v3Tools(deps), name, input, {
    workspaceRevision: state.workspaceRevision,
    readWorkspaceRevision: () => session(deps).snapshot().workspaceRevision,
    signal: request?.signal ?? fallbackController.signal,
    permissionGranted: request !== null,
  });
  request?.finish(
    result.ok ? 'ok' : 'error',
    {
      rowsReturned: result.meta.bounds.rowsReturned,
      redactedColumns: result.meta.redaction.columns.length,
    },
    result.ok ? null : result.error.code,
  );
  return result;
}

export function catalogueV3(deps: AgentSurfaceDeps) {
  return v3Tools(deps).map(({ name, description, scope, inputSchema, annotations }) => ({
    name,
    description,
    scope,
    inputSchema,
    annotations,
  }));
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

export function agentAccessSnapshot(deps: AgentSurfaceDeps) {
  return {
    version: AGENT_CONTRACT_VERSION,
    bounds: AGENT_BOUNDS,
    adapters: AGENT_ADAPTERS,
    ...session(deps).snapshot(),
  };
}

export function setAgentGrant(
  deps: AgentSurfaceDeps,
  scope: Exclude<AgentScope, 'metadata:read'>,
  granted: boolean,
): void {
  session(deps).setGrant(scope, granted);
}

export function revokeAgentGrants(deps: AgentSurfaceDeps): void {
  session(deps).revokeAll();
}

/** Force observation of a shell epoch change so replacement aborts already
 * in-flight calls immediately when this chunk has been loaded. */
export function syncAgentAccess(deps: AgentSurfaceDeps): void {
  session(deps).snapshot();
}

/** Render the Settings → Agent access panel from this lazy chunk so the
 * size-constrained shell carries only a placeholder. */
export function renderAgentAccessPanel(root: HTMLElement, deps: AgentSurfaceDeps): void {
  const state = agentAccessSnapshot(deps);
  const activity =
    state.activity.length === 0
      ? '<p class="settings-hint">No agent activity in this workspace.</p>'
      : `<ol>${state.activity
          .map(
            (entry) =>
              `<li><code>${escapeAgentText(entry.tool)}</code> · ${entry.scope} · ${entry.outcome} · ${entry.durationMs} ms${entry.rowsReturned === null ? '' : ` · ${entry.rowsReturned} rows`}${entry.redactedColumns === null ? '' : ` · ${entry.redactedColumns} redacted`} · <time>${escapeAgentText(entry.finishedAt)}</time></li>`,
          )
          .join('')}</ol>`;
  root.innerHTML = `
    <h3>Agent access</h3>
    <p class="settings-hint">Contract v${state.version}. Browser v2 is compatible; v3 permissions are enforced here. Metadata grounding is always available. There is no execution permission.</p>
    <label class="settings-remember">
      <input type="checkbox" checked disabled />
      <span>Read schema, semantics, cells, and lineage <code>metadata:read</code></span>
    </label>
    <label class="settings-remember">
      <input type="checkbox" data-agent-scope="values:read" ${state.grants['values:read'] ? 'checked' : ''} />
      <span>Read bounded, sensitivity-redacted row values <code>values:read</code></span>
    </label>
    <label class="settings-remember">
      <input type="checkbox" data-agent-scope="workspace:propose" ${state.grants['workspace:propose'] ? 'checked' : ''} />
      <span>Add editable, un-run proposals <code>workspace:propose</code></span>
    </label>
    <p class="settings-hint">Per-tab only. Grants clear when this workspace is replaced or the engine fails. Queries are capped at ${state.bounds.queryRows.toLocaleString('en-US')} rows; activity keeps ${state.bounds.activityEntries} metadata-only entries.</p>
    <button class="btn btn-ghost" data-agent-action="revoke">Revoke value and proposal access</button>
    <h3>Adapters</h3>
    <p class="settings-hint">${state.adapters
      .map((adapter) => `${escapeAgentText(adapter.label)}: ${adapter.readiness}`)
      .join(' · ')}</p>
    <h3>Activity (${state.inFlight} in flight)</h3>
    <div aria-live="polite">${activity}</div>
  `;
  if (root.dataset.agentAccessBound === '1') return;
  root.dataset.agentAccessBound = '1';
  root.addEventListener('change', (event) => {
    const input = (event.target as HTMLElement | null)?.closest<HTMLInputElement>(
      '[data-agent-scope]',
    );
    if (!input) return;
    const scope = input.dataset.agentScope;
    if (scope !== 'values:read' && scope !== 'workspace:propose') return;
    setAgentGrant(deps, scope, input.checked);
    renderAgentAccessPanel(root, deps);
  });
  root.addEventListener('click', (event) => {
    const action = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-agent-action]')
      ?.dataset.agentAction;
    if (action !== 'revoke') return;
    revokeAgentGrants(deps);
    renderAgentAccessPanel(root, deps);
  });
  const unsubscribe = session(deps).subscribe(() => {
    if (!root.isConnected) {
      unsubscribe();
      return;
    }
    renderAgentAccessPanel(root, deps);
  });
}

function escapeAgentText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
  execute: (input: unknown) => Promise<unknown>;
}
export interface WebMcpRoot {
  registerTool: (
    def: WebMcpToolDef,
    options?: { signal?: AbortSignal; exposedTo?: string[] },
  ) => Promise<unknown> | unknown;
}

export interface WebMcpRegistration {
  registered: string[];
  signal: AbortSignal;
  unregister: () => void;
}

/**
 * Register every v3 tool with WebMCP's current asynchronous, abort-scoped
 * contract. Execute returns the structured v3 envelope directly: WebMCP accepts
 * any promise result, so an MCP text-content compatibility wrapper would only
 * discard type information.
 */
export async function registerWithWebMcp(
  root: WebMcpRoot,
  deps: AgentSurfaceDeps,
  options: { signal?: AbortSignal; exposedTo?: string[] } = {},
): Promise<WebMcpRegistration> {
  const registered: string[] = [];
  const lifetime = new AbortController();
  if (options.signal?.aborted) lifetime.abort(options.signal.reason);
  options.signal?.addEventListener('abort', () => lifetime.abort(options.signal?.reason), {
    once: true,
  });
  try {
    for (const tool of v3Tools(deps)) {
      const def: WebMcpToolDef = {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          readOnlyHint: tool.annotations.readOnlyHint,
          untrustedContentHint: tool.annotations.untrustedContentHint,
        },
        execute: (input: unknown) => dispatchV3(deps, tool.name, input),
      };
      await root.registerTool(def, {
        signal: lifetime.signal,
        exposedTo: options.exposedTo ?? [],
      });
      registered.push(tool.name);
    }
  } catch (error) {
    lifetime.abort(error);
    throw error;
  }
  return {
    registered,
    signal: lifetime.signal,
    unregister: () => lifetime.abort('NakliData WebMCP registration ended.'),
  };
}

let _webMcpRegistration: WebMcpRegistration | null = null;

/** Feature-detected document adapter. This runs only after `?webmcp=1` caused
 * the shell to load this chunk; WebMCP remains optional and non-load-bearing. */
export async function registerWebMcpForDocument(deps: AgentSurfaceDeps): Promise<void> {
  const root = (document as unknown as { modelContext?: WebMcpRoot }).modelContext;
  if (!root) {
    console.info(
      '[naklidata] WebMCP requested (?webmcp=1) but document.modelContext is unavailable in this browser.',
    );
    return;
  }
  _webMcpRegistration?.unregister();
  const registration = await registerWithWebMcp(root, deps, {
    exposedTo: [window.location.origin],
  });
  _webMcpRegistration = registration;
  window.addEventListener(
    'pagehide',
    () => {
      registration.unregister();
      if (_webMcpRegistration === registration) _webMcpRegistration = null;
    },
    { once: true },
  );
  console.info(`[naklidata] WebMCP: registered ${registration.registered.length} v3 tools.`);
}
