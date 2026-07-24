// Agent surfaces — the tool registry (Chunk 2; DECISIONS EE). The pure contract
// half of the agent-driver surface: it defines the verbs an in-browser agent can
// call, in WebMCP's tool shape — `{ name, description, inputSchema, execute,
// annotations }` — so that when WebMCP stabilises the adapter is thin (0d). It
// is engine-boundary clean: it holds NO engine, DOM, or window reference. Every
// verb's `execute` calls an injected `AgentHost`, which the browser-side binder
// (`src/ui/agent-surface.ts`) implements against the live engine / workbook /
// notebook. "Orchestrate the existing engine, do not build a parallel writer"
// (resolve-track-vision.md:30) — the host verbs call the same handlers the human
// does; this module is only their catalogue + dispatch.
//
// The safety model rides in TWO places, not in this catalogue:
//   1. `AgentHost.query` runs every SQL string through the read-only validator
//      (`sql-validator.ts`) before the engine sees it. The model is never the
//      safety boundary.
//   2. `proposeCell` returns an UN-RUN cell with `{ editable: true }` — the
//      propose-don't-execute shape cribbed from Facet M0. Writes are proposals a
//      human runs (0a).
// The gate (0b): read verbs (describe / listTables / listCells / query) are
// on-by-default; write verbs (proposeCell / runCell) are refused unless
// `host.writesEnabled()` — the browser binder wires that to a Settings flag.

/** A JSON Schema object (draft-07 shape). Kept as an open record so this module
 *  needs no schema dependency; the binder/agent validates against it. */
export type JsonSchema = Record<string, unknown>;

/** WebMCP-style tool annotations. `readOnlyHint` / `untrustedContentHint` are
 *  the exact axes our sensitivity layer already speaks (agent-surfaces.md §3). */
export interface AgentToolAnnotations {
  /** True when the verb cannot mutate workspace state (all reads). */
  readOnlyHint: boolean;
  /** True when the verb can surface data whose values are redacted by tier. */
  untrustedContentHint: boolean;
  /** True when the verb is refused unless writes are enabled (the 0b gate). */
  gated: boolean;
}

/** Uniform verb result. `ok:false` carries a UI-safe message — a rejected
 *  validator, a disabled gate, or a bad-shape input all surface this way. */
export type AgentToolResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

/** A single agent verb, in WebMCP's registerTool shape. */
export interface AgentTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: AgentToolAnnotations;
  execute(input: unknown): Promise<AgentToolResult>;
}

// ── Shared data shapes the host returns (defined here so host + tools + a future
//    WebMCP adapter all speak one vocabulary) ──────────────────────────────────

/** One column of a mounted table, with its semantic layer. VALUES are never in
 *  here — this is the schema+semantics surface (0c). `sampleValues` is present
 *  only for `sensitivity: 'public'` columns; otherwise it's redacted to null. */
export interface DescribedColumn {
  name: string;
  sqlType: string;
  /** Taxonomy type id (the ~193-type semantic layer), or null if unclassified. */
  typeId: string | null;
  /** Sensitivity tier — the redaction axis. */
  sensitivity: 'public' | 'pii' | 'financial' | 'secret';
  /** Canonical universal-term id, if the column maps to one. */
  universalTerm: string | null;
  /** Fraction of rows that are NULL, 0..1 (a shape stat, not a value — always
   *  present when stats were computed). Null if stats couldn't be gathered. */
  nullFraction: number | null;
  /** Distinct non-null value count — cardinality (a shape stat, not a value). */
  distinctCount: number | null;
  /** Min value as text — ONLY for PUBLIC numeric/date columns (a value, so
   *  redacted to null by tier per 0c); null otherwise. */
  min: string | null;
  /** Max value as text — ONLY for public numeric/date columns; null otherwise. */
  max: string | null;
  /** A few example values — ONLY for public columns; null when redacted. */
  sampleValues: string[] | null;
}

/** Where a table's bytes came from — provenance for the data dictionary. */
export interface TableProvenance {
  sourceLabel: string;
  sourceKind: string;
  /** Display origin (a URL, a filename, a bundle id), if known. */
  origin: string | null;
}

export interface DescribedTable {
  sourceId: string;
  tableId: string;
  name: string;
  rowCount: number | null;
  provenance: TableProvenance;
  columns: DescribedColumn[];
}

export interface DescribeResult {
  /** Envelope version — additive-optional, like `.naklidata` (spec discipline). */
  version: '1';
  tables: DescribedTable[];
  /** Taxonomy bundle version the semantics were resolved against. */
  taxonomyVersion: string | null;
  /** False when no sensitivity layer is loaded — redaction then fails CLOSED
   *  (every non-public treated as redacted). The agent should know. */
  sensitivityLayerLoaded: boolean;
}

export interface TableSummary {
  sourceId: string;
  tableId: string;
  name: string;
  rowCount: number | null;
  columnCount: number;
}

export interface CellSummary {
  id: string;
  kind: string;
  name: string | null;
  /** SQL/code cells only — the current code (never results / row data). */
  code: string | null;
}

/** Result of a validated, redacted read query. */
export interface QueryResult {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  /** Row count returned (post-LIMIT). */
  rowCount: number;
  /** Output columns whose values were redacted by sensitivity tier. */
  redactedColumns: string[];
}

