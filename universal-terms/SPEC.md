# UniversalTerm (Tier-3) — SPEC

> **Lifecycle:** locked (2026-07-14)
> Supersedes the exploratory draft `docs/design/universal-term-meta-model-draft.md`.
> Ratified inputs: the 6 decisions in `walkthroughs.md` (all ✅ LOCKED).

## 1. What this is

A **Tier-3 semantic layer above the 145 flat taxonomy types** (`typeId`s). It adds an abstract
concept per role and the analytical + governance metadata that report/sink surfaces read, without
changing how classification works (Tier-1/2 still produce `typeId`s).

**Crosswalk (3 links — decision #5 moved report_slot out):**

```
source_term  ──classify──▶  naklidata_role  ──crosswalk──▶  universal_term
 (header)                    (typeId, unchanged)             (ut:*, NEW)
                                                              └─ roleFamily, sensitivity, exactMatch
```

Report placement (`kpi.total`, `axis.x`, …) is **not** in Tier-3 — the report engine derives it from
`roleFamily`. Tier-3 is purely semantic.

## 2. The model (locked)

### 2.1 UniversalTerm — a SKOS concept scheme
Hand-curated (~40–60 concepts) under `taxonomy/v0.1/universal/universal-terms.jsonl`, one concept
per line:

```jsonc
{"id":"ut:monetary_amount","prefLabel":"Monetary amount","broader":["ut:quantity"],
 "roleFamily":"measure","sensitivity":"financial",
 "exactMatch":["schema:MonetaryAmount","dbt:measure"]}
```

- `id` — `ut:` prefixed (decision #6). `prefLabel` — canonical name.
- `broader` — `skos:broader` parents (concept ladder; must resolve, acyclic).
- `roleFamily` — decision #1: **lives here** (`entity`|`dimension`|`measure`|`metric`), per-role
  override allowed in the crosswalk.
- `sensitivity` — decision #4: **the canonical home** (`public`|`pii`|`financial`|`secret`).
  `types.jsonl` no longer carries it.
- `exactMatch` — decision #3: **all four vocabs** where a mapping exists —
  `schema:` / `fhir:` / `ocds:` / `dbt:`.

### 2.2 Crosswalk — role → universal_term
`taxonomy/v0.1/universal/crosswalk.jsonl`, one mapping per `typeId` (all 145):

```jsonc
{"role":"compensation","universalTerm":"ut:compensation"}
{"role":"host_id","universalTerm":"ut:person_identifier","sensitivity":"public"}  // per-role override
```

Optional per-role `sensitivity` / `roleFamily` overrides for edge cases (decisions #1, #4).

## 3. Non-negotiables (what does NOT change)

- **Classification** (`classify.ts`) untouched — still emits `typeId`s. Tier-3 is read *after*.
- **`types.jsonl` shape** — only the `sensitivity` field is removed (migrated). Detectors, ids,
  domains, sql_compat, confidence_floor all unchanged.
- **Bundle load story** — the two universal JSONL files fetch + parse exactly like the existing
  bundle (loader mirrors `load.ts`); attached to `TaxonomyBundle.universal`, held in memory in
  `client.ts` so resolvers are **synchronous** at the seams.

## 4. Sensitivity migration (decision #4 — in-round, full diligence)

`sensitivity` moves off `types.jsonl` into the universal layer. Two consumer seams resolve it via a
single new resolver `sensitivityForType(bundle, typeId)`:

| Seam | File:line | Was | Becomes |
|---|---|---|---|
| Schema-panel badge | `schema-panel.ts:288` | `types.find(id).sensitivity` | `sensitivityForType(bundle, typeId)` |
| Anonymize sink | `sinks.ts:170` | `fromBundle.sensitivity` | `sensitivityForType(bundle, typeId)` |

`sensitivityForType` = crosswalk `role→ut` → per-role override ?? `ut.sensitivity` ?? `'public'`.
The anonymize default map (`secret→redact`, `pii→hash`, `financial→bucket`, `public→keep`) and
demo-mode masking are unchanged in behaviour — they just get the value from a new source. **Gate must
prove the anonymize + demo path still masks identically** (smoke leg + unit parity test).

## 5. Build sequence

- **Phase 1** — author `universal-terms.jsonl` (concepts) + `crosswalk.jsonl` (145 mappings).
- **Phase 2** — `src/taxonomy/universal.ts`: loader (extends the bundle) + validator (every role
  mapped, every ut resolves, broader acyclic, roleFamily ∈ enum) + `sensitivityForType` /
  `roleFamilyForType` / `universalTermForType`. Vitest.
- **Phase 3** — strip `sensitivity` from `types.jsonl`; rewire the two seams; re-verify anonymize/demo.
- **Phase 4** — `docs/spec-amendments.md` A36; full gate (test + check + smoke incl. anonymize/demo).

## 6. Gate

`npm run test` (incl. new universal + parity tests) · `npm run check` (tsc + biome + engine-boundary +
bundle ≤768) · `npm run smoke` (incl. an anonymize/demo leg proving masking is unchanged).
The universal layer must keep the loader **engine-pure** (no DOM/FSA) — it sits beside `load.ts`.
