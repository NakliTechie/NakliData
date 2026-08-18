# NakliData SHACL constraint profile

Status: internal Batch S2 adapter. No release or product capability is enabled
by this file.

Normative baseline: [Shapes Constraint Language, W3C Recommendation 20 July
2017](https://www.w3.org/TR/shacl/). Cross-tool tests use
`rdf-validate-shacl` 0.6.5 as an independent SHACL engine.

## Profile identifier and limits

- Profile: `naklidata-shacl-2017-core-v1`
- Syntax: Turtle (`text/turtle`)
- Maximum input: 1,000,000 UTF-8 bytes
- Maximum parsed graph: 50,000 quads
- Maximum node plus property shapes: 5,000
- Maximum enumeration values: 1,000

All processing is local. The adapter performs no fetches. Artifact IRIs remain
identifiers and are never dereferenced.

## Supported mapping

| Canonical construct | SHACL construct |
| --- | --- |
| table | named `sh:NodeShape` with one `sh:targetClass` |
| classified field | named `sh:PropertyShape` with one direct IRI `sh:path` |
| required/maximum cardinality | `sh:minCount` / `sh:maxCount` |
| supported XSD datatype | `sh:datatype` |
| inclusive numeric range | `sh:minInclusive` / `sh:maxInclusive` |
| bounded regular expression | `sh:pattern` |
| permitted string values | `sh:in` RDF list |

Supported datatypes are XSD string, boolean, integer, decimal, double, date,
and dateTime. Patterns use NakliData's bounded expression subset: 256
characters, eight group levels, 32 quantifiers, no backreferences or
lookbehind, and no nested repeated alternation or quantifier groups.

The adapter evaluates canonical constraints over supplied rows without
modifying them. A violation identifies the constraint, table, field, and row.
It includes an opaque FNV-1a value fingerprint for diagnostic correlation. It
does not include the source value.

## Import and execution boundary

Imports accept named node shapes, one known table target, named property
shapes, and direct known-field paths. Each supported constraint becomes an
editable assertion proposal with `status: 'un-run'` and `execution:
'explicit'`. Generated SQL selects at most 100 counterexamples. Import does not
insert assertions, execute SQL, enforce a rule, or alter source data.

`acceptShaclProposals` copies only identifiers selected by the caller. It does
not mutate the import result or canonical document. The product must retain a
separate user action before inserting or running any accepted assertion.

## Exclusions

The adapter loss-reports constructs outside the profile. It excludes
SHACL-SPARQL, JavaScript extensions, custom constraint components, logical
combinators, recursive shapes, qualified value shapes, closed shapes,
property-path expressions, entailment regimes, remote imports, monitoring,
and automatic enforcement. Unknown XSD datatypes produce no proposal.

Malformed lists, multiple or missing targets and paths, unknown canonical
resources, unsafe patterns, and resource-ceiling breaches fail closed.

## Evidence matrix

`tests/shacl-adapter.test.ts` covers all seven supported constraint kinds,
deterministic strict Turtle export, independent positive and negative
validation, editable un-run import, explicit non-mutating acceptance,
unsupported constructs and datatypes, unsafe patterns, malformed lists, and
the byte ceiling.

`tests/fixtures/standards/s2/positive-rows.json` and
`negative-rows.json` drive both NakliData evaluation and
`rdf-validate-shacl`. The negative fixture produces four equivalent validation
results across both engines. The development-only validator does not enter the
browser bundle.
