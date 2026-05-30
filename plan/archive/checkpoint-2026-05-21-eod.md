# End-of-day checkpoint — 2026-05-21

Day-end snapshot. Written to read cold tomorrow morning and resume
work without paging through every commit. Supersedes
[`checkpoint-2026-05-18-eod.md`](./checkpoint-2026-05-18-eod.md) —
that document captured the AI sidecar arc landing across 2026-05-18
and the v1.1 BYOK posture. Between then and now: 2026-05-19 shipped
classifier integration of user types, 2026-05-20 was a quiet day,
and today (2026-05-21) Theme 4 (schema + data quality polish) shipped
end to end across two commits.

---

## Day in one paragraph

Started the day with one open Theme 4 item from yesterday's pickup
list (B1 — column-profile panel) and three more sitting unstarted
in `plan/pending.md` (B2 compare, B3 override-rules learn, B4 demo
mode). By end of day all four are shipped, tested, and pushed. **Theme
4 is complete.** Two commits on `main` — `a5e8f85` (Theme 4 wave 1)
and `0b14ff7` (Theme 4 wave 2: B2+B3+B4 in one logical commit) —
+2,677 lines across 30 files, +13 vitest specs, +5 Playwright e2e
specs. Shell stayed at **408 KB / 600 KB budget** (+22 KB vs the
386 KB after Theme 3 — modals were inlined CSS-injected on demand,
no new lazy chunks). Zero new runtime dependencies. Worked smoke +
full e2e + tsc + biome green at both commit points.

---

## Repo state at day end

