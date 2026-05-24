# NakliData Backlog

Working list of features to consider, drawn from competitive recon. Items are tagged by status:

- ✅ **shipped** — already in v1.0
- 🗓️ **planned** — in spec or build order
- 🆕 **new** — added from this research; not in spec yet
- 🚫 **declined** — explicit "do not borrow", reason given

Each item names the mature OSS component to reuse (no point reinventing).

Sources for the survey are at the bottom.

---

## Persistence posture

Workspace state persists across tabs (IndexedDB + FSA where the user has granted permission). BYOK keys (v1.1) have a two-tier opt-in model. Both diverge from the original spec — see [spec-amendments.md](./spec-amendments.md) for the formal amended wording.

## Sidekicks to read alongside this file

- [remote-sources.md](./remote-sources.md) — the filestores-as-database question: what v1.1 Relay covers, where it falls short, and the five options (lakehouse catalogs, S3-compatible endpoints, Compute Bridge, DB Relay, edge compute) for closing the gap.
- [sidecar-architecture.md](./sidecar-architecture.md) — base model vs LoRA-tuned specialist: when (and when not) to ship LoRA-finetuned Gemma 4 as the sidecar; the eval-harness foundation; the new report-recommendation job.
- [product-shape.md](./product-shape.md) — the seven-axis view of the product, used for scoping.
- [spec-amendments.md](./spec-amendments.md) — every ratified divergence from the original `02-SPEC.md`.

---

## Workplan — next three waves (2026-05-24 snapshot)

This section is the load-bearing roadmap. Themes below (Theme 1 / 2 / 3 / 4 / 6) are the historical detail; the waves here are what's actually queued. Item-level detail in the themed sections is kept for cross-reference.

### Wave 1 — Close v1.1 cleanly + small polish — ✅ closed (2026-05-24) except W1.4 (deferred) + W1.6 (stretch)

**Pitch:** "Tag the version that already shipped; do the housekeeping; bag the cheap Theme-2 polish items."

- [x] **W1.1** — `v1.1.0` tag pushed 2026-05-24 at commit `04feedc`. `plan/v1.1.0-release-notes.md` is the canonical changelog (27 commits since v1.0.0).
- [x] **W1.2** — README v1.1 refresh landed in commit `04feedc` (Theme 2 surfaces + Theme 3 wave 2 + Theme 4 + AI sidecar + vendored extensions + pie + facet; formats 13 → 15; taxonomy 40 → 41).
- [x] **W1.3** — v1.0 review carryover (commit `bc78d4a`): CM6 EditorView dispose loop, `tests/sri-integrity.test.ts` (manifest ↔ bytes + negative tamper), save-load flake confirmation, taxonomy editorial pass (41 types, CIN regex fix, iso3 noise removal, UUID added).
- ~~**W1.4** — naklios.dev Immersive same-origin mirror~~. **Dropped 2026-05-24** — NakliData positions as an independent product. Tying discoverability to the `nakli-dev` launcher is no longer in scope. See `declined.md` for the longer note.
- [x] **W1.5** — Theme 2 polish pickups (commit `983827f`): pie chart (custom SVG arc renderer) + faceted small-multiples (third facet-by picker; Plot uses native `fy`, pie partitions into a grid).
- [ ] **W1.6** *(stretch)* — Map cell basemap with CSP carve-out for OSM tiles + UI to pick the basemap. **Not started; defer until requested** — touches privacy posture, warrants a real decision.
- [x] **W1.7** *(post-tag)* — `applyLoadedFile` re-entrancy fix (commit `8742b2c`). The v1.1.0 release notes flagged the race (boot-time auto-restore racing an explicit Load click → 4 source cards instead of 2) as deferred; module-level promise-chain mutex in `src/main.ts` serialises all three callers. e2e save-load reverts the IDB-clear workaround and now exercises the race directly. See DECISIONS 2026-05-24 13:00.

**Bonus (also landed 2026-05-24, commit `7a73bc4`):** Latent CSP-hash bug in `esbuild.config.mjs` — `String.prototype.replace` was interpreting `$&` in the minified script body as the matched substring, drifting the inlined CSP hash off the actual bytes. Fix is function-form replacers. The Wave 1 pie + facet additions tipped the minified bundle across the threshold where `$&` first appeared, which surfaced it.

**Post-v1.1.0 housekeeping queued (small):**
- [ ] **W1.8** — GitHub Pages deploy workflow. **Deferred — not near needing it.** A hosted build would be nice eventually but the runtime is the static page itself; users self-host. Pick up when we want a canonical hosted entry-point.
- [ ] **W1.9** — Doc-cadence decision. We now have *both* `checkpoint-YYYY-MM-DD-eod.md` (pre-windup pattern) and `YYYY-MM-DD-summary.md` (windup output). Pick one going forward.
- [ ] **W1.10** — `.naklidata` format-version policy note. Document when a `1.1` bump is warranted (breaking change to a required field) vs additive-optional fields that round-trip cleanly. One paragraph in `spec-amendments.md` or `DECISIONS.md`.
- [ ] **W1.11** — Cytoscape modal focus restoration. Quick a11y audit of `src/ui/schema-graph.ts` — keyboard focus may not return to the trigger button on close.

### Wave 2 — Strategic v1.2: lakehouse + endpoint flexibility

**Pitch:** "Open the lakehouse and BYO-model doors. No new core deps."

Full strategic context in [enterprise-strategy.md](./enterprise-strategy.md) §"v1.2 precursors" and [remote-sources.md](./remote-sources.md).

