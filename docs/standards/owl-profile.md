# NakliData OWL ontology profile

Status: internal Batch S4 adapter. No release or product capability is enabled
by this file.

Normative baseline: [OWL 2 Web Ontology Language Profiles, W3C Recommendation
11 December 2012](https://www.w3.org/TR/owl2-profiles/). The selected profile
is a strict product subset of OWL 2 RL.

## Selection and browser cost

Profile `naklidata-owl-2-rl-v1` uses constructs that retain direct mappings to
NakliData's semantic model and can feed the bounded rule engine planned for S5.
OWL 2 RL was selected over QL because RL provides a normative rule-based
semantics. It was selected over EL because NakliData needs direct property
domains, ranges, equivalence, disjointness, and at-most-one restrictions.

The adapter uses the existing pinned N3.js 2.1.1 parser/writer. It adds no
eager-shell dependency and no second browser RDF stack. The built lazy chunk
size is recorded in `STATUS.md` at the S4 checkpoint.

## Limits

- Syntax: Turtle (`text/turtle`)
- Maximum input: 1,000,000 UTF-8 bytes
- Maximum parsed graph: 50,000 quads
- Maximum classes plus properties: 10,000
- Maximum named axioms plus restrictions: 20,000

The adapter performs no fetches. Artifact IRIs remain identifiers and are
never dereferenced.

## Supported mapping

| NakliData construct | OWL/RDFS construct |
| --- | --- |
| table or explicitly modeled concept | `owl:Class` |
| field | `owl:DatatypeProperty` |
| relationship | `owl:ObjectProperty` |
| field owner / relationship source | `rdfs:domain` |
| OWL-RL datatype / relationship target | `rdfs:range` |
| approved class hierarchy | named `rdfs:subClassOf` |
| approved logical equivalence | named `owl:equivalentClass` |
| approved exclusion | named `owl:disjointWith` |
| maximum field count zero or one | superclass `owl:maxCardinality` restriction |

Unknown physical datatypes receive the broad `rdfs:Literal` range and a loss
record. OWL 2 RL's superclass grammar limits maximum cardinality to zero or
one. Larger bounds produce no axiom and enter the loss ledger.

## Semantic-upgrade boundary

SKOS `broader` does not mean subclass. SKOS `exactMatch` does not mean logical
class equivalence. The exporter never promotes either relation. It records the
omission and accepts subclass, equivalent-class, and disjoint-class axioms only
through `OwlApprovedAxioms`.

Import returns `accepted: false`. Classes, properties, named axioms, and
restrictions remain reviewable proposals. `acceptOwlProposals` returns detached
copies. It does not change concepts, relationships, assertions, or source data.

## Integrity and exclusions

The importer rejects resources with multiple OWL core types, named subclass
cycles, malformed restrictions, cardinalities above one, and individuals that
instantiate disjoint classes. It loss-reports OWL predicates outside the named
profile.

OWL itself permits satisfiable cyclic subclass graphs. NakliData rejects those
graphs because its review model requires an acyclic named hierarchy. This is a
product invariant, not an OWL inconsistency claim.

The profile excludes unions, intersections, complements, arbitrary class
expressions, property chains, keys, inverse/transitive/symmetric property
axioms, individuals as product records, unrestricted cardinalities, remote
imports, and automatic entailment.

## Independent evidence

`tests/owl-adapter.test.ts` covers deterministic export, every supported
mapping, explicit axioms, no SKOS semantic upgrade, proposal round trip,
datatype fallback, unsupported terms, cyclic and inconsistent graphs,
malformed restrictions, ambiguous types, and ceilings.

`scripts/verify-owl-fixtures.py` is an optional independent gate. With RDFLib
7.6.0 and OWL-RL 7.6.1 it parses and expands the exact S4 fixtures. It checks a
transitive subclass entailment in the satisfiable graph. It requires one
inconsistency error for the disjoint-class instance. It also records that OWL
accepts the cyclic and unsupported graphs, while NakliData separately rejects
or loss-reports them.
