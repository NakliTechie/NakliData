// Shared types for the taxonomy bundle + classification pipeline.

export type DetectorKind =
  | 'header_match'
  | 'regex'
  | 'checksum'
  | 'value_set'
  | 'range_numeric'
  | 'distribution';

export interface DetectorSpec {
  kind: DetectorKind;
  weight: number;
  /** header_match */
  patterns?: string[];
  /** regex */
  pattern?: string;
  /** checksum */
  fn?: string;
  /** value_set */
  values?: string[];
  /** range_numeric */
  min?: number;
  max?: number;
  /** distribution */
  high_cardinality?: boolean;
  low_cardinality?: boolean;
  numeric?: boolean;
  min_length?: number;
  max_length?: number;
}

/**
 * Sensitivity classification for a semantic type. Drives badge
 * rendering in the schema panel (W5.4) and is the substrate for
 * future PII guards (e.g., warn-on-save if a `.naklidata` carries
 * PII columns; sensitivity-aware demo mode that masks values, not
 * just headers).
 *
 * - `'public'` (default if absent) — no sensitivity concerns
 *   (vendor_name, sku, log_level, http_status, country_code, …).
 * - `'pii'` — identifies an individual (email, phone_e164, user_id,
 *   session_id, ip_v4/v6, event_properties_json — JSON payloads
 *   commonly carry name/email/etc.).
 * - `'financial'` — money or financial-system identifiers (amount,
 *   gstin, pan, iban, swift_bic, indian_bank_account, gst_rate,
 *   gl_account, hsn_code, currency_iso).
 * - `'secret'` — credentials, tokens, keys. Not currently used in
 *   v0.1 taxonomy but reserved.
 */
export type TypeSensitivity = 'public' | 'pii' | 'financial' | 'secret';

export interface TypeSpec {
  id: string;
  display_name: string;
  domain: string;
  sql_compat: string[];
  detectors: DetectorSpec[];
  confidence_floor: number;
  seed_origin?: string;
  // Sensitivity is NO LONGER on the type (decision #4, 2026-07-14): it migrated
  // to the Tier-3 universal layer. Resolve it with `sensitivityForType(bundle,
  // typeId)` from `./universal.ts`, never off this spec.
}

export interface DomainSpec {
  domain: string;
  label: string;
  types: string[];
  report_templates?: string[];
}

/**
 * Tier-3 analytical function of a universal_term — dbt semantic-layer style.
 * `entity` (identity/grain), `dimension` (group/filter by), `measure`
 * (additive quantity), `metric` (derived ratio). The report engine reads this
 * to place columns (decision #5: report_slot lives with the engine, not here).
 */
export type RoleFamily = 'entity' | 'dimension' | 'measure' | 'metric';

/**
 * A UniversalTerm (Tier-3) — an abstract SKOS concept above the flat `typeId`s.
 * Carries the canonical `sensitivity` (migrated off {@link TypeSpec}, decision
 * #4), the `roleFamily`, `skos:broader` ladder, and cross-vocabulary
 * `exactMatch` links (schema/fhir/ocds/dbt). See `universal-terms/SPEC.md`.
 */
export interface UniversalTerm {
  /** `ut:`-prefixed id (decision #6). */
  id: string;
  prefLabel: string;
  /** `skos:broader` parents — must resolve within the scheme, acyclic. */
  broader?: string[];
  roleFamily: RoleFamily;
  /** Canonical sensitivity home. */
  sensitivity: TypeSensitivity;
  /** Cross-vocabulary links, e.g. `schema:MonetaryAmount`, `fhir:Patient`. */
  exactMatch?: string[];
}

/** One `naklidata_role (typeId) → universal_term` crosswalk mapping. */
export interface CrosswalkEntry {
  role: string;
  universalTerm: string;
  /** Per-role override of the concept's default sensitivity (edge cases). */
  sensitivity?: TypeSensitivity;
  /** Per-role override of the concept's default roleFamily (edge cases). */
  roleFamily?: RoleFamily;
}

/** The Tier-3 layer: the concept scheme + the role→concept crosswalk. */
export interface UniversalLayer {
  terms: UniversalTerm[];
  crosswalk: CrosswalkEntry[];
}

export interface TaxonomyBundle {
  version: string;
  released: string;
  domains: DomainSpec[];
  types: TypeSpec[];
  /** Optional. Present when the bundle ships `relationships.json`. */
  relationships?: TypeRelationship[];
  /** Tier-3 UniversalTerm layer. Present when the bundle ships `universal/`. */
  universal?: UniversalLayer;
}

/** Edge in the taxonomy's type-relationship graph. */
export interface TypeRelationship {
  from: string;
  to: string;
  /** Free-text relationship kind: 'identifies', 'embeds', 'pairs_with', etc. */
  kind: string;
  /** Optional human note explaining the relationship. */
  note?: string;
}

/** Sample of one column passed into the detector pipeline. */
export interface ColumnSample {
  tableName: string;
  columnName: string;
  sqlType: string;
  /** Non-null sample values, stringified. */
  values: string[];
  /** Total rows considered (including nulls). */
  totalSampled: number;
  /** Null count in the sample. */
  nullCount: number;
  /** Distinct value count in the sample. */
  distinctCount: number;
}

export interface DetectorResult {
  /** 0..1 raw match score for this detector before weighting. */
  score: number;
  /** Whether the detector considers itself "applicable" at all. */
  applicable: boolean;
  /** Short human-readable evidence string for the schema panel. */
  evidence: string;
}

export interface TypeCandidate {
  typeId: string;
  displayName: string;
  confidence: number;
  evidence: string[];
}

export interface ClassificationResult {
  column: ColumnSample;
  candidates: TypeCandidate[];
  /** Resolved decision after Phase 2 — what the UI should default to. */
  resolution:
    | { kind: 'auto_accept'; typeId: string; confidence: number }
    | { kind: 'ambiguous'; choices: TypeCandidate[] }
    | { kind: 'unknown'; base: string };
}
