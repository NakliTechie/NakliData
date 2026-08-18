export {
  MAX_PROV_BYTES,
  MAX_PROV_QUADS,
  MAX_PROV_RECORDS,
  MAX_PROV_REFERENCE_LENGTH,
  PROV_IRI,
  RDF_IRI,
  RDFS_IRI,
  XSD_IRI,
  acceptProvProposal,
  assertProvGraphIntegrity,
  exportProvTurtle,
  importProvTurtle,
  provenanceRelationKey,
  projectLineageToProvenance,
} from '../core/standards/prov.ts';

export type {
  ProvExportOptions,
  ProvExportResult,
  ProvImportResult,
  ProvLineageProjection,
  ProvLineageProjectionOptions,
  ProvRelationEvidence,
} from '../core/standards/prov.ts';
