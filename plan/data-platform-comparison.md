# Data-platform comparison — Databricks et al.

How NakliData stacks up against the dominant data-platform stack
(Databricks, Snowflake, Microsoft Fabric, BigQuery + Looker) and the
analytics-notebook neighbors (Hex, Mode, Deepnote, Observable).
Companion to [`product-analytics-comparison.md`](./product-analytics-comparison.md)
(Mixpanel/Amplitude/PostHog) and [`warehouse-and-bi-question.md`](./warehouse-and-bi-question.md)
(do we need a warehouse / should we be Superset).

This doc has a deliberate twist: we don't compete with Databricks
head-on. We're a **personal-scale workbench**, they're a **team-scale
platform with a server-side fabric**. The comparison is useful for
two reasons:

1. **Adjacent surface to learn from.** Where Databricks SQL, AI
   Functions, and Genie have features that map cleanly onto our
   notebook + sidecar surface, borrow the pattern.
2. **Sharp differentiation story.** Knowing what we're not is as
   important as knowing what we are. The "browser-native, your data
   never leaves the tab" thesis is much sharper when contrasted with
   Snowflake's "all your data lives in our cloud."

---

## Comparators in scope

### Tier 1 — full data-platform stacks (the giants)

| Tool | Posture | What they do well | Where they don't fit our shape |
| --- | --- | --- | --- |
| [Databricks](https://www.databricks.com/) | Lakehouse SaaS on AWS/Azure/GCP | Spark + Photon for compute · Unity Catalog · Delta Lake · MLflow · AI Functions (Genie) · DBSQL warehouses · Notebooks (Python/SQL/Scala) | Server-side everything; data sits in your cloud-tenanted Delta/S3; multi-user with RBAC + lineage; pricing scales with DBUs. |
| [Snowflake](https://www.snowflake.com/) | Cloud DW SaaS | Compute/storage separation · Cortex AI (LLM SQL functions) · Streamlit-in-Snowflake · Marketplace · Cross-region replication · Time travel | Same — server-side, fully managed, no "open it in a tab" path. |
| [Microsoft Fabric](https://www.microsoft.com/en-us/microsoft-fabric) | All-in-one MS analytics SaaS | OneLake unified storage · Synapse engines · Power BI native integration · Notebooks · Data Factory · Real-Time Analytics | Microsoft 365 tenant required; tightly Azure-locked. |
| [Google BigQuery + Looker](https://cloud.google.com/bigquery) | Serverless DW + BI | Gemini-powered SQL · BQ ML in-warehouse · LookML semantic layer · Studio-style BI · Connected sheets | GCP-tenanted; Looker is enterprise BI, not a workbench. |
| [AWS Glue + Athena + QuickSight](https://aws.amazon.com/glue/) | Modular AWS analytics stack | Iceberg-native storage · Serverless Athena queries · QuickSight Q (NL → SQL) | Multi-product; each piece is a different surface; only useful as a stack. |

### Tier 2 — analytics notebooks (closer in shape)

| Tool | Posture | What they do well | Where they don't fit our shape |
| --- | --- | --- | --- |
| [Hex](https://hex.tech/) | Collaborative notebook SaaS | Polished SQL+Python notebooks · Magic AI (NL → SQL) · App publishing · Branching · Workspaces · Strong DB connectivity | Server-bound; teams + auth required; data crosses to Hex's plane. |
| [Mode Analytics](https://mode.com/) | SQL/Python notebooks for BI | Templated reports · Strong embed · Acquired by ThoughtSpot 2023 | Same. |
| [Deepnote](https://deepnote.com/) | Collaborative Python notebooks | Live-collab editing · Comments · Schedule notebooks · DB integrations · AI cells | Same. |
| [Observable](https://observablehq.com/) | JavaScript-based data notebooks | Reactive cells · D3/Plot-native · Forkable visualisation library | JS-not-SQL primary surface; teams plan for collaboration. |
| [Jupyter / JupyterLab](https://jupyter.org/) | Open-source Python notebooks | Local or hub-deployed · Universal kernel system · Massive ecosystem | Python-centric; for analytics use cases requires setup + a kernel. |

### Tier 3 — query engines + catalogs (infra, not surface)

| Tool | Posture | Relevance |
| --- | --- | --- |
| [Apache Spark](https://spark.apache.org/) | Distributed compute | Powers Databricks; we use DuckDB-wasm (single-node, plenty for our scale). |
| [Trino / Presto](https://trino.io/) | Distributed SQL engine | What the Compute Bridge can wrap (v1.3+); browser stays thin. |
| [Apache Iceberg](https://iceberg.apache.org/) | Lakehouse table format | Already an `iceberg-table` / `iceberg-catalog` SourceKind (A7/A8). |
| [Unity Catalog](https://www.databricks.com/product/unity-catalog) | Data catalog + governance (Databricks) | Spiritual cousin to our taxonomy: shared schema definitions across teams. Open-sourced 2024. |
| [dbt](https://www.getdbt.com/) | SQL transformation framework | Adjacent surface; ref(){} ≈ our @cellName. Their "model" is closer to our notebook cell. |

---

## Feature matrix — the load-bearing comparison

✅ have · 🟡 partial · 🆕 in scope to add · 🚫 out of scope · — n/a

| Capability | Databricks | Snowflake | Fabric | BQ+Looker | Hex | **NakliData** |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| **Storage** | Delta Lake (cloud) | Snowflake-native | OneLake | BigQuery | Per-connection (DB-side) | 🆕 user's disk · S3/R2 · Iceberg · Compute Bridge |
| **Compute** | Spark / Photon | Snowflake compute | Synapse engines | BigQuery serverless | Per-connection | DuckDB-wasm (browser) · Compute Bridge (v1.3) |
| **SQL editor** | ✅ DBSQL | ✅ | ✅ | ✅ | ✅ | ✅ CodeMirror 6 |
| **NL → SQL ("AI SQL")** | ✅ Genie | ✅ Cortex | ✅ Copilot | ✅ Gemini | ✅ Magic | 🟡 Job 2 type disambiguation; full NL→SQL out of scope (see below) |
| **AI inline-explain** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ Job 1 explain query error |
| **Notebooks** | ✅ (Py/SQL/Scala/R) | 🟡 Streamlit | ✅ | 🟡 Studio | ✅ | ✅ SQL/MD/chart/pivot/map/cohort (W4.4) |
| **Custom charts** | ✅ | ✅ | ✅ (Power BI) | ✅ (Looker) | ✅ | ✅ 13 types (W4 funnel + path included) |
| **Dashboards** | ✅ AI/BI Dashboards | ✅ | ✅ Power BI | ✅ Looker | ✅ Apps | 🆕 (linear notebook today; dashboard cell scoped in `warehouse-and-bi-question.md`) |
| **Schema / catalog** | ✅ Unity Catalog | ✅ | ✅ | ✅ | 🟡 | ✅ Taxonomy (4 domains, 48 types — see W4.1) |
| **Data lineage** | ✅ table + column | ✅ | ✅ | ✅ | 🟡 | 🟡 `@cellName` notebook DAG; no cross-source lineage |
| **Semantic layer / metrics** | ✅ (DBSQL + UC metrics) | ✅ (Semantic Views) | ✅ (Power BI) | ✅ LookML | 🟡 metrics catalog | 🟡 Templates (W3.1 + W4.2) are the metric-definition layer; no separate semantic-model surface |
| **ML / model serving** | ✅ MLflow + serving | ✅ Cortex | ✅ | ✅ Vertex | 🟡 | 🚫 (W3.2 slice A seam for local inference; not a Hard NOT but not a v1.x priority) |
| **Versioning of data** | ✅ Delta Time Travel | ✅ Time Travel | ✅ | 🟡 | — | 🚫 (no server; bytes are read-only from our perspective) |
| **Pipelines / orchestration** | ✅ Workflows + DLT | ✅ Tasks | ✅ Data Factory | ✅ Composer | ✅ Scheduled runs | 🚫 (no server) |
| **Data sharing / marketplace** | ✅ Delta Sharing | ✅ Marketplace | — | ✅ Analytics Hub | — | 🚫 (no accounts; sharing = `.naklidata` file or `?lens=` link) |
| **RBAC / governance** | ✅ Unity Catalog ACLs | ✅ RBAC | ✅ Purview | ✅ IAM | ✅ Workspaces | 🚫 (Hard NOT — no accounts) |
| **Multi-user / teams** | ✅ | ✅ | ✅ | ✅ | ✅ | 🚫 (single-user; sharing via files) |
| **Branching / Git-style** | 🟡 Repos | 🟡 | 🟡 | 🟡 | ✅ branches | 🟡 (`.naklidata` files can sit in git) |
| **Collaboration in-app** | ✅ Comments | 🟡 | ✅ | 🟡 | ✅ real-time | 🚫 |
| **Scheduled refresh / alerts** | ✅ | ✅ | ✅ | ✅ | ✅ | 🚫 (Hard NOT) |
| **Notebooks as APIs / endpoints** | ✅ Lakeflow | ✅ | 🟡 | 🟡 | ✅ | 🚫 |
| **Embeddable views** | ✅ AI/BI Embed | ✅ | ✅ | ✅ | ✅ | 🟡 `?lens=` URL · widget on the v2.1 roadmap |
| **Self-host** | 🟡 (Databricks on AWS/Azure/GCP only) | — | — | — | — | ✅ static page · USB stick |
| **Free for individuals** | 🟡 Community Edition | 🟡 trial | 🟡 trial | 🟡 sandbox | 🟡 free workspace | ✅ no caps, no auth |
| **Works fully offline** | — | — | — | — | — | ✅ PWA + vendored DuckDB |
| **Bring-your-own LLM key** | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 | ✅ BYOK (sessionStorage default; opt-in IDB) |

---

## Where NakliData fits — the three-axis framing

The hardest part of this comparison is that NakliData is not *trying*
to be in the same category. Three orthogonal axes that put each tool
in its own zone:

```
            personal  ◄────────►  team / org
              ▲
              │
            ▲ ┌──────────────┬──────────────┐
   workbench │ │  NakliData   │  Hex / Mode  │
   notebook  │ │  Deepnote*   │  Observable  │
       shape │ │              │              │
              │├──────────────┼──────────────┤
              ▼ │  DuckDB CLI  │  Databricks │
   warehouse / │ │  Beekeeper   │  Snowflake  │
   platform   │ │              │  Fabric/BQ  │
              │ └──────────────┴──────────────┘
              ▼
            ◄────────────────────────────────►
                  thin client      thick platform
```

NakliData sits in the **top-left**: personal-scale, workbench-shaped,
thin-client. Our nearest neighbors are Datasette Lite, PondPilot, the
DuckDB shell. The big platforms are bottom-right.

**Implications:**

- The "are we Databricks?" question is the wrong question. We're not.
  We're the thing a Databricks user opens to look at a CSV they
  exported from Databricks. Or to explore a Mixpanel dump before
  paying for an analytics tool. Or to clean up a vendor's invoice
  CSV without uploading to anyone's cloud.
- Where the platforms shine — multi-team governance, scheduled
  pipelines, lineage across thousands of tables, ML model registry —
  we deliberately don't follow. Those needs require a server we
  refuse to host.
- Where the platforms have ergonomics worth borrowing — NL-to-SQL
  hints, AI inline-explain, semantic templates, catalog-as-code,
  embeddable widgets — we map onto our notebook + sidecar +
  taxonomy + `?lens=` surfaces.

---

## Worth borrowing — pattern, not surface

### From Databricks

- **Genie's question-answering loop.** A user asks a natural-language
  question; Genie generates SQL against the current catalog; the user
  can edit + run. Maps onto a **5th sidecar job** ("answer this in
  SQL") layered on the existing 4 jobs. The hallucination guard
  pattern (parser drops invalid identifiers) from W3.1 Job 4 carries
  over directly — we'd reject SELECTs against tables/columns not in
  the current workbook.
- **AI Functions in SQL.** Databricks exposes LLMs as SQL functions:
  `ai_classify`, `ai_extract`, `ai_translate`. Maps onto a future
  **sidecar SQL UDF**: `SELECT sidecar_classify(text) FROM ...` runs
  the BYOK provider per row (rate-limited, batch-aware). Real
  workload before we build it.
- **Unity Catalog's column-level governance vocabulary.** UC labels
  columns as PII / sensitive / etc.; downstream queries respect the
  labels. Our taxonomy could grow a `sensitivity` field on each type
  (`email` → PII; `gstin` → financial-ID); the demo-mode + the
  `.naklidata` save flow could honor it.

### From Snowflake

- **Cortex AI's SQL-function shape.** Same as Databricks AI Functions
  — convert into our sidecar SQL UDF idea. Worth noting Cortex shipped
  this *before* most BI tools — strong signal that "LLM as SQL func"
  is the right ergonomic layer for ad-hoc analytics.
- **Streamlit-in-Snowflake's "Python turned into an app" pattern.**
  Our `.naklidata` → static HTML export (Evidence-style) is the
  same shape minus the server.
- **Time Travel for tables.** Maps onto a workbook-history feature
  for `.naklidata` files (open the last 5 saves of this file).
  Lightweight, doesn't break vision.

### From Microsoft Fabric

- **OneLake's "one logical lake" framing.** Their pitch is "you don't
  have to copy data between products." Our equivalent: a `.naklidata`
  file describes the work, not the data — re-mounting always pulls
  from the original source. Same anti-copy posture, different
  mechanism.
- **Power BI's quick-measure templates.** Drag a column onto the
  canvas; Power BI suggests an aggregation. Maps onto the schema
  panel growing **inline aggregation suggestions** ("This column is
  detected as `amount`; want to chart it as a sum by `vendor_name`?").
  Lightweight UX add.

### From Hex (closest in shape)

- **App publishing inside the notebook.** Hex notebooks have a
  "publish as app" toggle: hide editor, show only the user-facing
  cells. Maps onto a `.naklidata` "presentation mode" — same
  workbook, render only Markdown + chart cells, hide SQL. Trivial UI
  toggle; no engine change.
- **Branches.** Hex's branch model fits `.naklidata` files in a git
  repo — already supported via the file format. Worth a docs note.
- **Magic AI's "explain this query result" cards.** A subtle pattern
  we don't have: after a query runs, the AI offers a one-line
  observation ("Top 3 vendors account for 67% of spend"). Different
  from explaining errors (Job 1). Could be **sidecar Job 6:
  result-summary**. Hallucination guard would be parser-side again:
  AI emits text that gets template-validated against the result-set
  shape.

### From Observable

- **Reactive cells with `viewof` inputs.** Observable's secret sauce:
  parameterise cells via UI controls (dropdowns, sliders) that
  re-run downstream automatically. Maps onto the **interactive-input
  cell** noted in pending.md A.5 (Briefer borrow). Observable is the
  cleaner reference implementation.
- **Plot-the-everything ergonomics.** Plot is already our chart
  chunk. Worth noting that Observable's notebook makes Plot feel
  native; we can match that by improving the chart-cell auto-config
  (better defaults from schema panel detection).

### From dbt

- **`ref()` for cell-to-cell dependencies.** Already done — that's
  what `@cellName` is. Different syntax, same concept.
- **Tests as cells.** dbt's `tests:` block defines invariants per
  model. NakliData could grow an **assertion cell**: a SQL statement
  that should return 0 rows, otherwise the notebook is "broken."
  Useful for data-quality checks; small new cell kind.

---

## What we explicitly don't borrow

| Item | Why not |
| --- | --- |
| **Server-side compute fabric** | Hard NOT — we are a browser tab. Compute Bridge (v1.3+) is the user-deployed alternative; we provide the protocol, the user owns the binary. |
| **RBAC / multi-user / team workspaces** | Hard NOT — no accounts (§6). The sharing primitive is the file (`.naklidata`) or the URL (`?lens=`), not the user. |
| **Centralised data catalog** | Per-workbook MountedSource array IS the catalog, scoped to the tab. A team catalog would require a server. |
| **Scheduled refresh / alerts / pipelines** | Hard NOT — no background polling. |
| **Hosted model serving** | Out of scope. BYOK + local-model seam (W3.2) is our answer. |
| **Time travel on tables** | Not applicable — the user owns the bytes. Their git/Time-Machine/Dropbox handles versioning. |
| **Data marketplace / sharing** | Files are the sharing primitive. No accounts means no Marketplace UI. |
| **Notebook as API endpoint** | Foreground browser tab; nothing to expose. The Compute Bridge can be addressed as an API; the workbench can't. |
| **Spark / Trino / Photon** | DuckDB-wasm handles single-node workloads better than these (lower latency, no JVM). The Compute Bridge can wrap them if the customer has bigger data. |

---

## Suggested Wave 5 / Wave 6 from this comparison

Reordered for leverage:

**Wave 5 — borrowed-from-the-giants (proposed):**

1. **W5.1** Sidecar Job 5 — "Answer this in SQL" (Genie / Magic / Cortex pattern). ~2 hr.
2. **W5.2** Result-summary cards (Hex Magic pattern). New sidecar Job 6. ~1.5 hr.
3. **W5.3** Aggregation suggestions in the schema panel (Power BI quick-measure pattern). ~1.5 hr.
4. **W5.4** Sensitivity labels in the taxonomy (Unity Catalog pattern). Per-type `sensitivity: 'pii' | 'financial' | 'public' | ...`. Demo-mode auto-respects it. ~30 min.
5. **W5.5** Assertion cell kind (dbt-tests pattern). SQL that should return 0 rows; cell turns red otherwise. ~1 hr.

Total Wave 5: ~6.5 hr.

**Wave 6 — workflow polish:**

1. **W6.1** Interactive-input cell (Observable `viewof` / Briefer pattern). Dropdown / date-picker / slider that re-runs downstream cells. ~3 hr.
2. **W6.2** Presentation mode for `.naklidata` (Hex app-publish pattern). Hide SQL, show only Markdown + charts. URL flag or settings toggle. ~1 hr.
3. **W6.3** Static-HTML export (Evidence Dev pattern). Render the active notebook to a self-contained HTML file (no engine on the export). New sink. ~3 hr.
4. **W6.4** Dashboard layout cell (Superset/Power BI pattern). Grid arrangement of other cells. ~3-4 hr.

Total Wave 6: ~10 hr.

---

## Net read on the demo positioning

When someone asks "how is NakliData different from Databricks?", the
honest answer is:

> Databricks is a fabric — your data lives in their cloud, your queries
> run on their compute, your team logs in. NakliData is a tab — you
> open it, point it at a file or a URL, the data never leaves the
> browser. Different categories. We borrow Databricks's ergonomics
> (Genie-style AI, Unity Catalog-style schema, AI Functions) where
> they fit a single-user workbench. We refuse their architecture
> (server, accounts, fabric) where it doesn't.

The benchmark exercise IS the differentiation argument:

- **Personal scale.** A workbench, not a platform.
- **No server.** Your data, your tab.
- **Schema-first.** The taxonomy is the differentiator — none of the
  giants ship semantic auto-classification of generic columns.
- **BYOK AI.** The user controls the LLM relationship, not us.
- **The file IS the share.** No accounts, no marketplace, no
  scheduling.

When a user needs Databricks's scale or team workflows, they need
Databricks. When they need to look at a CSV someone just sent them,
they need us. The two coexist — and the Compute Bridge (v1.3+) is
the explicit handoff point between them.

---

## References

- [Databricks Lakehouse Platform overview](https://www.databricks.com/product/data-lakehouse)
- [Databricks Genie](https://www.databricks.com/product/ai-bi/genie)
- [Databricks AI Functions](https://docs.databricks.com/en/large-language-models/ai-functions.html)
- [Snowflake Cortex AI](https://www.snowflake.com/en/data-cloud/cortex/)
- [Microsoft Fabric overview](https://learn.microsoft.com/en-us/fabric/get-started/microsoft-fabric-overview)
- [BigQuery + Gemini](https://cloud.google.com/bigquery)
- [Hex](https://hex.tech/) · [Hex Magic AI](https://hex.tech/product/magic-ai/)
- [Observable](https://observablehq.com/) · [`viewof`](https://observablehq.com/@observablehq/views)
- [Unity Catalog (open-sourced)](https://www.unitycatalog.io/)
- [dbt tests](https://docs.getdbt.com/docs/build/data-tests)
- Sibling docs: [`warehouse-and-bi-question.md`](./warehouse-and-bi-question.md) (the do-we-need-a-warehouse parking lot), [`product-analytics-comparison.md`](./product-analytics-comparison.md) (Mixpanel/Amplitude/PostHog).