| Field | Value |
| --- | --- |
| Repo | [NakliTechie/NakliData](https://github.com/NakliTechie/NakliData) |
| Local path | `/Users/chiragpatnaik/Code/naklios-universe/NakliData/` |
| Default branch | `main` |
| Tag | `v1.0.0` at commit `5b10b93` (still the v1.0 release point) |
| Latest commit | `0b14ff7` (Theme 4 wave 2) |
| Working tree | Clean |
| Pushed to origin | Yes |

### Build sizes

| Artifact | Size | Δ vs 2026-05-18 EOD |
| --- | --- | --- |
| `dist/index.html` | **408 KB** | +36 KB (column-profile renderer + 3 modals + label masker + override-rule cache) |
| `dist/chunks/codemirror.js` | 364 KB | unchanged |
| `dist/chunks/observable-plot.js` | 273 KB | unchanged |
| `dist/chunks/cytoscape-graph.js` | 436 KB | unchanged |
| `dist/chunks/maplibre-map.js` | 1.0 MB | unchanged |
| `dist/chunks/_demo.js` | 0.1 KB | lazy-loader e2e fixture |
| `dist/sw.js` | 2.7 KB | unchanged |
| `dist/manifest.webmanifest` | 0.4 KB | unchanged |
| `dist/icon.svg` | 0.4 KB | unchanged |

### Test counts

| Suite | Count | Δ vs 2026-05-18 EOD |
| --- | --- | --- |
| Vitest | **156** (13 files) | +33 (was 123 — column-profile didn't add unit tests; today's wave-2 added 11 override-rules + 5 compare-tables + 8 demo-mode; 2026-05-19 added 9 user-types) |
| Playwright e2e | **24** (18 spec files) | +5 (was 19 — column-profile×1, override-rules×1, compare-tables×2, demo-mode×1) |
| Smoke (headless) | green | unchanged |
| tsc / biome | clean | 0 errors / 14 pre-existing warnings (template `!` non-null assertions; cosmetic) |

### Commits since v1.0.0 tag (today's two added)

| Hash | Subject | Day |
| --- | --- | --- |
| `0b14ff7` | Theme 4 wave 2: compare-tables (B2) + override learns (B3) + demo mode (B4) | 2026-05-21 |
| `a5e8f85` | Theme 4 wave 1: column-profile panel + GeoJSON fixture | 2026-05-21 |
| `a71ebf7` | v1.1: classifier integration of user types | 2026-05-19 |
| `e3e1c2c` | docs: plan/warehouse-and-bi-question — parked positioning thinking | 2026-05-19 |
| `0922a40` | docs: plan/checkpoint-2026-05-18-eod — end-of-day synthesis | 2026-05-18 |
| `b08d679` | v1.1: AI sidecar wave 3 — define-new-type assist + per-workbook user types | 2026-05-18 |
| `0c83cbe` | v1.1: AI sidecar wave 2 — type disambiguation on ambiguous schema columns | 2026-05-18 |
| `…` | (15 earlier commits back to v1.0.0) | |

---

## What the product can do at end of day

### File formats (15) — unchanged

CSV, TSV, JSONL/NDJSON, Parquet, Arrow IPC, DuckDB, SQLite, Excel,
SPSS (.sav/.zsav/.por), Stata (.dta), SAS (.sas7bdat/.xpt), GeoJSON,
KML.

### Cell kinds (5) — unchanged

SQL (CodeMirror 6 lazy), Chart (7 hand-rolled + 3 Plot-rendered),
Markdown, Pivot, Map.

### AI sidecar — unchanged since 2026-05-19

All three spec §4.3 jobs live: explain-query-error, disambiguate-type,
define-new-type. BYOK with Anthropic + OpenAI providers per spec
amendment A2 (sessionStorage default + opt-in IDB).

### Schema panel — extended today

Per-column row now has 4 buttons (Accept / Override / Evidence /
Profile) + an optional "Ask sidecar" affordance on ambiguous columns.
Toolbar now has 4 conditional buttons:

1. **Bulk accept ≥ N** (always when sources mounted)
2. **Re-classify with user types** (when ≥1 user type exists)
3. **Override rules (N)** (when ≥1 rule exists) — NEW today (B3)
4. **Compare tables…** (when ≥2 tables mounted) — NEW today (B2)

### Per-column profile panel — NEW today (B1, wave 1)

`Engine.profileColumn(tableName, columnName)` runs a full-table
aggregate (`COUNT(*)`, null_count, distinct_count, MIN/MAX/AVG
LENGTH(::VARCHAR)) + top-5 GROUP BY. On-demand only — clicking
Profile fetches and renders inline under the column row; clicking
again collapses and drops from cache. Cache lives in `main.ts` as
derived state (not persisted to `.naklidata`).

### Compare-tables modal — NEW today (B2, wave 2)

`Engine.compareTables` does a FULL OUTER JOIN bucket aggregate
(rowsA, rowsB, onlyInA, onlyInB, matched, differing) + per-row
column-level diff sample using `IS DISTINCT FROM` semantics. Modal
auto-detects candidate join keys from taxonomy assignments (typeIds
both tables have at least one assigned column for); user picks
between candidates when multiple.

### Override-rules learn — NEW today (B3, wave 2)

`workbook.overrideRules` persists "always treat columns named X as
type Y" rules. After Override → typeId, an extended toast offers
"Remember rule" — clicking adds the rule + applies forward to other
mounted columns + future mounts. Persisted to `.naklidata` as
`override_rules` (defaults `[]` on legacy v1.0 files — clean
migration). Manage-rules modal lists rules with a Remove button.

### Demo / censor mode — NEW today (B4, wave 2)

`settings.demoMode` boolean (IDB-persisted). `src/core/demo-mode.ts`
exposes `maskLabel(kind, original)` with stable per-session
`<prefix>_<n>` tokens (src_1, tbl_1, col_1, path_1). Threaded through
sources panel + schema panel + SQL result-table column headers. Off
by default; toggle via Settings modal; takes effect immediately
without reload. `data-*` attributes keep real identifiers so action
handlers still resolve. SQL cell text + row values intentionally NOT
masked.

### Persistence (Theme 3) — unchanged

URL state, PWA shell, multi-session sidebar, IDB workbook snapshots
all unchanged. `.naklidata` schema gains `override_rules` field
(defaults `[]` on missing).

### Engine + classifier — extended today

`Engine.profileColumn` + `Engine.compareTables` are new on the engine.
Classifier worker untouched. `classifyMountedSources` +
`reclassifyAllSources` in main.ts both pipe through `applyOverrideRule`
on detector-origin assignments so rules carry forward.

---

## Architectural decisions made today

Two DECISIONS.md entries — one per commit. Both timestamped
2026-05-21.

### 15:30 — Column-profile panel (Theme 4 wave 1)

- **(a) Full-table aggregate, not sampled.** sampleColumn exists for
  the classifier; the panel is user-facing and needs exact counts.
  One extra agg query per click is fine because the panel is on-demand.
- **(b) Derived state — module-scope Map in main.ts, not workbook
  state.** Don't bloat `.naklidata` with profile snapshots. Cache is
  per-tab; cleared on workbook reset.
- **(c) Inline pane under the column row, not a modal.** The schema
  panel is a scrollable list; inserting a 5-row grid under the
  clicked column keeps spatial context. A modal would force re-clicks
  to compare neighbours.
- **(d) Toggle re-fetches.** Click expands and fetches; click again
  collapses + drops from cache. Stats are stable per-mount but a
  fresh fetch is cheap and avoids stale-data risk.

### 17:00 — Theme 4 wave 2: compare (B2) + learns (B3) + demo (B4)

Combined entry because all three are small + the reasoning rhymes
(forward-acting, opt-in, derived-state-where-possible).

- **B2.** Compare is an ephemeral modal, not a cell kind — no
  persistence story to write, no `.naklidata` bloat. Auto join-key
  detection via workbook assignments. `IS DISTINCT FROM` so NULL/NULL
  doesn't count as a diff.
- **B3.** Rules are opt-in via post-Override toast (automatic rule
  creation would surprise users). Forward-acting: removing a rule
  doesn't rewind already-applied assignments. Rules persist in
  `.naklidata` + apply during classify for detector-origin
  assignments (user-curated origins on a specific column always win).
- **B4.** JS-side label replacement, not CSS-blur. Stable per-session
  tokens via per-kind in-memory map → coherent multi-screenshot demo
  reads. SQL cell text + row values not masked (would break running
  cells / would mask user data they should scrub themselves).

---

## What's not shipped

### Tier 1 — Theme 1 wave 3 (test infrastructure)

- Sample data regen to include `.sqlite` + `.xlsx` (+ ideally a
  small `.sas7bdat`) so smoke + e2e cover the new mounts.
- Vendor a small set of DuckDB extensions (`sqlite`, `excel`,
  `read_stat`) into `public/duckdb-fallback/` for offline-grade
  smoke testing.

These are the "C" item from yesterday's pickup list — deferred to a
dedicated session because they need a careful CSP rework + ~1 MB
asset budget review.

### Tier 2 — Sidecar follow-ups

- **Custom-endpoint support** — OpenAI-compatible URL field for
  local llamafiles / vLLM. CSP rethink required (current explicit-host
  whitelist won't work).
- **Eval harness (v1.2)** — held-out per-job evals so prompted-vs-LoRA
  can be measured honestly. Per `plan/sidecar-architecture.md`.
- **Local-model path (v1.2+)** — Transformers.js + Phi-3-mini-class
  (~150 MB OPFS). Opt-in fallback to BYOK.
- **LoRA-Gemma 4 E2B (v1.3+)** — opt-in "high-accuracy mode"; never
  the default.

### Tier 3 — v1.0 review carryover

From the original v1.0 punch list, still open:
- CM6 audit (any rough edges from the textarea → CM6 swap)
- SRI scenario coverage (manual injection / tamper test)
- README pass — second-look for accuracy after v1.1 surface added
- Taxonomy types review — the 80-something types could use a
  fresh-eyes editorial pass
- Save-load flake (was flaky a few sessions back — confirm green)

### Tier 4 — Theme 2 polish (deferred sub-items, still queued)

- Pie chart mark (Plot doesn't ship one by design — would need a
  hand-rolled SVG)
- Faceted small-multiples in chart cell (needs a third "facet-by"
  picker)
- deck.gl pairing for point-density on map cell (deferred until
  point-density work appears)
- Shapefile mount (needs multi-file `.shp + .dbf + .shx` bundling
  which FSA single-file picker can't deliver cleanly)

### Tier 5 — Enterprise / Compute Bridge (v1.2 → v2.x)

See `plan/enterprise-strategy.md`. v1.2 precursors are the immediate
cheap-and-leveraged items:

- **Iceberg REST Catalog** + OAuth2/Bearer/SigV4 auth
- **S3-compatible custom endpoints** (MinIO, R2, B2, Wasabi)

Both via DuckDB native paths — no new core deps needed. Closes the
gap for lakehouse customers who don't need a bridge yet.

### Tier 6 — Out-of-scope, intentionally

Listed for completeness so they don't accidentally get picked up:
- NL → SQL (vision §"What it is not")
- AI-suggested SQL auto-fix (sidecar's Explain analog is the allowed
  path)
- PDF table extraction (fragile; defer indefinitely)
- Background polling of remote sources (Hard NOT, spec §6)
- Login / accounts / sharing-via-link (Hard NOT, spec §6)

---

## Open questions still queued

Carried forward unchanged from 2026-05-18 EOD because nothing today
moved them:

1. **DuckDB extension vendoring scope.** Which extensions ship in
   `public/duckdb-fallback/` for offline-grade smoke? `sqlite`,
   `excel`, `read_stat` are the obvious three; `spatial`, `iceberg`
   are bigger and may need to stay CDN-only.
2. **README v1.1 pass.** v1.1 added sidecar, user types, sessions,
   share links — none reflected in README. Wait until v1.1 is
   tagged, then update once.
3. **Tag v1.1?** Currently at v1.0.0 only. v1.1 features (sidecar +
   user-type integration + Theme 4) are all in `main` since 2026-05-19.
   No urgency to tag yet — no external consumers of the tag — but
   worth doing before v1.2 work starts to keep the changelog clean.
4. **`naklios.dev/apps/naklidata/` mirroring.** Per the umbrella
   `CLAUDE.md`, FSA apps need same-origin mirroring under naklios.dev
   for Immersive mode. NakliData is FSA-heavy. Mirroring requires a
   new manifest entry + a GHA workflow on this repo. Not started.

---

## Tomorrow's pickup paths

Today closed out Theme 4 cleanly. Tomorrow's choices, in suggested
order:

### A. Theme 1 wave 3 — test infrastructure (Tier 1)

Two sub-items: sample-data regen + vendor DuckDB extensions. The
extension vendoring is the bigger one (CSP rework + ~1 MB asset
budget review). A morning's work for the regen alone; a full session
for both.

**Why first:** clears the only remaining ⏳ in Theme 1 and unblocks
offline-grade smoke for the new mount paths.

### B. v1.1 tag

Cheap. Cut a `v1.1.0` tag at HEAD, write a release-notes prose
section (sidecar / user-type integration / Theme 4) in
`plan/v1.1.0-release-notes.md`. Push the tag. Updates the README
download/quick-start to v1.1 if needed.

**Why second:** lets v1.2 work start with a clean tag boundary.

### C. Iceberg + S3-compatible endpoints (Tier 5 — v1.2 precursors)

The enterprise gap-closers. DuckDB native paths exist for both —
this is plumbing + UI for the source picker. Per
`plan/enterprise-strategy.md` + `plan/remote-sources.md`. Cheap +
high-leverage for the lakehouse user segment.

**Why third:** these are the next strategic moves for the product
shape (per `plan/product-shape.md`). They don't need a Compute
Bridge yet — they extend the existing FSA / HTTP source model.

### D. Custom-endpoint sidecar (Tier 2)

OpenAI-compatible URL field in Settings. Unblocks local-llamafile /
vLLM users. CSP rethink is the actual cost — current explicit-host
whitelist needs replacing with a pattern or an opt-in connect-src
relaxation.

**Why fourth:** narrower audience than A/B/C but high marginal value
for the users who care.

### E. v1.0 review carryover (Tier 3)

CM6 audit, SRI scenario, README pass, taxonomy types review,
save-load flake. Each is small individually; together they're a
half-day of housekeeping. Schedule when context for the bigger
themes feels stale.

### F. Eval harness (Tier 2, v1.2)

Per `plan/sidecar-architecture.md`. Per-job held-out evals so
prompted-vs-LoRA gets measured. Larger scope — better as its own
multi-session effort once we decide LoRA is on the roadmap.

---

## What changed in this checkpoint vs prior

| Field | 2026-05-18 EOD | 2026-05-21 EOD |
| --- | --- | --- |
| Latest commit | `b08d679` | `0b14ff7` |
| Bundle | 372 KB | 408 KB (+36 KB) |
| Vitest | 123 | 156 (+33) |
| Playwright e2e | 19 | 24 (+5) |
| Theme 4 status | not started | **complete** |
| Spec §4.3 sidecar | complete | complete (unchanged) |
| Classifier user-types path | partial (apply-only) | complete (classify too) |
| `.naklidata` schema | v1.0 + user_types | v1.0 + user_types + override_rules |
| Open headline tasks | classifier integration + Theme 4 + Theme 1 wave 3 | Theme 1 wave 3 + v1.1 tag + Iceberg/S3 precursors |

---

## How to resume tomorrow

1. **Read this file first.** It's a self-contained snapshot.
2. Check `STATUS.md` for the one-paragraph current state.
3. Read the bottom entry of `plan/progress.md` for what just shipped.
4. Pick from "Tomorrow's pickup paths" above.
5. If unsure which path: A (Theme 1 wave 3) is the cheapest unblocker;
   B (v1.1 tag) is the quickest win; C (Iceberg + S3) is the
   highest-leverage strategic move.

Working tree is clean. No uncommitted work. No abandoned branches.
Tests + smoke + bundle budget all green at end of day.
