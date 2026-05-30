# NakliData

> Browser-native semantic data workbench. Point it at your files, folders, or public data dumps; NakliData tells you what's in them, lets you query and chart, and writes results back into your other tools — without anything leaving the tab.

---

## What it is

A single-HTML-shell tool that reads tabular data — from your local disk (via the File System Access API), from S3-compatible cloud storage, from public URLs, from Apache Iceberg tables, or from a local Compute Bridge sidecar — and runs SQL against it using DuckDB-wasm. A versioned semantic taxonomy classifies your columns into types you recognize — GSTIN, HSN code, IFSC, ISO currency, email, vendor name, timestamp, log level, and so on. From a query result you can chart it, pivot it, map it, write CSV / Parquet to a folder you choose, push to KanZen as cards, propose a Bahi journal, or parametrize a NakliPoster collection. Notebook, schema panel, chart / pivot / map cells, action sinks — all in the browser tab.

Supported file formats today (15): CSV · TSV · JSONL · Parquet · Arrow IPC (`.arrow` / `.feather`) · SQLite · DuckDB (`.duckdb`) · Excel `.xlsx` · SPSS (`.sav` / `.zsav` / `.por`) · Stata `.dta` · SAS (`.sas7bdat` / `.xpt`) · GeoJSON (`.geojson` / `.geo.json`) · KML. The statistical formats, SQLite, Excel, and spatial formats mount via DuckDB extensions on first use.

## What it isn't

- **Not a hosted SaaS.** No server, no accounts, no login, no telemetry. NakliData is a static page; you can self-host it on a USB stick.
- **Not an ingestion pipeline.** The data stays on your disk. Even with cloud-storage sources (v1.1), bytes go from the bucket directly to your browser — no third party in the middle.
- **Not an "AI insights" generator.** The optional BYOK sidecar does four narrow jobs (see below). It never writes prose narration of your results and never auto-executes SQL.
- **Not multi-user.** The `.naklidata` save file (or a `?lens=` share link, which carries no data) is the sharing primitive — send the file, not a login.

## Browser support

