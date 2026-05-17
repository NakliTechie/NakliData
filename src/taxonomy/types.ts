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

export interface TypeSpec {
  id: string;
  display_name: string;
  domain: string;
  sql_compat: string[];
  detectors: DetectorSpec[];
  confidence_floor: number;
  seed_origin?: string;
}

export interface DomainSpec {
  domain: string;
  label: string;
  types: string[];
  report_templates?: string[];
}

export interface TaxonomyBundle {
  version: string;
  released: string;
  domains: DomainSpec[];
  types: TypeSpec[];
  /** Optional. Present when the bundle ships `relationships.json`. */
  relationships?: TypeRelationship[];
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
