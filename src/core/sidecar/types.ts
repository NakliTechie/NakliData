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

export type SidecarProvider = 'anthropic' | 'openai';

export interface SidecarProviderConfig {
  provider: SidecarProvider;
  model: string;
}

/** Defaults the BYOK + sidecar surface picks when nothing is set yet. */
export const DEFAULT_PROVIDER_CONFIG: Record<SidecarProvider, SidecarProviderConfig> = {
  anthropic: { provider: 'anthropic', model: 'claude-3-5-haiku-latest' },
  openai: { provider: 'openai', model: 'gpt-4o-mini' },
};

/** A sidecar job is a tagged input asking the model to do one specific thing. */
export type SidecarJob = ExplainErrorJob | DisambiguateTypeJob;

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

/** A sidecar response is a tagged structured output. */
export type SidecarResponse = ExplainErrorResponse | DisambiguateTypeResponse;

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
