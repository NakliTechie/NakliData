# NakliData — the Resolve track (Vision & Roadmap)

Dated **2026-06-22**. Reference build: **NakliData v1.4.0** (shipped + tagged + deployed; see `STATUS.md`).
Companion doc: `NAKLIDATA-AGENT-HANDOFF-RESOLVE-M1.md` (the M1 build spec).

> **One line.** The sovereign mirror of an agentic CDP's *resolve → audience → activate* loop — done locally, owned as files: **resolve → segment → own.**

---

## Why now

On 2026-06-16 Databricks announced CustomerLake (agentic CDP embedded in the lakehouse); Gartner's same-day note frames it as a platform-layer land-grab where value shifts off commoditized storage/compute onto the **govern + identity + orchestration** layer. CustomerLake's whole pitch — *don't copy your data into a separate CDP, work where it lives* — is the **centralized** version of NakliData's thesis. NakliData is the **anti-centralization** version: the bytes never leave the tab at all.

This track does not chase CustomerLake. It builds the three verbs NakliData *can* own without breaking a Hard NOT, in the opposite posture:

| CustomerLake (server, multi-user, autonomous, push) | NakliData (tab, single-user, user-disposes, file) |
| --- | --- |
| **Resolve** — Agentic Identity Resolution → golden Customer 360 | **Resolve** — value-level clustering/fuzzy-merge → a reproducible CASE-rewrite |
| **Audience** — agentic segmentation workspace | **Segment** — a named, reusable predicate compiled client-side |
| **Activate** — Reverse-ETL to martech/adtech, infinity campaigns | **Own** — write the resolved canonical table out as a file you keep |

The enterprise/activation version of all this is **Trellis's** problem, not NakliData's. NakliData stays correctly a non-competitor (see `plan/competitive-analysis-warehouses-bi-cdp.md`).

---

## Doctrine fit (checked before scoping)

- **Sidecar.** Every surface here works with the AI removed. Clustering runs on deterministic key-collision + Levenshtein; the sidecar only *proposes* on ambiguous cases; the user disposes. Pull the AI → manual clustering still stands. Each surface emits an **editable artifact in the tool's own language** (a SQL cell, a `.naklidata` field, a file) — never an opaque result — and replays without any model. ✓ removability, ✓ propose-don't-dispose, ✓ reproducibility-in-artifact.
- **Edge-First.** No new inference path. The one new sidecar job rides the existing BYOK + local-runtime ladder. No new cloud egress. ✓
- **Build.** Single `dist/index.html`, no server, no accounts, no telemetry, no background polling. New write paths **orchestrate the existing engine** (reuse the calc-field emitter; do not build a parallel writer). Exported artifacts carry their own source. Each surface gets a `window.naklidata` verb. ✓

---

## The three milestones (inline roadmap)

### M1 — Clustering / fuzzy-merge  *(Resolve)* → **v1.5.0**  ← specced in the companion handoff
Detect spelling/format variants of a column's values (`Sharma Trading Co` = `Sharma Trading Co.` = `SHARMA TRADING CO`) via two OpenRefine-style methods — **key collision** (fingerprint) and **nearest neighbour** (Levenshtein). Present clusters; user accepts/edits canonical values; NakliData emits a **CASE-expression SQL cell** (an additive `col__merged` column) using the existing injection-safe emitter. User runs it.
- **Artifact:** the CASE cell — reproducible, replays with no model.
- **Sidecar:** new job `propose-merge` for borderline pairs only (structured, no prose; all-or-nothing hallucination guard). Removable.
- **Persistence:** **none** — clusters are ephemeral UI that become an ordinary SQL cell. Zero `.naklidata` schema change, zero back-compat risk.
- **Mirrors:** Agentic Identity Resolution.
- **Hard NOTs preserved:** no auto-apply (emit-then-run), injection-safe by construction, sidecar emits no prose, no background work.

