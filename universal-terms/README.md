# UniversalTerm (Tier-3)

> **Lifecycle:** living · **Status:** ALL PHASES SHIPPED on branch `universal-termsv1` (unmerged) · amendment A36

A semantic layer above NakliData's 145 flat taxonomy types: an abstract SKOS concept (`ut:*`) per
role, carrying `roleFamily` (dbt-style analytical function), the canonical `sensitivity`, and
cross-vocabulary `exactMatch` links. Makes the existing types + reporting smarter without touching
classification.

- **[SPEC.md](SPEC.md)** — the locked design (authoritative).
- **[walkthroughs.md](walkthroughs.md)** — the 6 ratified decisions.
- **[DEFERRED.md](DEFERRED.md)** — what's out of scope + revisit triggers.
- Exploratory origin: `docs/design/universal-term-meta-model-draft.md` (superseded by SPEC.md).

## Phases
- [x] **Phase 0** — scaffold + lock decisions (`ae8539f`)
- [x] **Phase 1** — author `taxonomy/v0.1/universal/{universal-terms,crosswalk}.jsonl` — 67 concepts / 145 rows (`79597fb`)
- [x] **Phase 2** — `src/taxonomy/universal.ts` loader + validator + resolvers + parity contract (`b8b8db2`)
- [x] **Phase 3** — migrate `sensitivity` off `types.jsonl`; rewire the two seams; anonymize-strategy parity (`4734f21`)
- [x] **Phase 4** — `report_slot` guard + spec amendment A36 + full gate

**Gate:** 1154 vitest · check exit 0 · SMOKE PASSED · bundle within budget. Sensitivity + anonymize-strategy
parity asserted across all 145 types. Universal layer confirmed shipping to `dist/` and loading live.
