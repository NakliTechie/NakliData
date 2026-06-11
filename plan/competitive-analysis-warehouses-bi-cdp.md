# Competitive landscape — warehouses, BI, and CDPs

Dated **2026-06-11**. Reference build state: **NakliData v1.3.0** (shipped + tagged + deployed — see `STATUS.md` top entry).

This is a **backlog-feeding** competitive doc. It compares NakliData against three platform categories it is regularly *mentioned alongside* but mostly does **not** compete with: cloud data warehouses, enterprise BI, and customer-data platforms (CDPs).

It deliberately **extends, not duplicates**, the two existing comparison docs:

- [`data-platform-comparison.md`](./data-platform-comparison.md) — Databricks / Snowflake / Fabric / BQ+Looker / Hex / analytics-notebooks. Strong on the *lakehouse + notebook* axis; Databricks-centric; no per-platform pricing, no CDP. **This doc adds** dedicated, current-pricing per-platform notes for Snowflake + BigQuery, promotes Power BI / Tableau / Metabase to first-class BI comparators, and opens the CDP category.
- [`product-analytics-comparison.md`](./product-analytics-comparison.md) — Mixpanel / Amplitude / PostHog. Orthogonal (event-analytics). **This doc does not re-tread it**; CDPs are upstream of those tools and are covered fresh here.
- [`warehouse-and-bi-question.md`](./warehouse-and-bi-question.md) — the "should we be a warehouse / Superset?" parking lot. **This doc operationalises** its "worth borrowing" list into a ranked, constraint-checked backlog.

The thesis stays the one from the existing docs: NakliData is **top-left** on the personal↔team × thin-client↔thick-platform map — a single-user, browser-native, bring-your-own-data workbench. The platforms here are bottom-right. The value of the comparison is **(a)** a clean differentiation story and **(b)** a list of *ergonomics* worth borrowing without breaking a Hard NOT.

---

## TL;DR

