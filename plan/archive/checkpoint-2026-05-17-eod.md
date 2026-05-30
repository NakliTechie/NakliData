# End-of-day checkpoint — 2026-05-17

Day-end snapshot. Written to read cold tomorrow morning and resume
work without paging through every commit. Companion to (and
substantively supersedes) [`checkpoint-2026-05-17.md`](./checkpoint-2026-05-17.md),
the mid-session synthesis written earlier today before Theme 2 +
Theme 3 wave 2 finished.

---

## Day in one paragraph

NakliData was at v1.0-feature-complete, untagged, single branch
`claude/agent-handoff-start-3c2Ib` at the start of the desktop
session. By end of day: **v1.0.0 is tagged + pushed**, the bootstrap
branch is gone (single `main` now), **Theme 3 wave 2** (URL-state
sharing + PWA installability + multi-session sidebar) is complete,
and **Theme 2** (visualization upgrade) is complete in full (Plot
chart types, pivot-table cell, schema-graph modal, map cell + spatial
mount). Shell stayed at **340 KB** — well under the 600 KB budget —
even with four lazy chunks (CodeMirror, Plot, Cytoscape, MapLibre).
**87 vitest + 17 Playwright e2e + smoke** all green.

---

## Repo state at day end

| Field | Value |
| --- | --- |
| Repo | [NakliTechie/NakliData](https://github.com/NakliTechie/NakliData) |
| Default branch | `main` |
| Active local branch | `main` (single branch; bootstrap deleted local + remote) |
| Tag | `v1.0.0` at commit `5b10b93` (annotated, pushed) |
| Latest commit on main | `06c11ee` (Theme 2 wave 4) |
| Working tree | Clean |

### Build sizes

| Artifact | Size | Note |
| --- | --- | --- |
| `dist/index.html` | **340 KB** | Inlined shell — under the 600 KB spec §7.1 gate. |
| `dist/chunks/codemirror.js` | 364 KB | CM6 lazy chunk; loads on first SQL cell render. |
| `dist/chunks/observable-plot.js` | 273 KB | Plot + d3 internals; loads on Plot-rendered chart type. |
| `dist/chunks/cytoscape-graph.js` | 436 KB | Cytoscape; loads on schema-graph modal open. |
| `dist/chunks/maplibre-map.js` | **1.0 MB** | MapLibre GL JS; loads on map-cell render. Heaviest chunk. |
| `dist/chunks/_demo.js` | 0.1 KB | Lazy-loader e2e fixture. |
| `dist/sw.js` | 2.7 KB | PWA service worker (lite cache). |
| `dist/manifest.webmanifest` | 0.4 KB | PWA manifest. |
| `dist/icon.svg` | 0.4 KB | PWA icon. |

### Test counts

| Suite | Count | Status |
| --- | --- | --- |
| Vitest | **87** (7 files) | green |
| Playwright e2e | **17** (9 spec files) | green at `workers: 2` |
| Headless smoke | 12 assertions | green |

### Commits since v1.0.0 tag (9 total)

| SHA | Title |
| --- | --- |
| `4638450` | docs: v1.0 handoff notes — tag push pending desktop session |
| `53342b9` | chore: smoke script — env-var override for chromium path |
| `295032b` | docs: STATUS + progress — v1.0.0 tag landed; opening Theme 3 wave 2 |
| `bf45db1` | v1.1: theme 3 wave 2 item 1 — URL-state sharing (`?lens=<base64>`) |
| `f81b660` | v1.1: theme 3 wave 2 item 2 — PWA installability (manifest + lite SW) |
| `c9fcb48` | v1.1: theme 3 wave 2 item 3 — multi-session sidebar (header dropdown) |
| `8787853` | docs: plan/checkpoint-2026-05-17 — synthesis snapshot end of desktop session |
| `2d258d7` | v1.1: theme 2 wave 1 — Observable Plot lazy chunk (stacked-bar, area-stacked, heatmap) |
| `065b9f0` | v1.1: theme 2 wave 2 — pivot-table cell (new cell kind) |
| `c8b4eef` | v1.1: theme 2 wave 3 — schema-graph modal (Cytoscape lazy chunk) |
| `06c11ee` | v1.1: theme 2 wave 4 — map cell + GeoJSON/KML mount. Theme 2 complete. |

---

## What the product can do at end of day

A snapshot of capability, not architecture. Use this if you forget what
you've shipped.

### File formats (15)

CSV / TSV / JSONL / Parquet / Arrow IPC (.arrow + .feather) / SQLite
(.db + .sqlite + .sqlite3) / DuckDB (.duckdb) / Excel (.xlsx) / SPSS
(.sav + .zsav + .por) / Stata (.dta) / SAS (.sas7bdat + .xpt) /
**GeoJSON (.geojson + .geo.json) / KML (.kml)**. Spec §3.1 list bumped
from 13 → 15 today.

### Cell kinds (5)

- **SQL** (with CodeMirror 6 as a lazy chunk; textarea-first then async-swap)
- **Chart** (10 chart types: bar / line / area / scatter / histogram / stat / table custom + **stacked-bar / area-stacked / heatmap** via Observable Plot lazy chunk)
- **Markdown**
- **Pivot** (cross-tab from upstream SQL; sum / avg / min / max / count; row + column + grand totals for sum/count)
- **Map** (GeoJSON features on a tile-less MapLibre canvas; polygon/line/point layers; optional categorical color)

### Workspace surface

- 3-panel layout (Sources 240 / Notebook fluid / Schema 320)
- Header: Search / Open / Save / Share + **session dropdown** (active session name + popup with new/switch/rename/delete) + brand
- Schema panel header: **graph button** opens a Cytoscape modal of the taxonomy's type relationships
- Footer: engine status + "Your data never leaves the tab."

### Persistence (Theme 3)

- `.naklidata` file save/load via FSA (`Cmd+S` / `Open` actions)
- **IndexedDB auto-save + auto-restore** of the active session's workbook (debounced 300 ms)
- **Multi-session storage** at `sessions/index` + `sessions/<id>/snapshot`; legacy `workbook/current` auto-migrated on first multi-session boot
- **URL-state sharing** — `?lens=<base64>` round-trips the `.naklidata` JSON via gzip + base64url; Share button copies a clipboard link; URL stripped via `replaceState` after applying

### PWA

- `manifest.webmanifest` declares `display: standalone`, theme/background colors, single icon with `any maskable` purpose
- `public/sw.js` precaches the shell + chunks + manifest + icon + taxonomy worker; SWR for same-origin GETs; navigation fallback to cached `index.html` offline
- DuckDB-wasm bytes (74 MB) are NOT precached — opportunistically cached if a `?offline=1` boot fetches them

### Engine + classifier (v1.0 baseline, unchanged)

- DuckDB-wasm 1.29.0, vendored into `public/duckdb-fallback/` with SRI manifest at postinstall
- Boot tries CDN first (with SRI verification), falls back to vendored bytes on `?offline=1` or CDN failure
- Taxonomy worker classifies columns via regex / value-set / checksum / header-match detectors; v0.1 bundle ships ~30 types + 7 relationships
- Schema panel shows per-column candidates with confidence + accept/override (the spec's most-important surface)
- Templates panel seeds analyses ("Vendor concentration" etc.) based on classified types

---

## Architectural decisions made today

Eleven non-trivial calls. Full entries in `DECISIONS.md`; here's the
synthesis with reversal cost.

| When | Decision | Why | Reverse |
| --- | --- | --- | --- |
| 11:10 | Smoke script chromium path via env var | Hardcoded sandbox path; desktop fresh-install broke | Trivial |
| 11:30 | URL-state via gzip + base64url, not naive base64 | Naive base64 exceeds URL limits at realistic state | Easy |
| 11:30 | Playwright workers capped at 2 | Default N-cores caused DuckDB-boot timeouts | Trivial |
| 11:50 | PWA lite cache (shell + chunks), not full | DuckDB bytes are 74 MB — too aggressive on install | Trivial |
| 12:10 | Multi-session is a **header dropdown**, not a 4th panel column | Schema panel's primacy + 1280–1440 viewport reality | Easy |
| 13:00 | Observable Plot via lazy chunk + dispatch, not migrate-all-types | Reuses lazy infra; existing 7 types stay clean | Easy |
| 17:30 | Pivot is a **new cell kind**, not a chart-type variant | 2D table output is structurally different from charts | Easy |
| 17:30 | Pivot uses **in-memory** compute over upstream rows, not extra DuckDB query | No round-trip; consistent with chart-cell pattern | Easy |
| 18:00 | Schema graph is a **modal**, not an inline panel; **taxonomy-type** graph, not workbook-ER | Modal preserves 3-panel layout; relationships.json already curated | Easy |
| 18:30 | Map cell has **no basemap** (no tiles); **no deck.gl** | CSP + privacy; deck.gl only matters at >10k pts | Trivial |
| 18:30 | `.geojson` / `.kml` mount via DuckDB **spatial extension** + `ST_AsGeoJSON` | Cleaner SQL + gives users `ST_*` library; geometry as string column | Easy |

Plus three structural moves not in DECISIONS.md (they aren't
"decisions" so much as plumbing):

- **v1.0.0 tag** pushed (desktop-session resolution of the web-session 403).
- **GitHub default branch** flipped from `claude/agent-handoff-start-3c2Ib` to `main`; bootstrap branch deleted local + remote.
- **Cytoscape config tweak** + **MapLibre CSS skip** (the latter to avoid an esbuild module-declaration shim — only matters for popups + controls we don't use).

---

## What's not shipped

Tier list. Top items are the natural next pushes; bottom items are
v1.2+ or out-of-scope for v1.1.

### Tier 1 — Theme 2 polish (deferred sub-items)

Small, scattered. Worth picking up if you're touching the viz code
again anyway.

- **Plot pie chart** — custom arc adapter (Plot doesn't ship a pie mark).
- **Plot faceted small-multiples** — needs a third "facet-by" picker on the chart cell.
- **Map basemap** — vendor tiles or OSM. Requires CSP `connect-src` exception + UI to pick the basemap. Breaks "data never leaves the tab" unless the user explicitly opts in.
- **Map deck.gl pairing** — for >10k-point performance. Pair as a separate lazy chunk loaded only when the map cell sees a large feature count.
- **Shapefile mount** — needs multi-file FSA picker (`.shp + .dbf + .shx`); single-file picker can't deliver.

### Tier 2 — Theme 1 wave 3 (test infrastructure)

Closes the local sandbox gap.

- **Sample-data regen** — produce `.sqlite`, `.xlsx`, a small `.sas7bdat`, and a small `.geojson` for `tests/e2e/fixtures/` so the smoke + e2e suites exercise the new format paths.
- **Vendor DuckDB extensions** into `public/duckdb-fallback/` (`sqlite`, `excel`, `read_stat`, `spatial`). Production users hit `extensions.duckdb.org` fine; the web sandbox blocks it. Vendoring closes the gap so smoke fully exercises mounts in any environment.

### Tier 3 — Theme 4 (schema + data quality polish)

Direct extension of the "schema panel is the most important surface"
thesis.

- **Column-statistics panel** — cardinality, null %, length distribution, top-k. A `column-profile` mode for the schema panel.
- **Side-by-side data compare** — auto join-key detection from taxonomy + diff renderer using `EXCEPT`/`INTERSECT`.
- **Type-override learns** — "always treat columns named `vendor_id` as `gstin`" becomes a per-workspace seed.
- **Demo / censor mode** — mask user paths and column names in screenshots.

### Tier 4 — AI sidecar (v1.1 spec §4.3 + portfolio mandate)

Largest remaining product-shape work. Planning is mature
(`plan/sidecar-architecture.md` + spec §4.3) but implementation is
zero-started.

- **Three jobs**: explain-this-query / explain-this-error / recommend-a-template.
- **BYOK plumbing**: sessionStorage default per spec amendment; opt-in plaintext IDB persistence (option A); passphrase-encrypted variant for v1.2 (option B).
- **UI surface**: sidecar affordances + BYOK settings + per-job entry points.

### Tier 5 — v1.0 review carryover

Small, batchable, valuable.

- **CodeMirror 6 lazy-mount eyeball** — confirm textarea → CM6 swap, `cmInstances` map survives notebook re-renders, `disposeSqlCellEditor` fires on delete (memory leak vector).
- **DuckDB-wasm SRI scenario** — read the call sites in `engine.ts`'s CDN path; ideally simulate a tampered-CDN scenario.
- **README audit** — confirm browser-support claims match reality.
- **Agent-seeded taxonomy types review** — 11 entries with `seed_origin` in `taxonomy/v0.1/types.jsonl` want a human pass before they're treated as canonical (especially now that they'll show up as nodes in the schema-graph modal).
- **Save-load e2e flake** — uses count-based wait instead of `waitForClassificationStable`; intermittent under high parallelism. Drop-in helper replacement.

### Tier 6 — v1.2+ / out-of-scope

- **Theme 6 — Compute Bridge** (v1.2 → v2.x): Iceberg REST Catalog + S3 custom endpoints (v1.2); `NakliTechie/nakli-compute` sibling repo + Arrow Flight + LoRA-Gemma bridge sidecar (v1.3); multi-team OAuth2 (v1.4); DB Relay for Postgres/MySQL/Snowflake/BigQuery (v2.0); edge compute via CF Workers / Lambda (v2.x). See `plan/enterprise-strategy.md`.
- **Deploy target** — still no canonical home for the built artifact. CF Pages, GH Pages, S3, somewhere else? Affects manifest `start_url` / `scope` and SW scope.
- **Hard NOTs** (still locked): no telemetry, no persistent BYOK in v1.1, no auto-execute LLM SQL, no prose narration, no background polling, no login, no third-party scripts beyond SRI-pinned DuckDB CDN, no remote writes.

---

## Open questions still queued

None resolved today. Carried forward:

- **License for `nakli-compute` bridge repo** — leaning Apache 2.0.
- **Bridge wire protocol** — Arrow Flight vs HTTP + Arrow IPC. Probably both.
- **Agent-seeded taxonomy types** — 11 entries need human review (see Tier 5).
- **AI sidecar reality** — planning vs implementation. Tier 4 above.
- **Deploy target** — Tier 6 above.

---

## Tomorrow's pickup paths

Five viable next moves, ranked by likely-value.

### A. AI sidecar (Tier 4)

The largest unimplemented product surface and the standing
portfolio-wide mandate. Three narrow jobs to start. A 3-session push,
minimum. **High signal:** this is the only NakliTechie project that
hasn't shipped its sidecar; closing the gap is meaningful.

### B. Theme 4 (Tier 3) — schema + data quality polish

Extends the spec's most-important surface. Column-statistics panel
alone is a high-leverage feature; pair it with type-override-learns
for a focused push. **High signal:** every user who mounts data
benefits.

### C. Theme 1 wave 3 (Tier 2) — testing infrastructure

Closes the sandbox gap so the smoke test can exercise SQLite / Excel
/ SPSS / GeoJSON paths offline. Mostly mechanical. **High signal:**
makes the test suite trustworthy in any environment.

### D. v1.0 review carryover (Tier 5)

Small + batchable: CM6 mount audit, SRI scenario, README audit, the
11 agent-seeded taxonomy types, save-load flake fix. One focused
session. **Medium signal:** tidying the v1.0 close-out before any
v1.1.x release.

### E. Theme 2 polish (Tier 1)

Pie chart, faceted, basemap, deck.gl, shapefile. None individually
critical; together they round out the viz story. Save for a
"polish" session if no other directions surface. **Lower signal**
than A/B/C.

---

## Resume tomorrow

Practical bring-up sequence. Should take under 5 minutes if nothing
changed externally.

```bash
cd /Users/chiragpatnaik/Code/NakliData
git status              # should be clean on `main`
git pull origin main    # in case anything pushed from elsewhere
npm install             # only if package.json / lock changed
npm run check           # tsc + biome
npm run test            # vitest (expect 87 passing)
npm run smoke           # build + headless Playwright (expect SMOKE TEST PASSED)
```

If anything's red, the first place to look is
[`STATUS.md`](../STATUS.md) at repo root. The "Build status" line
should be **green** end-of-day-today; if it isn't on resumption,
something happened in-between.

For agent context on resumption, in order:

1. This file — `plan/checkpoint-2026-05-17-eod.md`
2. [`STATUS.md`](../STATUS.md) — current build/branch state
3. [`plan/progress.md`](./progress.md) — read top entry first for what just landed
4. [`plan/pending.md`](./pending.md) — backlog with completion checkboxes
5. [`DECISIONS.md`](../DECISIONS.md) — read top entries first; today's are 11:10 through 18:30

---

## Conventions + gotchas to remember

- **`exactOptionalPropertyTypes: true`** is on. Use explicit `null`, not `undefined`. When constructing types with optional fields from variable data, use `...(x ? { field: x } : {})` conditional spread.
- **Biome is the formatter** — `npm run fmt` auto-fixes. `npm run check` runs both tsc + biome. The 14 pre-existing biome warnings are all `noNonNullAssertion` in `src/ui/templates/templates.ts`; ignore unless you touch templates.
- **Lazy chunks**: anything > ~50 KB minified should be a chunk. Add to `LazyChunkRegistry` in `src/core/lazy-loader.ts`. Esbuild builds `src/lazy/<name>.ts` → `dist/chunks/<name>.js`.
- **CSP**: the inlined `<script>` body's SHA-256 is computed at build time and injected into `script-src`. If you change how the bundle is produced, verify the page still loads (smoke catches this).
- **Workers**: DuckDB's worker comes from the vendor bundle via `importScripts`. The taxonomy worker is a separate esbuild entrypoint. Don't add a third worker without a clear reason.
- **`process.env.NODE_ENV`** is replaced at build time (`"production"` for `npm run build`, `"development"` for `--dev`). The SW registration uses this gate.
- **Playwright workers** capped at 2 — DuckDB-boot is heavy; higher fan-out causes "Engine: ready" timeouts.
- **Sandbox limitation** — if you're in a sandbox that blocks `extensions.duckdb.org`, the SQLite / Excel / SPSS / GeoJSON mounts won't fetch their extensions on first use. Set `PLAYWRIGHT_CHROMIUM_PATH` for vendored chromium in the same environment.

### Stop checklist (from project `CLAUDE.md`)

Before declaring any change done:
1. `npm run smoke` passes (catches CSP/FSA/worker-bootstrap/classifier regressions).
2. `npm run check` clean (≤ 14 biome warnings).
3. `npm run test` green.
4. `dist/index.html` ≤ 600 KB.
5. Schema-panel-touching changes get a manual look (the most-important surface).
6. `STATUS.md` updated.
7. Non-trivial decisions logged in `DECISIONS.md`.

---

## Live ledger files

| File | Owns |
| --- | --- |
| `STATUS.md` | Current build state, branch state, what's done since last check-in. |
| `DECISIONS.md` | Append-only decision log. Today: 11:10 / 11:30 (×2) / 11:50 / 12:10 / 13:00 / 17:30 / 18:00 / 18:30. |
| `CLAUDE.md` | Agent rules; stop checklist; Hard NOTs; conventions. |
| `plan/progress.md` | Session journal. Today's entries: Theme 3 wave 2 ×3 + checkpoint + Theme 2 waves 1–4. |
| `plan/pending.md` | Backlog with completion checkboxes. |
| `plan/checkpoint-2026-05-17.md` | Midday synthesis snapshot (before Theme 2 finished). |
| **`plan/checkpoint-2026-05-17-eod.md`** | **This file.** End-of-day synthesis. |
| `plan/spec-amendments.md`, `plan/product-shape.md`, `plan/remote-sources.md`, `plan/enterprise-strategy.md`, `plan/sidecar-architecture.md`, `plan/declined.md`, `plan/v1.0-handoff-notes.md` | Standing forward-looking artifacts; mostly unchanged today. |

---

*Written 2026-05-17 end-of-day. Theme 2 + Theme 3 wave 2 complete;
v1.0.0 tagged. Resume bring-up: section "Resume tomorrow" above.*
