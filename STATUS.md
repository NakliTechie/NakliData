## Last update: 2026-05-17T12:00:00Z
## Current milestone: **Theme 2 wave 2 shipped — pivot-table cell** (new cell kind alongside SQL/chart/markdown; in-memory pivot over upstream `lastResult.rows`; sum/avg/min/max/count with row + col + grand totals for sum/count; DECISIONS 17:30). Theme 2 wave 1 (Observable Plot) shipped earlier. Theme 3 wave 2 complete; v1.0.0 tagged. Plan/checkpoint-2026-05-17.md captures the synthesis at end-of-session. Next push: schema-relationship diagram (Cytoscape, smallest remaining Theme 2 item) or map cell (MapLibre + spatial, heaviest).
## Build status: green — `dist/index.html` 332 KB; `dist/chunks/codemirror.js` 364 KB lazy; `dist/chunks/observable-plot.js` 273 KB lazy; `dist/sw.js` 2.7 KB; tsc clean; biome 0 errors / 14 warnings; **84 vitest + 13 Playwright e2e** passing; headless smoke green.
## Branch state: single `main` branch. `v1.0.0` tag pushed.
## Deploy status: not yet deployed; tag is the release source-of-truth.

## Theme 2 progress

  1. ✅ Observable Plot lazy chunk → stacked-bar / area-stacked / heatmap (DECISIONS 13:00). Pie + faceted small-multiples deferred.
  2. ✅ Pivot-table cell — new cell kind, in-memory pivot, sum/avg/min/max/count (DECISIONS 17:30).
  3. Schema-relationship-diagram via Cytoscape.js, fed by `taxonomy/v0.1/relationships.json`. Smallest remaining; recommended next.
  4. MapLibre GL JS + deck.gl lazy chunk → new map cell type. Heaviest remaining; pair with the spatial extension in one push.
  5. DuckDB spatial extension → GeoJSON / Shapefile / KML mount (pairs with the map cell).

After Theme 2:
  - **Theme 1 wave 3** — sample-data regen + vendor DuckDB extensions for offline smoke.
  - **Theme 4** — schema + data quality polish (column-statistics panel, side-by-side data compare, type-override learns, demo/censor mode).

## Theme 3 wave 2 — complete (earlier today)

  1. ✅ URL-state sharing (`?lens=<base64>`) — shipped.
  2. ✅ PWA installability — shipped (lite cache, not full; DECISIONS 11:50).
  3. ✅ Multi-session sidebar — shipped as a header dropdown (DECISIONS 12:10).

## Session highlights — 2026-05-17 (Theme 2 wave 2: pivot-table cell)

- **New cell kind** `'pivot'` alongside SQL / chart / markdown. `PivotCellState` in `src/ui/cells/types.ts` with input/row/col/value/agg pickers. `renderPivotCell` in `src/ui/cells/pivot-cell.ts` (~290 lines).
- **In-memory pivot** over the upstream SQL cell's `lastResult.rows` — same pattern as chart-cell. No extra DuckDB query. `computePivot` is exported pure-function for unit testing.
- **Aggregations**: sum / avg / min / max / count. `count` works without a value column. Row + column + grand totals shown only when totals are semantically meaningful (sum, count) — `hasMeaningfulTotals` flag gates the `<tfoot>` render.
- **Display cap** 200 rows × 50 cols with a "more hidden" footnote. BIGINT + numeric-string coercion; non-numeric values silently dropped for sum/avg/min/max.
- **Notebook** gets a "+ Pivot" toolbar button. `addCell('pivot')` seeds defaults.
- 7 new vitest specs (pure-function pivot logic) + 1 new Playwright e2e (full UI flow: mount → SQL → run → add pivot → pick pickers → assert numeric cells + grand-total tfoot).

## Session highlights — 2026-05-17 (Theme 2 wave 1: Observable Plot lazy chunk)

