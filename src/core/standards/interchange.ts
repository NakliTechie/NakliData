/**
 * Standards interchange foundation.
 *
 * This module is intentionally unreachable from the eager application graph.
 * Standards adapters load it through `src/lazy/standards/*` so the core shell
 * does not pay for RDF parsing, serialization, or conformance tooling.
 */

export const INTERCHANGE_FORMAT = 'naklidata-canonical-interchange' as const;
export const INTERCHANGE_VERSION = 1 as const;
export const NAKLIDATA_VOCABULARY_IRI = 'https://naklidata.dev/ns/interchange/v1#' as const;

export const RESOURCE_KINDS = [
  'workbook',
  'source',
  'table',
  'field',
  'concept',
  'relationship',
  'assertion',
  'entity',
  'activity',
  'agent',
] as const;

export type ResourceKind = (typeof RESOURCE_KINDS)[number];
export type CanonicalId = `nd:${ResourceKind}:${string}`;

export interface NamespaceContract {
  /** Absolute IRI ending in `/` or `#`; canonical resource IDs append here. */
  baseIri: string;
  /** Compact-name prefixes. `nd` is mandatory and immutable. */
  prefixes: Record<string, string>;
}

export interface LocalizedLabel {
  value: string;
  /** Lowercase BCP-47-shaped tag, or null for an untagged string. */
  language: string | null;
}

export interface WorkbookContract {
  id: CanonicalId;
  label: string;
}

export interface SourceContract {
  id: CanonicalId;
  workbookId: CanonicalId;
  label: string;
  sourceKind: string;
  /** Opaque, stable source identity. It must not contain a URL, path, or credential. */
  fingerprint: string;
}

export interface TableContract {
  id: CanonicalId;
  sourceId: CanonicalId;
  name: string;
  label: string;
}

export interface FieldContract {
  id: CanonicalId;
  tableId: CanonicalId;
  name: string;
  dataType: string;
  conceptIds: CanonicalId[];
}

export type ConceptMappingKind = 'exact' | 'close' | 'broad' | 'narrow' | 'related';

export interface ConceptMappingContract {
  kind: ConceptMappingKind;
  targetIri: string;
}

export interface ConceptContract {
  id: CanonicalId;
  kind: 'scheme' | 'concept';
  schemeId: CanonicalId | null;
  preferredLabels: LocalizedLabel[];
  alternateLabels: LocalizedLabel[];
  broaderIds: CanonicalId[];
  relatedIds: CanonicalId[];
  mappings: ConceptMappingContract[];
}

export type RelationshipCardinality =
  | 'one_to_one'
  | 'one_to_many'
  | 'many_to_one'
  | 'many_to_many'
  | 'unknown';

export interface RelationshipContract {
  id: CanonicalId;
  fromTableId: CanonicalId;
  toTableId: CanonicalId;
  columnPairs: Array<{ fromFieldId: CanonicalId; toFieldId: CanonicalId }>;
  cardinality: RelationshipCardinality;
}

export type ConstraintKind =
  | 'min_count'
  | 'max_count'
  | 'datatype'
  | 'min_inclusive'
  | 'max_inclusive'
  | 'pattern'
  | 'enumeration';

export interface ConstraintContract {
  id: CanonicalId;
  targetId: CanonicalId;
  kind: ConstraintKind;
  value: number | string | string[];
  execution: 'explicit';
}

export type ProvenanceEntityKind = 'source' | 'table' | 'result' | 'export';
export type ProvenanceActivityKind = 'mount' | 'classify' | 'query' | 'export' | 'annotation';
export type ProvenanceAgentKind = 'person' | 'software' | 'agent';

export interface ProvenanceEntityContract {
  id: CanonicalId;
  kind: ProvenanceEntityKind;
  label: string;
  /** Canonical source/table/field identifier, or null for a generated artifact. */
  resourceId: CanonicalId | null;
  redacted: boolean;
}

export interface ProvenanceActivityContract {
  id: CanonicalId;
  kind: ProvenanceActivityKind;
  startedAt: string | null;
  endedAt: string | null;
}

export interface ProvenanceAgentContract {
  id: CanonicalId;
  kind: ProvenanceAgentKind;
  label: string;
}

export type ProvenanceRelationKind =
  | 'used'
  | 'was_generated_by'
  | 'was_derived_from'
  | 'was_associated_with';

