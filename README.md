# NakliData

> Browser-native semantic data workbench. Point it at your files, folders, or public data dumps; NakliData tells you what's in them, lets you query and chart, and writes results back into your other tools — without anything leaving the tab.

---

## What it is

A single-HTML-shell tool that reads tabular data — from your local disk (via the File System Access API), from S3-compatible cloud storage, from public URLs, from Apache Iceberg tables, or from a local Compute Bridge sidecar — and runs SQL against it using DuckDB-wasm. A versioned semantic taxonomy classifies your columns into types you recognize — GSTIN, HSN code, IFSC, ISO currency, email, vendor name, timestamp, log level, and so on. From a query result you can chart it, pivot it, map it, write CSV / Parquet to a folder you choose, push to KanZen as cards, propose a Bahi journal, or parametrize a NakliPoster collection. Notebook, schema panel, chart / pivot / map cells, action sinks — all in the browser tab.

NakliData also **resolves** messy data locally — the **Resolve track**, a sovereign, file-owned take on an agentic CDP's *resolve → segment → own* loop, done without anything leaving the tab. Today that's **clustering** (fuzzy-merge variant spellings of a column into a canonical value — *Resolve M1*) and **segments** (named, reusable `SEGMENT(name)` predicates — saved audiences — *Resolve M2*); a golden-table sink (own the resolved entity table as a file) is next.

Supported file formats today (15): CSV · TSV · JSONL · Parquet · Arrow IPC (`.arrow` / `.feather`) · SQLite · DuckDB (`.duckdb`) · Excel `.xlsx` · SPSS (`.sav` / `.zsav` / `.por`) · Stata `.dta` · SAS (`.sas7bdat` / `.xpt`) · GeoJSON (`.geojson` / `.geo.json`) · KML. The statistical formats, SQLite, Excel, and spatial formats mount via DuckDB extensions on first use.

## What it isn't

- **Not a hosted SaaS.** No server, no accounts, no login, no telemetry. NakliData is a static page; you can self-host it on a USB stick.
- **Not an ingestion pipeline.** The data stays on your disk. Even with cloud-storage sources (v1.1), bytes go from the bucket directly to your browser — no third party in the middle.
- **Not an "AI insights" generator.** The optional BYOK sidecar does eight narrow jobs (see below). It never writes prose narration of your results and never auto-executes SQL.
- **Not multi-user.** The `.naklidata` save file (or a `?lens=` share link, which carries no data) is the sharing primitive — send the file, not a login.

## Browser support

