# Progress log

Append-only checkpoint journal. Each entry: where we are, what just shipped, where to pick up. Read the **bottom** entry first — that's the current state.

---

## 2026-05-18 (AI sidecar wave 2) — Type disambiguation on ambiguous schema columns.

### What landed

- **`src/core/sidecar/types.ts`** extended with `DisambiguateTypeJob` (`columnName / sqlType / samples / candidates`) and `DisambiguateTypeResponse` (`typeId: string | null`). Unions extended.
- **`src/core/sidecar/client.ts`** gets a new dispatch case + helpers. `buildDisambiguateTypePrompt(job)` produces a one-token-output prompt with the candidate list, sample values (capped at 20), column header, and SQL type. `parseDisambiguateTypeResponse(raw, candidates)` strips wrapping quotes / backticks / periods / code fences defensively, matches case-insensitively against the candidate ids, and coerces unknown / off-list / empty answers to `null`. Off-candidate strings (model hallucinates a typeId not in the list) become `null` rather than throwing.
- **`src/ui/schema-panel.ts`**: new `isAmbiguous(a)` predicate — `origin === 'detector'` && `≥2 candidates` && `assigned.confidence ∈ [0.5, 0.9)`. When true, `renderAskSidecarButton(sourceId, tableId, a)` adds a "Ask sidecar" button to the column row with the right `data-action` / `data-source-id` / `data-table-id` / `data-column` attrs. CSS `.schema-sidecar-ask { display: none }` + `.app-sidecar-enabled .schema-sidecar-ask { display: inline-flex }` so the button is gated by the global enable flag with no schema-panel re-render needed when the user toggles.
- **`src/main.ts`** new action handler `ask-sidecar-disambiguate` → `runDisambiguateType(engine, buttonEl, sourceId, tableId, columnName)`. The handler reads the column's `ColumnAssignment`, re-samples values via `engine.sampleColumn(table.name, columnName)` (up to 20), dispatches the job, and routes the result through the **existing** `overrideAssignment` — applying the chosen typeId as a `user_override`. `null` response → toast "Sidecar wasn't confident on <column>". Errors restore the button state since no workbook update will re-render the row.

### Why these choices

- **Reuse `overrideAssignment`** — keeps the audit trail single (`origin = 'user_override'` whether the user picked manually or the sidecar did). The "track sidecar overrides distinctly" idea is deferred; future work could add a `'sidecar_override'` origin if needed.
- **One-token format (not JSON)** — per spec §4.3. Cheaper on every model since the response is bounded to ~10 tokens.
- **CSS-gated visibility** — toggling sidecar on/off mid-session is instant, no perceptible flicker. The button only renders when `isAmbiguous` says so, so disabled-sidecar users never see it even if CSS were missing.
- **Defensive parsing** — small models occasionally return `"pan"` or `` `pan` `` or `pan.` despite the rule. Strip rather than reject; off-candidate strings fall to `null` (user-friendly fallback).

Full reasoning at DECISIONS 2026-05-18 18:00.

### Tests

- **`tests/sidecar-client.test.ts`** (+10 vitest specs):
  - `buildDisambiguateTypePrompt` — includes candidate list + samples + SQL type + column header in the user content; caps samples at 20 (`sample_0..sample_19` present, `sample_20` not).
  - `parseDisambiguateTypeResponse` — matches case-insensitively (`GSTIN` → `gstin`); `unknown` → null; off-candidate string → null; wrapping quotes/backticks/periods/code-fences stripped; empty string → null.
  - `dispatchJob` with kind `disambiguate-type` — calls transport with the right prompt and returns the parsed candidate; `unknown` transport response → `typeId: null`.

No new e2e — the dispatch + UI button-click → action-dispatch pipeline is the same machinery as wave 1's `explain-error`, already covered by `tests/e2e/sidecar-flow.spec.ts`. The wave 2 deltas (prompt + parser + override application) are isolated and unit-tested. Adding a real-data e2e here depends on the classifier producing a deterministically ambiguous column, which would be brittle to test infrastructure changes.

### Quality

- `dist/index.html` 360 KB (was 356; +4 KB for prompt/parser + schema-panel button + CSS). Well under the 600 KB shell budget.
- `tsc --noEmit` clean. `biome check` 0 errors / 14 warnings (pre-existing).
- **114 vitest** (was 104; +10) + 19 Playwright e2e + smoke green.

### What's next

- **Wave 3 — define-new-type assist** (spec §4.3 job 3). User picks an unrecognized column → sidecar suggests `{id, display_name, category, regex}`. Lives in the schema panel's "User type" workflow. Sets up the user-type lifecycle that's currently a placeholder.
- **Custom-endpoint support** — OpenAI-compatible URL for local llamafiles / vLLM. Needs CSP rethink.
- **Eval harness (v1.2)** — `plan/sidecar-architecture.md` makes the case.
- **Local-model path (v1.2+)** — Transformers.js + Phi-3-mini-class. Opt-in fallback to BYOK.

---

## 2026-05-18 (AI sidecar wave 1) — BYOK + explain-query-error end-to-end.

### What landed

- **`src/core/sidecar/`** (new module, ~400 lines total): `types.ts` (provider/job/response unions + `SidecarError`), `byok.ts` (per spec amendment A2 — sessionStorage default, opt-in IDB, last-4-char preview, "switching storage clears the other location" invariant), `providers/anthropic.ts` (Messages API with `anthropic-dangerous-direct-browser-access`), `providers/openai.ts` (Chat Completions with Bearer auth), `client.ts` (top-level `dispatchJob` with stubbable transport for tests; `buildExplainErrorPrompt` + `parseExplainErrorResponse` exported pure-function).
- **`src/core/settings.ts`** extended with `sidecarProvider` + `sidecarModel`.
- **`src/ui/settings-modal.ts`** (new, ~250 lines): sidecar enable, active-provider radio, model input, per-provider blocks with status line (formatStatus reads `locateKey` → "Not configured" / "In sessionStorage (••••xxxx). Will clear when you close this tab." / "Stored on this device (••••xxxx). Anyone with access to this browser profile can read it.") + per-provider forget + global "Forget all stored keys". Verbatim A2 wording.
- **`src/ui/shell.ts`** new Settings button in the header.
- **`src/ui/cells/sql-cell.ts`**: errored output gains a `cell-output-error-actions` row with an "Explain this error" button (hidden until `.app-sidecar-enabled`) and a `cell-sidecar-result` region for the response.
- **`src/main.ts`** new actions `open-settings`, `explain-error`, `copy-suggested-fix`. `runExplainError` reads cell's `code` + `lastError`, builds a compact schema hint (capped at 6 tables / 12 columns), dispatches, renders. `restoreFromActiveSession` toggles `.app-sidecar-enabled` from saved settings. `persistSnapshot` preserves sidecar fields (was clobbering on workbook autosave).
- **CSP**: `connect-src` extended with `https://api.anthropic.com` + `https://api.openai.com` in both `src/index.html` (dev) and `esbuild.config.mjs` (prod).
- **`src/ui/shell.css.ts`**: settings-modal styles + sidecar-result block styles (explanation card with accent border-left, suggested-fix code block, footnote with provider/model, error state).