- New `src/lazy/observable-plot.ts` (~130 lines) dispatches `stacked-bar` / `area-stacked` / `heatmap` to Plot marks. Reuses the existing lazy-loading infra from Theme 1 wave 2 — Plot lives at `dist/chunks/observable-plot.js` (273 KB lazy) and never touches the shell.
- `src/charts/render.ts` gets a `PLOT_TYPES` set + fire-and-forget `loadChunk('observable-plot')` for the new types. Existing 7 hand-rolled chart types unchanged.
- ChartCellState union + chart-cell picker extended with the three new types.
- Heuristics in `mountPlotChart`: `pickCategory` finds a categorical column for the fill channel; BIGINT-from-DuckDB on the y channel coerced to Number so Plot's stack math doesn't choke.
- 2 new Playwright specs in `tests/e2e/plot-chart-types.spec.ts` — chunk-load assertion via `page.on('request')` + SVG-with-marks check after switching chart type; heatmap on bad data falls back without throwing.
- **Single `main` branch now**: the bootstrap `claude/agent-handoff-start-3c2Ib` branch was deleted local + remote after the v1.0 tag pushed.

## Session highlights — 2026-05-17 (Theme 3 wave 2, item 3: multi-session sidebar)

- **`src/core/sessions.ts`** (new) owns the multi-session storage. CRUD over `sessions/index` + per-session snapshot at `sessions/<id>/snapshot`. First-boot migration adopts the legacy `workbook/current` value as the seed session and deletes the old key.
- **`src/main.ts`** boot ends with `ensureActiveSession()` → `refreshSessionSwitcher()` → restore (either `decodeLensParam` or active-session snapshot). New `switchToSession(engine, root, id)` flushes-then-flips so in-flight debounced saves land on the outgoing session. New handlers: `session-menu` / `session-new` / `session-switch` / `session-rename` / `session-delete`. Outside-click closes the dropdown.
- **`src/ui/shell.ts`** + **`src/ui/shell.css.ts`** add the header switcher: trigger chip (active session name + caret) → popup with "New session" + per-session row (switch / rename / delete).
- **`src/core/persistence.ts`** trimmed: removed `saveWorkbookSnapshot` / `loadWorkbookSnapshot` / `clearWorkbookSnapshot` (sessions.ts replaces them). `.naklidata` file save/load surface untouched.
- 13 new vitest specs in `tests/sessions.test.ts` (in-memory IDB shim via `vi.mock`; CRUD + migration + snapshot round-trip). 2 new Playwright specs in `tests/e2e/sessions.spec.ts` (full UI flow + last-session-deletion guard).

## Session highlights — 2026-05-17 (Theme 3 wave 2, item 2: PWA installability)

- **`public/manifest.webmanifest`** declares `name`, `start_url: ./`, `display: standalone`, theme/background colors, single icon with `any maskable` purpose.
- **`public/icon.svg`** — 256×256 brand-mark on accent background, 20% inset for the maskable safe area.
- **`public/sw.js`** (~85 lines, vanilla): precache shell + chunks + manifest + icon + taxonomy worker on `install`; cleanup stale caches on `activate`; SWR for same-origin GETs at runtime; cross-origin pass-through; navigation requests offline → cached `index.html`. DuckDB-fallback bytes (~74 MB) NOT precached — opportunistically cached if the user boots with `?offline=1` once. See DECISIONS 11:50 for why lite-not-full.
- `src/index.html` adds the manifest link, theme-color, application-name. `src/main.ts` registers the SW at window `load` only when `process.env.NODE_ENV === 'production'` (esbuild replaces at build time; DEV skips registration to avoid stale-asset surprises during watch).
- `.webmanifest` (→ `application/manifest+json`) + `.svg` MIME mappings added to both `scripts/smoke.mjs` and the e2e fixture server.
- 2 new Playwright specs in `tests/e2e/pwa.spec.ts` (manifest fetch + parse + maskable icon; SW registers + precaches + serves cached shell when `context.setOffline(true)` + reload).

## Session highlights — 2026-05-17 (Theme 3 wave 2, item 1: URL-state sharing)