export interface ProvenanceRelationContract {
  kind: ProvenanceRelationKind;
  fromId: CanonicalId;
  toId: CanonicalId;
  /** False denotes a user annotation; it must never be exported as observed lineage. */
  observed: boolean;
}

export interface ProvenanceContract {
  entities: ProvenanceEntityContract[];
  activities: ProvenanceActivityContract[];
  agents: ProvenanceAgentContract[];
  relations: ProvenanceRelationContract[];
}

export type LossSeverity = 'information' | 'warning' | 'error';

export interface LossRecord {
  severity: LossSeverity;
  code: string;
  path: string;
  construct: string;
  message: string;
}

export interface CanonicalInterchangeV1 {
  format: typeof INTERCHANGE_FORMAT;
  version: typeof INTERCHANGE_VERSION;
  namespace: NamespaceContract;
  workbook: WorkbookContract;
  sources: SourceContract[];
  tables: TableContract[];
  fields: FieldContract[];
  concepts: ConceptContract[];
  relationships: RelationshipContract[];
  constraints: ConstraintContract[];
  provenance: ProvenanceContract;
  losses: LossRecord[];
}

/** The only pre-release shape accepted by the migration boundary. */
export interface CanonicalInterchangeV0
  extends Omit<CanonicalInterchangeV1, 'version' | 'namespace' | 'losses'> {
  version: 0;
  baseIri: string;
  prefixes: Record<string, string>;
}

export interface ValidationIssue {
  code: string;
  path: string;
  message: string;
}

export interface MigrationResult {
  document: CanonicalInterchangeV1;
  fromVersion: 0 | 1;
  losses: LossRecord[];
}

const RESOURCE_KIND_SET: ReadonlySet<string> = new Set(RESOURCE_KINDS);
const PREFIX_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const LOCAL_ID_PATTERN = /^(?:[A-Za-z0-9._~-]|%[0-9A-F]{2})+$/;
const LANGUAGE_PATTERN = /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/;
const CONCEPT_KINDS: ReadonlySet<string> = new Set(['scheme', 'concept']);
const CONCEPT_MAPPING_KINDS: ReadonlySet<string> = new Set([
  'exact',
  'close',
  'broad',
  'narrow',
  'related',
]);
const CARDINALITIES: ReadonlySet<string> = new Set([
  'one_to_one',
  'one_to_many',
  'many_to_one',
  'many_to_many',
  'unknown',
]);
const CONSTRAINT_KINDS: ReadonlySet<string> = new Set([
  'min_count',
  'max_count',
  'datatype',
  'min_inclusive',
  'max_inclusive',
  'pattern',
  'enumeration',
]);
const PROVENANCE_ENTITY_KINDS: ReadonlySet<string> = new Set([
  'source',
  'table',
  'result',
  'export',
]);
const PROVENANCE_ACTIVITY_KINDS: ReadonlySet<string> = new Set([
  'mount',
  'classify',
  'query',
  'export',
  'annotation',
]);
const PROVENANCE_AGENT_KINDS: ReadonlySet<string> = new Set(['person', 'software', 'agent']);
const PROVENANCE_RELATION_KINDS: ReadonlySet<string> = new Set([
  'used',
  'was_generated_by',
  'was_derived_from',
  'was_associated_with',
]);
const LOSS_SEVERITIES: ReadonlySet<string> = new Set(['information', 'warning', 'error']);

/**
 * Build a reversible ID from a persisted opaque key.
 *
 * Callers must not pass a raw path, URL, credential, or source value. The
 * encoded segment is an identifier, not a confidentiality boundary.
 */
export function canonicalId(kind: ResourceKind, stableOpaqueKey: string): CanonicalId {
  const key = stableOpaqueKey.trim();
  if (!key) throw new TypeError('Canonical identifier key is required.');
  const encoded = encodeURIComponent(key).replace(/%[0-9a-f]{2}/g, (token) => token.toUpperCase());
  if (encoded.length > 256) throw new TypeError('Canonical identifier key exceeds 256 bytes.');
  return `nd:${kind}:${encoded}`;
}

export function resourceKindOf(id: string): ResourceKind | null {
  const match = /^nd:([^:]+):(.+)$/.exec(id);
  if (!match?.[1] || !match[2] || !RESOURCE_KIND_SET.has(match[1])) return null;
  if (!LOCAL_ID_PATTERN.test(match[2])) return null;
  return match[1] as ResourceKind;
}

