# NakliData Backlog

Working list of features to consider, drawn from competitive recon. Items are tagged by status:

- ✅ **shipped** — already in v1.0
- 🗓️ **planned** — in spec or build order
- 🆕 **new** — added from this research; not in spec yet
- 🚫 **declined** — explicit "do not borrow", reason given

Each item names the mature OSS component to reuse (no point reinventing).

Sources for the survey are at the bottom.

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

### Theme 1 — Format-import expansion

**Pitch:** "Drop a folder; everything mounts."

- Wire SQLite `.db` mount via DuckDB ATTACH (spec, easy)
- Wire DuckDB `.duckdb` file mount via ATTACH (trivial)
- Auto-load DuckDB core extensions on first use: `httpfs`, `excel`, `json`, `spatial`, `sqlite`, `iceberg`, `delta`
- Replace deferred SheetJS dep with DuckDB `excel` extension (removes the `cdn.sheetjs.com` block)
- Add `duckdb-read-stat` community extension → SPSS / Stata / SAS in one shot
- Add Apache Arrow IPC `.feather` via the `apache-arrow` JS lazy chunk

Result: spec §3.1 supported formats list grows from 6 → 12.

### Theme 2 — Visualization upgrade

**Pitch:** "From 7 chart types to 14, plus a map cell."

- Lazy code-splitting infrastructure in esbuild
- Observable Plot lazy chunk → adds pie, stacked bar, area-stacked, heatmap, faceted small-multiples
- MapLibre GL JS + deck.gl lazy chunk → new map cell type
- DuckDB spatial extension → GeoJSON / Shapefile / KML mount
- Pivot-table cell type (custom over DuckDB CUBE/ROLLUP)
- Schema-relationship-diagram view via Cytoscape.js, fed by `taxonomy/v0.1/relationships.json`

### Theme 3 — Shareability + persistence

**Pitch:** "Save my session. Share my analysis without my data."

- Wire `src/core/settings.ts` into boot (the orphan from action 4) — persist `autoAcceptThreshold`, `sidecarEnabled`
- Auto-save workbook (sources + assignments + cells) to IDB on every change; auto-restore on tab open. Folder-handle reconnect on user click.
- URL-encoded query state: `?lens=<base64>` round-trips the `.naklidata` JSON without sending data
- PWA installability: `manifest.webmanifest` + service worker caches shell + DuckDB-fallback for offline use
- Multi-session sidebar (à la OpenPlanter's `.openplanter/sessions/<id>/`)
- Embeddable `<nakli-data-widget>` (v2.1 roadmap, pre-work)

### Theme 4 — Schema + data quality polish

**Pitch:** "Make the most important surface even better."

- CodeMirror 6 lazy chunk (decision log 14:10 — pre-tag gate)
- Column statistics panel: cardinality, null %, length distribution, top-k (a `column-profile` mode for the schema panel)
- Side-by-side data compare (auto join-key detection from taxonomy + diff renderer)
- Type override learns: "always treat columns named `vendor_id` as `gstin`" (per-workspace user-type seed)
- Demo / censor mode (lessons doc item 9): mask user paths and column names in screenshots
- Spec §3.10 README pass

---

## D. Things explicitly NOT on the backlog

For when they come up:

- **AI chat / NL-to-SQL / SQL fix suggestions** — vision §"What it is not". The sidecar Jobs 1–3 (type disambiguation, error explanation, define-new-type assist) are the allowed scope.
- **Multi-user collab / share-via-link with login** — vision: single-operator. URL-state sharing in Theme 3 is the privacy-preserving alternative.
- **Hosted / SaaS variant** — never.
- **Spreadsheet metaphor** — spec §3.3 locks us to a notebook with three cell kinds. Pivot-table cell type (Theme 2) is a notebook cell, not a spreadsheet pivot.
- **PDF table extraction** — fragile; declined.
- **Apple Numbers / Lotus 1-2-3 / MS Access** — no clean OSS readers in WASM; not worth original work.
- **Encrypted-in-IDB BYOK storage** — sessionStorage-only is a deliberate Hard NOT (spec §4 item 2 + §2.3).
- **Recursive AI sub-agents** (OpenPlanter pattern) — vision forbids auto-execute and narration.

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