### Why this scope for wave 1

Spec §4.3 lists three jobs but prompts for each are independent —
bundling gains nothing. **explain-query-error** has the most
unambiguous trigger (errored SQL cell), cleanest input shape (SQL +
error + optional schema hint), and shortest output (1–3 sentences +
optional suggested SQL). Ship one job end-to-end with full BYOK +
settings + visibility plumbing; add the other two in follow-up waves.
Two providers shipped together since portfolio mandate forbids
provider lock-in. Full reasoning at DECISIONS 2026-05-18 17:00.

### Hard-NOT compliance

- **#2 (no persistent BYOK by default)**: sessionStorage is default; IDB is opt-in via a labelled checkbox.
- **#4 (no auto-execute LLM SQL)**: suggested-fix renders as `<pre>` with "Copy SQL" → clipboard. No editor mutation, no auto-run.
- **#7 (no third-party scripts beyond SRI-pinned DuckDB CDN)**: sidecar calls APIs via `fetch`, not script tags. CSP `connect-src` extension is to whitelisted JSON endpoints only.
- **Prose-narration boundary**: the explanation IS prose (spec explicitly allows it for the error-explanation job). The narration constraint applies to query-result summaries; separate surface.

### Tests

- **`tests/sidecar-byok.test.ts`** (7 vitest specs): default-sessionStorage, opt-in IDB, switching-clears-the-other invariant, locate-when-empty, forget-from-both-stores, forget-all, empty-key rejection. vi.mock IDB + MemoryStorage shim for `globalThis.sessionStorage`.
- **`tests/sidecar-client.test.ts`** (10 vitest specs): `buildExplainErrorPrompt` shape, `parseExplainErrorResponse` (clean / fenced / null-fix / malformed / missing-explanation), `dispatchJob` no-key, dispatch happy path with stubbed transport (verifies provider/model/key/system/user wiring), transport-error propagation.
- **`tests/e2e/sidecar-flow.spec.ts`** (2 Playwright specs): full UI flow with `page.route('https://api.anthropic.com/v1/messages', …)` returning a canned JSON response — open Settings → enable sidecar (verifies `.app-sidecar-enabled` on root) → save key → status line flips to "In sessionStorage (••••)" → close modal → trigger SQL error → click Explain → assert exactly 1 Anthropic call + explanation + suggested-fix rendered. Second spec: enable sidecar with no key → Explain → no-key error + "Open Settings" affordance visible.

### Quality

- `dist/index.html` 356 KB (was 340; +16 KB for sidecar code + settings modal + CSS). Well under 600 KB budget.
- Lazy chunks unchanged (sidecar dispatch lives in the main bundle because every errored cell needs it).
- `tsc --noEmit` clean. `biome check` 0 errors / 14 warnings (pre-existing).
- **104 vitest** (was 87; +17) + **19 Playwright e2e** (was 17; +2) + smoke green.

### What's next (sidecar arc)