- **Supported:** Chrome / Edge / Opera 122+ (File System Access + OPFS).
- **Partial:** Firefox — single-file mounts work; folder mount unavailable until FSA lands ([Mozilla feature tracker](https://bugzilla.mozilla.org/show_bug.cgi?id=1748582)).
- **Not supported:** Safari (yet). The app detects and shows a respectful "not supported here yet" page.

## Quick start

For end users: visit the hosted build (URL TBD when published), click **Browse example data**, and start querying. No install. Your workspace persists in IndexedDB so reopening the tab restores everything. From the browser menu you can also "Install" NakliData as a PWA — it then opens in its own window and the shell works offline (the DuckDB engine still needs a one-time network fetch to warm its cache, or load with `?offline=1` to use the vendored fallback).

For developers cloning the repo:

```bash
git clone https://github.com/NakliTechie/NakliData
cd NakliData
npm install              # also vendors DuckDB-wasm locally with SRI hashes
npm run dev              # http://localhost:5173 with hot reload
```

Other handy scripts:

```bash
npm run check            # tsc --noEmit + biome check
npm run test             # vitest unit tests
npm run smoke            # build + headless browser smoke test
npm run test:e2e         # build + Playwright e2e tests
npm run build            # → dist/index.html (the shell) + dist/chunks/ (lazy chunks)
npm run eval -- --dry-run # offline eval harness for the sidecar (recorded fixtures + HTML report)
```

`SKIP_DUCKDB_FETCH=1` on `npm install` skips the postinstall vendoring (useful in network-restricted CI).

## Example data

`public/examples/` ships a small synthetic bundle of Indian-SMB-finance shape (~25 vendors, 80 invoices, 65 payments with valid-checksum GSTINs, PANs, IFSCs, HSN codes) plus a small NDJSON access-log fixture. On first mount, the schema panel auto-classifies ~25 columns — the fastest way to see the taxonomy in action without bringing your own data.

Regenerate the fixtures with `node scripts/gen-examples.mjs` (deterministic; same seed → same output). The GSTIN generator implements the real base-36 check-digit algorithm so the GSTIN-checksum detector lights up.

## Remote data sources

Beyond local files, NakliData can mount tabular data from five remote source kinds. Bytes flow from the source directly to your browser; nothing relays through a NakliData server (there isn't one). CORS or signed-URL access still applies — the source has to be reachable from your browser context.

- **HTTPS by URL.** Paste a URL to a CSV / Parquet / Arrow / JSONL file. The server must send CORS headers your browser will accept. Bearer tokens (for protected URLs) follow the same BYOK posture as sidecar keys — `sessionStorage` by default, opt-in plaintext IDB with a Forget affordance.
- **S3-compatible endpoint.** AWS S3, Cloudflare R2, MinIO, etc. Anonymous public buckets or signed access (access key + secret); region + endpoint configurable. DuckDB's `httpfs` extension does the I/O.
- **Apache Iceberg by URL.** Catalog-less — point at a table directory or `metadata.json` and the latest snapshot is mounted via DuckDB's `iceberg` extension. Useful when a warehouse exposes table prefixes directly.
- **Iceberg REST catalog.** A catalog server (Nessie, Polaris, AWS Glue with REST adapter, etc.); Bearer auth supported. List namespaces + tables, pick a table to mount.
- **Compute Bridge.** A small sidecar binary that fronts your warehouse (DuckDB, Snowflake, BigQuery, Trino…) over HTTP + Arrow IPC. You write SQL against the warehouse; the bridge returns the result; NakliData registers it as a bounded Arrow buffer in the browser. The browser↔bridge wire is HTTP + Arrow IPC, not Flight (browsers can't do native gRPC). Spec amendment [A12](./plan/spec-amendments.md); protocol details in [`plan/compute-bridge-protocol.md`](./plan/compute-bridge-protocol.md). The bridge binary itself ships from a separate OSS repo.

Credentials for the remote sources (Bearer tokens, S3 secrets) follow the same BYOK posture described for sidecar keys below.

## The notebook

A notebook is an ordered list of cells. Five kinds:

- **SQL cell.** CodeMirror 6 editor (lazy-loaded chunk; the shell stays under 600 KB until you open one). Reference other cells by `@cellName`. Errors render inline next to the cell.
- **Chart cell.** Eleven chart types: `bar`, `line`, `area`, `scatter`, `histogram`, `stat`, `table`, `pie`, plus `stacked-bar` / `area-stacked` / `heatmap` via the Observable Plot lazy chunk. A `facet-by` picker draws small-multiples for facetable types (Plot uses native `fy`; pie partitions into a grid).
- **Pivot cell.** Pick a row column, a column column, a value column, and an aggregation (`sum` / `avg` / `min` / `max` / `count`). Row, column, and grand totals render only when semantically meaningful.
- **Map cell.** Tile-less MapLibre canvas (no basemap — privacy-clean). Reads a GeoJSON geometry column (object- or string-shaped) and optionally colors features by a categorical property. Mount `.geojson` / `.kml` files directly via the DuckDB spatial extension.
- **Markdown cell.** Hand-rolled minimal subset (60 lines, no `marked`/`markdown-it`); sufficient for notebook annotations.

## The schema panel

The taxonomy is what makes NakliData feel different — it knows what your columns mean, not just their SQL types.

- **Auto-classify** runs in a Web Worker against `taxonomy/v0.1` (41 semantic types). Confidence scores + evidence are shown; auto-accept threshold is user-configurable.
- **Column profile** (toggleable per column): cardinality, null %, length distribution, top-5 values. Single DuckDB aggregate query; no extra cost until you ask for it.
- **Override** a single column, or "Remember rule" to promote that override into an `override_rules` entry that applies on every future mount + reclassify.
- **Define a new type from this column** opens a modal that re-samples values and lets you write the spec by hand (header_match + regex + checksum + sql_type). User types persist per-workspace and are fed back to the classifier ("Re-classify with user types").
- **Compare tables** (when ≥2 mounted): pick a candidate join key (auto-suggested from shared semantic types) → FULL OUTER JOIN + bucket aggregate + sampled per-row column diff.
- **Schema graph** opens a Cytoscape modal showing taxonomy-type relationships (e.g., `gstin` ↔ `pan` ↔ `vendor_name`), fed by `taxonomy/v0.1/relationships.json`.
- **Demo mode** masks user paths and column names (`src_1`, `tbl_1`, `col_1`, …) in the sources panel, schema panel, and result table headers — safe for screenshots. SQL cell text and data row values are not masked; clear those manually.

## Sessions and sharing

- **Multi-session.** A header dropdown lets you create, switch, rename, and delete named sessions. Each session has its own snapshot in IndexedDB; auto-save writes to the active session.
- **Auto-restore.** Workspace state — sources, column assignments, notebook cells, settings, FSA folder handles — restores on tab open. FSA folder permission re-verifies silently when granted by user activation; otherwise a "Reconnect" banner appears. (Spec amendment [A1](./plan/spec-amendments.md).)
- **Share link** (`?lens=<base64>`). The Share button in the header serializes the current notebook to gzip + base64url and copies a URL to the clipboard. The link carries the description of your work — sources, column assignments, cells — but never your data. A loaded `?lens=` URL is stripped after applying, so refreshing won't re-trigger it.
- **PWA installable.** `manifest.webmanifest` + service worker; the shell and lazy chunks precache on install, navigation requests fall back to the cached shell offline. DuckDB-fallback bytes (~74 MB) are not precached by default — load with `?offline=1` once to warm the cache.

## AI sidecar (BYOK, optional)

Off by default. Open the gear icon → AI sidecar to enter a key. Four narrow jobs:

1. **Explain query error.** When a SQL cell errors, an inline affordance asks the sidecar what went wrong; the response is plain prose with an optional "Copy SQL" suggested-fix block (you decide whether to run it — never auto-executed).
2. **Disambiguate type.** Shown on schema-panel columns where two or more taxonomy candidates remain plausible (confidence ∈ [0.5, 0.9) and origin = detector). One-token answer matched against the candidate list; applied via the standard override path.
3. **Define a new type.** In the "+ Define new type from this column…" modal, an optional "Suggest with sidecar" button fills regex / checksum / sql_type guesses. You edit and save.
4. **Recommend reports.** In the Reports panel, "Ask sidecar to rank" scores up to N candidate report templates against your current schema + column-type summary and returns a ranked list with confidence scores. Hallucination guard lives in the parser, not just the prompt — any `template_id` the sidecar emits that isn't in the candidate set is dropped, so it can't invent reports that don't exist. You decide which of the ranked reports to run.

**BYOK posture** (spec amendment [A2](./plan/spec-amendments.md)):
- Keys live in `sessionStorage` by default (cleared on tab close).
- "Remember on this device" stores plaintext in IndexedDB with honest labelling: "Stored on this device. Anyone with access to this browser profile can read it. [Forget]"
- A "Forget all stored keys" action lives in settings.

Providers shipped: Anthropic, OpenAI, and Custom OpenAI-compatible endpoints (local llamafiles, vLLM, Ollama via its `/v1` adapter, …). A "Test connection" button in settings verifies the endpoint speaks the dialect before you commit to it. CSP was broadened to `connect-src 'self' https:` to enable this (spec amendment [A5](./plan/spec-amendments.md)).

A `local` runtime is wired through the dispatch layer for future fully-in-browser models (Transformers.js / WebLLM). The runtime itself isn't bundled in v1.1 — picking `local` today fails fast with a clear message rather than silently falling back to a cloud provider, because choosing local is a privacy choice (spec amendment [A11](./plan/spec-amendments.md)).

## The `.naklidata` file format

Save the current notebook (Cmd/Ctrl+S) and you get a `.naklidata` file — JSON, versioned, human-readable. It describes your work but never contains your data:

- mounted sources (label, kind, ref, table names — not bytes)
- column type assignments (typeId per column, origin: detector / user_accept / user_override, confidence, evidence)
- notebook cells (SQL / markdown / chart / pivot / map, ordered)
- user types (per-workspace taxonomy extensions you defined)
- override rules (e.g., "always treat columns named `vendor_id` as `gstin`")
- workspace settings (auto-accept threshold, demo mode, etc.)

On load, NakliData re-mounts each source. Example-bundle sources auto-re-mount; FSA folder sources prompt for permission re-grant if needed; bytes are never embedded in the lens file.

Schema canonical: spec §5. Format identifier: `"format": "naklidata"`, currently at version `1.0` (additive — new fields like `user_types` / `override_rules` round-trip cleanly through older readers).

## Taxonomy contribution flow

The v0.1 taxonomy bundle ships in `taxonomy/v0.1/` — 41 semantic types across three domains (Indian SMB finance, generic finance, generic logs). Each type has a header-name match list, an optional regex, optional checksum (e.g., the GSTIN base-36 check digit), optional value-set lookup, and an SQL-type compatibility set.

To add a new type or improve an existing detector, edit `taxonomy/v0.1/types.jsonl` and open a PR. The agent-seeded types are marked `"seed_origin": "agent_v1.0"` and have a tighter `confidence_floor` (0.6 vs the human-curated 0.5) — those are explicitly flagged for human review. If a type is specific to your workspace, define it in-app as a user type instead — it lives in the `.naklidata` file rather than the shared bundle.

A dedicated `nakli-taxonomy` repo for community-contributed types is planned for v1.1+.

## Privacy

Your data never leaves the tab. The shell HTML is static. DuckDB-wasm loads from jsDelivr with subresource integrity (SHA-384 verified against vendored copies at build time), or from a same-origin vendored fallback (`?offline=1`). DuckDB extensions (currently `json` + `sqlite_scanner` + alias) are vendored at `public/duckdb-extensions/v1.1.1/wasm_eh/` and served same-origin under `?offline=1`. Action sinks write to local folders you explicitly pick via the OS file picker. The `.naklidata` file is a description of your work — sources, types, queries — never a copy of your data.

Workspace state (sources, assignments, cells, settings, sessions) persists across tab reloads via IndexedDB on your machine. BYOK API keys for the optional sidecar live in `sessionStorage` by default (cleared on tab close); opt-in IDB persistence is plaintext with a "Forget" affordance, and a passphrase-encrypted variant is planned for v1.2. See [`plan/spec-amendments.md`](./plan/spec-amendments.md) A2.

The sidecar talks only to the provider URL you configured — `api.anthropic.com`, `api.openai.com`, or your own custom endpoint (a local llamafile, vLLM, Ollama, etc.). Remote-source I/O goes only to the bucket / URL / catalog / bridge you pointed at. No telemetry, no error reporting, no analytics — the static shell has no place to send those even if we wanted to.

## License

MIT — see [LICENSE](./LICENSE).

## More

- [`STATUS.md`](./STATUS.md) — current build state
- [`DECISIONS.md`](./DECISIONS.md) — running decisions log
- [`plan/`](./plan) — pending backlog, declined items, spec amendments, product shape, remote-sources strategy, sidecar architecture, enterprise strategy
- [`CLAUDE.md`](./CLAUDE.md) — agent rules for working in this repo