- **Different category, not a weaker version.** Warehouses (Snowflake, BigQuery), enterprise BI (Power BI, Tableau, Metabase), and CDPs (Segment, RudderStack) are all **server-side, multi-user, data-gravity-inward** systems: your data lands in *their* plane (or your cloud warehouse *they* operate against), compute runs *there*, and people *log in*. NakliData is the inverse on every axis — **no server, no accounts, data never leaves the tab, BYOK AI**.
- **Where we genuinely win:** zero-install / zero-cost / offline; data-never-leaves-the-tab privacy (no DPA, no data-residency review, no vendor breach surface); semantic taxonomy auto-classification (none of these ship generic-column semantic typing); instant local analysis of 15 file formats; in-browser associative cross-filter (Qlik's model, no server); BYOK AI with no vendor lock-in *and* a fully-local model runtime. These are not features the incumbents can cheaply copy — they're architectural.
- **Where we're a non-competitor by design:** TB/PB scale + concurrency, RBAC/governance, scheduled pipelines/alerts, multi-user live dashboards, identity resolution + activation. Several of these **would violate a Hard NOT** (no server, no accounts, no background polling) — flagged inline. Don't chase them.
- **Top backlog gaps to borrow (ranked, all constraint-clean):** (1) richer **semantic/metrics layer** atop `MEASURE()` — dimensions + a code-reviewable cube file; (2) **calculated/derived fields** on a result (Tableau-style), no raw SQL; (3) **deeper column profiling / data-quality** surface (Metabase X-Ray, BI data-profiling); (4) **"ask a question" guided query builder** evolution of the visual builder (Metabase question-builder); (5) **embeddable read-only widget** (`?lens=`-powered `<iframe>`/web component). All four-plus fit the browser, none needs a server.
- **Surprising finding:** the CDP category — *especially RudderStack's "warehouse-native, you own the data, open-source core, no MTU lock-in"* pitch — is the **closest philosophical ally to NakliData's anti-data-gravity thesis** in this whole set, even though it's functionally orthogonal. RudderStack markets *exactly* NakliData's privacy/ownership framing to a different buyer. There's a positioning + co-existence story there (NakliData as the local exploration surface on top of a warehouse a warehouse-native CDP already populates), not a competitive one.

---

## Category map — where NakliData sits

Three families, plotted against NakliData's two load-bearing axes.

```
              data-gravity INWARD                         data-gravity NONE
              (data lands in their plane)                 (data stays on your disk/tab)
   server /   ┌─────────────────────────────────────────┬───────────────────────────┐
   multi-user │  Snowflake · BigQuery   (warehouses)     │                           │
              │  Power BI · Tableau     (enterprise BI)  │      (empty —             │
              │  Metabase (server)                       │   server+multi-user but   │
              │  Segment · RudderStack-cloud  (CDP)      │   zero data-gravity is    │
              │                                          │   a contradiction)        │
              ├─────────────────────────────────────────┼───────────────────────────┤
   single-user│  Metabase-OSS-on-laptop                  │  ★ NakliData              │
   / no-server│  RudderStack-OSS-self-host (partial)     │  Datasette Lite · PondPilot│
              │  DuckDB CLI (data local, but a CLI)      │  DuckDB-wasm shells       │
              └─────────────────────────────────────────┴───────────────────────────┘
```

**Overlap vs orthogonality, per family:**

| Family | Overlap with NakliData | Orthogonal / non-competing |
| --- | --- | --- |
| **Warehouses** (Snowflake, BigQuery) | SQL surface; semantic/metrics layer; NL→SQL; the *output* of a warehouse is often a file/extract NakliData then reads | Storage + petabyte compute; governance; pipelines; concurrency; time-travel; marketplace |
| **Enterprise BI** (Power BI, Tableau, Metabase) | Charts, pivots, dashboards, calculated fields, "ask a question"; VizQL-style shelves (we borrowed this in v1.3 M5) | Multi-user publishing, RBAC, scheduled refresh, embedded enterprise analytics, server-side rendering |
| **CDP** (Segment, RudderStack) | *Almost none functionally.* Shared **philosophy** with RudderStack (warehouse-native, own-your-data, OSS). NakliData reads the warehouse/exports a CDP produces | Event ingestion (SDKs), identity resolution, real-time activation to 700+ destinations, audience orchestration |

The honest read: NakliData is the tool you open to **look at, classify, query, and chart data that one of these systems produced or that never went near them at all** — a CSV from a Snowflake `EXPORT`, a Parquet drop from a warehouse-native CDP, a vendor's invoice file that you refuse to upload anywhere. The Compute Bridge (planned) is the explicit handoff seam to the warehouse world when data outgrows the tab.

---

## Per-platform notes (current to 2025/2026)

### Cloud data warehouses

#### Snowflake
- **What it is (2026):** cloud data-warehouse / "AI Data Cloud." Hard separation of **storage** (per-TB) and **compute** (virtual warehouses billed in **credits**). Cortex AI is its LLM layer (LLM SQL functions, Cortex Analyst NL→SQL, Cortex Search/Agents); Streamlit-in-Snowflake for apps; Marketplace + Delta/Iceberg interop; Time Travel.
- **Deployment / pricing:** fully managed SaaS on AWS/Azure/GCP. Compute credits ~**$2/credit (Standard), ~$3 (Enterprise), ~$4 (Business Critical)** on US on-demand; warehouse sizes burn **1 credit/hr (XS) → 128 credits/hr (6XL)**. Storage ~**$23–40/TB-month**. Cortex AI moved to a separate **"AI Credit"** flat-rate model (edition-independent) in the April-2026 pricing overhaul, billed per-token/per-request; agents stack costs additively across sub-services. ([Snowflake AI pricing docs](https://docs.snowflake.com/en/user-guide/snowflake-cortex/pricing), [CloudZero 2026 guide](https://www.cloudzero.com/blog/snowflake-pricing/), [Finout 2026 guide](https://www.finout.io/blog/the-complete-guide-to-snowflake-pricing-2025))
- **Data-gravity / architecture:** **maximally inward.** All data lands in Snowflake-native (or Snowflake-operated Iceberg) storage; compute is Snowflake's; access is account+RBAC. There is no "open it in a tab" path. This is the *polar opposite* of NakliData's posture, which makes it the sharpest differentiation foil.

#### Google BigQuery
- **What it is (2026):** serverless cloud DW. **Editions** (Standard / Enterprise / Enterprise Plus) for capacity, or **on-demand** per-TiB. **Gemini in BigQuery** + **Data Canvas** (NL-driven find/transform/query/visualise over a DAG canvas — notable because it is the *closest incumbent analog to NakliData's notebook + sidecar shape*, but server-side and GCP-tenanted). BQML for in-warehouse ML; Connected Sheets; Analytics Hub.
- **Deployment / pricing:** GCP-tenanted serverless. On-demand **~$6.25/TiB scanned**, first **1 TiB/month free**; capacity = reserved **slots** (autoscaling) via Editions. Storage **$0.02/GB-mo active**, **~$0.01/GB-mo long-term** (auto after 90 days untouched), first **10 GB free**. ([BigQuery pricing](https://cloud.google.com/bigquery/pricing), [Editions intro](https://docs.cloud.google.com/bigquery/docs/editions-intro), [Data Canvas docs](https://docs.cloud.google.com/bigquery/docs/data-canvas))
- **Data-gravity / architecture:** inward (data in BigQuery storage / GCS), but the **per-TiB free tier + serverless** model makes it the *most "individual-friendly"* warehouse — relevant because a hobbyist could plausibly use BQ on-demand *or* NakliData for a one-off, so the "$0, no account, no upload" pitch lands here.

#### Adjacent (noted, not profiled): Databricks, MotherDuck
- **Databricks** — lakehouse platform; covered in `data-platform-comparison.md`. Same inward-gravity critique as Snowflake.
- **MotherDuck** — *the* adjacent worth flagging: a **DuckDB-based** serverless DW with a "hybrid execution" model splitting work between the cloud and a **local DuckDB (incl. WASM)**. It is the warehouse that shares NakliData's *engine lineage* (DuckDB). Differentiation is still architectural: MotherDuck is an account + a hosted catalog + a server side; NakliData is the tab. But it's the one warehouse whose marketing ("local-first DuckDB, scale to cloud") rhymes with ours — worth watching as the category boundary blurs.

### Enterprise BI / analytics

#### Microsoft Power BI (+ Fabric)
- **What it is (2026):** Microsoft's BI suite, now folded into **Microsoft Fabric**. DAX-driven **semantic models** (tabular), Power Query (M) for prep, report/dashboard authoring, **Copilot** for NL authoring + summaries.
- **Deployment / pricing:** SaaS in a Microsoft 365 / Fabric tenant. **Pro $14/user/mo**, **PPU $24/user/mo**, or **Fabric capacity (F2–F2048)** billed in Capacity Units (F2 ≈ $262/mo PAYG). Copilot available from **F2** since April 2025. Semantic-model size caps ~100 GB (PPU) to ~400 GB (high Fabric SKUs). ([Power BI pricing](https://www.microsoft.com/en-us/power-platform/products/power-bi/pricing), [SR Analytics 2026 license guide](https://sranalytics.io/blog/power-bi-licenses/), [Copilot capacity](https://learn.microsoft.com/en-us/fabric/enterprise/fabric-copilot-capacity))
- **Data-gravity / architecture:** inward — data is imported into the semantic model (in-tenant) or DirectQuery'd to a tenant-connected source; everything is account-gated in the MS cloud. The **semantic model + DAX measures** is the feature most worth studying for our `MEASURE()` layer.

#### Tableau (Salesforce)
- **What it is (2026):** the visual-analytics standard. **VizQL** (drag fields onto shelves → declarative viz — *the* model NakliData borrowed for v1.3 M5 shelf authoring) is now also exposed as a headless **VizQL Data Service** API. **Tableau Pulse** (AI metric digests), **Tableau Agent** (conversational viz authoring, multilingual) on the **Einstein/Agentforce Trust Layer**. Rich calculated fields, LOD expressions.
- **Deployment / pricing:** Tableau Cloud / Server, per-role seats. Cloud Standard: **Viewer $15 / Explorer $42 / Creator $75** per user/mo (annual); Enterprise: **$35 / $70 / $115**. Every deployment needs ≥1 Creator. ([Tableau pricing](https://www.tableau.com/pricing), [2025.1 features](https://www.tableau.com/2025-1-features), [Tableau Agent help](https://help.tableau.com/current/online/en-us/web_author_einstein.htm))
- **Data-gravity / architecture:** extracts (`.hyper`) or live connections; published to Server/Cloud; account+role gated. **Calculated fields + VizQL shelves** are the two ergonomics most relevant to our backlog (we have shelves; calculated fields are a gap).

#### Metabase
- **What it is (2026):** the **open-source-friendly** BI tool — the closest BI comparator to NakliData's "free + self-host" instinct. Question builder ("ask a question" without SQL), dashboards, **X-Ray** (one-click auto-profile of a table/column → instant exploratory dashboard — *directly relevant* to our column-profile gap), **Data Studio** semantic-layer workbench + **Metrics** (v59+), native multi-tenant embedding, **Metabot** AI add-on (NL→SQL).
- **Deployment / pricing:** **OSS edition free** (self-host via Docker/JAR; real cost is infra + DevOps, often cited $18–20K/yr all-in). Cloud: **Starter ~$100/mo** (+$6/user), **Pro ~$575/mo** (+$12/user), **Enterprise from ~$20K/yr**. Metabot add-on ~$100/mo per 500 requests. ([Metabase pricing](https://www.metabase.com/pricing/), [Metabase OSS](https://www.metabase.com/start/oss/))
- **Data-gravity / architecture:** **server-bound even when self-hosted** — it's a JVM service connecting to *your* DB; data flows DB→Metabase-server→browser. Multi-user + permissions are core. So even the OSS "free" path is not NakliData's path (a server you run, not a static page). Metabase's *question builder* and *X-Ray* are the highest-value patterns to borrow.

#### Sharpening comparators (noted, see existing docs): Looker, Qlik, Superset
- **Looker (LookML)** — the canonical **code-defined semantic layer**; the reference for "metrics as version-controlled code." Sharpens the metrics-layer backlog gap.
- **Qlik** — the **associative engine** NakliData borrowed for the v1.3 M1 cross-filter (selected / associated / excluded; absence-as-signal grey-out). We already ship a browser-native, single-user version of Qlik's defining feature — a genuine *win* worth stating loudly.
- **Apache Superset** — covered in `warehouse-and-bi-question.md`; server-side multi-user BI; the "don't become Superset" conclusion stands.

### Customer Data Platforms (CDP)

#### Twilio Segment
- **What it is (2026):** the category-defining CDP. Collect events from sources via SDKs → **identity resolution** (dedup to one user) → route to **700+ destinations** + the warehouse; audiences, Protocols (governance), Reverse ETL, predictions.
- **Deployment / pricing:** SaaS, billed on **Monthly Tracked Users (MTUs)** + API calls. Free up to 1,000 visitors/2 sources; **Team ~$120/mo** (10K MTUs); **Business** custom (100K+ MTUs, identity resolution, Protocols). MTU pricing is famously hard to predict for high-traffic/low-conversion sites. ([Twilio CDP pricing](https://www.twilio.com/en-us/pricing/customer-data), [MTUs & throughput](https://www.twilio.com/docs/segment/guides/usage-and-billing/mtus-and-throughput))
- **Data-gravity / architecture:** **maximally inward** — events flow *through Segment's plane* before fan-out. This is the data-routing-through-a-third-party model NakliData's "nothing relays through a NakliData server (there isn't one)" line is explicitly written against.

#### RudderStack
- **What it is (2026):** **warehouse-native, open-source-core** CDP. Same shape as Segment (collect → identity → activate, Segment-API-compatible for drop-in migration) but built to run **on top of the customer's own warehouse** (Snowflake/BigQuery/Databricks/Redshift); dual-license (**AGPL-3.0 server**, MIT SDKs); self-hostable.
- **Deployment / pricing:** cloud or self-host. **Event-volume** pricing ("no MTUs, no cliffs"); Free plan **1M events/mo**; OSS self-host effectively uncapped. ([RudderStack pricing](https://www.rudderstack.com/pricing/), [rudder-server GitHub](https://github.com/rudderlabs/rudder-server))
- **Data-gravity / architecture:** **the philosophical ally.** RudderStack's *entire pitch* — "you own the data, it lives in your warehouse, open-source core, no vendor lock-in, no MTU trap" — is NakliData's privacy/ownership thesis aimed at a different buyer (data engineers wiring event pipelines). Functionally orthogonal (it's an ingestion/activation pipeline; we're a read-only exploration workbench) but the **positioning rhymes**, and the co-existence story is clean: RudderStack populates the warehouse → NakliData (via export or Compute Bridge) is where a single user explores it privately.

---

## Comparison matrix

Capability rows × platform columns. NakliData is one column.
✅ have · 🟡 partial · 🆕 in backlog (constraint-clean) · 🚫 out of scope (often a Hard NOT) · — n/a

| Capability | Snowflake | BigQuery | Power BI | Tableau | Metabase | Segment | RudderStack | **NakliData** |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| **Where data lives** | Snowflake cloud | GCP/BQ | MS tenant | extracts/server | your DB (via server) | Segment plane | your warehouse | **your disk / tab** |
| **Where compute runs** | Snowflake | BQ serverless | Fabric/tenant | server/extract | JVM server | Segment | warehouse | **browser (DuckDB-wasm)** |
| Zero-install (just a URL) | — | — | 🟡 desktop app | 🟡 desktop app | — | — | — | ✅ |
| Runs fully offline | — | — | 🟡 (Desktop) | 🟡 (Desktop) | — | — | — | ✅ PWA + vendored DuckDB |
| Free for an individual, no caps | 🟡 trial | 🟡 1 TiB/mo free | 🟡 | — | 🟡 OSS (infra cost) | 🟡 1K MTU | 🟡 1M ev/mo | ✅ no auth, no caps |
| No account / login | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | ✅ (Hard NOT to add) |
| Data never leaves your control | 🚫 | 🚫 | 🚫 | 🚫 | 🟡 (your server) | 🚫 | 🟡 (your WH) | ✅ core thesis |
| Reads local files directly | — | 🟡 upload | 🟡 import | ✅ (desktop) | 🟡 upload | — | — | ✅ 15 formats via FSA |
| SQL editor | ✅ | ✅ | 🟡 | 🟡 | ✅ | — | 🟡 | ✅ CodeMirror 6 |
| Semantic auto-classification of columns | 🟡 tags | 🟡 | — | — | 🟡 field types | 🟡 | 🟡 | ✅ **taxonomy (48 types) — unique** |
| Semantic / metrics layer | ✅ Semantic Views | 🟡 | ✅ DAX model | ✅ calc fields/LOD | 🟡 Metrics/Data Studio | — | — | 🟡 `MEASURE()` — **gap to deepen** |
| Calculated / derived fields (no raw SQL) | 🟡 | 🟡 | ✅ DAX | ✅ | ✅ | — | — | 🆕 backlog |
| NL → SQL (BYOK on our side) | ✅ Cortex | ✅ Gemini | ✅ Copilot | ✅ Agent | ✅ Metabot | — | — | ✅ sidecar Job 5 (never auto-run) |
| AI explain / summarise | ✅ | ✅ | ✅ | ✅ Pulse | ✅ | — | — | ✅ jobs 1/6 (no prose narration of data) |
| Bring-your-own LLM key | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 | — | — | ✅ BYOK + **fully-local model runtime** |
| Charts | ✅ | ✅ | ✅ | ✅ best-in-class | ✅ | — | — | ✅ 11 types + shelf authoring (VizQL) |
| Pivot | ✅ | 🟡 | ✅ | ✅ | ✅ | — | — | ✅ pivot cell |
| Associative cross-filter (Qlik model) | — | — | 🟡 slicers | 🟡 filters | 🟡 | — | — | ✅ **in-browser, single-user — unique here** |
| Dashboards | ✅ | 🟡 | ✅ | ✅ | ✅ | — | — | ✅ dashboard cell (single-user) |
| Visual query builder | 🟡 | 🟡 Canvas | ✅ | ✅ | ✅ "ask a question" | — | — | ✅ Build-query (v1.2 M5) — **gap to grow** |
| Column profiling / X-Ray | 🟡 | 🟡 | 🟡 | 🟡 | ✅ X-Ray | — | — | 🟡 column profile — **gap to deepen** |
| Data-quality assertions | 🟡 | 🟡 | — | — | — | 🟡 Protocols | 🟡 | ✅ assertion cell (dbt-tests pattern) |
| Cell / data lineage | ✅ | ✅ | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 | ✅ EXPLAIN-based notebook lineage + edit |
| Anonymized / governed export | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 RBAC | ✅ Protocols | ✅ | ✅ per-column anonymize sink |
| Embeddable views | ✅ | ✅ | ✅ | ✅ | ✅ native embed | — | — | 🟡 `?lens=` link — 🆕 widget backlog |
| RBAC / governance | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 | 🚫 (Hard NOT — no accounts) |
| Multi-user / collaboration | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🚫 (single-user; file is the share) |
| Scheduled refresh / pipelines / alerts | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🚫 (Hard NOT — no bg polling) |
| Event ingestion / identity / activation | — | — | — | — | — | ✅ | ✅ | 🚫 (out of category) |
| PB-scale + concurrency | ✅ | ✅ | ✅ | ✅ | 🟡 | ✅ | ✅ | 🚫 (browser-bound; Compute Bridge offloads) |

---

## Where we win / non-competitor by design / actionable gaps

### Where NakliData genuinely wins

1. **Zero-everything onboarding.** A URL, no install, no account, no trial clock, no infra bill. Among this set only BigQuery's per-TiB free tier and Metabase-OSS get *near* "free," and both still need an account or a server. NakliData is the only one where the *honest answer to "what does it cost / how do I start"* is "open the tab."
2. **Data never leaves the tab — architecturally, not as a setting.** Every other system here is data-gravity-inward: your bytes (or your warehouse, operated by them) sit in their plane. NakliData has *no server to send to*. This collapses an entire enterprise-procurement surface (DPA, data-residency, breach blast-radius, sub-processor review) to zero. For the "vendor sent me a sensitive CSV" use case, this is decisive.
3. **Semantic taxonomy.** None of the eight ship generic-column semantic auto-classification (GSTIN/HSN/IFSC/email/log-level/etc. with confidence + evidence + sensitivity badges). Warehouses tag columns manually; BI tools infer SQL types only. This is NakliData's most defensible, hardest-to-copy differentiator.
4. **Instant local analysis of 15 formats.** Drop a `.sav`, `.dta`, `.sas7bdat`, `.xlsx`, `.parquet`, GeoJSON — query in seconds, no upload, no connector setup. The warehouses need ingestion; the BI tools need a connection or an import.
5. **Associative cross-filter in the browser.** We ship Qlik's signature model (selected/associated/excluded grey-out, absence-as-signal) single-user and server-free. Qlik charges for it; nobody else here ships it at all.
6. **BYOK AI with no lock-in + a local runtime.** Every incumbent's AI is *their* model on *their* bill (Cortex/Gemini/Copilot/Agent/Metabot). NakliData lets you point at your own Anthropic/OpenAI/custom endpoint *or* run a model fully in-browser with zero network. No per-token vendor bill, no data sent to the BI vendor's LLM.

### Non-competitor by design (and why — Hard NOT flags)

| What they have | Why NakliData doesn't / can't follow | Hard NOT? |
| --- | --- | --- |
| PB-scale storage + elastic concurrency | Browser memory bound; **Compute Bridge** is the deliberate offload seam (user owns the binary) | No (architectural, not forbidden) |
| RBAC / governance / row-level security | No accounts; the workbook is the scope unit | **Yes** — "no login, accounts" (§6) |
| Scheduled refresh / pipelines / alerts | No always-on server; "Refresh" is user-click-only | **Yes** — "no background polling" |
| Multi-user live dashboards + collaboration | Single-user; `.naklidata` file / `?lens=` link is the share | **Yes** — "no sharing-via-link" accounts; sharing is the file |
| Event ingestion / identity resolution / activation (CDP) | Out of category — we read what exists, we don't capture or route | **Yes-adjacent** — "no telemetry, no write to remote sources" |
| Hosted model serving / AI-on-our-bill | BYOK + local-model is the answer; we never run inference server-side | partial (no telemetry/server) |
| Data marketplace / sharing networks | No accounts → no marketplace surface | **Yes** — no accounts |
| Auto-executed AI SQL (Cortex/Genie run-and-show) | Every generated SQL lands as a cell the user runs | **Yes** — "no auto-execution of LLM SQL" |
| AI prose "insights"/narration (Pulse-style digests) | Sidecar emits structured config or one-line bounded observations only | **Yes** — "no prose insights/narrations" |

### Actionable gaps for the backlog (ranked by value-to-fit)

Each is checked against the Hard NOTs and tagged effort + fit. All are **browser-only, no-server, no-account** — i.e. none requires breaking the vision. Cross-referenced to existing planning where noted.

1. **Deepen the semantic / metrics layer beyond `MEASURE()`** *(value: high · fit: high · effort: M)*
   We ship `MEASURE(name)` (filtered aggregates). The warehouses/Looker/Power BI show the next step: **dimensions + reusable metric definitions as a code-reviewable artifact**. Add (a) named *dimensions* (e.g., `region = GSTIN[0..2]`), (b) a metrics catalog panel, (c) round-trip into `.naklidata` (already partly there). Optional: a Cube/LookML-style declarative block. **No constraint conflict** — it's pure client-side macro expansion; lives in the workbook description, never the data. *Builds directly on v1.3 M2; cross-ref `warehouse-and-bi-question.md` Cube.dev note.* **#1 because it compounds every other surface (charts, query builder, AI) and leans into our taxonomy moat.**

2. **Calculated / derived fields on a result (Tableau/Power BI/Metabase have this)** *(value: high · fit: high · effort: M)*
   Let a user add a computed column to a result without hand-writing the full SQL — pick fields + an operation/expression, NakliData rewrites the SELECT (reuse the **type-validated, no-string-concat emitter** already built for the visual query builder + anonymize sink, so it's injection-safe by construction). **No conflict** — same airtight-quoter posture; output is a cell the user runs (Hard NOT #4 preserved). **#2 because it's the single most-requested BI ergonomic we lack and the safe-emitter infra already exists.**

3. **Deeper column profiling / data-quality surface (Metabase X-Ray, BI data-profiling)** *(value: high · fit: high · effort: S–M)*
   We have a per-column profile (cardinality/null%/top-5) and assertion cells. Metabase's **X-Ray** is the pattern to grow toward: one click on a table → an auto-generated exploratory mini-dashboard (distributions, outliers, correlations — we already have the stats cell + correlation matrix from v1.3 M4). Bundle them into a "Profile this table" action that emits a small set of cells. **No conflict** — all DuckDB-side, no server. *Cross-ref `warehouse-and-bi-question.md` item 4 (Metabase X-Ray) — this operationalises it.* **#3: cheap, leverages shipped pieces (profile + stats + quick-chart), high demo value.**

4. **Evolve the visual query builder toward a Metabase-style "ask a question"** *(value: med-high · fit: high · effort: M)*
   v1.2 M5 ships a form-based builder (single table + one join + filters + group-by + aggregates). Metabase's question builder is the north star: multi-step (filter → summarise → re-summarise), field-picker-driven, no SQL knowledge required. Grow ours incrementally (multi-join, derived steps, nested group-bys) **on the same safe emitter**. **No conflict.** **#4: clear adoption value for non-SQL users; bounded, builds on shipped code.**

5. **Embeddable read-only widget (`?lens=`-powered)** *(value: med · fit: med · effort: M–L)*
   Every BI tool embeds. We have the `?lens=` share link (carries the workbook description, never data). A `<nakli-data-widget src="?lens=...">` web component / sandboxed iframe that renders a notebook read-only would close the "embed in a wiki/intranet" gap **without a server** — the embedding page supplies the data context (FSA/remote), exactly as the full app does. **Constraint check:** must stay read-only, no telemetry, no account; the data still never routes through us. Already on the v2.1 roadmap (`pending.md`) and noted in `warehouse-and-bi-question.md`. **#5: real gap, but more surface area and a security review (sandboxing, CSP) than #1–4, hence lower fit-to-effort.**

**Explicitly NOT recommended (would break a Hard NOT or the category):** scheduled refresh/alerts (no bg polling), RBAC/multi-user (no accounts), event ingestion/identity (out of category + no telemetry), server-side embedded analytics with auth (no server), AI prose data-narration like Tableau Pulse (no prose insights). The Tableau-Pulse-style "AI metric digest" is tempting but collides head-on with the "no prose narrations of query results" Hard NOT — a *structured* "metrics-changed-since-last-open" summary (numbers + deltas, no prose) could be a constraint-safe cousin if a workload ever demands it, but it's not ranked above.

---

## Sources

Warehouses:
- Snowflake — [AI pricing docs](https://docs.snowflake.com/en/user-guide/snowflake-cortex/pricing) · [CloudZero 2026 pricing guide](https://www.cloudzero.com/blog/snowflake-pricing/) · [Finout 2026 components guide](https://www.finout.io/blog/the-complete-guide-to-snowflake-pricing-2025)
- BigQuery — [pricing](https://cloud.google.com/bigquery/pricing) · [editions intro](https://docs.cloud.google.com/bigquery/docs/editions-intro) · [Data Canvas docs](https://docs.cloud.google.com/bigquery/docs/data-canvas) · [Gemini in BigQuery GA](https://cloud.google.com/blog/products/data-analytics/gemini-in-bigquery-features-are-now-ga)

BI / analytics:
- Power BI — [official pricing](https://www.microsoft.com/en-us/power-platform/products/power-bi/pricing) · [SR Analytics 2026 license guide](https://sranalytics.io/blog/power-bi-licenses/) · [Fabric Copilot capacity](https://learn.microsoft.com/en-us/fabric/enterprise/fabric-copilot-capacity)
- Tableau — [pricing](https://www.tableau.com/pricing) · [2025.1 features](https://www.tableau.com/2025-1-features) · [Tableau Pulse](https://www.tableau.com/products/tableau-pulse) · [Tableau Agent help](https://help.tableau.com/current/online/en-us/web_author_einstein.htm)
- Metabase — [pricing](https://www.metabase.com/pricing/) · [OSS editions](https://www.metabase.com/start/oss/) · [cloud vs self-host](https://www.metabase.com/docs/latest/cloud/cloud-vs-self-hosting)

CDP:
- Segment — [Twilio CDP pricing](https://www.twilio.com/en-us/pricing/customer-data) · [MTUs & throughput](https://www.twilio.com/docs/segment/guides/usage-and-billing/mtus-and-throughput)
- RudderStack — [pricing](https://www.rudderstack.com/pricing/) · [rudder-server GitHub](https://github.com/rudderlabs/rudder-server) · [vs Segment](https://www.rudderstack.com/competitors/rudderstack-vs-segment/)

Sibling internal docs:
- [`data-platform-comparison.md`](./data-platform-comparison.md) · [`product-analytics-comparison.md`](./product-analytics-comparison.md) · [`warehouse-and-bi-question.md`](./warehouse-and-bi-question.md) · [`enterprise-strategy.md`](./enterprise-strategy.md) · `STATUS.md` (v1.3.0)
