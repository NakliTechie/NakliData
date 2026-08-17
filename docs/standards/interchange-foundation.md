# Standards interchange foundation

Status: internal Batch S0 contract. This document does not claim SKOS, SHACL,
PROV-O, OWL, RDF, or reasoning interoperability.

## Purpose and boundary

`naklidata-canonical-interchange` version 1 is the loss-aware internal contract
for later standards adapters. It does not replace `.naklidata`, the portable
semantic model, data-quality assertions, or observed lineage. Adapters project
those product-owned records into this contract before they serialize a
standards artifact.

The runtime boundary is deliberately separate from the eager shell:

- `src/core/standards/interchange.ts` owns types, identifiers, validation,
  migration, canonical JSON, and the loss ledger.
- `src/lazy/standards/interchange.ts` is the only planned browser import path.
- `src/workers/standards-interchange-worker.ts` defines a 2,000,000-byte
  artifact-only worker protocol for validate, migrate, and serialize jobs.
- No standards module may fetch a network resource, inspect credentials,
  execute SQL, mutate source data, or enter the eager `src/main.ts` graph.
- RDF parsers, serializers, validators, and reasoners remain absent until their
  owning batch records an isolated dependency and bundle decision.

## Identifier and namespace rules

Every canonical identifier has `nd:<kind>:<encoded-key>` form. The frozen kinds
are workbook, source, table, field, concept, relationship, assertion, entity,
activity, and agent. The key comes from a persisted opaque workbook identifier.
It must never be a raw URL, filesystem path, credential, or source value.

Identifiers remain stable across export/import and adapter round trips. A
resource changes identity only when its persisted product identity changes.
Labels, aliases, mappings, and physical names do not determine identity.

Every document supplies an absolute base IRI ending in `/` or `#`. Resource
IRIs append the canonical identifier to that base. Prefix `nd` is reserved for
`https://naklidata.dev/ns/interchange/v1#` and cannot be rebound. Adapter-owned
prefixes must map to absolute IRIs. Prefix compaction never changes the stored
resource IRI.

## Versioning, migration, and loss

Version 1 freezes concept schemes/concepts, multilingual preferred and
alternate labels, external concept mappings, relationship cardinality and
field pairs, bounded datatype/value constraints, and a provenance core.

The migration boundary accepts version 1 and the single pre-release version 0
shape. Version 0 placed `baseIri` and `prefixes` at the document root. Migration
moves both fields under `namespace` and records
`migration.v0.namespace_wrapped`. Unknown formats and versions fail closed.

Every non-faithful import/export emits a loss record with severity, stable code,
JSON path, source construct, and human-readable message. Records deduplicate on
code, path, and construct. An adapter may refuse an artifact after an error,
but it may not omit a construct without a loss record.

## Canonical fixtures

`tests/fixtures/standards/s0/canonical-v1.json` covers:

- a concept scheme, multilingual aliases, and an external mapping;
- a many-to-one relationship with explicit field pairs;
- count, datatype, and enumeration constraints;
- source use, result generation, derivation, and software association;
- redaction state; and
- one unsupported logical constraint recorded in the loss ledger.

`tests/fixtures/standards/s0/invalid-references-v1.json` exercises fail-closed
referential validation. Object keys serialize lexically. Array order remains
contract-significant.

## Planned standards profiles

These are implementation envelopes, not product capabilities. Each remains
disabled until its batch passes import, export, negative, independent-processor,
and round-trip gates.

### S1 — SKOS 2009 Recommendation profile

Planned: `skos:ConceptScheme`, `skos:Concept`, `skos:prefLabel`,
`skos:altLabel`, `skos:broader`, `skos:narrower`, `skos:related`, scheme/top
concept links, and exact/close/broad/narrow/related mapping relations.

Initially excluded: collections, ordered collections, SKOS-XL, notation,
documentation-note properties, asserted transitive relations, and automatic
hierarchy inference. The normative reference is the
[SKOS Recommendation](https://www.w3.org/TR/skos-reference/).

### S2 — SHACL 2017 Recommendation, Core subset

Planned: table/field targets, direct field paths, minimum and maximum counts,
datatypes, inclusive numeric bounds, patterns, and enumerations. Imports create
editable, un-run proposals. Validation never mutates either input graph.

Initially excluded: SHACL-SPARQL, JavaScript extensions, custom constraint
components, logical combinators, recursive shapes, qualified value shapes,
closed shapes, property-path expressions, entailment regimes, and automatic
enforcement. SHACL 1.2 remains a draft and is outside this train. The normative
baseline is the [SHACL 2017 Recommendation](https://www.w3.org/TR/shacl/).

### S3 — PROV-O 2013 Recommendation profile

Planned: `prov:Entity`, `prov:Activity`, `prov:Agent`, `prov:used`,
`prov:wasGeneratedBy`, `prov:wasDerivedFrom`, `prov:wasAssociatedWith`, and
activity start/end instants. Observed relations and user annotations remain
separate. Protected source bytes do not enter provenance artifacts.

Initially excluded: qualified influence patterns, bundles, plans, delegation,
collections, dictionaries, alternate/specialization relations, and inference.
The normative reference is the
[PROV-O Recommendation](https://www.w3.org/TR/prov-o/).

### S4–S5 — OWL and reasoning

No OWL profile or reasoning rules are selected in S0. OWL 2 RL is the candidate
for measurement because the W3C defines it as a rule-oriented profile. S4 must
measure mapping needs and browser cost before selecting or rejecting it. Until
then every OWL axiom is unsupported and no entailment is performed. The
normative profile reference is
[OWL 2 Profiles, Second Edition](https://www.w3.org/TR/owl2-profiles/).

## Release claim gate

Engineering documentation may name the planned profiles. Product copy,
capability discovery, examples, and release notes must not name a standard as
supported until the owning adapter and Batch S6 pass their independent
conformance matrices.
