# Do we need a data warehouse? Do we need to be more like Superset?

Parked thinking. Not a decision yet. Drafted 2026-05-18 to capture
the question before it gets lost. Revisit when v1.2 work starts —
the answer changes meaningfully once the Compute Bridge (v1.3+) is
real.

---

## The question, sharpened

"Do we need a data warehouse?" is actually two different questions:

1. **Backend question**: Does NakliData need to be backed by a server-side warehouse / engine so users can query bigger data than fits in a browser?
2. **Surface question**: Does NakliData need to grow into a Superset-like BI tool — dashboards, multi-user, RBAC, scheduling, embeddable views?

These get conflated because Superset is *both* an engine layer (connection registry, query gateway) *and* a UI layer (dashboards + RBAC + sharing). But the answers diverge sharply for NakliData.

---

## Question 1 — warehouse backend (mostly answered)

**Yes, and we've planned this. Three data-plane modes, already documented in [`spec-amendments.md`](./spec-amendments.md) (A4) and [`enterprise-strategy.md`](./enterprise-strategy.md):**

- **Browser-DuckDB** (v1.0, shipped) — DuckDB-wasm in the same tab. Best for small data + local-mount workflows.
- **Signed-URL Relay** (v1.1) — Stateless Cloudflare Worker signs S3/GCS/Azure URLs; browser fetches directly. Best for personal-scale signed reads. See `plan/remote-sources.md`.
- **Compute Bridge** (v1.3+) — Single binary + Docker image running inside the customer's VPC. Browser becomes thin client over Arrow Flight / HTTP. Bytes never leave the VPC. Best for enterprise compliance, TB-scale, multi-team taxonomy.

The Compute Bridge IS the answer to "what about big data?" The
sibling repo `NakliTechie/nakli-compute` (Apache-2.0 lean) is on the
v1.3 milestone in `plan/enterprise-strategy.md`. It's not Superset
or a warehouse — it's a query-execution layer that adapters
warehouses behind it (Postgres, Snowflake, BigQuery via the v2.0 DB
Relay).

So **for the warehouse-backend question, the trajectory exists**.
The open questions are tactical:

- Compute Bridge license: leaning Apache 2.0 (`plan/enterprise-strategy.md`).
- Wire protocol: Arrow Flight (canonical) vs HTTP + Arrow IPC (simpler). Probably both.
- v1.2 precursors: Iceberg REST Catalog + S3-compatible custom endpoints. High leverage, no bridge yet.

