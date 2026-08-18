# NakliData SKOS vocabulary profile

Status: S6-conformance-evidenced adapter. Its independent product release flag
defaults off.

Normative baseline: [SKOS Simple Knowledge Organization System Reference,
W3C Recommendation 18 August 2009](https://www.w3.org/TR/skos-reference/).
RDF syntax processing uses pinned N3.js 2.1.1 in strict Turtle mode.

## Profile identifier and limits

- Profile: `naklidata-skos-2009-v1`
- Syntax: Turtle (`text/turtle`)
- Maximum input: 1,000,000 UTF-8 bytes
- Maximum parsed graph: 50,000 quads
- Maximum concepts: 5,000
- Maximum labels: 20,000
- Vocabulary browse result ceiling: 200 rows

All processing is local. The adapter performs no fetches. Absolute IRIs inside
the artifact remain identifiers and are never dereferenced.

## Supported mapping

| Canonical construct | SKOS construct |
| --- | --- |
| concept scheme | `skos:ConceptScheme` |
| concept | `skos:Concept` |
| preferred label | `skos:prefLabel` |
| alternate label | `skos:altLabel` |
| scheme membership | `skos:inScheme` |
| root concept | `skos:topConceptOf` + `skos:hasTopConcept` |
| hierarchy | `skos:broader` + `skos:narrower` |
| associative relation | `skos:related` |
| external mapping | `skos:exactMatch`, `closeMatch`, `broadMatch`, `narrowMatch`, `relatedMatch` |

The taxonomy projection emits one versioned bundled-taxonomy scheme and one
workbook-types scheme when user types exist. Universal terms retain their
broader hierarchy. Flat taxonomy types link to their universal term. External
CURIE mappings expand only through an explicit prefix registry; unresolved
prefixes enter the loss ledger.

## Import and review behavior

Imported IRIs under the selected base preserve canonical `nd:concept:*`
identifiers. Other IRIs receive deterministic opaque identifiers. Identifier
collisions fail into the loss ledger. Preferred labels allow one value per
language. Conflicting labels sort deterministically and disclose the dropped
value. Broader/narrower and related inverse statements normalize into the same
proposal relation.

The import result has `accepted: false`. The lazy vocabulary browser searches
preferred labels, aliases, and IRIs. Its acceptance callback returns new
canonical records. It has no workbook or taxonomy mutation dependency.
Unselected relation targets are omitted with a loss record.

## Exclusions

The adapter records predicates outside the profile as unsupported. The initial
profile excludes collections, ordered collections, SKOS-XL, notation,
documentation notes, asserted transitive properties, blank-node constructs,
and automatic hierarchy inference. Missing scheme membership and multiple
scheme membership are errors because the canonical contract permits one scheme
per concept.

## Evidence matrix

`tests/skos-adapter.test.ts` covers deterministic export, strict Turtle parse,
identifier/label/hierarchy/mapping round trip, inverse narrower import,
conflicting labels, unsupported predicates, browse bounds, non-mutating
acceptance, malformed input, byte ceilings, prefix selection, and bundled plus
user-type projection.

`tests/e2e/skos-vocabulary-browser.spec.ts` loads the built lazy chunk, searches
an alias, accepts one selected proposal, and checks focus return. N3.js is an
external RDF processor; its strict parser independently accepts the generated
Turtle graph and reproduces the emitted triple count.