1. **Wave 2 — type disambiguation** (spec §4.3 job 1). Schema panel's per-column candidate menu gets "Ask sidecar" for columns with confidence ∈ [0.5, 0.9]. One-token answer; temperature 0; output is `typeId` from the candidate list or `unknown`.
2. **Wave 3 — define-new type assist** (spec §4.3 job 3). User picks a column → sidecar suggests `{id, display_name, category, regex}`. Lives in the schema panel's "User type" workflow.
3. **Eval harness (v1.2)** — `plan/sidecar-architecture.md` makes the case that without held-out evals we can't honestly compare prompted vs LoRA. Per-job synthetic data generators + accuracy metrics.
4. **Custom-endpoint support** — OpenAI-compatible URL field for users running local llamafiles / vLLM. Needs a CSP rethink (current explicit-host whitelist won't work).
5. **Local model path (v1.2+)** — Transformers.js + Phi-3-mini-class (~150 MB OPFS). Opt-in fallback to BYOK if not downloaded.

---

## 2026-05-17 (Theme 2 wave 4) — Map cell + GeoJSON/KML mount. **Theme 2 complete.**

### What landed

- **`src/lazy/maplibre-map.ts`** (new, ~170 lines). `mountMap({container, data, colorBy})` renders a GeoJSON FeatureCollection on a tile-less MapLibre canvas. Empty style (no basemap) so geometry layers sit on the project background color — keeps CSP + privacy clean. Three render layers: polygons (fill + outline), lines, points (circles with dark stroke). Optional categorical color via a `match` expression on a property; falls back to the accent. Auto-fits bounds to the data on load. Skips MapLibre's own CSS — only matters for popups + controls we don't use.
- **`src/ui/cells/map-cell.ts`** (new, ~140 lines). `renderMapCell` mirrors the chart-cell / pivot-cell shape: header has input + geometry + optional color-by pickers + delete; output region is a 420px-tall map canvas. Parses geometry values at the cell boundary — handles both objects (when upstream selects from a JSON column) and strings (when upstream uses `ST_AsGeoJSON(geom)`). Lazy-loads `maplibre-map` chunk only when ready to render. Invalid geometries → friendly "No valid GeoJSON…" message.
- **`src/ui/cells/types.ts`**: new `MapCellState` (id / kind / order / name / inputCell / geometryCol / colorBy) + `'map'` added to `CellKind` and `CellState` union.
- **`src/ui/notebook.ts`**: addCell('map') seeds defaults (everything null); renderNotebook dispatches to renderMapCell; new "+ Map" toolbar button.
- **`src/core/engine.ts`**: new `registerSpatial({tableName, file})` uses `ensureExtension('spatial')` then creates a view with `ST_AsGeoJSON(geom) AS geometry, * EXCLUDE (geom) FROM ST_Read(...)`. JS side never has to touch the DuckDB `GEOMETRY` logical type.
- **`src/core/mount.ts`**: `'geojson' | 'kml'` added to `FileFormat`. `detectFormat` recognises `.geojson`, `.geo.json`, `.kml` (case-insensitive). `registerFileByFormat` routes both to `registerSpatial`.
- **`src/main.ts`**: file-picker accept list extended with `.geojson` + `.kml` (and `application/geo+json` + `application/vnd.google-earth.kml+xml` MIMEs for FSA). Fallback `<input type="file">` accept string also extended.
- **`src/core/lazy-loader.ts`**: `'maplibre-map'` added to `LazyChunkRegistry`.
- **`package.json`**: `maplibre-gl` ^5.24.0 added.

### Why no basemap; why no deck.gl; why spatial extension

- **No basemap.** Vendor tiles or OSM tiles would require a CSP `connect-src` exception and break "your data never leaves the tab" (tile requests carry referer + viewport coords to a third party). Geometry-on-background is sufficient for v1.1 and keeps the privacy posture clean.
- **No deck.gl.** deck.gl is for >10k-point rendering. Ship it later when real workloads need it; today we don't.
- **DuckDB spatial extension** (not `read_json_auto` + `UNNEST`). `ST_Read` produces a clean view; users also get the full `ST_*` function library for downstream filtering / transforming. Spatial is a core extension, no community-trust posture needed. Network for first load — same caveat as Excel/SQLite/read_stat mounts.

### Tests

- **`tests/mount.test.ts`** (3 new vitest specs): `.geojson` / `.geo.json` / `.kml` recognized; case-insensitive (`MAP.KML` → `'kml'`).
- **`tests/e2e/map-cell.spec.ts`** (2 new Playwright specs):
  1. SQL cell with three literal-GeoJSON `SELECT … UNION ALL` rows → "+ Map" → pick input + geometry column → MapLibre chunk fetched (asserted via `page.on('request')`) → `<canvas>` appears inside the map cell → no page errors.
  2. SQL cell with `'not-a-geometry' AS geometry` → map cell shows a "No valid GeoJSON…" message and doesn't throw.

### Quality

- `dist/index.html` 340 KB (was 336 KB; +4 KB for map cell + types + spatial mount + accept-list extensions). Well under the 600 KB shell budget.
- `dist/chunks/maplibre-map.js` 1.0 MB lazy (sizeable but loads only when a map cell renders).
- `dist/chunks/cytoscape-graph.js` 436 KB lazy unchanged. `dist/chunks/observable-plot.js` 273 KB lazy unchanged. `dist/chunks/codemirror.js` 364 KB lazy unchanged.
- `tsc --noEmit` clean. `biome check` 0 errors / 14 warnings (pre-existing).
- **87 vitest** (was 84; +3) + **17 Playwright e2e** (was 15; +2) + smoke green.

### Theme 2 totals

5/5 sub-items shipped (lazy splitting infra was already in place from Theme 1 wave 2). Stacked-bar / area-stacked / heatmap charts (Plot), pivot-table cell, schema-relationship graph (Cytoscape), map cell (MapLibre), GeoJSON + KML mounts (spatial). Bundle stayed comfortably within budget despite adding 4 lazy chunks. **Spec §3.1 supported formats: 13 → 15.**

### What's next

Theme 2 is closed. The natural next pushes from `plan/checkpoint-2026-05-17.md` Tier 2 and 3:

1. **Theme 1 wave 3** — sample-data regen (`.sqlite`, `.xlsx`, `.geojson`, `.sas7bdat`) + vendor DuckDB extensions into `public/duckdb-fallback/` for offline-grade smoke. Testing-infra work; closes the local sandbox gap.
2. **Theme 4** — schema + data quality polish (column-statistics panel; side-by-side data compare; type-override learns; demo/censor mode).
3. **AI sidecar (v1.1 spec §4.3 + portfolio mandate)** — explain-this-query / explain-this-error / recommend-a-template + BYOK plumbing. Largest remaining product-shape work.

---

## 2026-05-17 (Theme 2 wave 3) — Schema-graph modal (Cytoscape lazy chunk).

### What landed

- **`src/lazy/cytoscape-graph.ts`** (new, ~100 lines). `mountGraph({container, nodes, edges, onNodeClick})` renders Cytoscape with a Rangrez-palette-styled node/edge stylesheet, `cose` (force-directed) layout, target-arrow edges with rotating labels. Returns a `GraphHandle` with `destroy()` + `refit()`.
- **`src/ui/schema-graph.ts`** (new, ~100 lines). `openSchemaGraph()` mounts a singleton modal overlay, fetches the taxonomy bundle (via the existing `getTaxonomyClient().ensureReady()`), filters types to those that appear in any relationship, lazy-loads the Cytoscape chunk, and renders. `closeSchemaGraph()` destroys the cy instance and removes the overlay. Backdrop click, close icon, and `Escape` all dismiss.
- **`src/taxonomy/types.ts`**: `TaxonomyBundle` gains an optional `relationships?: TypeRelationship[]` field. New `TypeRelationship` interface (`from`, `to`, `kind`, optional `note`).
- **`src/taxonomy/load.ts`**: when the bundle's `index.json` includes a `relationships_file`, fetch it (best-effort — failures don't fail the whole bundle since classifier doesn't read relationships). Bundle is built with `...(relationships ? { relationships } : {})` so exactOptionalPropertyTypes is honored.
- **`src/ui/shell.ts`**: Schema panel header gets a chart-icon button next to the "Schema" label, `data-action="open-schema-graph"`. Present even before any sources are mounted — discoverable.
- **`src/main.ts`**: new `open-schema-graph` action case calls `openSchemaGraph()`.
- **`src/ui/shell.css.ts`**: `.schema-graph-overlay` (fixed, full-viewport, semi-transparent backdrop), `.schema-graph-modal` (centered, max ~1080×720), `.schema-graph-header` (title + status line + close), `.schema-graph-canvas` (flex-1 region for cytoscape).
- **`src/core/lazy-loader.ts`**: `'cytoscape-graph'` added to `LazyChunkRegistry`.
- **`package.json`**: `cytoscape` ^3.33.3 + `@types/cytoscape` dev-dep.

### Why modal + lazy chunk + taxonomy-type graph

A modal is the right affordance density for a low-frequency exploratory
view; it preserves the 3-panel layout. Lazy-loaded Cytoscape (436 KB)
keeps the shell at 336 KB. Taxonomy-type relationships are the
immediately-shippable scope — already curated in
`taxonomy/v0.1/relationships.json` (7 edges: identifies, embeds,
implies, pairs_with, scopes, contextualizes). Workbook-level ER
discovery from column names + taxonomy assignments is a richer feature
but speculative — defer. Full rationale at DECISIONS 2026-05-17 18:00.

### Tests

- **`tests/e2e/schema-graph.spec.ts`** (new, 2 Playwright specs):
  1. Click the graph button → overlay appears → `/chunks/cytoscape-graph.js` is fetched (asserted via both `page.on('request')` and `performance.getEntriesByType('resource')`) → a `<canvas>` element appears inside the graph region → status line reports `N types, M relationships` → Escape dismisses cleanly.
  2. Reopen → click the backdrop → modal closes. Reopen → click the close icon → modal closes.

### Quality

- `dist/index.html` 336 KB (was 332 KB; +4 KB for modal + button wiring + relationships type/loader. Well under the 600 KB shell budget). `dist/chunks/cytoscape-graph.js` 436 KB lazy. `dist/chunks/observable-plot.js` 273 KB lazy unchanged. `dist/chunks/codemirror.js` 364 KB lazy unchanged.
- `tsc --noEmit` clean. `biome check` 0 errors / 14 warnings (pre-existing).
- 84 vitest + **15 Playwright e2e** (was 13; +2) + smoke green.

### What's next (rest of Theme 2)

1. **Map cell** (MapLibre GL JS + deck.gl as a lazy chunk). New cell kind alongside SQL/chart/markdown/pivot. Largest remaining Theme 2 item; needs a geometry-column picker on the cell.
2. **DuckDB spatial extension** — GeoJSON / Shapefile / KML mount. Pairs naturally with the map cell.
3. **Plot pie + faceted small-multiples** — pair with the map cell's UI pass (faceted needs a third "facet-by" picker on the chart cell).

---

## 2026-05-17 (Theme 2 wave 2) — Pivot-table cell.

### What landed

- **`src/ui/cells/types.ts`**: new `PivotCellState` interface and `'pivot'` added to the `CellKind` union. Fields: `inputCell`, `rowCol`, `colCol`, `valueCol`, `agg`. Agg ∈ `'sum' | 'avg' | 'min' | 'max' | 'count'`.
- **`src/ui/cells/pivot-cell.ts`** (new, ~290 lines). `renderPivotCell(cell, upstreamCells, handlers)` mirrors the chart-cell pattern: header has input + row/col/value/agg pickers + delete; output region renders a 2D table with row labels left, column labels top, aggregated cells inside, plus row totals, column totals, and a grand-total tfoot — gated by `hasMeaningfulTotals` (only sum + count). `computePivot(cell, rows)` is exported pure-function for unit testing. Display cap: 200 rows × 50 cols with a "more hidden" footnote. BIGINT + numeric-string coercion; non-numeric silently dropped for sum/avg/min/max.
- **`src/ui/notebook.ts`**: `addCell('pivot')` seeds a new `PivotCellState` (defaults: agg=`sum`, everything else null). `renderNotebook` dispatches to `renderPivotCell`. Toolbar add row gets a "+ Pivot" button (alongside SQL / Markdown / Chart).

### Why new cell kind, not chart-type variant; why in-memory, not extra query

A pivot's output is structurally different from any chart type (2D
table with margins, not a single SVG). Forcing it through the chart
cell would mean the chart-cell renderer becomes a "pivot OR chart"
dispatcher with no shared code — the wrong abstraction. In-memory
compute over `upstream.lastResult.rows` reuses what's already on
screen, no engine round-trip, instant re-render on picker changes.
The "what if user needs more rows" case is handled by editing the
upstream SQL, not by the pivot silently issuing a different query
(consistent with the chart cell's behavior). Full reasoning at
DECISIONS 2026-05-17 17:30.

### Tests

- **`tests/pivot.test.ts`** (new, 7 vitest specs). Pure-function `computePivot`: sum across 2×2 grid + row/col/grand totals; count without value column; avg/min/max; numeric coercion (string `'50'` + bigint `50n`, with `'oops'` + null dropped); null `rowCol` or `colCol` returns null; null `valueCol` with non-count agg returns null; empty input → empty grid.
- **`tests/e2e/pivot-cell.spec.ts`** (new, 1 Playwright spec). End-to-end UI flow: mount example data → seeded SQL cell gets `SELECT vendor_name, payment_status, total_amount FROM invoices LIMIT 100` → run-all → click "+ Pivot" → pick input + row=vendor_name, col=payment_status, value=total_amount, agg=sum → assert the pivot table renders with numeric cells, header includes the col-value labels, and a `<tfoot>` row exists (grand-total path). The SQL-cell setter handles both the textarea and the post-CM6 `.cm-content` paths.

### Quality

- `dist/index.html` 332 KB (was 324 KB; +8 KB for the pivot cell + types + notebook plumbing). Well under the 600 KB shell budget. `dist/chunks/observable-plot.js` 273 KB lazy unchanged. `dist/chunks/codemirror.js` 364 KB lazy unchanged.
- `tsc --noEmit` clean. `biome check` 0 errors / 14 warnings (pre-existing).
- **84 vitest** (was 77; +7) + **13 Playwright e2e** (was 12; +1) + smoke green.

### What's next (rest of Theme 2)

1. **Schema-relationship-diagram via Cytoscape.js** — standalone view fed by `taxonomy/v0.1/relationships.json`. Smallest remaining Theme 2 item; lazy chunk to keep the shell budget intact.
2. **Map cell** (MapLibre GL JS + deck.gl) + DuckDB spatial extension (GeoJSON / Shapefile / KML). Heaviest remaining; pair the cell and the mount path in one push.
3. **Plot pie + faceted small-multiples** (still deferred from Theme 2 wave 1) — pair with the map cell's UI pass.

---

## 2026-05-17 (Theme 2 wave 1) — Observable Plot lazy chunk: stacked-bar, area-stacked, heatmap.

### What landed

- **`src/lazy/observable-plot.ts`** (new, ~130 lines). `mountPlotChart({mount, cell, result})` dispatches by `chartType`: `stacked-bar` → `Plot.barX` + stack; `area-stacked` → `Plot.areaY` + stack; `heatmap` → `Plot.cell` (auto-picks a numeric value column or falls back to `Plot.group({fill: 'count'})`). BIGINT-from-DuckDB on the y channel is coerced to Number so Plot's stack math doesn't choke. `pickCategory` heuristic picks a non-x/y, non-id categorical column for the fill channel.
- **`src/core/lazy-loader.ts`**: `'observable-plot'` added to `LazyChunkRegistry`. Existing `loadChunk('observable-plot')` machinery (cache, runtime URL, no esbuild inlining) reused as-is.
- **`src/charts/render.ts`**: new `PLOT_TYPES` set for the three new types; existing switch unchanged for the original 7 types. When the type is Plot-handled, show "Loading chart…" then fire-and-forget `loadChunk(...).then(mod => mod.mountPlotChart(...))`. The custom-rendered types continue to use the hand-rolled canvas+SVG path with the Rangrez palette.
- **`src/ui/cells/types.ts`**: `ChartCellState.chartType` union extended with `'stacked-bar' | 'area-stacked' | 'heatmap'`.
- **`src/ui/cells/chart-cell.ts`**: chart-type picker options extended with the three new types.
- **`package.json`**: `@observablehq/plot` ^0.6.17 added to dependencies.

### Tests

- **`tests/e2e/plot-chart-types.spec.ts`** (new, 2 Playwright specs):
  1. Switching a chart cell to `stacked-bar` fetches `/chunks/observable-plot.js` (asserted via `page.on('request')`) and renders an SVG containing real mark elements (`rect`/`path`/`circle`/`g`). The chunk is NOT loaded for the initial bar chart (custom canvas+SVG path).
  2. Heatmap on inappropriate single-axis data falls back without throwing — Plot may show its own "no data" or an empty SVG; the contract is "no uncaught error."

### Quality

- `dist/index.html` 324 KB (unchanged from Theme 3 wave 2 close — Plot stayed out of the shell). `dist/chunks/codemirror.js` 364 KB lazy unchanged. `dist/chunks/observable-plot.js` **273 KB lazy** (Plot + d3 internals; loaded only when a chart cell picks a Plot-rendered type).
- `tsc --noEmit` clean. `biome check` 0 errors / 14 warnings (pre-existing).
- 77 vitest + **12 Playwright e2e** (was 10; +2) + smoke green. Pre-existing save-load e2e is flaky under high parallel pressure (uses count-based wait instead of `waitForClassificationStable`) — passes consistently in isolation and at the current `workers: 2` config but worth a future cleanup.

### Why these three (and not pie / faceted)

- **Pie**: Plot deliberately doesn't ship a pie mark (the team's stance on quantitative-comparison ergonomics). We'd need a custom arc adapter; defer.
- **Faceted small-multiples**: Needs a third "facet-by" column picker on the chart cell (alongside x/y). Defer to the same UI pass as the map cell (which also needs new pickers).

