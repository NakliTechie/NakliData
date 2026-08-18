# NakliData bounded standards reasoning

Status: S6-conformance-evidenced engine. Its independent product release flag
defaults off and requires the SKOS and OWL flags.

Profile: `naklidata-bounded-standards-reasoning-v1`.

Normative inputs come only from the supported [SKOS
Recommendation](https://www.w3.org/TR/skos-reference/) and the selected [OWL
2 RL profile](https://www.w3.org/TR/owl2-profiles/). The engine is not a
general-purpose rule language or a full OWL reasoner.

## Rule set

| Rule | Output |
| --- | --- |
| SKOS broader-path closure | separate `skos_broader_transitive` fact |
| SKOS exact-match symmetry | inverse exact-match proposal |
| SKOS exact-match transitivity | connected exact-match proposal |
| OWL named-class equivalence | two subclass proposals |
| OWL named-subclass transitivity | transitive subclass proposal |
| mutual named subclasses | equivalent-class proposal |
| disjointness down subclass paths | narrower disjoint-class proposal |

SKOS broader links never become OWL subclass facts. SKOS exact matches never
become OWL equivalence. `buildReasoningFacts` keeps both vocabularies separate
and accepts only already-approved OWL named axioms.

## Execution and ownership boundary

The shipped execution path is `standards-reasoning.worker.js`. The lazy
`StandardsReasoningClient` boots that worker on first use, applies a ten-second
transport timeout, propagates cancellation, and terminates outstanding calls
when its owner closes it. The worker yields after each 256 rule applications so
it can receive cancellation messages.

Every request carries actual and expected workspace identifiers and revisions.
Any mismatch fails before rule evaluation. Every proposal carries the
workspace identity, revision, reasoning profile, and a deterministic
source-graph fingerprint.

## Resource ceilings

- Nodes: 5,000
- Input facts: 20,000
- Rule applications: 100,000
- Output proposals: 50,000
- Default deadline: 1,000 ms
- Absolute deadline ceiling: 5,000 ms
- Worker message: 2,000,000 serialized bytes

Callers may lower every ceiling. They cannot raise one. The engine checks
abort, deadline, and application counts during traversal. It sorts facts,
adjacency, premises, conflicts, and proposals for reproducible output.

## Proposal and conflict model

An inferred fact has `status: 'review'`, `execution: 'none'`, confidence 1,
the exact rule, and the flattened identifiers of asserted premises. The engine
does not mutate its input. It has no SQL, source-data, persistence, or network
dependency.

Equivalent-and-disjoint and subclass-and-disjoint conclusions produce
separate conflict records. A conflict does not select or apply either fact.
Acceptance and persistence remain future explicit product actions.

## Evidence

`tests/standards-reasoning.test.ts` covers the seven rules, SKOS/OWL separation,
determinism, non-mutation, ownership changes, conflict reporting, cyclic input,
termination, every resource ceiling, preflight and cooperative cancellation,
and the same A-to-C subclass entailment checked by RDFLib/OWL-RL.

`tests/e2e/standards-reasoning-worker.spec.ts` loads the built lazy client in
Chromium, derives A-to-C in the dedicated worker, and cancels a 300-edge graph.
`scripts/verify-owl-fixtures.py` independently derives the same transitive
subclass result with RDFLib 7.6.0 and OWL-RL 7.6.1.
