# Workplan — 2026-05-30 snapshot (post-Wave 4)

Today closed the F→G→H→I→K polish slate, Wave 3 (W3.4b catalog
picker), Wave 1+2 stretches (basemap, deck.gl, deploy), Cloudflare on
a custom domain, Excel via SheetJS, and the full **Wave 4 product
analytics surface** (W4.1–W4.5). Plus the Databricks comparison +
Wave 5 + Wave 6 proposals. 27 commits, all on `origin/main`.

Tomorrow's slate, in pickup order:

---

## Chunk 1 — Demo verification with real event data (keystone, ~1 hr)

The Wave 4 templates haven't been end-to-end-verified with a real
Mixpanel/Amplitude/PostHog-shaped dataset yet — only at the
build/typecheck level. The user has
`~/Downloads/Retention Rate Analysis_Ecommerce.xlsx` queued for
exactly this verification. Chrome MCP's `file_upload` requires the
file to be shared through the Claude UI first.

- [ ] User attaches `Retention Rate Analysis_Ecommerce.xlsx` to the next chat OR clicks "Add file" in their own browser. (Decision needed up-front.)
- [ ] [test] Mount the xlsx → confirm SheetJS lazy chunk loads, each sheet emits CSV → registerCsv path.
- [ ] [test] Schema panel auto-classifies. Confirm any of the W4.1 types (`event_name`, `user_id`, `session_id`, `event_timestamp`, `utm_*`) fire on this dataset's columns.
- [ ] [test] Reports panel surfaces W4.2 templates that fit the schema. Pick one (likely Retention or Top events) and run. Confirm chart renders.
- [ ] [test] If event-shaped: also exercise Funnel (W4.3) + Cohort (W4.4) + TOP_PATHS (W4.5).
- [ ] If anything misfires: capture the gap (which type missed, which SQL didn't match the column shape) into pending.md as a W4 follow-up.

Why keystone: it converts "Wave 4 ships" from build-time evidence to actual-user-data evidence. If the templates don't light up on a real workbook, the order changes — fix taxonomy/templates first, then move on.

---

## Chunk 2 — Wave 5: borrowed-from-the-giants (~6.5 hr)

Five items proposed in [`plan/data-platform-comparison.md`](./data-platform-comparison.md). Each maps a Databricks/Snowflake/Microsoft Fabric/Hex ergonomic onto our workbench. Pick in this order — smallest leverage-on-leverage first:

- [x] **W5.4** — Sensitivity labels in the taxonomy. Per-type `sensitivity: 'pii' | 'financial' | 'public'` field, badge rendered in the schema panel. Substrate for future demo-mode + PII guards. (Shipped 2026-05-31.)
- [x] **W5.5** — Assertion cell kind. New `kind: 'assertion'` — SQL that should return 0 rows; PASS/FAIL pill; FAIL paints the cell red. Reuses the SQL execution path. (Shipped 2026-05-31.)
- [x] **W5.3** — Aggregation suggestions in the schema panel. "Quick chart ▾" per column emits SQL + chart + markdown cells (Power BI quick-measure pattern). Partners-by-table map drives sum-by, count-by, count-over-time, GSTIN-state-spend, COUNT DISTINCT for ids. (Shipped 2026-05-31.)
- [x] **W5.2** — Sidecar Job 6: Result-summary cards. Hex Magic one-line observation card; hallucination guard validates backticked column refs; 200-char cap with ellipsis. 8-case eval fixture, 12 unit tests. (Shipped 2026-05-31.)
- [ ] **W5.1** — Sidecar Job 5: NL → SQL (~2 hr). Genie / Magic / Cortex pattern. Parser rejects identifiers not in current schema. Biggest of the five.

Prereqs: none. None of these touch external systems. The eval harness should grow new fixtures per new sidecar job (Job 5 + Job 6).

---

## Chunk 3 — Wave 6: workflow polish (~10 hr, depth-first)

Four items proposed in [`plan/data-platform-comparison.md`](./data-platform-comparison.md). Each closes a workflow gap the Databricks comparison surfaced. Pick in this order:

- [ ] **W6.2** — Presentation mode (~1 hr). `?present=1` or settings toggle that hides SQL cells, shows only Markdown + charts. Hex app-publish pattern. Cheapest of the four; immediate demo value.
- [ ] **W6.3** — Static-HTML export (~3 hr). Render the active notebook to a self-contained HTML file (no engine on the export). New sink alongside KanZen / Bahi / NakliPoster. Evidence Dev pattern.
- [ ] **W6.1** — Interactive-input cell (~3 hr). Dropdown / date-picker / slider that parameterises downstream SQL via `@inputName`. Observable `viewof` / Briefer pattern.
- [ ] **W6.4** — Dashboard layout cell (~3–4 hr). New cell kind that arranges other cells in a grid. Superset / Power BI pattern. Closes the linear-notebook gap once and for all.

Prereqs: W6.1 + W6.4 may want W5.5 (assertion cells) to surface in the layout. Otherwise independent.

---

## Unbatched / external-blocked / out-of-scope

Carried forward; not actionable in the next session:

- **W3.2 slice B** — Real Transformers.js local-model inference. Needs a real browser + WebGPU verification session. Seam (slice A) shipped 2026-05-29.
- **The Compute Bridge binary** — separate OSS repo (Rust + Docker; multi-week). Wire contract is fully designed in [`plan/compute-bridge-protocol.md`](./compute-bridge-protocol.md). Naming (`nakli-compute` → reconsider) + license + repo creation TBD.
- **W3.5** — Routing logic for jobs that benefit from the bridge. Waits for the binary to exist.
- **W2.1c** — Iceberg OAuth2 device flow + AWS SigV4. v1.3 enterprise scope.
- **W3.6** — Resume vendoring `read_stat` + SQLite-VFS-on-wasm when upstream lands. (Excel split out — shipped via SheetJS today.)
- **W1.4 mirror** (dropped earlier) and **v1.4+ multi-team / DB Relay / edge / widget** items in pending.md "Deferred" — long-term roadmap, not actionable this week.
- **`@cellName` cycle detection** — currently relies on DuckDB error if a view references a not-yet-materialised view. Could pre-walk the DAG; nothing pressing.

---

## Sequencing rationale

- **Chunk 1 is the keystone** because it converts assumptions into evidence. If templates misfire on real data, Wave 5/6 work is premature.
- **Wave 5 before Wave 6** because Wave 5 enhances the existing surface (more taxonomy power, more sidecar jobs, schema-panel polish) while Wave 6 adds new surface (presentation mode, export, parameters, layout). Enhance-then-extend.
- **Within each wave, smallest-leverage-on-leverage first.** W5.4 (sensitivity labels, 30 min) unlocks demo-mode-by-label across the app for one line of type-spec change per type. W5.5 (assertions, 1 hr) follows the just-shipped W4.4 cohort pattern verbatim, so the dev cost is mostly typing.
