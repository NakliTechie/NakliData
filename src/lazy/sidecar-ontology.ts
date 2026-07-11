// Lazy chunk — the two Wave-7 ontology sidecar jobs (assign-type Job 9 +
// nl-to-schema Job 10) and the NL→schema modal. Loaded only when the user
// clicks "Ask AI to classify" (schema panel) or "Infer schema" (notebook
// toolbar), so the jobs' prompts/parsers + the modal stay off the inlined
// shell budget (spec §7.1 / A35). Safe to split: the code holds no store
// singletons — the modal returns its DDL via an `onInsert` callback the
// shell handles, and dispatchOntologyJob is a pure request→response call.
export { dispatchOntologyJob } from '../core/sidecar/ontology-jobs.ts';
export { closeNlToSchemaModal, openNlToSchemaModal } from '../ui/nl-to-schema-modal.ts';
export type { OpenNlToSchemaOpts } from '../ui/nl-to-schema-modal.ts';
