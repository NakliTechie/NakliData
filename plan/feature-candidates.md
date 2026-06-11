# Feature candidates — from the competitive analysis (2026-06-11)

> **✅ ALL SHIPPED (2026-06-11).** Every candidate F1–F9 below was built,
> gated (check/test/smoke), and Chrome-verified — see STATUS + DECISIONS
> AI–AO. F1 dimensions · F2 metrics catalog · F3 code view · F4 calculated
> fields · F5 window/LOD · F6 multi-join query builder · F7 X-Ray ·
> F8 numeric distribution · F9 embed widget. (A latent M2 bug — the lazy
> measures panel's split store singletons — was fixed along the way.)
> The S1/S2 strategic/positioning notes + the "explicitly out" list stand.


Derived from [competitive-analysis-warehouses-bi-cdp.md](./competitive-analysis-warehouses-bi-cdp.md)
(NakliData vs Snowflake / BigQuery / Power BI / Tableau / Metabase /
Segment / RudderStack). Every item below is **constraint-clean** — browser-
only, no server, no account, no telemetry; none breaks a Hard NOT (§6 /
CLAUDE.md). The ranked gaps from the analysis are broken into more
granular, individually-shippable features here. Effort: S < M < L.

Status legend: 🆕 new · 🟡 deepen an existing surface.

---

## Theme A — Semantic / metrics layer (deepen `MEASURE()`, v1.3 M2)

The single highest-leverage theme — it compounds charts, the query
builder, and the AI sidecar, and leans into the taxonomy moat. Mirrors
Power BI's DAX semantic model + Looker's LookML + Snowflake Semantic Views.

- **F1 · Named dimensions** 🆕 (value high · fit high · effort M)
  Reusable derived dimensions referenceable like measures — e.g.
  `region = GSTIN[0..2]`, `month = date_trunc('month', ts)`. Pure
  client-side macro expansion, same path as `MEASURE()`. Pairs with F4.
- **F2 · Metrics catalog panel** 🟡 (value med-high · fit high · effort S–M)
  One panel to browse / edit / version all measures + dimensions (today
  measures live behind the Measures button only). Surfaces "applicable
  metrics" per result.
- **F3 · Declarative semantic block (Cube / LookML-style)** 🆕 (value med · fit high · effort M–L)
  A code-reviewable metrics definition block round-tripped in
  `.naklidata` — "metrics as a versioned artifact." The warehouses'
  defining feature; we'd do it client-side, in the workbook description,
  never the data.

## Theme B — Authoring ergonomics (BI parity)

- **F4 · Calculated / derived fields on a result** 🆕 (value high · fit high · effort M)
  **The single most-requested BI ergonomic we lack** (Tableau / Power BI
  / Metabase all have it). Point-and-click a new column (field + op /
  expression) → NakliData rewrites the SELECT via the existing
  injection-safe, no-string-concat emitter (already built for the visual
  query builder + anonymize sink). Output stays a user-run cell (Hard
  NOT #4 preserved).
- **F5 · LOD-style expressions** 🆕 (value med · fit med · effort M — stretch on F4)
  Tableau's FIXED / INCLUDE / EXCLUDE level-of-detail calcs — windowed /
  scoped aggregates beyond a flat calculated field. Stretch goal layered
  on F4.
- **F6 · "Ask a question" guided query builder** 🟡 (value med-high · fit high · effort M)
  Grow the v1.2 M5 visual builder (single table + one join) toward
  Metabase's multi-step question builder: multi-join, derived steps
  (filter → summarise → re-summarise), nested group-bys — all on the
  same safe emitter. Adoption win for non-SQL users.

## Theme C — Profiling / data quality

- **F7 · "Profile this table" X-Ray** 🟡 (value high · fit high · effort S–M)
  Metabase X-Ray pattern: one click on a table → an auto-generated
  exploratory mini-set of cells (distributions, outliers, correlations).
  **Bundles already-shipped pieces** — column profile + stats cell +
  correlation matrix (v1.3 M4) + quick-chart. Cheap, high demo value.
- **F8 · Outlier / distribution surfacing in the profile** 🆕 (value med · fit high · effort S — stretch on F7)
  Add quartile/outlier flags + a mini sparkline-histogram to the per-
  column profile. All DuckDB-side.

## Theme D — Distribution / embed

- **F9 · Embeddable read-only `?lens=` widget** 🆕 (value med · fit med · effort M–L)
  A `<nakli-data-widget src="?lens=...">` web component / sandboxed
  iframe that renders a notebook read-only — closes the "embed in a
  wiki/intranet" gap **server-free** (the embedding page supplies the
  data context, exactly as the full app does). **Must stay read-only,
  no-telemetry, no-account; needs a sandboxing + CSP review.** Already
  noted for v2.1.

---

## Strategic / positioning (not features — narrative + watch)

- **S1 · Compute Bridge ↔ MotherDuck-style hybrid execution.** MotherDuck
  is the one warehouse sharing our DuckDB engine lineage ("local-first
  DuckDB, scale to cloud"). The planned Compute Bridge is our offload
  seam; align messaging + watch as the boundary blurs.
- **S2 · Warehouse-native CDP co-existence (RudderStack).** RudderStack's
  "you own the data, warehouse-native, OSS, no MTU lock-in" pitch is our
  closest *philosophical* ally. Positioning story: NakliData is the
  private local exploration surface on a warehouse a warehouse-native CDP
  already populates. Not a feature — a narrative for docs / landing.

## Explicitly OUT (would break a Hard NOT or the category)

Scheduled refresh / alerts (no bg polling) · RBAC / multi-user / sharing-
by-account (no accounts) · event ingestion / identity resolution /
activation (out of category + no telemetry) · server-side authed embedded
analytics (no server) · Tableau-Pulse-style AI **prose** narration of
results (no prose insights). *Note:* a **structured** "metrics changed
since last open" digest (numbers + deltas, no prose) could be a
constraint-safe cousin of Pulse if ever demanded — not ranked.

---

## Suggested v1.4 slate

If cutting a focused next milestone, the highest value-to-fit cluster is
**F4 (calculated fields) + F7 (X-Ray profile) + F1/F2 (dimensions +
metrics catalog)** — all M-or-smaller, all build on shipped infra (the
safe emitter, the stats cell, the measures layer), and together they
close the most-felt BI-parity gaps without touching a constraint. F6 and
F9 are natural follow-ons; F3/F5/F8 are deepening stretches.