### What's next (rest of Theme 2)

1. **MapLibre GL JS + deck.gl lazy chunk** — new map cell type. Largest remaining UX change in Theme 2; new cell kind in `src/ui/cells/`.
2. **DuckDB spatial extension** — GeoJSON / Shapefile / KML mount. Pairs naturally with the map cell.
3. **Pivot-table cell** — custom over DuckDB `GROUP BY CUBE` / `ROLLUP`. Self-contained, lower-cost ship.
4. **Schema-relationship-diagram via Cytoscape.js** — fed by `taxonomy/v0.1/relationships.json`. Standalone view.

---

## 2026-05-17 (Theme 3 wave 2, item 3) — Multi-session sidebar. **Wave 2 complete.**

### What landed

- **`src/core/sessions.ts`** (new, ~170 lines). `SessionMeta` + `SessionsIndex` types. CRUD: `createSession`, `setActiveSession`, `renameSession`, `deleteSession`. Snapshot ops keyed by session id: `loadSnapshot(id)`, `saveSnapshot(id, file)`, `clearSnapshot(id)`. The first call to `ensureActiveSession()` handles three startup states cleanly: brand-new (creates Untitled seed), upgrade from pre-session storage (migrates `workbook/current` into the seed session and deletes the legacy key), or returns the existing active.
- **`src/core/persistence.ts`**: removed the now-superseded `saveWorkbookSnapshot` / `loadWorkbookSnapshot` / `clearWorkbookSnapshot` functions (they wrote to the single-key `workbook/current`). Kept all `.naklidata` file save/load surface intact.
- **`src/main.ts`**: boot now ends with `ensureActiveSession()` → `refreshSessionSwitcher()` → either `decodeLensParam` (URL state) or `restoreFromActiveSession()` (IDB). `persistSnapshot` writes to the active session's key. New `switchToSession(engine, root, id)` flushes-then-flips, so an in-flight debounced save lands on the OUTGOING session (not the incoming one). Handlers added for `session-menu` / `session-new` / `session-switch` / `session-rename` / `session-delete`. Outside-click closes the dropdown.
- **`src/ui/shell.ts`**: new `renderSessionSwitcher(root, idx)`. Header now has a `[data-region="session-switcher"]` slot between brand and the right-button group. Active session name + caret in the trigger; popup lists every session with a checkmark on the active one, a rename button, a delete button, and a "New session" action at the top.
- **`src/ui/shell.css.ts`**: styles for `.session-switcher`, `.session-trigger`, `.session-menu`, `.session-row`. Popup uses `[data-open]` attribute for show/hide.

