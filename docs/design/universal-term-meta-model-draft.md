# Tier-3 UniversalTerm meta-model — DESIGN DRAFT

> **Status: DRAFT — unratified. Autopilot-authored 2026-07-14 (D1).**
> This is groundwork for a supervised `/dev-process` session, NOT a ratified
> amendment and NOT shipped behaviour. It ships no code and changes no runtime
> classification. Its job is to make the design space concrete so the real
> decision session starts from a strong draft. Every "**Decision**" below is a
> proposal with options — the human picks. Nothing here is in `types.jsonl`,
> `docs/spec-amendments.md`, or the classifier.

## 1. Why a Tier-3 layer

Today's taxonomy is two tiers, both flat lists of `typeId`s in `taxonomy/v0.1/`:

- **Tier-1** — generic cross-domain roles (`amount`, `latitude`, `record_id`, `iso_datetime`, …).
- **Tier-2** — domain packs (retail / marketplace / media / hr-people / sensitive-data), each a
  set of `typeId`s + detectors + a `sensitivity` meta-field + one report template.

A `typeId` today carries: detectors (how to recognise it), `sql_compat`, `confidence_floor`, and an
optional `sensitivity`. That's enough to **classify a column** and **surface a domain report**. It is
NOT enough to answer the questions that make cross-report intelligence possible:

1. **Synonymy across domains.** `compensation` (hr), `amount` (finance), `fare_amount` (sample), and
   `revenue` (a measure) are all *monetary quantities*, but nothing in the model says so — so a
   "money over time" capability has to be re-taught per role.
2. **Analytical function.** Is a column an **entity** (has identity), a **dimension** (group-by
   attribute), a **measure** (additive fact), or a **metric** (derived ratio)? A2's auto-measures and
   A1's chart-picker each re-derive this ad hoc (`pickChartColumns` = "first non-numeric label × last
   numeric measure"). A declared role_family would let report/measure generation be principled.
3. **Report placement.** Given a classified schema, *where does each column go* in a report — the y-axis
   of a bar, a KPI tile, a group-by facet, a filter? A2's kpi-row + A1's chart already imply "report
   slots" but hardcode them.
4. **Meta-roles beyond sensitivity.** `sensitivity` shipped (DK). Quality (coverage/validity) and
   provenance (where a value came from) are the same *shape* of cross-cutting annotation and belong in
   the same layer.

Tier-3 is the layer that answers 1–4 **once, abstractly**, so Tier-1/Tier-2 roles inherit it.

## 2. The meta-model

### 2.1 The crosswalk chain

The spine (from the workplan): **`source_term → universal_term → naklidata_role → report_slot`.**

| Link | What it is | Example | Where it lives today |
|------|-----------|---------|----------------------|
| `source_term` | a raw observed column header / alias | `"MonthlyIncome"`, `"CTC"`, `"salary"` | the `patterns` arrays in detectors |
| `universal_term` | an abstract SKOS concept | `ut:compensation` (⊂ `ut:monetary_amount`) | **new** |
| `naklidata_role` | an existing `typeId` | `compensation` | `types.jsonl` |
| `report_slot` | how it's consumed in a report/measure | `measure.currency`, `kpi.total`, `axis.y` | implicit in A1/A2 + templates |

Reading it: the classifier already does `source_term → naklidata_role` (header patterns → typeId).
Tier-3 adds the **two outer links** — an abstract concept above the role, and a consumption slot below
it — plus **role_family** and **meta-roles** hanging off the universal_term.

### 2.2 UniversalTerm as a SKOS concept scheme

