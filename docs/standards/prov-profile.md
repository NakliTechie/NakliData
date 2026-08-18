# NakliData PROV-O provenance profile

Status: S6-conformance-evidenced adapter. Its independent product release flag
defaults off.

Normative baseline: [PROV-O: The PROV Ontology, W3C Recommendation 30 April
2013](https://www.w3.org/TR/prov-o/). RDF syntax processing uses pinned N3.js
2.1.1 in strict Turtle mode.

## Profile identifier and limits

- Profile: `naklidata-prov-o-2013-v1`
- Syntax: Turtle (`text/turtle`)
- Maximum input: 1,000,000 UTF-8 bytes
- Maximum parsed graph: 50,000 quads
- Maximum entities plus activities plus agents: 10,000
- Maximum source-reference length: 2,048 printable characters

The adapter performs no fetches. Artifact IRIs remain identifiers and are
never dereferenced. It serializes metadata only. It has no API accepting source
bytes or query-result bytes.

## Supported mapping

| Canonical construct | PROV-O construct |
| --- | --- |
| source, table, result, or export record | `prov:Entity` |
| mount, classification, query, export, or annotation event | `prov:Activity` |
| person, software, or agent actor | `prov:Agent` |
| activity input | `prov:used` |
| generated entity | `prov:wasGeneratedBy` |
| entity derivation | `prov:wasDerivedFrom` |
| activity actor | `prov:wasAssociatedWith` |
| activity interval | `prov:startedAtTime` / `prov:endedAtTime` |

Canonical labels, resource links, record kinds, redaction flags, build
identity, taxonomy identity, source references, observed state, and high/low
confidence use NakliData vocabulary properties. Each standard PROV relation
also has an `rdf:Statement` metadata record. The PROV relation remains directly
queryable by processors that ignore NakliData metadata.

## Workbook-lineage projection

The lineage projector maps mounted sources to source entities. It maps each
runtime cell to an activity and result entity. It maps sinks to export entities.
Source-to-cell and cell-to-cell edges become activity uses. Cell-to-cell edges
also become result derivations. Cell-to-sink edges become generation records.
One software agent identifies the NakliData build that owns projected
activities.

Lineage nodes carrying `cellKind` are visual-only inserted steps. Their
activities and adjacent relations serialize with `observed: false`. Runtime
nodes serialize with `observed: true`. Edge confidence remains high or low.
Activity timestamps remain optional UTC instants.

Source references are preserved only for non-redacted source entities.
Redacted references are omitted and loss-reported. Canonical resource links
use source, table, or field identifiers. Stable provenance identifiers hash
lineage node identifiers so raw paths and URLs never become canonical IDs.

## Import and integrity boundary

Imported standard relations without a NakliData evidence statement become
annotations with low confidence. They never become observed history by
inference. Import returns `accepted: false`; acceptance copies a new canonical
graph without changing the workbook.

The adapter rejects untyped relation endpoints, entities with multiple
generating activities, duplicate relation ownership, resources carrying more
than one PROV core type, and derivation cycles. It loss-reports PROV-O
predicates outside the profile.

## Exclusions

The initial profile excludes qualified influence patterns, bundles, plans,
delegation, collections, dictionaries, alternate/specialization relations,
remote imports, and PROV inference. It does not claim that visual annotations
were observed. It does not embed protected values, SQL text, file contents,
credentials, or result bytes.

## Evidence matrix

`tests/prov-adapter.test.ts` covers deterministic export, strict external RDF
parsing, observed-versus-annotated counts, redacted reference omission,
complete metadata round trip, non-mutating acceptance, conservative external
imports, workbook-lineage projection, confidence, excluded terms, dangling
endpoints, derivation cycles, ambiguous generation and types, and ceilings.