### Why header dropdown not a literal sidebar

Schema panel is the spec's most important surface (handoff §9). The 3-panel layout — Sources / Notebook / Schema — reinforces that. Adding a 4th column for session navigation would crowd the 1280–1440 viewport sizes most users have. Sessions are low-frequency; a dropdown is the right affordance density. Full writeup at DECISIONS 2026-05-17 12:10.

### Tests

- **`tests/sessions.test.ts`** (new, 13 vitest specs). In-memory IDB shim via `vi.mock` of `./idb.ts`. Covers: brand-new boot creates Untitled; legacy `workbook/current` migration; existing-index re-activation + stale-activeId fallback; createSession defaulting + active-pointer flip; rename + reject-empty-name; delete + can't-drop-last + active-pivot-on-delete; snapshot save/load round-trip; loadSnapshot rejects non-naklidata stored value.
- **`tests/e2e/sessions.spec.ts`** (new, 2 Playwright specs). Full UI flow: mount example data → header switcher reads "Untitled" → New session → workbook empties + name becomes "Session 2" → switch back via dropdown → sources + classifications restored. Second spec: delete on the only session is rejected (no-op).

### Quality

- `dist/index.html` 324 KB (was 316 KB; ~8 KB growth from sessions module + switcher UI + CSS). `dist/chunks/codemirror.js` 364 KB lazy unchanged.
- `tsc --noEmit` clean. `biome check` 0 errors / 14 warnings (pre-existing).
- 77 vitest (was 64; +13) + **10 Playwright e2e** (was 8; +2) + smoke green. All auto-restore + save-load + url-state + PWA + lazy-chunk specs still pass — the snapshot-storage change is transparent to them because they use `browser.newContext()` (clean IDB) and the new boot path always ensures a seed session before any restore attempt.

### What's next

Theme 3 wave 2 is complete. Recommended next themes from `plan/progress.md` 2026-05-16 entry:

1. **Theme 2** — visualization upgrade (Observable Plot lazy chunk + MapLibre map cell + pivot table + Cytoscape schema-relationship view). Heaviest of the remaining themes; biggest UX dividend.
2. **Theme 1 wave 3** — sample-data regen (`.sqlite`, `.xlsx`, `.sas7bdat`) + vendor DuckDB extensions into `public/duckdb-fallback/` for offline-grade smoke. Testing-infrastructure work; closes the local sandbox gap.
3. **Theme 4** — schema + data quality polish (column statistics panel; side-by-side data compare; type-override learns; demo/censor mode).

Open decisions still queued (from 2026-05-16): `nakli-compute` bridge repo license, bridge wire protocol, agent-seeded taxonomy types review.

---

## 2026-05-17 (Theme 3 wave 2, item 2) — PWA installability.

### What landed

