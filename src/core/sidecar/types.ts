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
  | RecommendReportsJob;

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

/** A sidecar response is a tagged structured output. */
export type SidecarResponse =
  | ExplainErrorResponse
  | DisambiguateTypeResponse
  | DefineTypeResponse
  | RecommendReportsResponse;

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
