// Sidecar surface — shared types between the BYOK store, the provider
// clients, and the job-dispatch layer.
//
// Spec §4.3 (v1.1) defines three jobs:
//   1. Type disambiguation (later wave)
//   2. Explain query error (this wave)
//   3. Define-new type assist (later wave)
//
// All sidecar jobs honor the same constraints:
//   - structured outputs, no prose narration of query results
//   - no auto-execute of generated SQL (we only EXPLAIN; we never RUN)
//   - BYOK keys per spec amendment A2 (sessionStorage default, opt-in IDB)

export type SidecarProvider = 'anthropic' | 'openai' | 'custom' | 'local';

export interface SidecarProviderConfig {
  provider: SidecarProvider;
  model: string;
  /** Required for `provider: 'custom'` — the OpenAI-compatible base URL. */
  endpointUrl?: string;
}

/** Defaults the BYOK + sidecar surface picks when nothing is set yet. */
export const DEFAULT_PROVIDER_CONFIG: Record<SidecarProvider, SidecarProviderConfig> = {
  anthropic: { provider: 'anthropic', model: 'claude-3-5-haiku-latest' },
  openai: { provider: 'openai', model: 'gpt-4o-mini' },
  // The 'custom' default has no usable model + endpoint until the user
  // configures one in Settings — the UI surfaces that as a required step.
  custom: { provider: 'custom', model: '', endpointUrl: '' },
  // 'local' runs an in-browser model (Transformers.js). No API key. The
  // model id is an HF ONNX repo; default left blank until slice B picks
  // the shipping model.
  local: { provider: 'local', model: '' },
};

/** A sidecar job is a tagged input asking the model to do one specific thing. */
export type SidecarJob =
  | ExplainErrorJob
  | DisambiguateTypeJob
  | DefineTypeJob
  | RecommendReportsJob
  | SummariseResultJob
  | NlToSqlJob
  | ProposeChartJob;

export interface ExplainErrorJob {
  kind: 'explain-error';
  /** The SQL the user tried to run. */
  sql: string;
  /** DuckDB's error message string. */
  errorMessage: string;
  /**
   * Optional snippet of the active workbook's schema (table → columns)
   * so the model can spot typos and missing tables. Caller decides how
   * much context to ship — typically 1–3 tables, names only, no rows.
   */
  schemaHint?: string;
}

export interface DisambiguateTypeJob {
  kind: 'disambiguate-type';
  /** Column header name. */
  columnName: string;
  /** DuckDB SQL type for the column (e.g., 'VARCHAR', 'BIGINT'). */
  sqlType: string;
  /** Up to 20 non-null sample values, stringified. */
  samples: string[];
  /** Candidate types (typeId + display_name) the column was classified into. */
  candidates: Array<{ typeId: string; displayName: string }>;
}

export interface DefineTypeJob {
  kind: 'define-type';
  /** Column header name. */
  columnName: string;
  /** DuckDB SQL type for the column. */
  sqlType: string;
  /** Up to 20 non-null sample values, stringified. */
  samples: string[];
}

/**
 * Job 4 (Wave 3 / W3.1) — rank the report templates that are ALREADY
 * applicable to the workbook by how well they fit. Structured output
 * only — the model returns template-ids + scores, never prose
 * justification (vision §"What it is not"). The model may only rank ids
 * from `candidates`; the parser drops anything else.
 */
export interface RecommendReportsJob {
  kind: 'recommend-reports';
  /** Candidate templates — the model must only return these ids. */
  candidates: Array<{ templateId: string; name: string; description: string }>;
  /**
   * Compact summary of the workbook's assigned column types, e.g.
   * "invoices: gstin, amount, iso_date; payments: amount, payment_mode".
   * Gives the model context without shipping any row data.
   */
  typeSummary: string;
}

/**
 * Job 6 (Wave 5 / W5.2) — given a small result set produced by an SQL
 * cell, ask the sidecar to emit a one-line observation. Hex Magic's
 * "explain this result" cards are the closest analog; we constrain
 * the model to text under 200 chars, no SQL, no formatting. The
 * caller ships only column names + a tiny sample (first 5 rows
 * typically) — never the full result.
 *
 * Hallucination guard lives in the parser: drop any observation that
 * references a column name not in `columns`. Anchors the model to the
 * data it was actually given.
 */
export interface SummariseResultJob {
  kind: 'summarise-result';
  /** SQL the cell ran (one-line preview, helps the model frame intent). */
  sql: string;
  /** Result column names, in order. */
  columns: string[];
  /**
   * First N rows of the result, stringified. Caller caps at ~5 rows
   * to keep prompts tight + privacy posture clear.
   */
  sampleRows: Array<Record<string, string>>;
  /** Total row count (the sample may be smaller). */
  rowCount: number;
}