- **`public/manifest.webmanifest`** — `name`, `short_name`, `start_url: './'`, `scope: './'`, `display: standalone`, `theme_color: #B5371C`, `background_color: #FAF7F0`. One icon entry advertising both `any` and `maskable` purposes.
- **`public/icon.svg`** — 256×256 brand-mark on accent background. Search-glass path (matches the inline favicon already in `src/index.html`), inset 20% so the maskable safe area is honored.
- **`public/sw.js`** (~85 lines, vanilla — easier than wiring a third esbuild entrypoint). Strategy: precache shell + chunks + manifest + icon + taxonomy worker on `install`; activate-time stale-cache cleanup; fetch handler is SWR for same-origin GETs; cross-origin passes through; navigation requests offline → cached `index.html`. DuckDB-fallback bytes are NOT precached (74 MB — see DECISIONS 11:50).
- **`src/index.html`** — `<link rel="manifest">`, `<meta name="theme-color">`, `<meta name="application-name">`, `<meta name="mobile-web-app-capable">`.
- **`src/main.ts`** — gates `navigator.serviceWorker.register('./sw.js')` on `process.env.NODE_ENV === 'production'` (esbuild replaces this at build time). DEV skips registration to avoid stale assets during watch.
- **`scripts/smoke.mjs` + `tests/e2e/fixtures/server.ts`** — `.webmanifest` MIME (`application/manifest+json`) and `.svg` MIME so the SW + manifest fetches don't pick up `application/octet-stream`.

### Tests

- **`tests/e2e/pwa.spec.ts`** (new, 2 Playwright specs):
  1. Manifest is linked from `index.html` with the right `theme-color`, fetches with the right `content-type`, parses, has `display: standalone` and at least one icon with the `maskable` purpose.
  2. SW registers + reports an active `controller`, precaches `/index.html` + `/manifest.webmanifest` + at least one `/chunks/*`, then `context.setOffline(true)` + reload still mounts the shell from the cached `index.html`.

### Quality

- `dist/index.html` 316 KB (was 316 KB; few-hundred-byte growth from manifest link + theme-color + SW registration). `dist/sw.js` 2.7 KB. `dist/manifest.webmanifest` 438 B. `dist/icon.svg` 350 B.
- `tsc --noEmit` clean. `biome check` 0 errors / 14 warnings (pre-existing).
- 64 vitest + **8 Playwright e2e** (was 6, +2 from pwa.spec.ts) + smoke green.

### What's next

Theme 3 wave 2 remaining:
1. **Multi-session sidebar** — OpenPlanter-style per-session workspaces. IDB keyspace per session + UI to switch.

---

## 2026-05-17 (Theme 3 wave 2, item 1) — URL-state sharing (`?lens=<base64>`).

### What landed