- **Supported:** Chrome / Edge / Opera 122+ (File System Access + OPFS).
- **Partial:** Firefox — single-file mounts work; folder mount unavailable until FSA lands ([Mozilla feature tracker](https://bugzilla.mozilla.org/show_bug.cgi?id=1748582)).
- **Not supported:** Safari (yet). The app detects and shows a respectful "not supported here yet" page.

## Quick start

For end users: visit **[naklidata.naklitechie.com](https://naklidata.naklitechie.com/)**, click **Browse example data**, and start querying. No install. Your workspace persists in IndexedDB so reopening the tab restores everything. From the browser menu you can also "Install" NakliData as a PWA — it then opens in its own window and the shell works offline (the DuckDB engine still needs a one-time network fetch to warm its cache, or load with `?offline=1` to use the vendored fallback).

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

Regenerate the fixtures with `npm run gen-examples` (deterministic; same seed → same output). The GSTIN generator implements the real base-36 check-digit algorithm so the GSTIN-checksum detector lights up.

## Remote data sources

Beyond local files, NakliData can mount tabular data from five remote source kinds. Bytes flow from the source directly to your browser; nothing relays through a NakliData server (there isn't one). CORS or signed-URL access still applies — the source has to be reachable from your browser context.

- **HTTPS by URL.** Paste a URL to a CSV / Parquet / Arrow / JSONL file. The server must send CORS headers your browser will accept. Bearer tokens (for protected URLs) follow the same BYOK posture as sidecar keys — `sessionStorage` by default, opt-in plaintext IDB with a Forget affordance.
- **S3-compatible endpoint.** AWS S3, Cloudflare R2, MinIO, etc. Anonymous public buckets or signed access (access key + secret); region + endpoint configurable. DuckDB's `httpfs` extension does the I/O.
- **Apache Iceberg by URL.** Catalog-less — point at a table directory or `metadata.json` and the latest snapshot is mounted via DuckDB's `iceberg` extension. Useful when a warehouse exposes table prefixes directly.
- **Iceberg REST catalog.** A catalog server (Nessie, Polaris, AWS Glue with REST adapter, etc.); Bearer auth supported. List namespaces + tables, pick a table to mount.
- **Compute Bridge.** A small sidecar binary that fronts your warehouse (DuckDB, Snowflake, BigQuery, Trino…) over HTTP + Arrow IPC. You write SQL against the warehouse; the bridge returns the result; NakliData registers it as a bounded Arrow buffer in the browser. The browser↔bridge wire is HTTP + Arrow IPC, not Flight (browsers can't do native gRPC). Spec amendment [A12](./docs/spec-amendments.md); protocol details in [`plan/compute-bridge-protocol.md`](./plan/compute-bridge-protocol.md). The bridge binary itself ships from a separate OSS repo.

Credentials for the remote sources (Bearer tokens, S3 secrets) follow the same BYOK posture described for sidecar keys below.

## The notebook

A notebook is an ordered list of cells. Nine kinds:

- **SQL cell.** CodeMirror 6 editor (lazy-loaded chunk; the shell stays under 750 KB until you open one). Reference other cells by `@cellName`. Errors render inline next to the cell. **Associative cross-filter** *(v1.3 M1):* click a value in any result and the engine paints SELECTED / ASSOCIATED / EXCLUDED states across the result — non-co-occurring values grey out (not hidden; absence-as-signal, Qlik's model). The **Associations** header button links columns across cells (auto-suggested by shared taxonomy type or name, plus a manual link form) so a selection in one cell cross-filters the others.
- **Chart cell.** Eleven chart types: `bar`, `line`, `area`, `scatter`, `histogram`, `stat`, `table`, `pie`, plus `stacked-bar` / `area-stacked` / `heatmap` via the Observable Plot lazy chunk. A `facet-by` picker draws small-multiples for facetable types (Plot uses native `fy`; pie partitions into a grid). A **Manual | Shelves** toggle *(v1.3 M5)* adds VizQL-style authoring — drag result fields onto Columns / Rows / Color drop-zones; the shelves compile to the same chart config the manual controls write.
- **Stats cell** *(v1.3 M4).* Descriptive statistics (count / mean / stddev / min / quartiles / max) + a correlation matrix over an upstream cell's numeric columns. All computed in DuckDB SQL — no regression, no modelling.
- **Report cell** *(v1.3 M3).* A paginated report surface — KPI tiles + embedded cell references. Print to PDF via the browser's print dialog (scoped `@media print` CSS reveals only the report; no pdf-lib dependency).
- **Pivot cell.** Pick a row column, a column column, a value column, and an aggregation (`sum` / `avg` / `min` / `max` / `count`). Row, column, and grand totals render only when semantically meaningful.
- **Map cell.** Tile-less MapLibre canvas (no basemap — privacy-clean). Reads a GeoJSON geometry column (object- or string-shaped) and optionally colors features by a categorical property. Mount `.geojson` / `.kml` files directly via the DuckDB spatial extension.
- **Markdown cell.** Hand-rolled minimal subset (60 lines, no `marked`/`markdown-it`); sufficient for notebook annotations.
- **Cohort cell** *(W4.4).* SQL that returns a `user_id` column. Reference via `@<cohort_name>` in downstream cells; downstream queries `JOIN` against the cohort. Same execution path as SQL cells; just clearer intent + a count badge.
- **Assertion cell** *(W5.5, dbt-tests pattern).* SQL that should return 0 rows when an invariant holds. PASS pill on green, FAIL pill + counter-example count + red border on red. Catches data-quality regressions inline ("no negative amounts", "every invoice has a vendor", "no duplicate user_ids").
- **Input cell** *(W6.1, viewof / Briefer pattern).* Interactive parameter — text / number / date / select widget. The current value is inlined into downstream SQL via `@<name>` ref resolution (text → quoted, number → bare, date → `DATE 'YYYY-MM-DD'`, empty → `NULL`). Quote-doubling makes SQL injection benign — an attacker-controlled value becomes a single quoted string literal.
- **Dashboard cell** *(W6.4, Superset / Power BI pattern).* CSS grid (1–4 columns) of named markdown / chart / pivot / map cells. Items are listed by `@name`; the dashboard re-renders each referenced cell with the editing chrome stripped. SQL / cohort / assertion / input cells aren't valid items (queries + parameters, not presentation surfaces).

### Sharing the notebook

- **Save HTML** (header button) — exports the active notebook as a self-contained `.html` file: markdown previews + chart SVGs + pivot/result tables + SQL `<details>` blocks. ~3 KB embedded CSS, no JS, no engine. Email it, drop it into a Google Doc, pin it in a wiki.
- **Export anonymized** *(v1.2 M1).* Sixth sink on every result table — opens a per-column dialog: `keep` / `hash` / `redact` / `bucket` / `drop`, with defaults driven by the column's sensitivity badge (PII → hash, financial → bucket, secret → redact, public → keep). Applied via DuckDB SQL projection rewrite (md5 + DATE_TRUNC + FLOOR built-ins, no JS post-processing of millions of rows), with every identifier + literal flowing through a dedicated quoter so the SQL is airtight against hostile column names. Salt is per-export, generated via `crypto.getRandomValues`, shown once with Copy + Regenerate, never persisted — paste it back next time for a same-hash re-export. A JSON manifest is written alongside the data file recording the column-strategy map + taxonomy version + a `saltUsed: boolean` (never the salt itself).
- **Export golden table** *(Resolve M3).* The *own* verb of the Resolve track — a seventh sink that collapses a result to **one row per canonical entity** (typically a clustered `__merged` column from *Cluster values*) and writes the deduped table to a folder you keep, as CSV or Parquet. Pick the entity (group-by) column and a **survivorship rule** per other column — keep-first / max / min / latest (latest keeps the row with the MAX of a chosen order column, via `arg_max`). Injection-safe: every identifier flows through `quoteIdent`, the aggregate function comes from a fixed allowlist. Customer 360, inverted to ownership — a file you hold, nothing pushed to a plane.
- **Build a query (visual)** *(v1.2 M5 + v1.4 F6).* New "Build query" button in the header opens a form: source table, **multiple joins** *(F6)* (each attaching to the source or an earlier join), AND-joined filters (column + op + value), GROUP BY + aggregates (SUM / AVG / COUNT / MIN / MAX), LIMIT. Every filter + aggregate column picker is **table-qualified** so joined-table columns are reachable, and `validateSpec` rejects a join that attaches to an out-of-scope table. Live SQL preview as you edit. Click "Insert as SQL cell" → drops the emitted SQL into a new SQL cell at the end of the notebook. **Strict no-string-concat-injection emitter**: every identifier flows through `quoteIdent` (`"` doubled), every literal through a TYPE-VALIDATED emitter (numeric must parse as a finite number; string goes through `quoteLiteral` (`'` doubled); date validated against ISO-8601; boolean validated as `true|false`). Hostile values (`1; DROP TABLE`, `' OR 1=1; --`) either silently drop the filter (numeric / date) or land inside one quoted SQL literal (string), never as free SQL fragments. Scope stays bounded: multi-join but no nested subqueries and no window functions (use a Calc field for windowing). Output goes to a new SQL cell — you click Run.
- **Calc field** *(v1.4 F4/F5).* A "Calc field" button on every SQL result opens a modal with two modes. **Expression** mode: type a free expression (with column chips) → emits `SELECT *, (<expr>) AS "<alias>" FROM (<upstream_sql>) AS calc_src` — the upstream query wrapped as a subquery so the new column composes over any result. **Window (LOD)** mode: build a Tableau-style level-of-detail calc — function + column + optional `PARTITION BY` (e.g. `SUM(total_amount) OVER (PARTITION BY vendor_name)`). Reuses the visual-query-builder injection-safe emitter (`quoteIdent` for the alias, validated expression, function allowlist for windows). Output is a new SQL cell — you click Run (Hard NOT #4).
- **X-Ray** *(v1.4 F7/F8).* An "X-Ray" button on every SQL result inserts a markdown header + a **stats cell** bound to the result and runs it — one click gives descriptive statistics + a correlation matrix (the v1.3 M4 stats cell). Pairs with the schema panel's per-column distribution + outlier surfacing *(F8, below)*.
- **Cluster values** *(Resolve M1).* A "Cluster" chip on every SQL result and a per-column "Cluster values" action in the schema panel fuzzy-merge variant spellings of a column (`Sharma Trading Co` = `Sharma Trading Co.` = `SHARMA TRADING CO`) into a canonical column. Two OpenRefine-standard methods — **key collision** (fingerprint: case / punctuation / word-order, the default) and **nearest neighbour** (edit distance, opt-in, with a similarity slider). Review the clusters (edit the canonical, accept / reject each), then it emits an additive `… CASE WHEN "col" IN (…) THEN '<canonical>' … ELSE "col" END AS "col__merged"` SQL cell you run — reproducible, replays with no model. Reuses the injection-safe emitter; every variant value lands inside one quoted literal. An optional **Ask AI to check ambiguous pairs** affordance (only when a sidecar provider is configured) adjudicates borderline pairs — structured decision only, no prose, and fully removable.
- **Embed** *(v1.4 F9).* An "Embed" button wraps the self-contained Save-HTML export (markdown + chart SVGs + tables, no JS, no engine) in a **sandboxed `<iframe srcdoc>`** snippet you can paste into a wiki or intranet — read-only, server-free, works offline. The sandbox is empty (no `allow-scripts`, no `allow-same-origin`) since the export carries no scripts. A static snapshot, not a live view; chosen over a `?lens=` iframe (which would render empty charts for local-data notebooks and needs a reachable server).
- **Suggest a chart** *(v1.2 M4).* New chip next to the result-table "Summarise" button on every SQL cell. Click → the sidecar (BYOK, your provider) sees the SQL + columns + 10 sample rows + row count and returns a strict JSON ChartProposal (one of 8 chart types + x/y/group column names from the result + a short title). The proposal is materialised as a chart cell wired to the SQL cell via the existing `@name` plumbing. **NO PROSE** — the sidecar never narrates your data; the parser rejects anything that isn't strict structured config; columns referencing non-existent fields are dropped wholesale (hallucination guard). On parser reject: toast "Couldn't propose a chart — try inserting one manually."
- **Check for source updates** *(v1.2 M3).* New "Refresh" button in the header runs a single change-detection sweep — FSA folders re-fingerprint (file size + last-modified, aggregated across all files in the directory; cheap, no file reads); HTTP URLs fire a HEAD request (ETag + Last-Modified + Content-Length). The result modal shows which sources have changed since you last saved, which cells are downstream of those sources (cascaded via the M2 lineage graph), and which sources couldn't be checked (permission revoked or HEAD failed). Click "Re-run N stale cells" to refresh them — fingerprints are persisted first so the next check has a new baseline. No background polling — the check only runs on click; no auto-rescan on boot.
- **Cell lineage** *(v1.2 M2).* New "Lineage" button in the header opens a panel that answers "where does this number come from?" Every SQL / cohort / assertion cell records its upstream inputs after each successful run by walking the DuckDB `EXPLAIN (FORMAT JSON)` plan — not regex parsing — so `WITH vendors AS (...) SELECT * FROM vendors` correctly DOES NOT emit a vendors edge (the CTE shadows the table) and `FROM read_parquet('/p/x.parquet')` correctly DOES emit a file edge. The panel renders both an accessible list view (the load-bearing truth) and a hand-rolled SVG with sources / cells / sinks in three lanes (no D3, no React-Flow dependency). The lineage graph persists into `.naklidata` alongside the workbook description (still no data — just node + edge records). An **Edit mode** *(v1.3 M6)* on the panel lets you insert a cell on an edge or delete a node (downstream dependents are listed before you confirm a delete).
- **Semantic layer** *(v1.3 M2 + v1.4 F1–F3).* New "Semantic" header button manages named, versioned **measures** and **dimensions** in one catalog. A measure is an aggregate — `revenue = SUM(amount) FILTER (WHERE status = 'completed')`, referenced in any SQL cell as `MEASURE(revenue)`. A dimension *(F1)* is a reusable derived expression — `gstin_state = SUBSTR(gstin, 1, 2)`, referenced as `DIM(gstin_state)`. Both macro-expand in the same pass at run time through one audited expansion point, so the definition stays single-source. The catalog panel *(F2)* lists every measure + dimension with a "used by N cells" count; a **View as code** toggle *(F3)* shows the whole layer as editable JSON (`{measures, dimensions}`) with Apply-validation — a code-reviewable metrics artifact round-tripped in the `.naklidata` description, never the data. Pre-v1.4 files round-trip cleanly (the `dimensions` field is optional). *(Resolve M2)* the catalog gained a third kind — **segments**: a named, reusable boolean predicate like `high_value_lapsed = total_amount > 100000 AND last_seen < '2026-01-01'`, referenced in a WHERE clause as `SEGMENT(high_value_lapsed)` and expanded in the same audited pass. The code view round-trips `{measures, dimensions, segments}`; the optional `segments` field round-trips pre-M2 files cleanly.
- **Presentation mode** *(W6.2, Hex app-publish pattern).* Append `?present=1` to the URL — hides SQL/cohort/assertion cells, the sources + schema sidebars, the notebook toolbar, the cell-add row, and per-cell edit chrome. Markdown + chart + pivot + map keep rendering. An "Exit presentation" pill in the header returns to the workbench.

## The schema panel

The taxonomy is what makes NakliData feel different — it knows what your columns mean, not just their SQL types.

- **Auto-classify** runs in a Web Worker against `taxonomy/v0.1` (48 semantic types incl. the W4.1 product-analytics seeds: `event_name`, `user_id`, `session_id`, `event_timestamp`, `utm_*`, `event_properties_json`, `page_url`). Confidence scores + evidence are shown; auto-accept threshold is user-configurable.
- **Sensitivity badges** *(W5.4, Unity Catalog pattern).* Each TypeSpec carries a `sensitivity` field — `public` / `pii` / `financial` / `secret`. The schema panel surfaces a small badge on PII / financial columns (no badge on public). Substrate for future demo-mode-by-label + sidecar prompt redaction.
- **Quick-chart suggestions** *(W5.3, Power BI quick-measure pattern).* Each column row has a "Quick chart ▾" affordance that emits ready-to-run SQL + chart + markdown cells based on the assigned type and same-table partners — e.g. an `amount` column suggests "Sum amount by vendor_name" + a histogram; a `gstin` column suggests "Spend by state (GSTIN[0..2])"; a `user_id` column suggests COUNT DISTINCT.
- **Column profile** (toggleable per column): cardinality, null %, length distribution, top-5 values, plus *(v1.4 F8)* a five-number **distribution** (min / q1 / median / q3 / max) + an IQR-rule **outlier** count for any numeric (or numeric-castable) column — computed over `TRY_CAST(col AS DOUBLE)`, so it's type-agnostic and absent on non-numeric columns. Single DuckDB aggregate query; no extra cost until you ask for it.
- **Override** a single column, or "Remember rule" to promote that override into an `override_rules` entry that applies on every future mount + reclassify.
- **Define a new type from this column** opens a modal that re-samples values and lets you write the spec by hand (header_match + regex + checksum + sql_type). User types persist per-workspace and are fed back to the classifier ("Re-classify with user types").
- **Compare tables** (when ≥2 mounted): pick a candidate join key (auto-suggested from shared semantic types) → FULL OUTER JOIN + bucket aggregate + sampled per-row column diff.
- **Schema graph** opens a Cytoscape modal showing taxonomy-type relationships (e.g., `gstin` ↔ `pan` ↔ `vendor_name`), fed by `taxonomy/v0.1/relationships.json`.
- **Demo mode** masks user paths and column names (`src_1`, `tbl_1`, `col_1`, …) in the sources panel, schema panel, and result table headers — safe for screenshots. SQL cell text and data row values are not masked; clear those manually.

## Sessions and sharing

- **Multi-session.** A header dropdown lets you create, switch, rename, and delete named sessions. Each session has its own snapshot in IndexedDB; auto-save writes to the active session.
- **Auto-restore.** Workspace state — sources, column assignments, notebook cells, settings, FSA folder handles — restores on tab open. FSA folder permission re-verifies silently when granted by user activation; otherwise a "Reconnect" banner appears. (Spec amendment [A1](./docs/spec-amendments.md).)
- **Share link** (`?lens=<base64>`). The Share button in the header serializes the current notebook to gzip + base64url and copies a URL to the clipboard. The link carries the description of your work — sources, column assignments, cells — but never your data. A loaded `?lens=` URL is stripped after applying, so refreshing won't re-trigger it. When the link includes any remote-source kind (HTTP / S3 / Iceberg / Compute Bridge), a confirmation modal lists every host the link would fetch from and waits for an explicit "Continue and fetch" click — local-only links (example bundle, FSA folders) auto-restore silently (spec amendment [A19](./docs/spec-amendments.md), shipped in v1.2.2).
- **PWA installable.** `manifest.webmanifest` + service worker; the shell and lazy chunks precache on install, navigation requests fall back to the cached shell offline. DuckDB-fallback bytes (~74 MB) are not precached by default — load with `?offline=1` once to warm the cache.

## AI sidecar (BYOK, optional)

Off by default. Open the gear icon → AI sidecar to enter a key. Eight narrow jobs:

1. **Explain query error.** When a SQL cell errors, an inline affordance asks the sidecar what went wrong; the response is plain prose with an optional "Copy SQL" suggested-fix block (you decide whether to run it — never auto-executed).
2. **Disambiguate type.** Shown on schema-panel columns where two or more taxonomy candidates remain plausible (confidence ∈ [0.5, 0.9) and origin = detector). One-token answer matched against the candidate list; applied via the standard override path.
3. **Define a new type.** In the "+ Define new type from this column…" modal, an optional "Suggest with sidecar" button fills regex / checksum / sql_type guesses. You edit and save.
4. **Recommend reports.** In the Reports panel, "Ask sidecar to rank" scores up to N candidate report templates against your current schema + column-type summary and returns a ranked list with confidence scores. Hallucination guard lives in the parser, not just the prompt — any `template_id` the sidecar emits that isn't in the candidate set is dropped, so it can't invent reports that don't exist. You decide which of the ranked reports to run.
5. **NL → SQL** *(W5.1, Genie / Cortex / Magic pattern).* "Ask in plain English" button on the notebook toolbar — type a question, get a DuckDB `SELECT` against your mounted tables. Five parser safety guards (defence in depth alongside the prompt, formalised in spec amendment [A23](./docs/spec-amendments.md)): (1) statement must start with `SELECT` / `WITH`; (2) every write/DDL/session-mutating keyword rejected (INSERT / UPDATE / DELETE / CREATE / DROP / ALTER / TRUNCATE / MERGE / CALL / ATTACH / COPY / EXPORT / VACUUM / PRAGMA / INSTALL / LOAD / SET / RESET / USE); (3) multi-statement responses rejected (string-literal-aware `;` scan); (4) DuckDB's replacement-scan via single-quoted FROM (`FROM 'https://attacker/x.csv'`) rejected; (5) every FROM/JOIN identifier must be in the table allowlist, including the SQL-89 comma-join form (`FROM a, b, c`) — LATERAL / UNNEST / TABLE / VALUES / PIVOT correctly treated as keywords. The generated SQL lands as a new cell — **never auto-executed**; you click Run. Only table + column names are shipped to the sidecar; no row data.
6. **Summarise result** *(W5.2, Hex Magic pattern).* On a successfully-run SQL/cohort/assertion cell, a "Summarise" button asks the sidecar for a one-line observation about the result (top value / distribution / range). Hallucination guard: any column reference must be wrapped in backticks AND match a real result column — otherwise the entire observation is dropped. 200-char cap with ellipsis truncation. Only the columns + first 5 sample rows are shipped (privacy posture).
7. **Propose a chart** *(v1.2 M4).* A "Suggest chart" chip on a SQL result asks the sidecar for a strict JSON chart configuration (one of 8 chart types + x / y / group columns drawn from the result + a short title), materialised as a chart cell. **No prose** — the parser drops any proposal that references a column not in the result (all-or-nothing hallucination guard). Only column names + 10 sample rows are shipped.
8. **Propose a merge** *(Resolve M1).* The optional "Ask AI to check ambiguous pairs" affordance in the Cluster-values modal sends *only* the borderline value pairs the deterministic clustering didn't group and gets back structured merge / keep decisions, each canonical drawn from the inputs. **No prose**; a per-pair allowlist guard blocks both fabricated values and recombined pairings; **fully removable** — delete the job and key-collision + nearest-neighbour clustering still work end to end.

**BYOK posture** (spec amendment [A2](./docs/spec-amendments.md)):
- Keys live in `sessionStorage` by default (cleared on tab close).
- "Remember on this device" stores plaintext in IndexedDB with honest labelling: "Stored on this device. Anyone with access to this browser profile can read it. [Forget]"
- A "Forget all stored keys" action lives in settings.

**Providers shipped** (four): Anthropic, OpenAI, Custom OpenAI-compatible endpoints (local llamafiles, vLLM, Ollama via its `/v1` adapter, …), and a fully-in-browser **Local** runtime via Transformers.js (W3.2 slice B, spec amendment [A24](./docs/spec-amendments.md), code shipped 2026-06-03). A "Test connection" button in settings verifies cloud / custom endpoints speak the dialect before you commit to it. CSP was broadened to `connect-src 'self' https:` to enable cloud providers (spec amendment [A5](./docs/spec-amendments.md)). Custom-endpoint URLs are hard-validated as `https://` only and the resolved host is surfaced inline so a typo / clipboard-paste can't silently ship your key to `api.opena1.com` (spec amendment forward-pass M3 fix in v1.2.2).

**Local provider** (in-browser inference, no API key, no network calls after the one-time model download). Open Settings → Local → pick a model from the curated list:

- **Qwen2.5-1.5B-Instruct** (~0.9 GB, Apache 2.0) — recommended default. Balanced quality and download size.
- **Phi-3.5-mini-instruct** (~2.3 GB, MIT) — best NL→SQL quality, bigger download.
- **Llama-3.2-1B-Instruct** (~0.7 GB, Llama license) — smallest, fastest.

Weights download from Hugging Face on first "Download & load" click and cache in **OPFS** (Origin Private File System), inspectable + deletable from Settings (size shown per-model + aggregate; per-row Delete + Forget-all-cached). On subsequent page loads with the model already cached, the runtime auto-loads at boot. Inference runs on the universal `wasm` device (WebGPU opt-in is a planned follow-up). Browser support: recent Chrome / Edge / Safari with OPFS; Firefox private-browsing < 111 falls back to "Local model caching not available."

Bearer tokens that flow to remote sources (Iceberg catalog auth, Compute Bridge auth) are now validated against the RFC 7235 token68 charset — `\r\n` / whitespace / quotes rejected, closing a CRLF-injection channel against any backend that doesn't validate header bytes (spec amendment [A21](./docs/spec-amendments.md), shipped in v1.2.2).

## The `.naklidata` file format

Save the current notebook (Cmd/Ctrl+S) and you get a `.naklidata` file — JSON, versioned, human-readable. It describes your work but never contains your data:

- mounted sources (label, kind, ref, table names — not bytes)
- column type assignments (typeId per column, origin: detector / user_accept / user_override, confidence, evidence)
- notebook cells (SQL / markdown / chart / pivot / map / cohort / assertion / input / dashboard, ordered)
- user types (per-workspace taxonomy extensions you defined)
- override rules (e.g., "always treat columns named `vendor_id` as `gstin`")
- workspace settings (auto-accept threshold, demo mode, etc.)

On load, NakliData re-mounts each source. Example-bundle sources auto-re-mount; FSA folder sources prompt for permission re-grant if needed; bytes are never embedded in the lens file.

Schema canonical: spec §5. Format identifier: `"format": "naklidata"`, currently at version `1.0` (additive — new fields like `user_types` / `override_rules` round-trip cleanly through older readers).

## Taxonomy contribution flow

The v0.1 taxonomy bundle ships in `taxonomy/v0.1/` — 48 semantic types across four domains (Indian SMB finance, generic finance, generic logs, product analytics). Each type has a header-name match list, an optional regex, optional checksum (e.g., the GSTIN base-36 check digit), optional value-set lookup, an SQL-type compatibility set, and a `sensitivity` field (`public` / `pii` / `financial` / `secret`).

To add a new type or improve an existing detector, edit `taxonomy/v0.1/types.jsonl` and open a PR. The agent-seeded types are marked `"seed_origin": "agent_v1.0"` and have a tighter `confidence_floor` (0.6 vs the human-curated 0.5) — those are explicitly flagged for human review. If a type is specific to your workspace, define it in-app as a user type instead — it lives in the `.naklidata` file rather than the shared bundle.

A dedicated `nakli-taxonomy` repo for community-contributed types is planned for v1.1+.

## Privacy

Your data never leaves the tab. The shell HTML is static. DuckDB-wasm loads from jsDelivr with subresource integrity (SHA-384 verified against vendored copies at build time), or from a same-origin vendored fallback (`?offline=1`). DuckDB extensions (currently `json` + `sqlite_scanner` + alias) are vendored at `public/duckdb-extensions/v1.1.1/wasm_eh/` and served same-origin under `?offline=1`. Action sinks write to local folders you explicitly pick via the OS file picker. The `.naklidata` file is a description of your work — sources, types, queries — never a copy of your data.

Workspace state (sources, assignments, cells, settings, sessions) persists across tab reloads via IndexedDB on your machine. BYOK API keys for the optional sidecar live in `sessionStorage` by default (cleared on tab close); opt-in IDB persistence is plaintext with a "Forget" affordance, and a passphrase-encrypted variant is planned for v1.2. See [`docs/spec-amendments.md`](./docs/spec-amendments.md) A2. Local-model weights (Transformers.js runtime) cache in **OPFS** with a visible size + delete affordance in Settings — same posture as BYOK keys.

The sidecar talks only to the provider URL you configured — `api.anthropic.com`, `api.openai.com`, your own custom endpoint, or zero-network (Local provider, once the model is cached). Remote-source I/O goes only to the bucket / URL / catalog / bridge you pointed at. No telemetry, no error reporting, no analytics — the static shell has no place to send those even if we wanted to.

**v1.2.2 hardening sweep** (closed 33 forward-pass + 9 adversarial-review findings — see [`plan/forward-pass-2026-06-02.md`](./plan/forward-pass-2026-06-02.md)):
- **CSP defence-in-depth** — added `base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'` to the policy (amendment [A22](./docs/spec-amendments.md)). `base-uri 'self'` in particular closes the `<base href>` exfil channel that `script-src` doesn't cover.
- **Postinstall hash-pin** — `scripts/fetch-duckdb-*.mjs` now sha384-verify downloaded bytes against the checked-in `integrity.json` and exit 1 on mismatch with a "supply-chain alert" message. Re-verification also fires on the `alreadyVendored()` shortcut so an on-disk tamper between installs gets caught (amendment [A20](./docs/spec-amendments.md)).
- **Sidecar error scrubber** — Bearer / `sk-*` / `sk-ant-*` / `x-api-key:` patterns get redacted from HTTP error bodies before reaching the UI, so a misconfigured proxy echoing the Authorization header on 4xx can't leak your key.

## License

MIT — see [LICENSE](./LICENSE).

## More

- [`STATUS.md`](./STATUS.md) — current build state
- [`DECISIONS.md`](./DECISIONS.md) — running decisions log
- [`plan/`](./plan) — pending backlog, declined items, spec amendments, product shape, remote-sources strategy, sidecar architecture, enterprise strategy
- [`CLAUDE.md`](./CLAUDE.md) — agent rules for working in this repo
