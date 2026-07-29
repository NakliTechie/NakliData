import type { RoleFamily, TypeSensitivity } from '../taxonomy/types.ts';
import type { MeasureFormat } from './measures.ts';
import type { SourceKind } from './mount.ts';

export type SemanticFieldKind = 'dimension' | 'time_dimension' | 'fact';
export type RelationshipCardinality =
  | 'one_to_one'
  | 'one_to_many'
  | 'many_to_one'
  | 'many_to_many'
  | 'unknown';

export interface GovernanceMetadata {
  owner: string | null;
  certification: 'certified' | 'draft' | 'deprecated' | null;
  deprecated: boolean;
  businessTerms: string[];
}

export interface PhysicalBinding {
  sourceId: string;
  sourceKind: SourceKind;
  mountedTableId: string;
  relation: string;
  catalog: string | null;
  database: string | null;
  schema: string | null;
  table: string;
  qualifiedName: string | null;
}

export interface SemanticField {
  name: string;
  expression: string;
  dataType: string;
  kind: SemanticFieldKind;
  roleFamily: RoleFamily | null;
  semanticTypeId: string | null;
  semanticTypeName: string | null;
  sensitivity: TypeSensitivity | null;
  synonyms: string[];
  description: string;
  governance: GovernanceMetadata;
}

export interface LogicalTable {
  id: string;
  name: string;
  label: string;
  description: string;
  synonyms: string[];
  binding: PhysicalBinding;
  fields: SemanticField[];
  grain: { columns: string[]; verified: boolean };
  governance: GovernanceMetadata;
}

export interface SemanticMeasure {
  name: string;
  tableId: string | null;
  expression: string;
  format: MeasureFormat;
  description: string;
  synonyms: string[];
  governance: GovernanceMetadata;
}

export interface SemanticDimension {
  name: string;
  tableId: string | null;
  expression: string;
  kind: 'dimension' | 'time_dimension';
  description: string;
  synonyms: string[];
  governance: GovernanceMetadata;
}

export interface SemanticFilter {
  name: string;
  tableId: string | null;
  expression: string;
  description: string;
  synonyms: string[];
  governance: GovernanceMetadata;
}

export interface SemanticRelationship {
  id: string;
  name: string;
  fromTableId: string;
  toTableId: string;
  columnPairs: Array<{ from: string; to: string }>;
  cardinality: RelationshipCardinality;
  joinPath: string[];
  description: string;
  governance: GovernanceMetadata;
}

export interface VerifiedQuery {
  name: string;
  question: string;
  sql: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
}

export interface PortableSemanticModel {
  format: 'naklidata-semantic-model';
  version: 1;
  name: string;
  description: string;
  tables: LogicalTable[];
  dimensions: SemanticDimension[];
  measures: SemanticMeasure[];
  filters: SemanticFilter[];
  relationships: SemanticRelationship[];
  verifiedQueries: VerifiedQuery[];
  governance: GovernanceMetadata;
}

export interface AdapterIssue {
  severity: 'warning' | 'error';
  code: string;
  message: string;
  path: string | null;
}

export interface SemanticAdapterResult {
  platform: 'databricks-metric-view' | 'snowflake-semantic-view';
  formatVersion: string;
  deployable: boolean;
  document: Record<string, unknown>;
  yaml: string;
  issues: AdapterIssue[];
}