- **`src/core/url-state.ts`** (new, ~85 lines). `encodeLensParam(file)` → gzip + base64url. `decodeLensParam(s)` → base64url + gunzip + reuse `persistence.parse()` for validation. `readLensFromLocation()`, `clearLensFromLocation()`, `buildShareUrl(file)`. Uses browser-native `CompressionStream('gzip')` and `DecompressionStream('gzip')` (no new deps; both are in the spec's browser floor).
- **`src/main.ts` boot**: `?lens=` takes precedence over the IDB workbook snapshot. On bad lens, fall back to IDB rather than empty state. URL is stripped via `replaceState` after the file is applied so refresh doesn't re-trigger the load.
- **`src/main.ts` action**: new `share-link` case. Calls `serialize()`, `buildShareUrl()`, writes the URL to clipboard. Toast tells user if the URL is longer than `SOFT_URL_LIMIT` (7800 chars) and may be truncated by some chat tools.
- **`src/ui/shell.ts`**: new "Share" button in the header (next to Save), using the existing `link` icon and `data-action="share-link"`.
- **`tests/url-state.test.ts`** (new, 4 specs): round-trip preserves shape; compression ratio better than 0.6× naive base64; malformed base64 rejected; non-`.naklidata` payload rejected with `parse()`'s "Not a .naklidata file" error.
- **`tests/e2e/url-state-share.spec.ts`** (new, 2 specs): producer-mounts-example → click Share (clipboard `writeText` stubbed for headless determinism) → consumer-context-opens-link → workbook + classified columns match producer + URL stripped via replaceState. Corrupted lens → empty state without page errors.

### Quality

- **`tests/e2e/playwright.config.ts`** aligned with the smoke-script env-var convention: `PLAYWRIGHT_CHROMIUM_PATH` first, falls back to legacy `CHROMIUM_PATH`, otherwise lets Playwright pick its bundled chromium. Also capped `workers: 2` — `--workers=4` (Playwright default = N cores) caused intermittent "Engine: ready" timeouts on parallel DuckDB-wasm boots. Override on a beefier box with `--workers=N`.
- `dist/index.html` 316 KB (was 316 KB — url-state.ts adds ~2 KB code, no new deps). `dist/chunks/codemirror.js` 364 KB lazy unchanged.
- `tsc --noEmit` clean. `biome check` 0 errors / 14 warnings (pre-existing).
- 64 vitest tests (was 60, +4 from url-state.test.ts), 6 Playwright e2e (was 4, +2 from url-state-share.spec.ts), smoke green.

### What's next

Theme 3 wave 2 remaining:
1. **PWA installability** — `manifest.webmanifest` + service worker caching shell + `public/duckdb-fallback/`. Enables offline use after first load.
2. **Multi-session sidebar** — OpenPlanter-style per-session workspaces. IDB keyspace per session + UI to switch.

---

## 2026-05-17 (desktop pickup) — v1.0.0 tag landed; opening Theme 3 wave 2.

### What landed

- **`v1.0.0` tag pushed to origin.** Annotated tag at `5b10b93` (the pre-tag-bundle commit) per `plan/v1.0-handoff-notes.md`. Web session created it locally; desktop session pushed.
- **GitHub default branch switched from `claude/agent-handoff-start-3c2Ib` → `main`.** The handoff branch was set as default by the web-session bootstrap; main is the right default for a public repo.
- **Smoke script portability** (`scripts/smoke.mjs`): no longer hardcodes `/opt/pw-browsers/...`. Uses `PLAYWRIGHT_CHROMIUM_PATH` env var if set; otherwise lets Playwright pick its bundled chromium. DECISIONS entry at 11:10.

### Quality

- Desktop-handoff checklist (`plan/v1.0-handoff-notes.md` §"Testing / review checklist before next development") run end-to-end on a fresh clone: `npm install` (postinstall vendored DuckDB-wasm + wrote `integrity.json`), `npm run check` clean (0 errors / 14 expected biome warnings), `npm run test` 60/60 green, `npm run smoke` all 12 assertions pass (4 source tables mounted — desktop reaches `extensions.duckdb.org` for the JSONL extension that the web sandbox blocks), `dist/index.html` 316 KB / `dist/chunks/codemirror.js` 364 KB.
- Manual schema-panel pass (CLAUDE.md stop-checklist item 5) covered by the smoke test's override step ("overrode vendor_id → gstin" + origin assertion). A naked-eye browser pass is still worth a moment when the user is at the screen.

### What's next

Theme 3 wave 2 in order:
1. **URL-state sharing** — `?lens=<base64>` round-trips the `.naklidata` JSON (no data, only the description). Pattern from Huey; honors the no-server / no-account vision. Self-contained, no service-worker complexity. Starting first.
2. **PWA installability** — `manifest.webmanifest` + service worker caching the shell + `public/duckdb-fallback/`. Enables offline use after first load.
3. **Multi-session sidebar** — OpenPlanter-style per-session workspaces. IDB keyspace per session + UI to switch.

After Theme 3 wave 2: Theme 2 (visualization upgrade), then Theme 1 wave 3 (sample-data regen + vendored DuckDB extensions for offline-grade smoke).

---

## 2026-05-17 (pre-tag bundle) — CodeMirror 6 lazy chunk + DuckDB-wasm SRI pinning + README pass; ready to tag v1.0.0.

### What landed

- **CodeMirror 6 as a lazy chunk.** `src/lazy/codemirror.ts` exports `mountSqlEditor(host, opts)` returning `{ getDoc, setDoc, focus, dispose, domNode }`. Pulls in `@codemirror/{state,view,commands,autocomplete}` + `@codemirror/lang-sql` + `@codemirror/view`'s `lineNumbers`. `src/ui/cells/sql-cell.ts` now renders a textarea first, then async-swaps to CM6 once the chunk lands; per-cell-id `cmInstances` map keeps the editor + its state across notebook re-renders. `disposeSqlCellEditor(cellId)` is called from `Notebook.deleteCell()` for cleanup. Three render paths: existing CM6 instance (reuse), CM6 module already loaded (mount synchronously), first-ever render (textarea + async upgrade). Closes the spec §7.1-vs-§1 tension recorded in DECISIONS 2026-05-15 14:10.
- **DuckDB-wasm SRI pinning** (§7.1 gate "DuckDB-wasm boots from CDN with SRI"). `scripts/fetch-duckdb-fallback.mjs` now sources from `node_modules/@duckdb/duckdb-wasm/dist/` first (CDN fallback when missing) and writes `public/duckdb-fallback/integrity.json` with SHA-384 hashes per file. `src/core/engine.ts` imports the integrity manifest (typed as `Record<string, string | undefined>`); on the CDN path (`!opts.offline`), `fetchWithSri(url, integrity)` fetches the worker JS + wasm bytes with the `integrity` attribute and creates blob URLs. Offline path skips since vendored bytes are trusted (came from the postinstall hook that wrote the manifest).
- **README pass per spec §3.10.** Full rewrite covering: what it is (with full 12-format list); what it isn't; browser support (Chrome / Edge / Opera 122+, Firefox partial, Safari unsupported); quick start (end-user + dev); example data; `.naklidata` file format; taxonomy contribution flow; privacy posture (mentioning SRI verification + workspace IDB persistence + BYOK sessionStorage default with opt-in IDB); license; links to STATUS / DECISIONS / plan / CLAUDE.md.
- **Smoke test updated for CM6.** `scripts/smoke.mjs` now checks both `<textarea>` and `.cm-content` for SQL text, accommodating the lazy-upgrade timing.

### Quality

- `dist/index.html` 320 KB (under 600 KB shell budget); `dist/chunks/codemirror.js` 370 KB lazy; `dist/chunks/_demo.js` 126 bytes.
- `tsc --noEmit` clean. `biome check` 0 errors / 14 warnings (pre-existing noNonNullAssertion in templates).
- 60 vitest + 4 Playwright e2e + headless smoke all green.

### What's next

After tagging v1.0.0:

1. **Theme 3 wave 2** — URL-state sharing (`?lens=<base64>`) + PWA installability + multi-session sidebar.
2. **Theme 2** — visualization upgrade (Observable Plot lazy chunk + MapLibre map cell + pivot table).
3. **Theme 1 wave 3** — sample-data regen + vendor DuckDB extensions for offline smoke.

---

## 2026-05-17 (later) — Theme 1 wave 2 shipped.

### What landed

- **Lazy code-splitting infrastructure.** New `src/lazy/<name>.ts` entries are built standalone into `dist/chunks/<name>.js` by an added esbuild pass. New `src/core/lazy-loader.ts` exposes a typed `loadChunk(name)` that dynamic-imports at runtime — the URL is constructed from a runtime variable so esbuild doesn't inline. Tiny `_demo.ts` chunk verifies the pipeline end-to-end via an e2e spec. Ready for CodeMirror 6 (next push) and Observable Plot / MapLibre (Theme 2).
- **Apache Arrow IPC mount.** `.arrow` / `.feather` files mount via DuckDB-wasm's `insertArrowFromIPCStream` — turns out the `apache-arrow` JS lib isn't needed, DuckDB reads IPC bytes directly. ~30 lines added. `Engine.drop()` is now dual-mode (DROP VIEW then DROP TABLE) since Arrow files become TABLEs while CSV/Parquet/Excel are VIEWs.
- **File picker accept list** extended for `.arrow` / `.feather`.
- **5 new tests** (mount routing for Arrow, lazy-chunk e2e); totals now 60 vitest + 4 e2e.

### Quality

- `dist/index.html` 312 KB (under 600 KB shell budget); `dist/chunks/_demo.js` 126 bytes (tiny demo).
- `tsc --noEmit` clean. `biome check` 0 errors / 14 warnings (pre-existing).
- 60 vitest + 4 Playwright e2e + headless smoke all green.

### Deferred

- Sample-data regen (`.sqlite`, `.xlsx`, `.sas7bdat`) — needs node-sqlite / exceljs / readstat deps; defer to when offline-extension vendoring is also addressed.
- Vendor DuckDB extensions (`sqlite`, `excel`, `read_stat`) into `public/duckdb-fallback/` — needs sandbox-permitted access to community-extensions.duckdb.org which is blocked here.

Both items are testing infrastructure (let the smoke test exercise the new format paths in this sandbox) — production users hit extensions.duckdb.org just fine.

### What's next

1. **Pre-v1.0-tag gates** — first user of the new lazy-splitting infra. CodeMirror 6 as a chunk in `src/lazy/codemirror.ts`, then SRI pinning for DuckDB-wasm, README pass per spec §3.10, tag `v1.0.0`.
2. **Theme 3 wave 2** — URL-state sharing + PWA install.
3. **Theme 2** — visualization upgrade (Observable Plot + MapLibre + pivot table).

---

## 2026-05-17 — Theme 3 wave 1 shipped (persistence wire-up).

### What landed today

- **Unified IDB connection.** `handles.ts` was writing to a different IDB database (`'NakliData'`, case-sensitive) than `idb.ts` (`'naklidata'`). Both now share `openNakliDataDb()` from `idb.ts`. Latent bug fixed before it hurt anyone.
- **Settings persistence.** `loadSettings()` + `saveSettings()` (already in `src/core/settings.ts` as orphan code) are now wired into boot. `autoAcceptThreshold` survives a reload.
- **Workbook auto-save / auto-restore.** New `saveWorkbookSnapshot()` / `loadWorkbookSnapshot()` / `clearWorkbookSnapshot()` in `persistence.ts`. Boot-time `restoreFromIdb()` runs before any auto-save subscriber is installed (avoids race). Snapshot keyed at `workbook/current` in the shared kv store. Same JSON shape as `.naklidata` files; we reuse `serialize()` for fidelity.
- **Silent boot-time restore.** `applyLoadedFile()` got a `{ silent }` option. Boot path uses `queryReadPermissionQuiet` for FSA folder handles (no prompt without user activation); explicit `.naklidata` load still uses `ensureReadPermission`.
- **Debounced auto-save.** 300 ms debounce on workbook + notebook changes. Empty state doesn't write (avoids stale empty snapshots).
- **Two new e2e tests** in `tests/e2e/auto-restore.spec.ts`:
  1. Mount example bundle → reload tab → workbook + assignments restored automatically.
  2. Slider threshold change → reload → restored value present.
  - Plus a `waitForClassificationStable()` helper that polls until the schema-panel column count stops growing (replaces fragile fixed sleeps).

### Quality

- `dist/index.html` 310 KB (under 600 KB shell budget).
- `tsc --noEmit` clean. `biome check` 0 errors / 14 warnings (pre-existing).
- 56 vitest tests + **3 e2e tests** (was 1) all green.
- Headless smoke test green.

### What's next

Theme 3 wave 2 (lower priority):
- URL-encoded query state for sharing
- PWA installability
- Multi-session sidebar

Other open work, in suggested order:
1. **Theme 1 wave 2** — esbuild lazy code-splitting infra, then Apache Arrow IPC via lazy chunk, then vendor DuckDB extensions for offline-grade smoke.
2. **Pre-v1.0-tag gates** — CodeMirror 6 lazy chunk (uses wave 2 splitting), SRI pinning, README pass, tag `v1.0.0`.
3. **Theme 3 wave 2** — URL-state sharing + PWA install.

---

## 2026-05-16 — Theme 1 wave 1 shipped.

### Where things stand

- `main` and `claude/agent-handoff-start-3c2Ib` both at `25ebe14` and pushed.
- v1.0 is feature-complete on `main`; v1.1 work has started.
- Build green (`dist/index.html` 308 KB), 56 vitest tests, headless smoke + Playwright e2e both pass.

### What landed today

| Item | Status |
| --- | --- |
| Repo merged to `main` (was `claude/agent-handoff-start-3c2Ib` only) | ✓ done |
| Spec amendments (persistence + BYOK + plane split + naming) | ✓ in `plan/spec-amendments.md` |
| AI sidecar + BYOK as portfolio-wide hard requirement | ✓ `~/.claude/CLAUDE.md` + project `CLAUDE.md` |
| Enterprise strategy (Compute Bridge, data/control plane, sibling OSS repo) | ✓ in `plan/enterprise-strategy.md` |
| Sidecar architecture (LoRA-Gemma + browser/bridge split + phasing) | ✓ in `plan/sidecar-architecture.md` |
| Filestores-as-database options (5 options ranked) | ✓ in `plan/remote-sources.md` |
| Theme 1 wave 1: SQLite + DuckDB + Excel + SPSS/SAS/Stata via DuckDB extensions | ✓ shipped on `main` (commit `25ebe14`) |

### Theme 1 status

Wave 1 (extensions-based mounts) — done. Six new formats: `.sqlite` / `.db` / `.sqlite3` / `.duckdb` / `.xlsx` / `.sav` / `.zsav` / `.por` / `.dta` / `.sas7bdat` / `.xpt`. Spec §3.1 supported-formats list: 6 → 12.

Wave 2 (deferred) — see the unchecked items in `plan/pending.md` Theme 1:
- Apache Arrow IPC via `apache-arrow` lazy chunk
- Lazy code-splitting infrastructure in esbuild (precondition for the above + CodeMirror 6 + Observable Plot)
- Regenerate sample data with `.sqlite` + `.xlsx` for production smoke
- Vendor `sqlite` / `excel` / `read_stat` DuckDB extensions into `public/duckdb-fallback/` for offline-grade smoke (sandbox blocks `extensions.duckdb.org`)

### Open decisions queued for next session

- **License for `nakli-compute` bridge repo** — leaning Apache 2.0 (per `plan/enterprise-strategy.md` "Open questions"). Final pick needed before the repo is created.
- **Wire protocol for the bridge** — Arrow Flight (canonical) vs HTTP + Arrow IPC (simpler). Probably both; need to confirm.
- **11 agent-seeded taxonomy types** in `taxonomy/v0.1/types.jsonl` (search `seed_origin`) still want human review before v1.0 tag.

### Where to pick up tomorrow

Pick one of these to start the next session:

1. **Theme 1 wave 2** — esbuild lazy code-splitting infra, then Arrow IPC, then vendor extensions for offline smoke. ~1 session. Closes the Theme 1 loop and unblocks Theme 2/4 viz work.
2. **Theme 3 — Persistence wire-up** — connect the orphan `src/core/settings.ts` + `src/core/idb.ts` to boot; auto-save workbook on every change; auto-restore on tab open. Quick win, honors the persistence amendment locked in today. ~1 session.
3. **Pre-v1.0-tag gates** — CodeMirror 6 lazy chunk (needs wave 2 splitting infra) + SRI pinning for DuckDB-wasm + README pass per spec §3.10 + tag `v1.0.0`. Mostly mechanical; closes the v1.0 chapter cleanly.

My recommendation order: **1 → 3 → 2** (build the splitting infra once, reuse it; close v1.0; then unlock the persistence UX win). User may differ.

### Live ledger files

| File | Purpose |
| --- | --- |
| `STATUS.md` | Current build state, deploy state, what's done since last check-in |
| `DECISIONS.md` | Append-only decisions log |
| `CLAUDE.md` | Agent rules for this project + pointer to portfolio rules |
| `~/.claude/CLAUDE.md` | Portfolio-wide rules (AI sidecar + BYOK mandate) |

### Live planning files in this folder

| File | Purpose |
| --- | --- |
| `pending.md` | The open backlog: PondPilot parity, OSS reuse, 6 themed pushes |
| `declined.md` | "Do not borrow" with reasons |
| `spec-amendments.md` | Ratified divergences from the original `02-SPEC.md` |
| `product-shape.md` | Phase model — 4-phase pitch + 7-axis honest view |
| `remote-sources.md` | Filestores-as-database options |
| `enterprise-strategy.md` | Compute Bridge + buyer profiles + deployment paths |
| `sidecar-architecture.md` | LoRA-Gemma phasing + browser/bridge split |
| `progress.md` | This file — session checkpoint journal |

### Sandbox limitation to remember next session

The dev sandbox blocks `extensions.duckdb.org`. Theme 1 wave 1 mounts (sqlite/xlsx/read_stat) require that egress to install extensions on first use. In the user's actual browser, they work fine; in our smoke-test environment they'd fail silently per the per-file-tolerant mount path. Vendoring extensions into `public/duckdb-fallback/` (Theme 1 wave 2) closes this gap and makes the smoke test fully exercise the new format paths.