/**
 * Job 5 (Wave 5 / W5.1) — natural-language question → DuckDB SQL.
 * Databricks Genie / Snowflake Cortex / Hex Magic pattern, scoped to
 * the currently-mounted workbook.
 *
 * Hallucination guard: the response is rejected when it references
 * tables not in `tables`. We only validate at the table level because
 * column validation requires a real SQL parser. DuckDB will give a
 * crisp error for an unknown column when the user clicks Run, and the
 * user is in the loop anyway (Hard NOT #4 — never auto-execute).
 *
 * Safety: SELECT-only. Any of INSERT/UPDATE/DELETE/CREATE/DROP/ALTER/
 * TRUNCATE/MERGE/CALL surviving in the response → parser drops the
 * whole thing. Even with auto-execute off, suggesting a write is a
 * trap; we don't render it.
 */
export interface NlToSqlJob {
  kind: 'nl-to-sql';
  /** The user's plain-English question. */
  question: string;
  /** Workbook schema — each entry is `{ table, columns }`. The model may
   *  reference these tables and columns only. Keep `columns` lean: order
   *  matches the source, no row samples. */
  tables: Array<{ name: string; columns: string[] }>;
  /** SQL dialect hint embedded in the prompt. Always `'duckdb'` today
   *  (this is what every cell runs against), but explicit makes it
   *  cheap to expand later. */
  dialect?: 'duckdb';
}

/** A sidecar response is a tagged structured output. */
export type SidecarResponse =
  | ExplainErrorResponse
  | DisambiguateTypeResponse
  | DefineTypeResponse
  | RecommendReportsResponse
  | SummariseResultResponse
  | NlToSqlResponse
  | ProposeChartResponse;

export interface ExplainErrorResponse {
  kind: 'explain-error';
  /** 1–3 sentence plain-English explanation. */
  explanation: string;
  /** Optional suggested SQL fix. Not auto-executed (Hard NOT #4). */
  suggestedFix: string | null;
}

export interface DisambiguateTypeResponse {
  kind: 'disambiguate-type';
  /**
   * Chosen typeId from the candidate list, or `null` when the sidecar
   * picks 'unknown' / can't decide.
   */
  typeId: string | null;
}

export interface DefineTypeResponse {
  kind: 'define-type';
  suggestion: {
    /** snake_case identifier. */
    id: string;
    /** Human-readable label, capitalised. */
    display_name: string;
    /** Short category label (e.g., 'Identifier', 'Code', 'Email', 'Domain-specific'). */
    category: string;
    /** JavaScript-compatible regex (anchors included, no `/` delimiters). */
    regex: string;
  };
}

export interface RecommendReportsResponse {
  kind: 'recommend-reports';
  /**
   * Template-ids ranked by fit, highest first. Only ids from the job's
   * candidate list survive parsing; scores are clamped to [0, 1].
   */
  recommendations: Array<{ templateId: string; score: number }>;
}

export interface SummariseResultResponse {
  kind: 'summarise-result';
  /**
   * One-line observation (≤ 200 chars). Parser drops the response
   * entirely if the model emitted text referencing columns not in
   * the input. Empty string means the model declined to summarise.
   */
  observation: string;
}

export interface NlToSqlResponse {
  kind: 'nl-to-sql';
  /**
   * Generated SQL, ready to drop into a new SQL cell. Empty string
   * means the parser rejected the response (write statement, unknown
   * table, empty body, or junk). The caller is responsible for the
   * "no SQL produced" UX when this is empty.
   *
   * Critically: this SQL is NEVER auto-executed (Hard NOT #4). The UI
   * inserts a cell with the code pre-filled and waits for the user to
   * click Run.
   */
  sql: string;
}

/**
 * Job 7 (v1.2 / M4) — propose a chart configuration for a SQL cell's
 * result. **Structured config only — NO PROSE** (handoff §10 Hard NOT
 * #6). The sidecar returns a ChartProposal that the existing chart
 * cell can ingest verbatim; the proposal chip appears next to the
 * result table and the user clicks to materialise.
 *
 * Hallucination guard in the parser: `xColumn` / `yColumn` /
 * `groupColumn` must all be present in `columns` (or null). Anything
 * else → drop the proposal.
 */
export interface ProposeChartJob {
  kind: 'propose-chart';
  /** The SQL the cell ran (one-line preview — gives the model intent). */
  sql: string;
  /** Result column names + DuckDB SQL types (in order). */
  columns: Array<{ name: string; sqlType: string }>;
  /**
   * Up to 10 rows from the result, stringified. The sidecar uses
   * these to gauge cardinality + numeric vs categorical shape. Caller
   * caps at 10 rows for privacy + prompt size.
   */
  sampleRows: Array<Record<string, string>>;
  /** Total row count in the result (sample may be smaller). */
  rowCount: number;
}

/**
 * Sidecar wraps the canonical `ChartConfig` schema from
 * `src/core/chart-config.ts` (v1.3 M0 — single source of truth for
 * chart configuration across three producers: manual / sidecar /
 * shelves). A null proposal means the parser rejected the model's
 * output.
 */
export interface ProposeChartResponse {
  kind: 'propose-chart';
  proposal: import('../chart-config.ts').ChartConfig | null;
}

export class SidecarError extends Error {
  constructor(
    message: string,
    public readonly kind:
      | 'no-key'
      | 'no-provider'
      | 'http'
      | 'parse'
      | 'rate-limit'
      | 'unsupported',
  ) {
    super(message);
    this.name = 'SidecarError';
  }
}
