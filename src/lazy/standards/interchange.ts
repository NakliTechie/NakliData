// Lazy boundary for standards interchange work. Product code must import this
// module dynamically; the eager shell must not depend on RDF tooling.
export {
  appendLoss,
  assertCanonicalInterchange,
  canonicalId,
  canonicalIri,
  INTERCHANGE_FORMAT,
  INTERCHANGE_VERSION,
  migrateCanonicalInterchange,
  NAKLIDATA_VOCABULARY_IRI,
  RESOURCE_KINDS,
  resourceKindOf,
  serializeCanonicalInterchange,
  validateCanonicalInterchange,
} from '../../core/standards/interchange.ts';

export type {
  CanonicalId,
  CanonicalInterchangeV0,
  CanonicalInterchangeV1,
  ConceptContract,
  ConstraintContract,
  FieldContract,
  LossRecord,
  MigrationResult,
  NamespaceContract,
  ProvenanceContract,
  RelationshipContract,
  ResourceKind,
  SourceContract,
  TableContract,
  ValidationIssue,
} from '../../core/standards/interchange.ts';