/** Result of proposing a cell — the propose-don't-execute shape. The cell is
 *  added UN-RUN; the human runs it. `editable: true` is the whole safety model
 *  in one field (Facet M0). */
export interface ProposeResult {
  id: string;
  sql: string;
  editable: true;
}

export interface RunResult {
  id: string;
  status: string;
}

/**
 * The capability surface the tools call. The browser binder implements it
 * against the live engine / workbook / notebook. `query` MUST validate its SQL
 * through the read-only validator and redact by sensitivity before returning —
 * the tools trust the host to be the safety boundary, not the model.
 */
export interface AgentHost {
  describe(): DescribeResult | Promise<DescribeResult>;
  listTables(): TableSummary[] | Promise<TableSummary[]>;
  listCells(): CellSummary[] | Promise<CellSummary[]>;
  /** Validate (read-only + scoped) → execute → redact. Rejects by throwing an
   *  Error whose message is UI-safe. */
  query(sql: string): Promise<QueryResult>;
  /** Add an un-run SQL cell carrying `sql`. Does NOT execute it. */
  proposeCell(sql: string): Promise<ProposeResult>;
  /** Run an existing cell by id (a write path — gated). */
  runCell(id: string): Promise<RunResult>;
  /** The 0b gate: are write verbs (proposeCell / runCell) permitted? */
  writesEnabled(): boolean;
}

/** Narrow an unknown input to `{ [key]: string }` — the shape every verb here
 *  takes. Returns the string or null (bad shape). */
function stringField(input: unknown, key: string): string | null {
  if (input === null || typeof input !== 'object') return null;
  const v = (input as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : null;
}

/** Wrap a host call so a thrown Error becomes a `{ ok:false }` result (the
 *  validator and gate both throw UI-safe messages). */
async function guarded<T>(fn: () => Promise<T> | T): Promise<AgentToolResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Build the agent verb set against a host. Pure: the same host produces the same
 * catalogue. The browser binder exposes these on `window.naklidata` and (later)
 * registers them with WebMCP via the identical annotations.
 */
export function buildAgentTools(host: AgentHost): AgentTool[] {
  const gate = (): void => {
    if (!host.writesEnabled()) {
      throw new Error(
        'This action is disabled. Turn on agent write access in Settings → AI sidecar to let an agent propose or run cells.',
      );
    }
  };

  return [
    {
      name: 'describe',
      description:
        'Describe the mounted workspace: every table and column with its semantic type, sensitivity tier, and universal term. Values are never returned except a few samples for public columns — this is the grounding an agent needs without the data leaving the tab.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true, gated: false },
      execute: () => guarded(() => host.describe()),
    },
    {
      name: 'listTables',
      description:
        'List mounted tables with row/column counts. A lightweight index; use describe for the semantic layer.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false, gated: false },
      execute: () => guarded(() => host.listTables()),
    },
    {
      name: 'listCells',
      description:
        'List the notebook cells (id, kind, name, and code for SQL cells). Never returns results or row data.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false, gated: false },
      execute: () => guarded(() => host.listCells()),
    },
    {
      name: 'query',
      description:
        'Run a READ-ONLY SQL query against the mounted tables and return rows. The query passes a strict validator first (SELECT-only, scoped to mounted tables, no writes/DDL/file access); columns whose sensitivity tier is not public are redacted in the output.',
      inputSchema: {
        type: 'object',
        properties: { sql: { type: 'string', description: 'A single read-only SQL SELECT.' } },
        required: ['sql'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true, gated: false },
      execute: (input) =>
        guarded(() => {
          const sql = stringField(input, 'sql');
          if (sql === null) throw new Error('query expects { sql: string }.');
          return host.query(sql);
        }),
    },
    {
      name: 'proposeCell',
      description:
        'Add an UN-RUN SQL cell carrying the given query to the notebook, for the human to review and run. Returns { id, sql, editable: true } — the agent proposes, the human executes. Requires agent write access.',
      inputSchema: {
        type: 'object',
        properties: { sql: { type: 'string', description: 'SQL to seed the proposed cell.' } },
        required: ['sql'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false, gated: true },
      execute: (input) =>
        guarded(() => {
          gate();
          const sql = stringField(input, 'sql');
          if (sql === null) throw new Error('proposeCell expects { sql: string }.');
          return host.proposeCell(sql);
        }),
    },
    {
      name: 'runCell',
      description:
        'Run an existing notebook cell by id. This executes SQL against the engine, so it requires agent write access.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'The cell id to run.' } },
        required: ['id'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false, gated: true },
      execute: (input) =>
        guarded(() => {
          gate();
          const id = stringField(input, 'id');
          if (id === null) throw new Error('runCell expects { id: string }.');
          return host.runCell(id);
        }),
    },
  ];
}

/**
 * Dispatch a verb by name against a built tool list. The `window.naklidata`
 * binding and a future WebMCP adapter both route through here, so name
 * resolution + the unknown-verb error live in one place.
 */
export async function dispatchAgentTool(
  tools: AgentTool[],
  name: string,
  input: unknown,
): Promise<AgentToolResult> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    return {
      ok: false,
      error: `Unknown verb "${name}". Available: ${tools.map((t) => t.name).join(', ')}.`,
    };
  }
  return tool.execute(input);
}