export function canonicalIri(namespace: NamespaceContract, id: CanonicalId): string {
  validateNamespace(namespace);
  if (!resourceKindOf(id)) throw new TypeError(`Invalid canonical identifier: ${id}`);
  return `${namespace.baseIri}${id}`;
}

export function validateCanonicalInterchange(document: CanonicalInterchangeV1): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (document.format !== INTERCHANGE_FORMAT) {
    addIssue(issues, 'format', 'format', `format must be ${INTERCHANGE_FORMAT}.`);
  }
  if (document.version !== INTERCHANGE_VERSION) {
    addIssue(issues, 'version', 'version', `version must be ${INTERCHANGE_VERSION}.`);
  }
  try {
    validateNamespace(document.namespace);
  } catch (error) {
    addIssue(issues, 'namespace', 'namespace', errorMessage(error));
  }

  validateId(document.workbook.id, 'workbook', 'workbook.id', issues);
  if (!document.workbook.label.trim())
    addIssue(issues, 'required', 'workbook.label', 'label is required.');

  const allIds = new Map<string, string>();
  registerId(document.workbook.id, 'workbook.id', allIds, issues);
  for (const [index, source] of document.sources.entries()) {
    const path = `sources[${index}]`;
    validateId(source.id, 'source', `${path}.id`, issues);
    registerId(source.id, `${path}.id`, allIds, issues);
    validateId(source.workbookId, 'workbook', `${path}.workbookId`, issues);
    if (source.workbookId !== document.workbook.id) {
      addIssue(
        issues,
        'unknown_reference',
        `${path}.workbookId`,
        'source must reference the document workbook.',
      );
    }
    if (!source.label.trim()) addIssue(issues, 'required', `${path}.label`, 'label is required.');
    if (!source.sourceKind.trim())
      addIssue(issues, 'required', `${path}.sourceKind`, 'sourceKind is required.');
    if (!source.fingerprint.trim())
      addIssue(issues, 'required', `${path}.fingerprint`, 'fingerprint is required.');
    if (/[:/\\]|\s/.test(source.fingerprint)) {
      addIssue(
        issues,
        'non_opaque_fingerprint',
        `${path}.fingerprint`,
        'fingerprint must be opaque and path-free.',
      );
    }
  }

  const sourceIds = new Set(document.sources.map((item) => item.id));
  for (const [index, table] of document.tables.entries()) {
    const path = `tables[${index}]`;
    validateId(table.id, 'table', `${path}.id`, issues);
    registerId(table.id, `${path}.id`, allIds, issues);
    validateReference(table.sourceId, sourceIds, `${path}.sourceId`, issues);
    if (!table.name.trim()) addIssue(issues, 'required', `${path}.name`, 'name is required.');
    if (!table.label.trim()) addIssue(issues, 'required', `${path}.label`, 'label is required.');
  }

  const tableIds = new Set(document.tables.map((item) => item.id));
  for (const [index, field] of document.fields.entries()) {
    const path = `fields[${index}]`;
    validateId(field.id, 'field', `${path}.id`, issues);
    registerId(field.id, `${path}.id`, allIds, issues);
    validateReference(field.tableId, tableIds, `${path}.tableId`, issues);
    if (!field.name.trim()) addIssue(issues, 'required', `${path}.name`, 'name is required.');
    if (!field.dataType.trim())
      addIssue(issues, 'required', `${path}.dataType`, 'dataType is required.');
  }

  const conceptIds = new Set(document.concepts.map((item) => item.id));
  const schemeIds = new Set(
    document.concepts.filter((item) => item.kind === 'scheme').map((item) => item.id),
  );
  for (const [index, concept] of document.concepts.entries()) {
    const path = `concepts[${index}]`;
    validateId(concept.id, 'concept', `${path}.id`, issues);
    registerId(concept.id, `${path}.id`, allIds, issues);
    if (!CONCEPT_KINDS.has(concept.kind)) {
      addIssue(issues, 'concept_kind', `${path}.kind`, 'concept kind is unsupported.');
    }
    if (concept.kind === 'scheme') {
      if (concept.schemeId !== null) {
        addIssue(
          issues,
          'concept_scheme',
          `${path}.schemeId`,
          'a concept scheme must have a null schemeId.',
        );
      }
    } else if (concept.kind === 'concept') {
      if (concept.schemeId === null) {
        addIssue(
          issues,
          'concept_scheme',
          `${path}.schemeId`,
          'a concept must reference a scheme.',
        );
      } else {
        validateId(concept.schemeId, 'concept', `${path}.schemeId`, issues);
        validateReference(concept.schemeId, schemeIds, `${path}.schemeId`, issues);
      }
    }
    validateLabels(concept.preferredLabels, `${path}.preferredLabels`, true, issues);
    validateLabels(concept.alternateLabels, `${path}.alternateLabels`, false, issues);
    validateReferences(concept.broaderIds, conceptIds, `${path}.broaderIds`, issues);
    validateReferences(concept.relatedIds, conceptIds, `${path}.relatedIds`, issues);
    for (const [mappingIndex, mapping] of concept.mappings.entries()) {
      if (!CONCEPT_MAPPING_KINDS.has(mapping.kind)) {
        addIssue(
          issues,
          'mapping_kind',
          `${path}.mappings[${mappingIndex}].kind`,
          'mapping kind is unsupported.',
        );
      }
      if (!isAbsoluteIri(mapping.targetIri)) {
        addIssue(
          issues,
          'iri',
          `${path}.mappings[${mappingIndex}].targetIri`,
          'mapping target must be an absolute IRI.',
        );
      }
    }
  }
  for (const [index, field] of document.fields.entries()) {
    validateReferences(field.conceptIds, conceptIds, `fields[${index}].conceptIds`, issues);
  }

  const fieldIds = new Set(document.fields.map((item) => item.id));
  for (const [index, relationship] of document.relationships.entries()) {
    const path = `relationships[${index}]`;
    validateId(relationship.id, 'relationship', `${path}.id`, issues);
    registerId(relationship.id, `${path}.id`, allIds, issues);
    validateReference(relationship.fromTableId, tableIds, `${path}.fromTableId`, issues);
    validateReference(relationship.toTableId, tableIds, `${path}.toTableId`, issues);
    if (!CARDINALITIES.has(relationship.cardinality)) {
      addIssue(issues, 'cardinality', `${path}.cardinality`, 'cardinality is unsupported.');
    }
    if (relationship.columnPairs.length === 0) {
      addIssue(issues, 'required', `${path}.columnPairs`, 'at least one column pair is required.');
    }
    for (const [pairIndex, pair] of relationship.columnPairs.entries()) {
      validateReference(
        pair.fromFieldId,
        fieldIds,
        `${path}.columnPairs[${pairIndex}].fromFieldId`,
        issues,
      );
      validateReference(
        pair.toFieldId,
        fieldIds,
        `${path}.columnPairs[${pairIndex}].toFieldId`,
        issues,
      );
      if (!fieldBelongsToTable(pair.fromFieldId, relationship.fromTableId, document.fields)) {
        addIssue(
          issues,
          'field_ownership',
          `${path}.columnPairs[${pairIndex}].fromFieldId`,
          'field does not belong to fromTableId.',
        );
      }
      if (!fieldBelongsToTable(pair.toFieldId, relationship.toTableId, document.fields)) {
        addIssue(
          issues,
          'field_ownership',
          `${path}.columnPairs[${pairIndex}].toFieldId`,
          'field does not belong to toTableId.',
        );
      }
    }
  }

  const constraintTargets = new Set([...tableIds, ...fieldIds]);
  for (const [index, constraint] of document.constraints.entries()) {
    const path = `constraints[${index}]`;
    validateId(constraint.id, 'assertion', `${path}.id`, issues);
    registerId(constraint.id, `${path}.id`, allIds, issues);
    validateReference(constraint.targetId, constraintTargets, `${path}.targetId`, issues);
    if (!CONSTRAINT_KINDS.has(constraint.kind)) {
      addIssue(issues, 'constraint_kind', `${path}.kind`, 'constraint kind is unsupported.');
    }
    if (constraint.execution !== 'explicit') {
      addIssue(
        issues,
        'execution',
        `${path}.execution`,
        'constraint execution must remain explicit.',
      );
    }
    validateConstraintValue(constraint, path, issues);
  }

  validateProvenance(document.provenance, allIds, issues);
  for (const [index, loss] of document.losses.entries()) validateLoss(loss, index, issues);
  return issues;
}