- [ ] **W2.1** — Apache Iceberg REST + OAuth2/Bearer/SigV4 via DuckDB's `iceberg` extension (browser HTTP load works as of Dec 2025). New source kind `iceberg-catalog`; auth via either Bearer token, OAuth2 device-code flow, or AWS SigV4 (for Glue).
- [ ] **W2.2** — S3-compatible custom endpoints via DuckDB `httpfs`. UI source kind `s3-endpoint` with fields for endpoint URL, region, access key, secret. Supports MinIO, Cloudflare R2, Backblaze B2, Wasabi out of the box. BYOK secrets policy mirrors sidecar BYOK (session default + opt-in IDB).
- [ ] **W2.3** — Custom-endpoint sidecar. New provider kind `custom-openai-compatible`; user supplies a URL + model name. CSP rework: replace explicit-host whitelist with a runtime-allow-list driven by configured provider URLs (or use a meta-CSP refresh pattern).
- [ ] **W2.4** — Sidecar eval harness ([sidecar-architecture.md](./sidecar-architecture.md) §"v1.2 — build the eval harness"). Held-out per-job evaluation set + a runner that scores prompted-base vs. prompted+LoRA on the same set. Lays the foundation for v1.3 LoRA work. Outputs an HTML report. No new runtime dependency in the main app; lives under `eval/`.
- [ ] **W2.5** — Spec amendments for Iceberg + S3 custom endpoints. New `plan/spec-amendments.md` entries.
- [ ] **W2.6** *(stretch)* — Map cell deck.gl pairing (for >10k-point rendering) if a real workload shows up during W2.

### Wave 3 — Sidecar maturation + Compute Bridge MVP

**Pitch:** "A 4th sidecar job + a local model path + the Compute Bridge — the v1.3 enterprise launch."

Full strategic context in [enterprise-strategy.md](./enterprise-strategy.md) §"Compute Bridge — sibling OSS project" and [sidecar-architecture.md](./sidecar-architecture.md) §"AI in the browser vs AI in the bridge".

- [ ] **W3.1** — Job 4: report-template recommendation. Per `plan/sidecar-architecture.md`. Browser-side, structured-output only (template-ids ranked by fit), no prose. Wired into the schema panel's "Suggested reports" section as an "Ask sidecar to rank" affordance.
- [ ] **W3.2** — Local-model path. Transformers.js + a Phi-3-mini-class model at 4-bit (~150 MB OPFS-cached). Opt-in via Settings; fallback to BYOK when not downloaded. Adds a new sidecar transport in `src/core/sidecar/`.
- [ ] **W3.3** — Compute Bridge MVP (sibling OSS project `NakliTechie/nakli-compute`, Apache-2.0 lean). Single binary + Docker image. Arrow Flight + HTTP wire protocol. Bearer-token auth. Bridge-side sidecar uses a heavier LoRA-Gemma weight (Gemma 4 E4B at 4-bit, ~2.5 GB on bridge disk).
- [ ] **W3.4** — `compute-bridge` source kind in NakliData's mount layer. Discovery + connection flow; falls back gracefully when bridge is unreachable.
- [ ] **W3.5** — Routing logic for jobs that benefit from the bridge (batch classification of 10k+ columns, heavy semantic search). Browser-side stays the baseline; bridge-side is the enhancement layer.
- [ ] **W3.6** *(stretch / opportunistic)* — Resume vendoring `excel` + `read_stat` extensions if/when DuckDB-wasm bumps to a version where they're published for wasm_eh. Resume SQLite ATTACH-on-wasm work if the upstream VFS bridge lands.

### Deferred / blocked / out-of-scope for these three waves

Listed here so they don't get re-discovered as "what about…":

- **Excel + read_stat DuckDB extensions** — blocked on DuckDB-wasm version bump (not published for v1.1.1/wasm_eh).
- **SQLite mount on wasm** — blocked on the sqlite_scanner extension bridging to DuckDB-wasm's VFS. Fixture lives at `tests/e2e/fixtures/sample-data/finance.sqlite` for when it lands.
- **`.xlsx`, `.sas7bdat` fixtures** — depend on the two above.
- **Shapefile mount** — needs a multi-file FSA picker which the FSA spec doesn't support today.
- **v1.4 multi-team OAuth2 + shared-taxonomy hub** — see `plan/enterprise-strategy.md`. Comes after W3.
- **v2.0 DB Relay** — Postgres / MySQL / Snowflake / BigQuery via stateless user-deployed proxy.
- **v2.x edge compute** — Cloudflare Worker / AWS Lambda DuckDB deployment.
- **Embeddable `<nakli-data-widget>`** — v2.1 roadmap item.

### Wave-1 / 2 / 3 themed in the existing backlog

The themed sections below carry the historical detail. Cross-reference if needed:

| Wave | Themed sections | What's done | What's queued |
| --- | --- | --- | --- |
| Wave 1 | Pre-v1.0-tag gates ✅, Theme 4 ✅, Theme 1 wave 3 ✅, Wave 1 polish ✅, v1.0 review carryover ✅, v1.1.0 tag ✅, README v1.1 ✅, applyLoadedFile mutex ✅ | All in-scope items shipped + v1.1.0 tagged + post-tag mutex follow-up | **W1.4 mirror** + **W1.8 GH Pages deploy** (deploy unblocks mirror); W1.6 basemap stretch deferred |
| Wave 2 | Theme 6 v1.2 precursors, AI sidecar custom-endpoint | none yet | Iceberg, S3 endpoints, custom-endpoint sidecar, eval harness |
| Wave 3 | Theme 6 v1.3 (Compute Bridge), AI sidecar local-model + LoRA | none yet | Job 4, local model, bridge MVP, bridge-side sidecar |

---

## A. PondPilot feature parity

