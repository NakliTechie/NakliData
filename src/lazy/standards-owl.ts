export {
  MAX_OWL_AXIOMS,
  MAX_OWL_BYTES,
  MAX_OWL_QUADS,
  MAX_OWL_RESOURCES,
  OWL_IRI,
  RDF_IRI,
  RDFS_IRI,
  XSD_IRI,
  acceptOwlProposals,
  exportOwlTurtle,
  importOwlTurtle,
} from '../core/standards/owl.ts';

export type {
  OwlAcceptedProposal,
  OwlApprovedAxioms,
  OwlClassProposal,
  OwlExportOptions,
  OwlExportResult,
  OwlImportResult,
  OwlNamedAxiomProposal,
  OwlNamedClassAxiom,
  OwlPropertyProposal,
  OwlRestrictionProposal,
} from '../core/standards/owl.ts';
