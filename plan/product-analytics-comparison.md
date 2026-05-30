# Product analytics — feature comparison

How NakliData stacks up against the dominant product-analytics tools
(Mixpanel, Amplitude, PostHog, Plausible, Heap), and what's worth
borrowing for the next wave.

## Why this comparison

A natural NakliData use case: someone exports a Mixpanel / Amplitude
dataset as CSV / Parquet, drops it on the workbench, and wants useful
analyses without a cloud account.

We already do the boring 80% — schema panel, SQL, charts, pivots,
demo mode — but the analytics-specific surfaces (funnels, retention,
flows) live in those tools' workflows, not ours. This doc enumerates
the gap and proposes a tight subset to bring into scope as **Theme 5
— Product analytics surface**.

Anything that requires server-side ingestion, real-time streams, or
hosted alerts stays out — those collide with the spec's Hard NOTs §6
(no server, no telemetry, no background polling).

---

## Comparators in scope

| Tool | Posture | What they do well | Where they don't fit our shape |
| --- | --- | --- | --- |
| [Mixpanel](https://mixpanel.com) | Cloud SaaS | Funnels, retention, dashboards, Insights AI | Server-side ingestion; data leaves the tab. |
| [Amplitude](https://amplitude.com) | Cloud SaaS | Pathfinder flows, predictive cohorts, AI Agents | Same. |
| [PostHog](https://posthog.com) | OSS + Cloud + Self-host | HogQL (SQL-on-events via ClickHouse), funnels, paths, feature flags, session replay | Heavy infra (ClickHouse, Postgres, Kafka); a single browser tab can't host it. |
| [Plausible](https://plausible.io) | Privacy-first, lightweight | Cookieless web analytics, simple goal funnels | Web analytics only, not product analytics; no user-level data by design. |
| [Heap](https://heap.io) | Auto-capture cloud | Retroactive event definitions; "behavioral" segments | Server-side capture; collide with our local-only posture. |

**Adjacent (not analytics tools but inform the design):**

- [Mode](https://mode.com), [Hex](https://hex.tech), [Deepnote](https://deepnote.com), [Observable](https://observablehq.com) — data notebooks. Closer to our notebook UX; not analytics-specialised but often used for it.
- [Metabase](https://www.metabase.com), [Apache Superset](https://superset.apache.org) — BI tools with funnels + dashboards. Server-bound.
- [Briefer](https://github.com/briefercloud/briefer) — already in `plan/pending.md` Section A.5; interactive-input cells.
- [Evidence](https://github.com/evidence-dev/evidence) — already in pending.md; markdown-to-report.

---

## Feature matrix

✅ have · 🟡 partial · 🆕 in scope to add · 🚫 explicitly out of scope · — n/a to our posture

| Capability | Mixpanel | Amplitude | PostHog | Plausible | Heap | **NakliData** |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| Event ingestion (SDK) | ✅ | ✅ | ✅ | ✅ | ✅ | 🚫 (file-based; user brings exported data) |
| Auto-capture from page | — | — | ✅ | — | ✅ | 🚫 (no instrumentation in product) |
| Custom SQL | 🟡 | 🟡 | ✅ | — | 🟡 | ✅ first-class |
| Schema / semantic types | 🟡 (event taxonomy) | 🟡 | 🟡 | — | 🟡 (auto) | ✅ first-class (the differentiator) |
| Funnels | ✅ | ✅ | ✅ | ✅ (goals) | ✅ | 🆕 |
| Retention / cohorts | ✅ | ✅ | ✅ | 🟡 | ✅ | 🆕 |
| Path / flow analysis | ✅ (Flows) | ✅ (Pathfinder) | ✅ (paths) | — | ✅ | 🆕 |
| Segmentation (by user prop) | ✅ | ✅ | ✅ | 🟡 | ✅ | 🟡 (SQL WHERE; no UI builder) |
| Cohorts as reusable filters | ✅ | ✅ | ✅ | — | ✅ | 🆕 |
| Pivot / breakdown | ✅ | ✅ | ✅ | 🟡 | ✅ | ✅ (pivot cell) |
| Time-series with auto-bin | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 (SQL `date_trunc` works; no auto UI) |
| Line / bar / area | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Heatmap | 🟡 | ✅ | ✅ | — | ✅ | ✅ (Plot chunk) |
| Map | 🟡 | 🟡 | ✅ | ✅ (geo) | — | ✅ (MapLibre + deck.gl pairing) |
| Dashboards | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (notebooks ≈ dashboards) |
| Saved / shared reports | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (`.naklidata` + `?lens=` link) |
| Alerts / anomaly detection | ✅ | ✅ | ✅ | ✅ | ✅ | 🚫 (no server to push from) |
| Real-time streaming | ✅ | ✅ | ✅ | ✅ | ✅ | 🚫 (batch only; spec §6 forbids polling) |
| Predictive cohorts (ML) | 🟡 | ✅ | 🟡 | — | ✅ | 🟡 (future bridge-side; W3.2 slice B seam already in place) |
| AI assist for queries | ✅ (Insights) | ✅ (Agents) | ✅ (Max AI) | — | ✅ | ✅ (4 narrow BYOK jobs) |
| A/B test analysis | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 (SQL works; no template) |
| Session replay | — | — | ✅ | — | — | 🚫 (impossible from exported data) |
| Feature flags | — | — | ✅ | — | — | 🚫 (run-time concern, not a workbench one) |
| Self-host | — | — | ✅ | ✅ | — | ✅ (static page; USB-stick deployable) |
| Free for individuals | 🟡 (free tier w/ caps) | 🟡 | 🟡 | — | 🟡 | ✅ (no auth, no caps) |
| Works offline | — | — | — | — | — | ✅ (PWA + `?offline=1`) |
| Privacy-clean | 🟡 | 🟡 | 🟡 | ✅ | 🟡 | ✅ |

---

## Where we already cover the analytics use case

- **Event-table SQL.** Anyone exporting an `events.parquet` from
  Mixpanel today (their "Raw export") gets a single wide table they can
  paste into NakliData and query. Same for Amplitude's "Behavioral
  Data Sync" Parquet exports. CSV + Parquet + JSONL all mount via
  DuckDB.
- **Time-series via SQL.** `date_trunc('day', event_timestamp) AS day,
  COUNT(*) FROM events GROUP BY 1` is a one-liner; the line cell
  renders it. No analytics-specific cell needed.
- **Per-user breakdown.** `GROUP BY user_id` works directly. The
  schema panel auto-classifies common id columns; a `user_id` type
  seed (see Theme 5 below) makes this even tighter.
- **Pivot + heatmap.** A retention pivot — first-event-week × N-weeks-
  later activity — already renders cleanly with the existing pivot
  cell + heatmap chart. The missing piece is the *template* that
  builds the SQL; the rendering surface already exists.
- **AI assist for SQL.** The "Explain query error" + "Disambiguate
  type" + "Define new type" jobs are exactly the assists Amplitude /
  Mixpanel are starting to ship for their power users. The Reports
  recommender (W3.1 Job 4) is the same shape as Amplitude's "Compass"
  / Mixpanel's "Insights" — recommend a report from current schema.
- **`.naklidata` / `?lens=` sharing.** Same role as Mixpanel "Boards"
  + share URL. Difference: ours carries the work (sources, types,
  cells), not the data — recipients re-mount their own bytes.

The analytics use case as it stands works. What's missing is *guided
analyses* — the four to six chart-template-driven analyses a product
analyst expects to do without writing SQL.

---

## In scope to add — Theme 5: Product analytics surface

Five proposals; each lands incrementally as its own commit.

### 5.1 Event-shape taxonomy seeds (small)

Add to `taxonomy/v0.1/types.jsonl`:

- `event_name` (categorical id, low-cardinality if "page_view"/"signup"/etc.; high-cardinality if free-form)
- `user_id` (opaque id; UUID + numeric variants)
- `session_id` (opaque id, short-lived)
- `event_timestamp` (ISO 8601 + Unix epoch ms variants)
- `event_properties_json` (JSON object payload — detectable by leading `{`)
- `country_code` (ISO 3166-1 alpha-2 — already partially covered)
- `utm_source` / `utm_medium` / `utm_campaign` (string with low-card distribution)

Cheap; lifts every downstream analysis. ~30 min.

### 5.2 Pre-built analytics report templates

Drop into `src/ui/templates/templates.ts` alongside "Vendor
concentration":

- **Daily active users (DAU)** — `event_timestamp` + `user_id` → line chart.
- **Top events by user-count** — `event_name` + `user_id` → bar chart.
- **Funnel: A → B → C** — three-event selection; horizontal-bar drop-off chart.
- **30-day retention** — first-event-week × N-weeks-later → heatmap.
- **Conversion rate by source** — `utm_source` × `event_name = signup` → bar.

Each template instantiates SQL + chart cells; the report-recommender
(W3.1 Job 4) ranks which are applicable to the current schema. ~2 hr.

### 5.3 Funnel chart type

New chart-cell variant — horizontal bars annotated with absolute
counts + drop-off percentages. Either:

- (a) A custom SVG renderer (matches the existing `pie` arc renderer
  pattern; ~80 lines).
- (b) Add to the Observable Plot lazy chunk via a `barX` with
  annotation marks. Cheaper code-wise; less control over the
  funnel-specific styling.

Recommendation: (a) — the funnel chart is iconic enough that owning
the visual identity is worth the ~80 lines. ~1 hr.

### 5.4 Cohort cell

New cell kind. The user defines a cohort as "users matching this SQL
predicate"; the cell emits a `user_id` list (cached on the cell). All
downstream cells gain a `@<cohort_name>` reference that resolves to
the cached list, joined via `WHERE user_id IN (@cohort)`.

Implementation: store the list in `lastResult.rows` (already
plumbed); add a single-property `kind: 'cohort'` to `CellState`.
`@cellName` reference machinery already exists. ~1.5 hr.

### 5.5 Path / flow chart type (Sankey)

New chart-cell variant: Sankey diagram of N-step user paths.

Implementation: custom SVG (Observable Plot doesn't ship a Sankey
mark). Each node = `(step_index, event_name)`; each edge = transition
count; width ∝ count. The hard part is the layout — d3-sankey would
fit but adds ~30 KB to a lazy chunk; we can do a simpler "top-K paths
as horizontal bars" first and earn d3-sankey only if needed.

Recommendation: ship the simpler "top-K paths" version first (~1 hr).
A Sankey is a follow-up if a real workload demands it.

---

## Out of scope (with reasons)

| Item | Why not |
| --- | --- |
| **Event SDK / ingestion** | Spec §6 Hard NOT — no telemetry, no servers, no background polling. We're a workbench, not a data plane. If user wants to capture events, that's a different tool. |
| **Real-time / streaming** | Same root cause. Files are batch by nature. We can mount a remote URL or a Compute Bridge query that returns recent data, but the user has to re-run; we won't poll. |
| **Alerts / anomaly detection** | Needs a server to push from. The browser isn't open 24/7. If a user wants alerts, they can run NakliData on a schedule via the bridge (future) — but the alerting itself isn't our problem. |
| **Session replay** | Impossible from exported event data — replay needs raw DOM snapshots. PostHog records those at instrumentation time. |
| **Feature flags** | Run-time concern, not a workbench one. NakliData reads what was, not what should happen next. |
| **Predictive cohorts (in-product)** | The W3.2 slice A seam is already in place; the W3.2 slice B work (Transformers.js / WebLLM) or a bridge-side model service can fill this when real workloads appear. Not a v1.x priority. |
| **Cloud account / dashboards.com URLs** | No accounts. Sharing happens via `.naklidata` files and `?lens=` links. |
| **Group analytics (account-level vs user-level)** | Pure SQL handles this — `GROUP BY company_id` is the same as `GROUP BY user_id`. Adding it as first-class UI is YAGNI until a workload shows up. |

---

## Suggested wave layout

These items group naturally into one wave; the order is by leverage
(taxonomy seeds → templates → cohort → funnel chart → path chart).

**Wave 4 — Product analytics surface (proposed):**

1. **5.1** Taxonomy seeds — `event_name`, `user_id`, `session_id`, `event_timestamp`, `event_properties_json`, `utm_*`. (~30 min)
2. **5.2** Pre-built templates — DAU, top events, funnel, retention, conversion-by-source. (~2 hr)
3. **5.3** Funnel chart type. (~1 hr)
4. **5.4** Cohort cell. (~1.5 hr)
5. **5.5** Top-K paths (Sankey deferred). (~1 hr)

Total: ~6 hr of focused work to land the full slate.

After Wave 4 the demo can credibly carry a product-analytics dataset
end-to-end: drop a Mixpanel CSV export → schema panel classifies
`user_id` + `event_name` + `event_timestamp` → Reports panel offers
the five analytics templates → user picks Funnel → 60 seconds later
they have a chart. Same posture as the existing "Vendor
concentration" example bundle, just with event data.

---

## What this doc doesn't do

- **No specific Mixpanel-data-import script.** The user mounts their
  exported CSV/Parquet directly; we don't need a Mixpanel-specific
  parser. The taxonomy seeds and templates cover the post-mount work.
- **No "should we add tracking to NakliData itself" question.** That's
  resolved — Hard NOT §6 says no, and this doc doesn't propose
  changing that.
- **No timeline pressure.** Wave 4 is opportunistic; nothing about
  Wave 3's closeout depends on it.

---

## References

- Mixpanel events spec — https://docs.mixpanel.com/docs/data-structure/events-and-properties
- Amplitude Pathfinder — https://amplitude.com/docs/analytics/charts/pathfinder
- PostHog HogQL — https://posthog.com/docs/hogql
- Plausible goals + funnels — https://plausible.io/docs/goal-conversions
- Heap auto-capture — https://heap.io/docs/getting-started/installation/web
- d3-sankey — https://github.com/d3/d3-sankey
- Observable Plot (no Sankey mark today) — https://observablehq.com/plot/marks