**Decision A — model universal_terms as a [SKOS](https://www.w3.org/TR/skos-reference/) concept
scheme.** SKOS is the W3C thesaurus standard; it gives us exactly the relations we need without
inventing them:

- `skos:broader` / `skos:narrower` — the concept ladder (`ut:compensation` broader → `ut:monetary_amount`
  broader → `ut:quantity`). This is what powers "treat all money the same" while keeping specificity.
- `skos:exactMatch` / `skos:closeMatch` — cross-vocabulary links (to schema.org, FHIR, OCDS, dbt) so the
  universal layer is *interoperable*, not another silo. e.g. `ut:person` `skos:exactMatch`
  `schema:Person`.
- `skos:related` — non-hierarchical association (`ut:order_id` related `ut:customer_id`).
- `skos:prefLabel` / `skos:altLabel` — the canonical name + synonyms (the altLabels are the
  `source_term` seeds).

> Options considered: (a) a bespoke `{id, parent, synonyms}` tree — simpler, but re-invents SKOS and
> loses the external `exactMatch` interop that makes FHIR/OCDS packs cheap later; (b) full OWL — far too
> heavy, no payoff for a browser tool. **Recommend SKOS** (a) as the vocabulary, stored as compact JSONL
> (not RDF/Turtle — see §4), so we get SKOS *semantics* without an RDF runtime.

### 2.3 role_family (dbt-style analytical function)

**Decision B — every universal_term declares a `role_family` ∈ {`entity`, `dimension`, `measure`,
`metric`}.** Borrowed from dbt's semantic layer, which is the closest well-worn prior art:

- **entity** — a thing with identity; the grain of a table. `ut:person`, `ut:order`, `ut:listing`.
  (Maps to id roles: `employee_id`, `order_id`, `record_id`.)
- **dimension** — a qualitative attribute you group/filter by. `ut:department`, `ut:geographic_region`,
  `ut:temporal_instant`, `ut:category`.
- **measure** — an additive quantity you aggregate. `ut:monetary_amount`, `ut:quantity`, `ut:count`.
- **metric** — a derived/ratio quantity, usually measure-over-measure or measure-over-dimension.
  `ut:average_compensation`, `ut:conversion_rate`, `ut:reviews_per_period`.

This is the single highest-leverage field: it lets A1's chart-picker and A2's auto-measures stop
guessing. `pickChartColumns` becomes "x = a `dimension`, y = a `measure`"; auto-measures become "for each
`measure` role, emit SUM/AVG; for each `entity`, emit COUNT(DISTINCT)".

> Open question B1: is `role_family` a property of the **universal_term** (cleaner — `ut:monetary_amount`
> is always a measure) or of the **naklidata_role** (allows a role to override)? Recommend: on the
> universal_term, with an optional per-role override for edge cases.

### 2.4 Meta-roles (cross-cutting annotations)

**Decision C — three orthogonal meta-role axes, each an optional annotation on a universal_term (with
per-role override):**

- **sensitivity** — `public | pii | financial | secret` (ALREADY SHIPPED, DK; this just lifts it into
  the meta-role slot so it's declared once on `ut:person_identifier` instead of repeated per role).
- **quality** — declared expectations that drive quality signals: e.g. `{expected_completeness,
  expected_uniqueness, valid_range|value_set}`. Feeds a future "data quality" panel; for now, purely
  declarative.
- **provenance** — how a value is derived: `source | joined | computed | imputed`. Interacts with the
  measures layer (a `computed` metric records its formula).

These are the same *shape* — a cross-cutting label that a report/sink/panel reads — which is why they
belong together in Tier-3 rather than scattered as ad-hoc fields.

### 2.5 report_slot

**Decision D — `report_slot` is a controlled vocabulary describing default report placement**, derived
mostly from `role_family` but overridable:

`kpi.total` · `kpi.count` · `kpi.average` · `axis.x` · `axis.y` · `facet` · `filter` · `label` ·
`provenance` · `hidden`.

The mapping is mostly mechanical from role_family (`measure` → `axis.y` + `kpi.*`; `dimension` →
`axis.x`/`facet`/`filter`; `entity` → `kpi.count` + `label`), which is why A1/A2 could adopt it
incrementally: they already hardcode these choices, so Tier-3 just *names* them.

## 3. How it layers on what exists (non-breaking)

The whole point is **additive**. Nothing in `types.jsonl` changes shape. Tier-3 is a *side table* keyed
by `typeId`:

```
naklidata_role (typeId)  ──crosswalk──▶  universal_term  ──has──▶  role_family, meta-roles, report_slots
     (types.jsonl, unchanged)              (new file)
```

- **Classification** (`classify.ts`) is untouched: it still produces `typeId`s. Tier-3 is read *after*
  classification to enrich a resolved column, never to classify it.
- **A1 `pickChartColumns` / A2 auto-measures / templates** become *consumers* of role_family +
  report_slot, replacing their ad-hoc heuristics — but only once the human decides to wire them (a later
  round; out of scope here).
- **`sensitivity`** stays on the type for back-compat; the meta-role is the new canonical home, and a
  migration can dedupe later.

## 4. Proposed data representation

**Decision E — compact JSONL under `taxonomy/v0.1/universal/`, not RDF.** Keep the vendored-bundle
loader story (fetch + parse JSONL, as today). Two files:

`taxonomy/v0.1/universal/universal-terms.jsonl` — the concept scheme, one concept per line:

```jsonc
{"id":"ut:monetary_amount","prefLabel":"Monetary amount","broader":["ut:quantity"],
 "roleFamily":"measure","reportSlots":["axis.y","kpi.total","kpi.average"],
 "sensitivity":"financial","exactMatch":["schema:MonetaryAmount"]}
{"id":"ut:compensation","prefLabel":"Compensation","broader":["ut:monetary_amount"],
 "altLabel":["salary","wage","ctc","monthly income"],"sensitivity":"financial"}
{"id":"ut:person","prefLabel":"Person","roleFamily":"entity","reportSlots":["kpi.count","label"],
 "exactMatch":["schema:Person","fhir:Patient"]}
```

`taxonomy/v0.1/universal/crosswalk.jsonl` — role → universal_term, with optional overrides:

```jsonc
{"role":"compensation","universalTerm":"ut:compensation"}
{"role":"amount","universalTerm":"ut:monetary_amount"}
{"role":"employee_id","universalTerm":"ut:person_identifier","roleFamilyOverride":"entity"}
{"role":"latitude","universalTerm":"ut:geographic_coordinate","reportSlotOverride":["hidden"]}
```

> Rationale: JSONL keeps the diff-friendly, one-fact-per-line shape the taxonomy already uses; `broader`
> arrays give the SKOS ladder; `exactMatch` to `schema:`/`fhir:`/`ocds:` prefixes buys interop and makes
> the deferred FHIR/OCDS packs (B2 follow-ups) cheap — they map to existing universal_terms instead of
> inventing roles. Validation mirrors `validateMeasuresFile`: unique ids, `broader` resolves, no cycles.

## 5. Worked examples

| source_term | naklidata_role | universal_term (broader…) | role_family | meta | report_slot |
|---|---|---|---|---|---|
| `MonthlyIncome`, `CTC` | `compensation` | `ut:compensation` → `ut:monetary_amount` → `ut:quantity` | measure | financial | `kpi.total`, `axis.y` |
| `UnitPrice` | `amount` | `ut:monetary_amount` | measure | financial | `axis.y`, `kpi.total` |
| `EmployeeNumber` | `employee_id` | `ut:person_identifier` → `ut:identifier` | entity | pii | `kpi.count`, `label` |
| `Department` | `department` | `ut:organizational_unit` → `ut:category` | dimension | public | `axis.x`, `facet` |
| `latitude` | `latitude` | `ut:geographic_coordinate` | dimension | public | `hidden` (pairs with lon → map) |
| `InvoiceDate` | `iso_datetime` | `ut:temporal_instant` | dimension | public | `axis.x`, `filter` |

The value is visible in the last two columns: once `department` is known to be a `dimension` with slot
`axis.x` and `compensation` a `measure` with slot `axis.y`+`kpi.total`, the `hr_workforce` report (and
A1/A2) are *derivable* rather than hand-written.

## 6. Scope for the ratified round (proposal)

**In:** the two JSONL files above for the *already-shipped* roles (100 types), a pure loader +
validator (mirrors `load.ts`/`measures.ts`), and an amendment entry. **NOT in** (later rounds): rewiring
`pickChartColumns`/auto-measures/templates to consume it; a quality panel; FHIR/OCDS packs. This keeps
D1 a *spec + data + validator* increment with zero behaviour change, exactly as the workplan framed it.

## 7. Open questions for the human

1. **B1 (role_family home):** universal_term with per-role override — confirm?
2. **Concept-scheme authorship:** hand-curate universal_terms (opinionated, ~40–60 concepts) or
   seed from schema.org's type hierarchy and prune? Recommend hand-curate — the reference doc
   (`plan/codex-suggestions/universal-ontology-by-source.md`) already surveyed the sources.
3. **exactMatch targets:** commit to `schema:` now, add `fhir:`/`ocds:`/`dbt:` lazily per pack?
4. **Migration of `sensitivity`:** keep dual (type + meta-role) indefinitely, or migrate types.jsonl to
   read sensitivity from the universal layer (a breaking-ish change to the bundle)?
5. **Does report_slot belong in Tier-3 at all**, or is it really an A1/A2 concern that should live with
   the report engine? (Argument: it's the one link that's about *output*, not *meaning*.)
6. **Naming:** "UniversalTerm" vs "concept" vs "semantic type" — the last collides with the existing
   "type"/`typeId`. Pick a name that doesn't overload.

## 8. Suggested next step

Run `/dev-process` on this draft: it has the problem framing (stage 1), a concrete meta-model to
walk (stages 2–3), and the six decisions above as the lock-and-fold checkpoints. Treat §7 as the
agenda. This draft is safe to discard or rewrite — it exists to make that session fast, not to bind it.