- **New `src/core/url-state.ts`** — `encodeLensParam` / `decodeLensParam` via browser-native `CompressionStream('gzip')` + base64url. `buildShareUrl()`, `readLensFromLocation()`, `clearLensFromLocation()` complete the surface. No new dependencies.
- **Boot precedence**: `?lens=` overrides the IDB workbook snapshot. On bad lens, fall back to IDB (not empty state) so a malformed link doesn't wipe the user's work. URL is stripped via `replaceState` after applying — refresh doesn't re-trigger.
- **Share button** in the shell header (next to Save). Action `share-link` serializes the workbook, encodes, copies to clipboard. Soft warning when URL > 7.8 KB (some chat tools truncate).
- 4 new vitest specs in `tests/url-state.test.ts` (round-trip, compression ratio, malformed-base64, non-`.naklidata` payload). 2 new Playwright specs in `tests/e2e/url-state-share.spec.ts` (Share-and-load round-trip with clipboard.writeText stubbed for headless determinism; corrupted-lens fallback).
- `tests/e2e/playwright.config.ts`: env-var aligned with `scripts/smoke.mjs` convention (`PLAYWRIGHT_CHROMIUM_PATH`, fallback to legacy `CHROMIUM_PATH`, fallback to Playwright bundled chromium). Capped at `workers: 2` — default `workers: N-cores` caused intermittent engine-boot timeouts from parallel DuckDB-wasm boots.

## Session highlights — 2026-05-17 (desktop pickup, tag landed)

- **v1.0.0 tag pushed** — annotated tag at `5b10b93` per `plan/v1.0-handoff-notes.md`. Web session created the tag locally but couldn't push (sandbox 403 on tag pushes); desktop session landed it cleanly.
- **GitHub default branch switched to `main`** — was the bootstrap leftover `claude/agent-handoff-start-3c2Ib`. Both branches stay tracked.
- **Smoke script made portable** — `scripts/smoke.mjs` no longer hardcodes the sandbox chromium path. Uses `PLAYWRIGHT_CHROMIUM_PATH` env var if set; otherwise lets Playwright pick the bundled chromium. DECISIONS entry at 2026-05-17 11:10.
- Desktop-handoff checklist passed end-to-end: install (postinstall vendored DuckDB + integrity.json), check (clean, 14 expected biome warnings), test (60/60), smoke (all 12 assertions; mounted 4 source tables = sandbox's 3 + the JSONL log that needs `extensions.duckdb.org`), build size under budget.

## Session highlights — 2026-05-17 (pre-tag bundle)

- **CodeMirror 6 returns as a lazy chunk.** `src/lazy/codemirror.ts` exports `mountSqlEditor(host, opts)` (SQL syntax + autocomplete + line numbers). `src/ui/cells/sql-cell.ts` renders a textarea first and asynchronously upgrades to CM6 once the chunk lands; per-cell-id `cmInstances` map preserves editor state across notebook re-renders. `disposeSqlCellEditor(cellId)` released on cell delete. Shell stays under the 600 KB gate (320 KB); CM6 chunk is 370 KB, fetched only when a SQL cell renders. Closes the §7.1 vs §1 spec tension recorded in DECISIONS 2026-05-15 14:10.
- **DuckDB-wasm SRI pinning.** `scripts/fetch-duckdb-fallback.mjs` now sources from `node_modules/@duckdb/duckdb-wasm/dist/` first (with CDN fallback) and writes `public/duckdb-fallback/integrity.json` with SHA-384 hashes per file. `src/core/engine.ts` imports the integrity manifest and, on the CDN path (`!opts.offline`), calls `fetchWithSri(url, integrity)` for the worker JS + wasm before passing them to DuckDB as blob URLs. Closes the §7.1 gate artifact "DuckDB-wasm boots from CDN with SRI."
- **README pass per spec §3.10.** Full rewrite: what it is, what it isn't, browser support (Chrome/Edge/Opera 122+ / Firefox partial / Safari unsupported), quick start (end-user + dev), example data, `.naklidata` format, taxonomy contribution flow, privacy posture (SRI verification + workspace IDB persistence + BYOK sessionStorage default with opt-in IDB), license, links to STATUS / DECISIONS / plan / CLAUDE.md.

## Session highlights — earlier 2026-05-17

- Theme 1 wave 2: lazy code-splitting infra + Apache Arrow IPC mount. 5 new tests; spec §3.1 formats list at 13.
- Theme 3 wave 1: workspace state auto-saves + auto-restores from IDB (per spec amendment A1). 2 new e2e tests.

## Sandbox limitation
Dev sandbox blocks `extensions.duckdb.org` so Theme 1 mounts requiring DuckDB extensions can't be exercised in the local smoke. User's browser works fine; vendoring extensions (Theme 1 wave 3) closes the local gap.
