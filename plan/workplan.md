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
- [x] **W5.1** — Sidecar Job 5: NL → SQL. Genie / Magic / Cortex pattern. SELECT-only (parser rejects every write/DDL keyword); hallucination guard validates table refs in FROM/JOIN (CTE names + `cell_<id>` allowed); never auto-executed (Hard NOT #4). Modal opens from notebook toolbar; only table+column names shipped (no rows). 10-case eval fixture, 17 unit tests. (Shipped 2026-05-31.)

**Wave 5 complete (5/5).** Total spend matched the ~6.5 hr estimate.

Prereqs: none. None of these touch external systems. The eval harness should grow new fixtures per new sidecar job (Job 5 + Job 6).

---

## Chunk 3 — Wave 6: workflow polish (~10 hr, depth-first)

Four items proposed in [`plan/data-platform-comparison.md`](./data-platform-comparison.md). Each closes a workflow gap the Databricks comparison surfaced. Pick in this order:

- [x] **W6.2** — Presentation mode. `?present=1` (Hex app-publish pattern). Adds `app-present-mode` class to root; CSS hides SQL/cohort/assertion cells, the sources/schema sidebars, the notebook toolbar, the cell-add row, and per-cell edit/delete chrome. Markdown + chart + pivot + map keep rendering. "Exit presentation" pill in the header strips `?present=1` and reloads. (Shipped 2026-05-31.)
- [x] **W6.3** — Static-HTML export. New `src/ui/export-html.ts` walks the live notebook DOM and packages markdown previews + chart SVGs + pivot/result tables + SQL `<details>` blocks into a single self-contained HTML file (~5 KB embedded CSS, no JS, no engine). Map cells show a "interactive map omitted" placeholder. New "Export HTML" header button calls FSA `showSaveFilePicker` or falls back to `<a download>`. Evidence Dev pattern. (Shipped 2026-05-31.)
- [x] **W6.1** — Interactive-input cell. New `kind: 'input'` cell — text / number / date / select widget with required `@name` for downstream @ref resolution. `Notebook.rewriteReferences` now checks input cells FIRST and inlines the value as a SQL literal (text → `'value'` with quote-doubling for safety, number → bare, date → `DATE 'YYYY-MM-DD'`, empty → `NULL`). New "+ Input" toolbar button. 5 vitest cases cover the coercion contract incl. SQL-injection safety (quote-doubling closes off the attacker's payload as a single string literal). Observable viewof / Briefer pattern. (Shipped 2026-05-31.)
- [x] **W6.4** — Dashboard layout cell. New `kind: 'dashboard'` cell — CSS grid (1–4 columns) of referenced cells (markdown / chart / pivot / map). Items are listed by `@name`; the dashboard re-invokes the renderer for each referenced cell with no-op handlers + strips `.cell-head` / `.cell-actions` chrome so only the output shows. Markdown + chart cells now expose name inputs so they can be referenced. Unknown name → "No cell named X" affordance; wrong-kind name (SQL / cohort / etc.) → "only markdown / chart / pivot / map" affordance. Superset / Power BI pattern. (Shipped 2026-05-31.)

**Wave 6 complete (4/4).** All four items shipped in one session — well under the ~10 hr estimate thanks to W6.2/W6.3/W6.1 each landing inside an hour.

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
