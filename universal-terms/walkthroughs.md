# UniversalTerm (Tier-3) — Walkthroughs

> **Lifecycle:** locked (2026-07-14) — all 6 questions ✅ LOCKED at ratification.
> These were decided with the user before development (the draft's §7 agenda).

## Q1 — Where does `role_family` live? ✅ LOCKED 2026-07-14
**Decision:** on the **universal_term** (declared once — `ut:monetary_amount` is always a `measure`),
with an optional **per-role override** in the crosswalk for edge cases.
_Rationale:_ one place to reason about; less repetition/drift than per-type. Folded into SPEC §2.1/2.2.

## Q2 — How are the concepts authored? ✅ LOCKED 2026-07-14
**Decision:** **hand-curate** ~40–60 `ut:` concepts, grounded in
`plan/codex-suggestions/universal-ontology-by-source.md`.
_Rationale:_ keeps the scheme small and report-facing; seeding from schema.org pulls in web-entity
noise. Folded into SPEC §2.1 + Phase 1.

## Q3 — Which external vocabularies do we `exactMatch` now? ✅ LOCKED 2026-07-14
**Decision:** **all four upfront** — `schema:` + `fhir:` + `ocds:` + `dbt:`, wherever a concept has a
clear mapping (omit where none exists; never force one).
_Rationale (user override of the "schema-only-now" rec):_ front-load interop so future FHIR/OCDS/dbt
packs are cheap. Folded into SPEC §2.1.

## Q4 — What happens to `sensitivity`? ✅ LOCKED 2026-07-14
**Decision:** **migrate it off `types.jsonl` into the universal layer THIS ROUND**, with full
diligence — the anonymize sink + demo-mode masking are re-wired to resolve via the crosswalk and
re-verified.
_Rationale (user override of the "keep dual" rec):_ single source of truth now. Accepted scope cost:
the round is behaviour-touching, so the gate explicitly proves anonymize/demo masking is unchanged.
Folded into SPEC §4 + Phase 3.

## Q5 — Where does `report_slot` belong? ✅ LOCKED 2026-07-14
**Decision:** **move it out to the report engine.** Tier-3 stays purely semantic; the crosswalk is
now 3 links (`source_term → naklidata_role → universal_term`). The report engine derives placement
from `roleFamily`.
_Rationale (user override of the "keep as default" rec):_ cleaner separation of meaning vs output.
Folded into SPEC §1.

## Q6 — What is it called? ✅ LOCKED 2026-07-14
**Decision:** **UniversalTerm**, id prefix **`ut:`**.
_Rationale:_ no collision with the existing `type`/`typeId` vocabulary; reads as "the universal
vocabulary." Folded throughout.
