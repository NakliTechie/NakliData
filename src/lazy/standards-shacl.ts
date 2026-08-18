export {
  acceptShaclProposals,
  evaluateShaclRows,
  exportShaclTurtle,
  importShaclTurtle,
  MAX_SHACL_BYTES,
  MAX_SHACL_LIST_ITEMS,
  MAX_SHACL_QUADS,
  MAX_SHACL_SHAPES,
  projectRowsToRdfTurtle,
  RDF_IRI,
  SHACL_IRI,
  XSD_IRI,
} from '../core/standards/shacl.ts';

export type {
  ShaclAcceptedProposals,
  ShaclAssertionProposal,
  ShaclEvaluationResult,
  ShaclExportResult,
  ShaclImportResult,
  ShaclViolation,
} from '../core/standards/shacl.ts';
