# Standards interoperability matrix

Evidence date: 2026-08-18. Status: engineering gate passed; every product
release flag remains off.

## Exact profiles and processors

| Surface | NakliData profile | Independent processor | Public fixture baseline | Result |
| --- | --- | --- | --- | --- |
| SKOS | `naklidata-skos-2009-v1` | RDFLib 7.6.0 and N3.js 2.1.1 | W3C SKOS Reference example | RDF parse, concept/scheme, multilingual label, and hierarchy checks pass |
| SHACL | `naklidata-shacl-2017-core-v1` | PySHACL 0.40.0 and rdf-validate-shacl 0.6.5 | W3C SHACL person example | conforming graph passes; invalid graph returns two results |
| PROV-O | `naklidata-prov-o-2013-v1` | RDFLib 7.6.0 and N3.js 2.1.1 | W3C PROV-O starting-point example | Entity, Activity, Agent, use, generation, association, and times parse |
| OWL | `naklidata-owl-2-rl-v1` | OWL-RL 7.6.2 over RDFLib 7.6.0 | W3C OWL 2 RL/test-case baseline | named subclass closure and equivalent-class symmetry materialize |
| Reasoning | `naklidata-bounded-standards-reasoning-v1` | OWL-RL 7.6.2 comparison | OWL named-class fixture | selected closure agrees; SKOS and OWL fact kinds remain separate |

This is profile evidence. It is not evidence for full SKOS integrity checking,
all SHACL Core, full PROV-O, complete OWL 2 RL, OWL DL, SPARQL, SWRL, or a
general reasoner.

## Reproducible gate

The six checked-in Turtle files carry their W3C source URLs and SHA-256 hashes
in `tests/fixtures/standards/s6/manifest.json`. The Python processors are
development-only. They never enter the browser bundle or production dependency
graph.

```sh
python3 -m venv /tmp/naklidata-s6
/tmp/naklidata-s6/bin/pip install -r scripts/standards-conformance-requirements.txt
/tmp/naklidata-s6/bin/python scripts/verify-standards-interoperability.py
npx vitest run tests/standards-interoperability.test.ts tests/standards-capabilities.test.ts
```

The independent script checks fixture hashes before parsing. The TypeScript
matrix covers detached import → edit → export, stable namespaces, v0 migration,
structured losses, malformed Turtle containment, and cancellation before an
inference proposal can be produced. Adapter-specific suites retain bounds,
cycles, ownership, contradictory graph, and positive/negative validation cases.

## Examples and supported flow

1. Project a canonical interchange document through one adapter.
2. Export bounded Turtle with the named profile identifier.
3. Parse or validate it in an independent processor.
4. Import supported terms into detached proposals.
5. Review and edit those proposals outside the live workbook.
6. Accept selected proposals through the adapter-specific acceptance function.
7. Apply them only through a future authorized product surface.

No import mutates a workbook. No inference executes SQL. No artifact fetches an
IRI. No adapter reads credentials. Unsupported constructs enter a loss ledger
or fail closed when their semantics would be ambiguous.

## Independent rollback gates

`src/core/standards/capabilities.ts` owns one flag each for SKOS, SHACL,
PROV-O, OWL, and reasoning. Every flag defaults to false. Reasoning additionally
requires enabled SKOS and OWL dependencies. Disabling a flag changes discovery
state only; it does not rewrite workbooks or artifacts.

Agent `getCapabilities` exposes exact profiles as `release-gated`. This build
has no user-facing standards import/export/reasoning tool, so enabling any flag
would require a separately reviewed product surface and release authorization.

## Limits and exclusions

- Turtle only; no JSON-LD, RDF/XML, TriG, remote context, ontology import, or
  network dereference.
- Direct paths and named resources only; no arbitrary property paths or class
  expressions.
- Detached review proposals only; no automatic enforcement, inference
  acceptance, SQL execution, source mutation, or remote write.
- Fixed byte, graph, resource, rule, proposal, time, and worker-message bounds.
- Full per-profile exclusions remain normative in the five profile documents.