### M2 — Segment primitive  *(Audience)* → **v1.5.1** (additive)
A named, reusable predicate over a table — e.g. `high_value_lapsed = total_amount > 100000 AND last_seen < '2026-01-01'` — that compiles client-side to a `WHERE` and is referenceable as `SEGMENT(name)`, exactly as `MEASURE(name)` / `DIM(name)` already work (`expandMeasures` / `src/core/dimensions.ts`). Managed in the existing **Semantic layer** panel; persisted as an optional `segments` field on `.naklidata`.
- **Artifact:** the segment definition (in the workbook description, never the data) + the cell the user runs.
- **Mirrors:** the marketer-friendly segmentation workspace.
- **Persistence:** optional `segments` field; pre-M2 files round-trip clean (mirrors how `dimensions` shipped in v1.4).
- **Hard NOTs preserved:** pure macro expansion; no server; emits a cell, never auto-runs.
- **Dependency:** independent of M1, but M1's merged columns make segments far more useful (segment on canonical entities, not noisy variants).

### M3 — Golden-table sink  *(Own)* → **v1.5.2** (additive)
A new export sink (alongside CSV / Parquet / KanZen / Bahi / NakliPoster / Export-anonymized) that writes the **resolved, deduped canonical-entity table** to a local folder as CSV/Parquet — optionally one row per canonical entity with chosen survivorship rules (keep-first / max / latest per column).
- **Artifact:** the user's own file. Customer 360, but a file you hold — no profile-as-a-service, no plane to push to.
- **Mirrors:** the unified Customer 360, inverted to ownership.
- **Persistence:** new sink; no schema change to existing fields.
- **Hard NOTs preserved:** writes to a folder the user explicitly chose; nothing leaves the tab except into the user's own disk.
- **Dependency:** consumes M1's resolved column (and is most useful after M2).

---

## Where the track deliberately stops (non-goals → route)

| Tempting | Why not in NakliData | Where it goes |
| --- | --- | --- |
| Persistent cross-session **entity graph** / identity store | Needs a server + accounts | Compute Bridge (shared) / Trellis |
| **Golden profile as a service**, enrichment marketplace | Out of category; data movement | Trellis |
| **Activation / Reverse-ETL** to martech | Out of category, no remote writes | Trellis |
| **Autonomous** resolve→act loops ("infinity campaigns") | Declined (`plan/declined.md`): no agent loops, no auto-exec, no bg polling | One Job (if sovereign autonomy ever wanted) |
| Probabilistic ML record-linkage at scale (Splink-class) | Browser-memory bound; the deterministic + sidecar pair covers the single-file case | Bridge-side enhancement, later |

---

## Sidecar posture for the whole track

One new job, `propose-merge`, is the only AI addition across all three milestones. It stays inside the declared sidecar scope ("narrow disambiguation, never prose"): given a small set of **borderline** value-pairs, it returns a structured merge/keep decision plus a canonical value drawn from the inputs — no narration, all-or-nothing reject on hallucination, three-layer guard like `propose-chart`. It rides the existing BYOK + local provider. **Removability test for the track:** delete the job → key-collision + Levenshtein clustering, segments, and the golden sink all still work end to end. ✓

---

## Roadmap table

| Ver | Milestone | New `.naklidata` field | New dep | Back-compat |
| --- | --- | --- | --- | --- |
| **v1.5.0** | M1 Clustering / fuzzy-merge | none | `fastest-levenshtein` (~2 KB, MIT) | none needed |
| v1.5.1 | M2 Segment primitive | `segments?` (optional) | none | additive, round-trips |
| v1.5.2 | M3 Golden-table sink | none | none | additive sink |

Ship minimal: M1 cuts as **v1.5.0** on its own; M2 and M3 fold into v1.5.x as additive ships. Each milestone carries full gate artifacts (STATUS entry, DECISIONS entries, spec amendment, README bullet, tests green, bundle under 750 KB).

---

## Portfolio integration

- **Trellis** is the head-on CustomerLake competitor (enterprise identity resolution, audience/NBA, activation, FinOps, DPDP consent). The Resolve track is the *sovereign cousin*: the clustering **logic** could be shared as a reference, but the **relay boundary is the line** (Edge-First Track Fork) — the moment resolution routes through a retaining server it stops being NakliData.
- **Agent face** (the parallel doctrine-debt track, extension #5): each Resolve surface ships a `window.naklidata` verb — `cluster(col, opts)`, `defineSegment(name, predicate)`, `exportGolden(opts)` — so a script, another tab, or an agent drives the same core the human does, dev-setting-gated, off by default.

---

## Next

Build M1 per the companion handoff → smoke-test → return for the M2 + M3 spec.