[PondPilot](https://github.com/pondpilot/pondpilot) is our most direct competitor (AGPL-3.0, 100% client-side, DuckDB-wasm). Their feature surface, mapped to ours:

### Data sources

| Feature | Status | NakliData path |
| --- | --- | --- |
| CSV / TSV / Parquet / JSON | ✅ | DuckDB native |
| Excel `.xlsx` | 🗓️ build-order §12 | DuckDB `excel` core extension (NOT SheetJS — DuckDB extension avoids the cdn.sheetjs.com block we hit) |
| DuckDB `.duckdb` files | 🗓️ | DuckDB `ATTACH` |
| SQLite `.db` / `.sqlite` | 🗓️ build-order §12 | DuckDB `ATTACH` via sqlite extension |
| SPSS `.sav` / `.zsav` / `.por` | 🆕 | [`duckdb-read-stat` community extension](https://duckdb.org/community_extensions/extensions/read_stat) — confirmed to ship a WASM build per community-extensions CI; PondPilot uses this exact path |
| Stata `.dta` | 🆕 | Same extension |
| SAS `.sas7bdat` / `.xpt` | 🆕 | Same extension |
| Apache Iceberg with REST + OAuth2 + Bearer + SigV4 | 🆕 | DuckDB iceberg extension; HTTP load works in browser (Dec 2025) |
| S3-compatible storage with custom endpoint | 🗓️ v1.1 §4.1 + Relay | DuckDB httpfs + our Relay for signing |
| HTTP/HTTPS Parquet/CSV/JSONL | 🗓️ v1.1 §4.1 | DuckDB httpfs |
| Clipboard paste (CSV / JSON) | 🆕 | Native `navigator.clipboard.read()` + parse + DuckDB register |
| HTML table paste | 🆕 (proposed) | `DOMParser` walk → CSV register |
| PDF table extraction | 🚫 | Fragile; defer indefinitely. Vision: "show me what I have", not "OCR my PDFs". |

### Query / editor

| Feature | Status | NakliData path |
| --- | --- | --- |
| SQL editor | ✅ (textarea first-cut) | [CodeMirror 6](https://codemirror.net/) as lazy chunk (decision log 14:10); already planned |
| Syntax highlighting | 🆕 | CodeMirror SQL mode |
| Autocomplete on tables/columns | 🗓️ spec §3.3 | CodeMirror autocomplete + DuckDB INFORMATION_SCHEMA |
| Query error annotations inline | ✅ | (DuckDB error → editor decoration) |
| AI-suggested SQL fix | 🚫 | Vision §"What it is not": no prose / no auto-suggestion. Sidecar Job 2 (Explain error) is the allowed analog — spec §4.3 |
| Natural-language → SQL | 🚫 | Same — vision forbids |
| SQL data lineage / column-level dependencies | 🆕 | DuckDB EXPLAIN + custom renderer; matches our `@cellName` reference DAG |

### Visualization

| Feature | Status | NakliData path |
| --- | --- | --- |
| Bar / line / area / scatter / histogram / stat / table | ✅ (custom canvas+SVG) | — |
| Pie | 🆕 | Add to custom renderer (small) |
| Stacked bar | 🆕 | Add to custom renderer |
| Horizontal bar | 🆕 | (have it; PondPilot lists it separately) |
| Pivot tables | 🆕 | [Huey](https://github.com/rpbouman/huey) proves it works inline with DuckDB; either embed [pivottable.js](https://pivottable.js.org/) (MIT, well-known) or roll a thin layer using DuckDB GROUP BY CUBE |
| Heatmap | 🆕 | Add to custom renderer (SVG cells) |
| Map cell (GeoJSON / Shapefile) | 🆕 | [MapLibre GL JS](https://maplibre.org/) for the base map; [deck.gl](https://deck.gl/) layered on top for large-point datasets. Honeycomb Maps does this with DuckDB-wasm directly |
| Schema relationship diagram | 🆕 | Mini-map navigation. Our `taxonomy/v0.1/relationships.json` is the seed; render with [Cytoscape.js](https://js.cytoscape.org/) or `vis-network` |

> **Charting library decision still open.** Custom canvas+SVG is fine for the 7 chart types we ship. If we add 5+ more (pie, stacked, heatmap, map, pivot) the calculus shifts. Realistic choices in priority order:
> - **[Observable Plot](https://observablehq.com/plot/)** — ESM, ~150 KB gzip, declarative, MIT, the cleanest Vega-Lite-derived API for ad-hoc charts.
> - **[Apache ECharts](https://echarts.apache.org/)** — Canvas, very fast on large data, ~300 KB gzip, Apache 2.0. Heavier but most chart types out-of-box.
> - **[Vega-Lite](https://vega.github.io/vega-lite/)** — declarative spec, but the runtime is ~600 KB. Too heavy for our shell budget.
> Recommendation: **Observable Plot** as a lazy chunk; same approach we'll use for CodeMirror 6. Keeps shell ≤ 600 KB; charts cell triggers the lazy load.

### Data comparison + schema

| Feature | Status | NakliData path |
| --- | --- | --- |
| Side-by-side data compare with auto join-key detection | 🆕 | DuckDB `EXCEPT` + `INTERSECT` + diff rendering |
| Schema diff between two tables | 🆕 | DuckDB DESCRIBE compare; small UI |
| Schema browser with mini-map | 🆕 | Cytoscape.js + our relationships.json |
| Multiple join strategies UI | 🆕 | Generates SQL with `LEFT JOIN` / `INNER JOIN` / `FULL OUTER JOIN` toggles |

### Export

| Feature | Status | NakliData path |
| --- | --- | --- |
| CSV / Parquet write | ✅ | DuckDB COPY TO |
| TSV / XLSX / SQL / XML / Markdown write | 🆕 | DuckDB COPY for TSV/XLSX/SQL; custom for XML/Markdown |
| Format conversion (right-click → "save as Parquet") | 🆕 | Same plumbing |
| KanZen / Bahi / NakliPoster | ✅ | — (our differentiator) |

### Persistence + sharing

| Feature | Status | NakliData path |
| --- | --- | --- |
| `.naklidata` file save/load | ✅ | — |
| Cross-session auto-save of queries + data handles | 🆕 | IDB-backed (the `idb.ts` + `settings.ts` modules already laid down; action 4 wires them) |
| PWA installable + offline | 🆕 | `manifest.webmanifest` + service worker caching the shell + DuckDB-fallback |
| URL-encoded query state (`?lens=<base64>`) | 🆕 | Pattern from [Huey](https://github.com/rpbouman/huey); compatible with privacy posture (no data, only the description) |
| Embeddable widget (`<nakli-data-widget src="...">`) | 🗓️ v2.1 roadmap | [PondPilot widget](https://github.com/pondpilot/pondpilot-widget) is the working example; same approach (lazy-load DuckDB, render SQL block as interactive cell) |

### Security + AI

| Feature | Status | NakliData path |
| --- | --- | --- |
| Encrypted secret store (BYOK in IndexedDB w/ AES-GCM) | 🚫 | **We deliberately use sessionStorage only** (spec §4 Hard NOT 8 + spec §2.3). PondPilot's encrypted IDB persists across tabs; that's a different tradeoff we're explicitly not making. |
| Multi-provider AI (OpenAI / Anthropic / custom) | 🗓️ v1.1 §4.3 | Pattern from OpenPlanter (lessons doc item 4) |
| CORS proxy support | 🗓️ v1.1 §4.2 | Our Relay primitive |

### UX

| Feature | Status | NakliData path |
| --- | --- | --- |
| Dark / light mode + system pref detect | 🆕 | `prefers-color-scheme` + token alts in `src/tokens/colors.ts` |
| Cmd/Ctrl+K spotlight | 🗓️ spec §3.8 | — |
| Cmd+S save | ✅ | — |
| Ctrl+F add file | 🆕 | Trivial |
| Ctrl+I SQL import | 🆕 | — |

---

## A.5 Second wave of contemporaries

Survey beyond the immediate DuckDB-wasm neighborhood. Each entry: what they do that's worth pulling into NakliData's thinking.

### [Frictionless Data — Table Schema](https://specs.frictionlessdata.io/table-schema/)

Published, language-agnostic standard for describing tabular data: per-field `type` (string/number/integer/date/boolean/object/array/...), constraints (range, regex, enum), and `primaryKey` / `foreignKeys` for cross-table relationships. EU Commission uses it.

**For NakliData:**
- 🆕 Align our taxonomy types' shape with Table Schema so a `.naklidata` file can also be exported as a Frictionless `datapackage.json`. Interop with R `frictionless`, Python `tableschema`, etc.
- 🆕 Import Table Schema descriptors as taxonomy seeds (each `field.type` + constraints becomes a user-defined type).

### [Cube.dev](https://github.com/cube-js/cube) — open-source semantic layer

JavaScript-based data-modeling language defining "cubes" (entities) with measures + dimensions + relationships. Reactive — model mutates at runtime. APIs: REST, GraphQL, SQL. Apache 2.0.

**For NakliData:**
- 🆕 Pattern for taxonomy v2 evolution: cubes-as-code, version-controlled, reviewable. Our `taxonomy/v0.1/types.jsonl` is a precursor to this; the next iteration could borrow Cube's measure/dimension distinction (which columns are aggregatable vs which are categorical) — already implicit in our typeIds but not first-class.
- 🚫 Cube's actual code-base requires a server runtime; not adoptable. Pattern only.

### [OpenRefine](https://openrefine.org/) — the legacy elephant for data cleanup

Desktop Java tool, but the *features* are gold standard for messy data:
- **Clustering** — fuzzy matching across column values (Key Collision, Nearest Neighbor methods) to dedup "Sharma Trading Co" vs "Sharma Trading Co." vs "SHARMA TRADING CO".
- **Faceting** — interactive subset filtering by column value, with live histograms.
- **Reconciling** — match values against an external authoritative database (Wikidata, custom).
- **Infinite undo/redo** of every transform.

**For NakliData:**
- 🆕 Clustering as a transform suggestion in the schema panel: "Detected 5 spelling variants of `vendor_name`. Merge?" — fits perfectly with our "schema panel is the most important surface" thesis. Use [`fastest-levenshtein`](https://www.npmjs.com/package/fastest-levenshtein) or [`string-similarity`](https://www.npmjs.com/package/string-similarity) (both MIT, small).
- 🆕 Faceting as a fourth cell type — pick a column, get an interactive filter UI with live value-count histogram. Auto-applies as a `WHERE` on downstream cells.
- 🆕 Reconciliation against the taxonomy: for `gstin` columns, optionally check the [GSTN portal status API](https://services.gst.gov.in/) (browser-restricted; via Relay in v1.2). For `hsn_code`, check against the CBIC HSN list (vendored JSON).
- 🚫 Don't borrow OpenRefine's UI — its 2010-era Java applet aesthetic is dated. The features, not the look.

### [Datasette Lite](https://github.com/simonw/datasette-lite) — pyodide-in-browser precedent

Simon Willison runs full server-side Datasette inside Pyodide in a Web Worker. CSV/JSON/SQL/Parquet load from URLs. Plugin install via `?install=plugin-name`. Self-hostable NPM package.

**For NakliData:**
- 🆕 Plugin model — `?install=...` URL param could install community extensions or user-defined types into a session at boot. Lightweight precedent.
- 🚫 We don't need Pyodide — DuckDB-wasm gives us the same query power at a fraction of the bundle.

### [Datasette enrichments framework](https://simonwillison.net/2023/Dec/1/datasette-enrichments/)

Code that runs against rows in a table, transforming or augmenting them. Examples: jinja template per row, regex extraction per row, fetch external data per row.

**For NakliData:**
- 🆕 A **transform cell** as a fifth cell type: takes an upstream cell, applies a per-row JS function, emits a new view. Deterministic, user-triggered (not auto). Aligns with vision's "no auto-execute" — user clicks Run.
- Useful for: extract domain from email, parse date strings, derive `gst_state_code` from `gstin[0..2]`, etc.

### [Briefer](https://github.com/briefercloud/briefer) — notebook BI with interactive inputs

Notebook + dashboard hybrid. AGPL-3.0. SQL + Python + Markdown cells. Key UX move: **interactive inputs** (dropdowns, date pickers) turn notebooks into lightweight data apps.

**For NakliData:**
- 🆕 Interactive-input cells: parameterize an SQL cell with a value picker, runs reactively when the input changes. Composes cleanly with `@cellName` references. (Vision's "no narration" doesn't prohibit user-driven interactivity.)
- 🚫 Don't borrow the multiplayer / scheduling / writeback features — out of scope.

### [Evidence Dev](https://github.com/evidence-dev/evidence) — BI-as-code with markdown

MIT. Static-site generator: SQL + Markdown → polished HTML reports. Components for charts/tables embedded as simple syntax. Auto-chart-type selection.

**For NakliData:**
- 🆕 Static export of a `.naklidata` notebook to a self-contained HTML report (no engine needed for the read-only published view — pre-rendered chart SVGs + tables). Closes the loop: "describe → query → publish."
- 🆕 Markdown cell shortcodes: `{{vendor_spend.row_count}}` references upstream cell results inline. Spec §3.3 already mentions this in passing.

### [Recap](https://recap.build/) — multi-format schema extraction

Python lib + HTTP gateway. Extracts schemas from Postgres / Avro / Parquet / Protobuf / JSON Schema files and converts between them.

**For NakliData:**
- 🆕 "Save my taxonomy as JSON Schema" / "Export my workbook's column types as Avro schema" → interop with other tools' schema-management workflows. Cheap feature with high "did not expect this" value for the data-engineering audience.

---

## B. Mature OSS components to adopt (reuse, don't rebuild)

Component-by-component, what we should pull in vs keep custom:

| Concern | Recommended | Why | Bundle cost |
| --- | --- | --- | --- |
| SQL editor | [CodeMirror 6](https://codemirror.net/) — `@codemirror/lang-sql` + autocomplete | Spec calls it out; lazy chunk, not in shell | ~250 KB gzip lazy |
| Charts (basic) | Keep custom canvas+SVG for the v1.0 seven | Tiny, matches Rangrez palette discipline | 0 |
| Charts (full) | [Observable Plot](https://github.com/observablehq/plot) lazy chunk for pie/stacked/heatmap | MIT, declarative grammar, ~150 KB gzip | ~150 KB lazy |
| Maps | [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js) + [deck.gl](https://deck.gl/) for >10k points | BSD-3 / MIT, vector tiles, no Mapbox token | ~700 KB lazy (only when map cell used) |
| Pivot tables | [PivotTable.js](https://pivottable.js.org/) (MIT) OR write our own thin wrapper over DuckDB `GROUP BY CUBE` | Library has 2k+ rows of jQuery cruft; for fresh code, our own DuckDB-backed pivot may be cleaner | depends |
| Markdown rendering | Keep our hand-rolled minimal subset | 60 lines vs marked/markdown-it's 50 KB; sufficient for notebook annotations | 0 |
| Statistical format reading | [`duckdb-read-stat` community extension](https://github.com/mettekou/duckdb-read-stat) | SAS / SPSS / Stata in one extension; WASM build via community-extensions CI; PondPilot confirms it works in-browser | extension fetched on demand |
| Iceberg / Delta tables | DuckDB `iceberg` + `delta` core extensions | First-class browser support since Dec 2025 | extension fetched on demand |
| Spatial / geo SQL | DuckDB `spatial` core extension | Loads in wasm; reads GeoJSON / Shapefile / KML | extension fetched on demand |
| Schema graph viz | [Cytoscape.js](https://js.cytoscape.org/) | Same lib OpenPlanter uses for its knowledge graph; rich layout algos | ~250 KB lazy (only when schema-graph view opened) |
| State store | Our 30-line `Store<T>` is correct shape | Confirmed via OpenPlanter recon | 0 |
| Icons | Phosphor vendored as SVG path | Already shipped | 0 |
| Colors | Rangrez subset | Already shipped — tokens are the source of truth | 0 |

### A note on "lazy chunks"

Most of the heavy adds above are gated behind features the user has to opt into (open a map cell → load MapLibre; open a pivot cell → load pivot lib; SQL cell → load CodeMirror). This keeps the shell ≤ 600 KB while still allowing best-of-class deep dives.

The build-pipeline work to support this (esbuild splitting + service-worker chunk caching) is itself a backlog item: **"Wire lazy code-splitting in esbuild config"**. Once that's done, CM6, Observable Plot, MapLibre, Cytoscape can all ship as separate chunks fetched on demand.

---

## C. Themed roadmap proposals

Bundle the items above into 4 coherent themes; each is one or two commits:

### Theme 1 — Format-import expansion ⏳ in progress (2026-05-16)

**Pitch:** "Drop a folder; everything mounts."

Tracking checklist — tick as items land:

- [x] Engine: `ensureExtension(name, 'core' | 'community')` helper — idempotent INSTALL+LOAD, scoped allow-unsigned per community extension
- [x] Mount: SQLite `.db` / `.sqlite` via DuckDB `ATTACH` (multi-table, one view per SQLite table)
- [x] Mount: DuckDB `.duckdb` file via `ATTACH` (multi-table)
- [x] Mount: Excel `.xlsx` via DuckDB `excel` extension (multi-sheet, one view per sheet; replaces the deferred SheetJS dep — kills the `cdn.sheetjs.com` block)
- [x] Mount: SPSS `.sav` / `.zsav` / `.por`, Stata `.dta`, SAS `.sas7bdat` / `.xpt` via the `read_stat` community extension (the PondPilot path)
- [x] `registerFileByFormat` returns `string[]` so multi-table mounts populate `MountedSource.tables` correctly
- [x] File-picker `accept` list extended for all new extensions
- [x] `tests/mount.test.ts` covers detectFormat for every new extension + format-routing via mock engine (36 → 40 tests)
- [x] DECISIONS.md: community-extension trust posture logged (2026-05-16 05:50)
- [x] **Lazy code-splitting infrastructure in esbuild** — `src/lazy/<name>.ts` → `dist/chunks/<name>.js`; `src/core/lazy-loader.ts` with typed `loadChunk(name)`; demo chunk `_demo.ts` verifies end-to-end via e2e. Ready for CodeMirror 6 + Observable Plot + future chunks.
- [x] **Mount: Apache Arrow IPC** (`.arrow` / `.feather`) — turns out `apache-arrow` JS isn't needed; DuckDB-wasm's `insertArrowFromIPCStream` reads IPC bytes directly. Creates a TABLE (not a view), so `drop()` is now dual-mode (DROP VIEW then DROP TABLE). No new dep, ~30 lines.
- [~] Sample data: regenerate to include `.sqlite` + `.xlsx` (and ideally a small `.sas7bdat`) so the smoke + e2e tests cover the new mounts in production
  - [x] `.sqlite` fixture generated (Node `node:sqlite`) at `tests/e2e/fixtures/sample-data/finance.sqlite` — but NOT in the auto-loaded example bundle. SQLite ATTACH on duckdb-wasm fails (VFS bridge limitation, see DECISIONS 2026-05-23). Mount works in native DuckDB; defer auto-load until upstream bridge work lands.
  - [ ] `.xlsx` fixture — blocked on the same vendoring step (the `excel` extension isn't published at extensions.duckdb.org for v1.1.1/wasm_eh — we'd need to bump DuckDB-wasm or find an alternative source).
  - [ ] `.sas7bdat` fixture — blocked on `read_stat` community extension not being available for our wasm revision.
- [~] Vendor a small set of DuckDB extensions (`sqlite`, `excel`, `read_stat`) into `public/duckdb-extensions/` for offline-grade smoke testing
  - [x] `json` (680 KB) vendored at `public/duckdb-extensions/v1.1.1/wasm_eh/` — unblocks the JSONL access-log mount in offline smoke. Smoke now asserts 4 tables (was tolerant 3).
  - [x] `sqlite_scanner` (1.6 MB) + `sqlite` alias copy vendored — extension loads but `ATTACH` fails due to VFS bridge (see DECISIONS 2026-05-23). Vendored for the day it's fixed.
  - [x] `engine.boot({ offline: true })` sets `custom_extension_repository = '${origin}/duckdb-extensions'` so DuckDB picks up the vendored bytes.
  - [x] `tests/e2e/offline-extensions.spec.ts` asserts zero `extensions.duckdb.org` fetches under `?offline=1`.
  - [ ] `excel` + `read_stat` deferred — not published at extensions.duckdb.org for v1.1.1/wasm_eh.

Wave 2 result: spec §3.1 supported formats list at 13 (CSV, TSV, JSONL, Parquet, Arrow IPC × 2 exts, SQLite × 3 exts, DuckDB, Excel, SPSS × 3 exts, Stata, SAS × 2 exts). The two remaining items are testing-infrastructure work, not new features.

### Theme 2 — Visualization upgrade ✅ complete (2026-05-17)

**Pitch:** "From 7 chart types to 14, plus a map cell."

- [x] Lazy code-splitting infrastructure in esbuild (shipped 2026-05-17 as part of Theme 1 wave 2).
- [x] Observable Plot lazy chunk — adds **stacked-bar**, **area-stacked**, **heatmap** (shipped 2026-05-17; DECISIONS 13:00). Pie + faceted small-multiples deferred — Plot doesn't ship a pie mark by design; faceting needs a third "facet-by" column picker on the chart cell.
- [x] MapLibre GL JS lazy chunk → new map cell type. No basemap (CSP-clean, privacy-clean); deck.gl pairing deferred until point-density work appears. DECISIONS 2026-05-17 18:30.
- [x] DuckDB spatial extension → GeoJSON + KML mount via `ST_Read`. Shapefile deferred (needs the multi-file `.shp + .dbf + .shx` bundling which the FSA single-file picker can't deliver cleanly).
- [x] Pivot-table cell type — new cell kind alongside SQL/chart/markdown, in-memory pivot over the upstream SQL cell's `lastResult.rows` (no extra DuckDB query needed). Row × col × value with sum/avg/min/max/count; row + column + grand totals for sum/count. DECISIONS 2026-05-17 17:30. (Decided against the "custom over CUBE/ROLLUP" path the original bullet suggested — see entry for rationale.)
- [x] Schema-relationship-diagram view via Cytoscape.js, fed by `taxonomy/v0.1/relationships.json` — modal (button in the Schema panel header), Cytoscape as a lazy chunk so the shell stays small. Taxonomy-type graph (not workbook-table ER). DECISIONS 2026-05-17 18:00.

**Deferred Theme 2 sub-items** (for a follow-up "viz polish" pass):
- Plot pie chart (custom arc adapter — Plot doesn't ship pie).
- Plot faceted small-multiples (needs a third "facet-by" picker on the chart cell).
- Map cell basemap (vendor tiles or OSM via CSP `connect-src` exception + UI to pick the basemap).
- Map cell deck.gl pairing (for >10k-point rendering).
- Shapefile (`.shp`) mount (requires multi-file FSA picker; not currently supported).
- Spec §3.1 supported-formats list bumps from 13 → 15 with this wave (+geojson, +kml).

### AI sidecar (spec §4.3 + portfolio mandate) ⏳ wave 1 done (2026-05-18)

**Pitch:** "Narrow, helpful, BYOK. Never generates SQL you didn't write."

- [x] Wave 1 — BYOK key storage (`src/core/sidecar/byok.ts`; sessionStorage default + opt-in IDB per amendment A2), Anthropic + OpenAI providers, settings modal in header, `explain-query-error` job wired to errored SQL cells with inline render + "Copy SQL" suggested-fix affordance, CSP extended with the two API endpoints. DECISIONS 2026-05-18 17:00.
- [x] Wave 2 — **type-disambiguation** job (spec §4.3 job 1). Schema-panel "Ask sidecar" button on ambiguous columns (≥2 candidates + confidence ∈ [0.5, 0.9) + origin='detector'). One-token answer matched case-insensitively to the candidate list (or `null` for `unknown` / off-list). Chosen typeId applied via the existing `overrideAssignment` path (origin = `user_override`). DECISIONS 2026-05-18 18:00.
- [x] Wave 3 — **define-new-type assist** job (spec §4.3 job 3). "+ Define new type from this column…" in the Override dropdown opens a modal: re-samples values, shows column context, lets the user fill the spec by hand OR click "Suggest with sidecar". Save → `workbook.addUserType` + apply via `overrideAssignment`. User types persist per-workbook (via `.naklidata` `user_types` field — was a placeholder). DECISIONS 2026-05-18 19:00.
- [x] **Classifier integration of user types** — `src/taxonomy/user-types.ts` synthesises regex + header_match detectors per user type; `set_user_types` worker message rebuilds the effective bundle; `installUserTypesSync` in main.ts pushes on workbook change; "Re-classify with user types" button in the schema-panel toolbar preserves user accepts/overrides. DECISIONS 2026-05-19 14:00.
- [ ] Custom-endpoint support — OpenAI-compatible URL field for local llamafiles / vLLM. CSP rethink required (current explicit-host whitelist won't work).
- [ ] Eval harness (v1.2) — held-out per-job evals so prompted-vs-LoRA can be measured honestly. Per `plan/sidecar-architecture.md`.
- [ ] Local-model path (v1.2+) — Transformers.js + Phi-3-mini-class (~150 MB OPFS). Opt-in fallback to BYOK if not downloaded.
- [ ] LoRA-Gemma 4 E2B (v1.3+) — opt-in "high-accuracy mode"; never the default. See `plan/sidecar-architecture.md`.

### Theme 3 — Shareability + persistence ⏳ wave 1 done (2026-05-17)

**Pitch:** "Save my session. Share my analysis without my data."

Tracking checklist:

- [x] Unify IDB connections — `handles.ts` now uses the shared `openNakliDataDb()` / `withStore()` from `idb.ts` (was a latent bug: handles wrote to DB `'NakliData'`, settings wrote to DB `'naklidata'`)
- [x] `loadSettings()` + `saveSettings()` wired into boot — autoAcceptThreshold persists across tabs
- [x] `saveWorkbookSnapshot()` / `loadWorkbookSnapshot()` / `clearWorkbookSnapshot()` in `persistence.ts`, IDB-keyed at `workbook/current` (same JSON shape as `.naklidata` files)
- [x] Boot-time auto-restore: `restoreFromIdb()` applies settings + workbook snapshot before installing auto-save subscribers
- [x] Debounced auto-save (300 ms) subscribers on workbook + notebook
- [x] `applyLoadedFile({ silent })` option: boot-time restore uses `queryReadPermissionQuiet` for FSA folder handles (no prompt without user activation); explicit `.naklidata` load keeps the existing `ensureReadPermission` (can prompt)
- [x] `tests/e2e/auto-restore.spec.ts` — two specs verifying (i) mount-bundle → reload → restored without click; (ii) threshold slider value persists across reload
- [x] `waitForClassificationStable()` helper for e2e — polls until column count stops growing
- [x] URL-encoded query state: `?lens=<base64>` round-trips the `.naklidata` JSON without sending data — gzip + base64url via `src/core/url-state.ts`; Share button in header; boot prefers `?lens=` over IDB snapshot; URL stripped after applying. DECISIONS 2026-05-17 11:30.
- [x] PWA installability: `public/manifest.webmanifest` + `public/sw.js` (lite — precache shell + chunks + manifest + icon; SWR for same-origin GETs; navigation fallback to cached index.html offline). Decision was lite-not-full (DuckDB-fallback bytes are 74 MB — opportunistically cached if a `?offline=1` boot fetches them, but not precached). DECISIONS 2026-05-17 11:50.
- [x] Multi-session sidebar — header dropdown (chose dropdown over a 4th sidebar column to keep the 3-panel layout; see DECISIONS 2026-05-17 12:10). New `src/core/sessions.ts` (CRUD + migration from legacy `workbook/current`); header switcher in `src/ui/shell.ts` with new / switch / rename / delete; auto-save now writes to active session's snapshot key. **Theme 3 wave 2 complete.**
- [ ] Embeddable `<nakli-data-widget>` (v2.1 roadmap, pre-work)

Wave 1 result: workspace state persists across tabs (per `plan/spec-amendments.md` A1). The user no longer starts over each session.

### Pre-v1.0-tag gates ✅ shipped (2026-05-17)

**Pitch:** "Close the v1.0 chapter cleanly."

- [x] CodeMirror 6 lazy chunk (DECISIONS 2026-05-15 14:10 + 2026-05-17 03:50) — `src/lazy/codemirror.ts`; textarea-first, async-swap to CM6 once chunk lands; per-cell-id instance cache; `disposeSqlCellEditor` on delete
- [x] DuckDB-wasm SRI pinning (spec §7.1 gate) — `scripts/fetch-duckdb-fallback.mjs` writes `public/duckdb-fallback/integrity.json` with SHA-384 per file; `src/core/engine.ts` `fetchWithSri()` on CDN path
- [x] README pass per spec §3.10 — what it is / what it isn't / browser support / quick start / `.naklidata` format / taxonomy contribution / privacy
- [x] Tag `v1.0.0`

### Theme 4 — Schema + data quality polish ✅ complete (2026-05-21)

**Pitch:** "Make the most important surface even better."

- [x] Column statistics panel: cardinality, null %, length distribution, top-k (a `column-profile` mode for the schema panel) — shipped 2026-05-21 (wave 1). `Engine.profileColumn` runs a full-table aggregate + top-5; `.schema-profile-pane` renders inline under each column row; toggleable via the Profile button. e2e: `tests/e2e/column-profile.spec.ts`.
- [x] Side-by-side data compare (auto join-key detection from taxonomy + diff renderer) — shipped 2026-05-21 (wave 2 / B2). `Engine.compareTables` does a FULL OUTER JOIN + bucket aggregate + per-row column-level diff sample. Schema-panel header gets a "Compare tables…" button (when ≥2 tables mounted) that opens a modal with auto-detected shared semantic types as candidate join keys. e2e: `tests/e2e/compare-tables.spec.ts`.
- [x] Type override learns: "always treat columns named `vendor_id` as `gstin`" (per-workspace user-type seed) — shipped 2026-05-21 (wave 2 / B3). Workbook gains `overrideRules: OverrideRule[]` (persisted in `.naklidata` as `override_rules`). After Override, a "Remember rule" toast offers to promote the one-off pick to a rule; new mounts + reclassify apply the rule with origin `user_override`. Manage-rules modal lists current rules with a Remove button. e2e: `tests/e2e/override-rules.spec.ts`.
- [x] Demo / censor mode (lessons doc item 9): mask user paths and column names in screenshots — shipped 2026-05-21 (wave 2 / B4). `settings.demoMode` boolean (persisted in IDB) gates a `maskLabel(kind, original)` helper used by the sources panel, schema panel, and SQL result-table headers. When on, labels get stable prefixed tokens (`src_1`, `tbl_1`, `col_1`, …). SQL cell text + data row values are NOT masked — the user must clear/anonymise those manually before screenshotting. e2e: `tests/e2e/demo-mode.spec.ts`.

### Theme 6 — Enterprise / Compute Bridge

**Pitch:** "Filestores-as-database for organizations that can't ship 500 GB to a browser."

Full writeup in [enterprise-strategy.md](./enterprise-strategy.md). Phased:

- **v1.2 (precursors).** Iceberg REST Catalog + OAuth2/Bearer/SigV4 auth. S3-compatible custom endpoints (MinIO, R2, B2, Wasabi). Cheap, high-leverage; closes the gap for lakehouse customers who don't need a bridge yet.
- **v1.3 (MVP).** Compute Bridge as a sibling OSS project (`NakliTechie/nakli-compute`, Apache-2.0 lean). Single binary + Docker image. Arrow Flight + HTTP wire protocol. Bearer-token auth. `compute-bridge` source kind added to the mount layer. Bridge-side AI sidecar with heavier LoRA-Gemma weights (see [sidecar-architecture.md](./sidecar-architecture.md) "AI in the browser vs AI in the bridge").
- **v1.4 (multi-team).** OAuth2 against customer IdP. Shared-taxonomy hub: browsers fetch from the bridge, accept/override changes proposed back. Helm + Terraform deployment paths. Audit log.
- **v2.0 (DB Relay + governance).** Postgres / MySQL / Snowflake / BigQuery via stateless user-deployed proxy. Role-based auth + review queues for taxonomy changes.
- **v2.x (edge).** Cloudflare Worker / AWS Lambda DuckDB deployment for users who don't want a long-running instance.

---

## Sources

- [PondPilot — repo](https://github.com/pondpilot/pondpilot)
- [PondPilot — site](https://pondpilot.io/)
- [PondPilot — open SPSS in browser](https://pondpilot.io/formats/open-spss-files-in-browser/)
- [PondPilot Widget](https://github.com/pondpilot/pondpilot-widget) — embeddable SQL playground precedent
- [Huey — pivot tables](https://github.com/rpbouman/huey)
- [DuckDB Community Extensions — read_stat](https://duckdb.org/community_extensions/extensions/read_stat)
- [DuckDB Community Extensions — list](https://duckdb.org/community_extensions/list_of_extensions)
- [DuckDB Iceberg in the Browser, Dec 2025](https://duckdb.org/2025/12/16/iceberg-in-the-browser)
- [DuckDB-wasm extensions discussion](https://github.com/duckdb/duckdb-wasm/discussions/1531)
- [Observable Plot](https://github.com/observablehq/plot)
- [Apache ECharts](https://echarts.apache.org/)
- [MapLibre GL JS](https://maplibre.org/)
- [deck.gl](https://deck.gl/)
- [Leaflet vs MapLibre vs deck.gl comparison](https://js-maps.com/best-javascript-map-libraries/)
- [PivotTable.js](https://pivottable.js.org/)
- [CodeMirror 6](https://codemirror.net/)
- [apache-arrow JS](https://arrow.apache.org/js/)
- [readstat-rs WASM build](https://github.com/curtisalexander/readstat-rs)
- [Cytoscape.js](https://js.cytoscape.org/)