export function assertCanonicalInterchange(document: CanonicalInterchangeV1): void {
  const issues = validateCanonicalInterchange(document);
  if (issues.length === 0) return;
  throw new TypeError(issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
}

export function migrateCanonicalInterchange(value: unknown): MigrationResult {
  const source = requireObject(value, 'interchange document');
  if (source.format !== INTERCHANGE_FORMAT)
    throw new TypeError(`Unsupported interchange format: ${String(source.format)}`);
  if (source.version === 1) {
    const document = source as unknown as CanonicalInterchangeV1;
    assertCanonicalInterchange(document);
    return { document, fromVersion: 1, losses: [...document.losses] };
  }
  if (source.version !== 0)
    throw new TypeError(`Unsupported interchange version: ${String(source.version)}`);
  const v0 = source as unknown as CanonicalInterchangeV0;
  const migrationLoss: LossRecord = {
    severity: 'information',
    code: 'migration.v0.namespace_wrapped',
    path: 'namespace',
    construct: 'v0 baseIri/prefixes',
    message: 'Version 0 namespace fields moved under namespace without semantic loss.',
  };
  const document: CanonicalInterchangeV1 = {
    format: INTERCHANGE_FORMAT,
    version: INTERCHANGE_VERSION,
    namespace: { baseIri: v0.baseIri, prefixes: { ...v0.prefixes } },
    workbook: v0.workbook,
    sources: v0.sources,
    tables: v0.tables,
    fields: v0.fields,
    concepts: v0.concepts,
    relationships: v0.relationships,
    constraints: v0.constraints,
    provenance: v0.provenance,
    losses: [migrationLoss],
  };
  assertCanonicalInterchange(document);
  return { document, fromVersion: 0, losses: [migrationLoss] };
}

/** Stable JSON: object keys sort lexically; array order remains contract-significant. */
export function serializeCanonicalInterchange(document: CanonicalInterchangeV1): string {
  assertCanonicalInterchange(document);
  return `${JSON.stringify(sortObjectKeys(document), null, 2)}\n`;
}

export function appendLoss(losses: ReadonlyArray<LossRecord>, next: LossRecord): LossRecord[] {
  const key = lossKey(next);
  const unique = [...losses.filter((loss) => lossKey(loss) !== key), next];
  return unique.sort((left, right) => lossKey(left).localeCompare(lossKey(right)));
}

function validateNamespace(namespace: NamespaceContract): void {
  if (!isAbsoluteIri(namespace.baseIri) || !/[\/#]$/.test(namespace.baseIri)) {
    throw new TypeError('baseIri must be an absolute IRI ending in / or #.');
  }
  if (namespace.prefixes.nd !== NAKLIDATA_VOCABULARY_IRI) {
    throw new TypeError(`prefix nd must equal ${NAKLIDATA_VOCABULARY_IRI}.`);
  }
  for (const [prefix, iri] of Object.entries(namespace.prefixes)) {
    if (!PREFIX_PATTERN.test(prefix)) throw new TypeError(`Invalid namespace prefix: ${prefix}`);
    if (!isAbsoluteIri(iri)) throw new TypeError(`Prefix ${prefix} must map to an absolute IRI.`);
  }
}

function validateId(
  id: string,
  expected: ResourceKind,
  path: string,
  issues: ValidationIssue[],
): void {
  const actual = resourceKindOf(id);
  if (actual !== expected)
    addIssue(issues, 'identifier', path, `expected nd:${expected}: identifier.`);
}

function registerId(
  id: string,
  path: string,
  ids: Map<string, string>,
  issues: ValidationIssue[],
): void {
  const first = ids.get(id);
  if (first)
    addIssue(issues, 'duplicate_identifier', path, `identifier already occurs at ${first}.`);
  else ids.set(id, path);
}

function validateReference(
  id: string,
  ids: ReadonlySet<string>,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!ids.has(id)) addIssue(issues, 'unknown_reference', path, `unknown identifier ${id}.`);
}

function validateReferences(
  ids: string[],
  known: ReadonlySet<string>,
  path: string,
  issues: ValidationIssue[],
): void {
  const seen = new Set<string>();
  for (const [index, id] of ids.entries()) {
    validateReference(id, known, `${path}[${index}]`, issues);
    if (seen.has(id))
      addIssue(issues, 'duplicate_reference', `${path}[${index}]`, `duplicate identifier ${id}.`);
    seen.add(id);
  }
}

function validateLabels(
  labels: LocalizedLabel[],
  path: string,
  required: boolean,
  issues: ValidationIssue[],
): void {
  if (required && labels.length === 0)
    addIssue(issues, 'required', path, 'at least one preferred label is required.');
  const languages = new Set<string>();
  for (const [index, label] of labels.entries()) {
    if (!label.value.trim())
      addIssue(issues, 'required', `${path}[${index}].value`, 'label value is required.');
    if (label.language !== null && !LANGUAGE_PATTERN.test(label.language)) {
      addIssue(
        issues,
        'language',
        `${path}[${index}].language`,
        'language tag must be lowercase BCP-47-shaped text.',
      );
    }
    const key = label.language ?? '';
    if (required && languages.has(key)) {
      addIssue(
        issues,
        'duplicate_language',
        `${path}[${index}].language`,
        'preferred labels require at most one value per language.',
      );
    }
    languages.add(key);
  }
}

function fieldBelongsToTable(fieldId: string, tableId: string, fields: FieldContract[]): boolean {
  return fields.some((field) => field.id === fieldId && field.tableId === tableId);
}

function validateConstraintValue(
  constraint: ConstraintContract,
  path: string,
  issues: ValidationIssue[],
): void {
  if (constraint.kind === 'enumeration') {
    if (!Array.isArray(constraint.value) || constraint.value.length === 0) {
      addIssue(
        issues,
        'constraint_value',
        `${path}.value`,
        'enumeration requires at least one string.',
      );
    } else if (constraint.value.some((value) => typeof value !== 'string')) {
      addIssue(issues, 'constraint_value', `${path}.value`, 'enumeration values must be strings.');
    }
    return;
  }
  if (constraint.kind === 'min_count' || constraint.kind === 'max_count') {
    if (
      typeof constraint.value !== 'number' ||
      !Number.isInteger(constraint.value) ||
      constraint.value < 0
    ) {
      addIssue(
        issues,
        'constraint_value',
        `${path}.value`,
        'count requires a non-negative integer.',
      );
    }
    return;
  }
  if (constraint.kind === 'min_inclusive' || constraint.kind === 'max_inclusive') {
    if (typeof constraint.value !== 'number' || !Number.isFinite(constraint.value)) {
      addIssue(issues, 'constraint_value', `${path}.value`, 'range requires a finite number.');
    }
    return;
  }
  if (typeof constraint.value !== 'string' || !constraint.value.trim()) {
    addIssue(
      issues,
      'constraint_value',
      `${path}.value`,
      `${constraint.kind} requires a non-empty string.`,
    );
  }
}

function validateProvenance(
  provenance: ProvenanceContract,
  resourceIds: Map<string, string>,
  issues: ValidationIssue[],
): void {
  const provenanceIds = new Set<string>();
  for (const [index, entity] of provenance.entities.entries()) {
    const path = `provenance.entities[${index}]`;
    validateId(entity.id, 'entity', `${path}.id`, issues);
    registerProvenanceId(entity.id, `${path}.id`, provenanceIds, resourceIds, issues);
    if (!PROVENANCE_ENTITY_KINDS.has(entity.kind)) {
      addIssue(issues, 'provenance_entity_kind', `${path}.kind`, 'entity kind is unsupported.');
    }
    if (!entity.label.trim()) addIssue(issues, 'required', `${path}.label`, 'label is required.');
    if (entity.resourceId !== null && !resourceIds.has(entity.resourceId)) {
      addIssue(
        issues,
        'unknown_reference',
        `${path}.resourceId`,
        `unknown identifier ${entity.resourceId}.`,
      );
    }
  }
  for (const [index, activity] of provenance.activities.entries()) {
    const path = `provenance.activities[${index}]`;
    validateId(activity.id, 'activity', `${path}.id`, issues);
    registerProvenanceId(activity.id, `${path}.id`, provenanceIds, resourceIds, issues);
    if (!PROVENANCE_ACTIVITY_KINDS.has(activity.kind)) {
      addIssue(issues, 'provenance_activity_kind', `${path}.kind`, 'activity kind is unsupported.');
    }
    validateTimestamp(activity.startedAt, `${path}.startedAt`, issues);
    validateTimestamp(activity.endedAt, `${path}.endedAt`, issues);
    if (activity.startedAt && activity.endedAt && activity.startedAt > activity.endedAt) {
      addIssue(issues, 'time_order', path, 'startedAt must not follow endedAt.');
    }
  }
  for (const [index, agent] of provenance.agents.entries()) {
    const path = `provenance.agents[${index}]`;
    validateId(agent.id, 'agent', `${path}.id`, issues);
    registerProvenanceId(agent.id, `${path}.id`, provenanceIds, resourceIds, issues);
    if (!PROVENANCE_AGENT_KINDS.has(agent.kind)) {
      addIssue(issues, 'provenance_agent_kind', `${path}.kind`, 'agent kind is unsupported.');
    }
    if (!agent.label.trim()) addIssue(issues, 'required', `${path}.label`, 'label is required.');
  }
  for (const [index, relation] of provenance.relations.entries()) {
    const path = `provenance.relations[${index}]`;
    if (!PROVENANCE_RELATION_KINDS.has(relation.kind)) {
      addIssue(
        issues,
        'provenance_relation_kind',
        `${path}.kind`,
        'provenance relation kind is unsupported.',
      );
      continue;
    }
    validateReference(relation.fromId, provenanceIds, `${path}.fromId`, issues);
    validateReference(relation.toId, provenanceIds, `${path}.toId`, issues);
    validateProvenanceRelationShape(relation, path, provenance, issues);
  }
}

function registerProvenanceId(
  id: string,
  path: string,
  provenanceIds: Set<string>,
  resourceIds: Map<string, string>,
  issues: ValidationIssue[],
): void {
  if (provenanceIds.has(id) || resourceIds.has(id))
    addIssue(issues, 'duplicate_identifier', path, `identifier ${id} is not unique.`);
  provenanceIds.add(id);
}

function validateProvenanceRelationShape(
  relation: ProvenanceRelationContract,
  path: string,
  provenance: ProvenanceContract,
  issues: ValidationIssue[],
): void {
  const entityIds = new Set(provenance.entities.map((item) => item.id));
  const activityIds = new Set(provenance.activities.map((item) => item.id));
  const agentIds = new Set(provenance.agents.map((item) => item.id));
  const valid =
    relation.kind === 'used'
      ? activityIds.has(relation.fromId) && entityIds.has(relation.toId)
      : relation.kind === 'was_generated_by'
        ? entityIds.has(relation.fromId) && activityIds.has(relation.toId)
        : relation.kind === 'was_derived_from'
          ? entityIds.has(relation.fromId) && entityIds.has(relation.toId)
          : activityIds.has(relation.fromId) && agentIds.has(relation.toId);
  if (!valid)
    addIssue(issues, 'provenance_relation', path, `invalid endpoints for ${relation.kind}.`);
}

function validateLoss(loss: LossRecord, index: number, issues: ValidationIssue[]): void {
  const path = `losses[${index}]`;
  if (!LOSS_SEVERITIES.has(loss.severity)) {
    addIssue(issues, 'loss_severity', `${path}.severity`, 'loss severity is unsupported.');
  }
  for (const key of ['code', 'path', 'construct', 'message'] as const) {
    if (!loss[key].trim()) addIssue(issues, 'required', `${path}.${key}`, `${key} is required.`);
  }
}

function validateTimestamp(value: string | null, path: string, issues: ValidationIssue[]): void {
  if (value === null) return;
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    addIssue(issues, 'timestamp', path, 'timestamp must be an ISO-8601 UTC instant.');
  }
}

function addIssue(issues: ValidationIssue[], code: string, path: string, message: string): void {
  issues.push({ code, path, message });
}

function isAbsoluteIri(value: string): boolean {
  try {
    return new URL(value).protocol.length > 1;
  } catch {
    return /^urn:[^\s]+$/i.test(value);
  }
}

function requireObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError(`${name} must be an object.`);
  return value as Record<string, unknown>;
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortObjectKeys(child)]),
  );
}

function lossKey(loss: LossRecord): string {
  return `${loss.code}\u0000${loss.path}\u0000${loss.construct}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
