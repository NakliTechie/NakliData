# UniversalTerm (Tier-3)

> **Lifecycle:** living · **Status:** Phase 0 (scaffold) done · branch `universal-termsv1`

A semantic layer above NakliData's 145 flat taxonomy types: an abstract SKOS concept (`ut:*`) per
role, carrying `roleFamily` (dbt-style analytical function), the canonical `sensitivity`, and
cross-vocabulary `exactMatch` links. Makes the existing types + reporting smarter without touching
classification.

- **[SPEC.md](SPEC.md)** — the locked design (authoritative).
- **[walkthroughs.md](walkthroughs.md)** — the 6 ratified decisions.
- **[DEFERRED.md](DEFERRED.md)** — what's out of scope + revisit triggers.
- Exploratory origin: `docs/design/universal-term-meta-model-draft.md` (superseded by SPEC.md).

## Phases
- [x] **Phase 0** — scaffold + lock decisions
- [ ] **Phase 1** — author `taxonomy/v0.1/universal/{universal-terms,crosswalk}.jsonl`
- [ ] **Phase 2** — `src/taxonomy/universal.ts` loader + validator + tests
- [ ] **Phase 3** — migrate `sensitivity` off `types.jsonl`; rewire anonymize + demo; re-verify
- [ ] **Phase 4** — spec amendment A36 + full gate