**What we don't need**: to write our own warehouse from scratch.
The bridge wraps an existing engine (DuckDB on the bridge side, or
delegates to the customer's warehouse via DB Relay).

---

## Question 2 — Superset-like BI surface (more open)

This one's worth thinking through. The honest read: Superset is in a
different category than NakliData and trying to BE Superset would
require breaking the vision.

### Superset's category — server-side multi-user BI

Apache Superset is a self-hosted BI platform: connect to a warehouse,
build dashboards, share with the team, schedule refreshes, manage
permissions. It's designed for **a BI team serving an organization**.
The core surface is:

- Connection registry (Postgres, Snowflake, BigQuery, Trino, Druid, ClickHouse, etc.)
- SQL Lab (queryable editor with autocomplete + history)
- Chart builder (Vega-Lite-based; many chart types)
- Dashboard composer (drag chart blocks onto a grid)
- Multi-user accounts + RBAC + row-level security
- Scheduling + alerts
- Embeddable dashboards (Superset Embedded)

Categories it serves: dashboarding, ad-hoc analysis, reporting.

### NakliData's category — single-user browser-native curation workbench

NakliData is in a different category, even when the surface overlaps.
The thesis is:

- **Browser-native** (no server; "your data never leaves the tab" per spec §6).
- **Single-user** (no accounts, no login, no RBAC — spec §6 Hard NOTs).
- **Schema-curation first** (the schema panel is "the spec's single most important surface" per handoff §9; the taxonomy + sidecar are the real differentiator).
- **Ephemeral by default; portable via files** (`.naklidata` is the unit of share, not server-side links).

These aren't accidental — they're load-bearing differentiation from
PondPilot, Datasette, Hex, Superset, etc. Most of those are
server-or-account-based; NakliData is the offline, anti-account
take.

### Where Superset's surface would conflict with the vision

| Superset feature | NakliData posture | Verdict |
| --- | --- | --- |
| Multi-user accounts + RBAC | "No login, accounts, email, sharing-via-link" (Hard NOT #6) | **Don't borrow.** |
| Server-side scheduled refreshes | "No background polling of remote sources" (Hard NOT #5) | **Don't borrow.** |
| Server-side dashboard rendering | "Browser-native; data never leaves the tab" (vision §1) | **Don't borrow.** Embeddable widget at v2.1 is the closest analog. |
| Centralised connection registry | Per-tab mounts via FSA + signed-URL Relay; v1.3+ Compute Bridge | **Don't borrow centrally**. Per-workbook connection state is the model. |
| Row-level security | Not relevant for a single-user product | **Skip.** |

### Where Superset's surface is worth borrowing

| Superset feature | NakliData fit | Status |
| --- | --- | --- |
| **Connection registry as a per-workbook list** | The `MountedSource[]` array IS this, scoped to the workbook. Future: a "remember this connection" affordance for v1.1 Relay-mounted URLs. | Adjacent already shipped (sources panel); the Relay-mount UX needs polish in v1.2. |
| **SQL editor with history** | We have the SQL editor (CodeMirror 6); query "history" is the notebook itself. No separate history surface needed. | Done by accident. |
| **Chart composer** | Notebook + chart cell + pivot cell + map cell. 10+ chart types via Plot lazy chunk. | Theme 2 (shipped). |
| **Dashboard composer (multi-chart grid view)** | **Open question**. Currently the notebook is linear. A "dashboard layout" cell that arranges other cells in a grid would close this gap. | Worth scoping. |
| **Saved-query library** | `.naklidata` files ARE this. Each file is a saved analysis. Cross-tab persistence via IDB workbook snapshot. | Done. |
| **Alerts on a metric crossing a threshold** | Background polling is forbidden. A foreground "run-on-tab-open" version would respect the vision. | Open; low priority. |
| **Annotations on charts** | Not in any of our cell kinds. Could add as a chart-cell config field. | Open; nice-to-have. |
| **Embedded dashboards (Superset Embedded)** | `<nakli-data-widget src="...">` is in the v2.1 roadmap (`pending.md`). Same pattern. | Planned. |
| **Connection driver library** | Compute Bridge (v1.3+) is the layer where this lives. The bridge knows about Postgres / Snowflake / BigQuery / etc.; the browser stays a thin client. | Planned. |

---

## What about the other neighbors?

Quick read on each adjacent product. The shape of the question
"should NakliData be more like X?" depends on which X.

### Metabase

Server-side multi-user BI; dashboards; embeddable. Same Superset
critique applies — different category. Metabase's "X-Ray a column"
feature (auto-profile a column) is interesting and overlaps with
**Theme 4** (column-statistics panel) in our pending. Borrow the
idea, not the surface.

### Evidence Dev

Markdown → static-site BI report. SQL + Markdown cells render to
polished HTML. Static-site generator. We could ship a "static export"
of a `.naklidata` workbook to a self-contained HTML report — closes
the loop "describe → query → publish." Already noted in
`plan/pending.md` A.5 (Evidence Dev entry).

### Briefer

Notebook + dashboard hybrid with interactive inputs (dropdowns, date
pickers). Per-cell parameters that compose. Our pending.md A.5
already notes "interactive-input cells" as a borrowed pattern. This
is the right thing to borrow from Briefer, not its multiplayer or
scheduling.

### Datasette / Datasette Lite

Single-tool, browser-first (Lite), data exploration. **The closest
cousin to NakliData.** Datasette Lite uses Pyodide; we use
DuckDB-wasm. Datasette has plugins; we have lazy chunks. Datasette
has a `?install=plugin-name` URL param for boot-time extension; we
could borrow that pattern for community-extensions or community-
defined types in v1.2+. Already noted in `pending.md` A.5.

### Cube.dev

Open-source semantic layer with "cubes" (entities with measures +
dimensions). Pattern: declarative, code-reviewable, version-controlled
schema. **Conceptually adjacent to our taxonomy** but differently
scoped (Cube is per-warehouse; our taxonomy is global type
definitions). Already in `pending.md` A.5 — borrow the pattern (cubes
as code, version-controlled) when iterating on taxonomy v2.

### Hex / Mode / Deepnote

Cloud-hosted notebooks with collaboration. We are the deliberate
opposite. Don't borrow surface; learn from "what's the natural
workflow for an analyst sitting in a notebook" — but most of that's
already in NakliData's notebook design.

### PondPilot

Most direct competitor. AGPL-3.0, browser-native, DuckDB-wasm. Full
feature-by-feature comparison in `pending.md` §A. We've borrowed what
made sense (Excel via DuckDB extension, statistical-format reading
via `read_stat`, etc.). PondPilot's posture overlaps but their
Schema view + taxonomy is much thinner than ours.

---

## Net read

**Warehouse backend**: trajectory exists (signed-URL Relay → Compute
Bridge → DB Relay). Don't write our own warehouse; wrap the user's.

**Superset-like BI tool**: NakliData is in a different category.
Multi-user / accounts / server-side dashboards / RBAC / scheduling
are vision-incompatible. **Don't try to be Superset.**

**Worth borrowing from BI tools (in approximate priority order):**

1. **Dashboard layout** — a new cell kind that arranges other cells in a grid. Closes a real workflow gap (the notebook is linear today). Bounded scope; respects vision.
2. **Static export** (Evidence Dev pattern) — turn a `.naklidata` into a self-contained HTML report. Already noted in pending.md.
3. **Interactive-input cells** (Briefer pattern) — dropdowns / date pickers that parameterise downstream cells. Already in pending.md.
4. **Column-profile X-Ray** (Metabase pattern) — auto-suggest stats panel from a column's data. Lands in Theme 4 (quality polish).
5. **Connection-library polish** (Superset pattern) — once Relay + Bridge are real, a "remember this connection" surface. v1.2 work.
6. **Plugin URL-install pattern** (Datasette Lite) — boot-time `?install=community-extension-name` for community types or DuckDB extensions. v1.2 nice-to-have.

---

## Open sub-questions (for future-us to decide)

1. **Dashboard layout cell**: do we want one? The notebook is linear today. Would a "grid layout" cell that arranges others belong in our model? Probably yes; spec it after Theme 4 lands.
2. **"Run on tab open" cells**: foreground-triggered refresh (user opens the tab, cells re-run against their latest data). Doesn't violate the no-background-polling Hard NOT. Worth scoping as a workflow.
3. **Static export to HTML**: the Evidence pattern. Could be a new sink (alongside NakliPoster / Bahi / KanZen). Low-cost; useful.
4. **Multi-workbook "library" view**: today each tab has its own multi-session store. Does a user with 20 workbooks want a "library" of all their `.naklidata` files? Cross-cuts with `naklOS` (the umbrella launcher) — maybe the library lives there, not in NakliData.
5. **Team-share workflows without accounts**: signed `.naklidata` blobs over Mehfil (the encrypted-team-chat tool in the universe)? Per-team type libraries via shared GitHub repo? This is where NakliData might play in the team workflow without breaking the no-accounts posture.
6. **Custom data-warehouse adapters**: the Compute Bridge currently maps to Postgres / Snowflake / BigQuery / MySQL via the v2.0 DB Relay. Are there warehouses we're missing? (ClickHouse, Trino, DuckDB-server, Iceberg-only.) Decide per customer demand.

---

## Where this fits in the existing planning

- **Already covered**:
  - Compute Bridge story → `plan/enterprise-strategy.md`
  - Data-plane modes → `plan/spec-amendments.md` A4
  - Remote-source options → `plan/remote-sources.md`
  - PondPilot + neighbor feature mapping → `plan/pending.md` A + A.5
  - AI sidecar (orthogonal to BI/warehouse question) → `plan/sidecar-architecture.md`

- **This file's role**: synthesises the cross-cutting "should we become Superset?" question that none of the above answers directly. Reference it when scoping v1.2+ work.

---

## Revisit timing

**Not before v1.2 work starts.** The interesting decisions here
require knowing what the Compute Bridge actually looks like in
practice + what real users want from the workflow. v1.1 sidecar +
Theme 2 + Theme 3 polish is plenty to ship first.

**Trigger to revisit**: when the v1.2 spec is being drafted, or when
someone says "I wish NakliData had dashboards" / "I wish I could
schedule a query" / "I wish my team could see this." The user voice
will sharpen the question better than upfront speculation.
