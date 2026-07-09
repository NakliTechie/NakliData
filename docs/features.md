# NakliData — feature reference

A functional tour of what NakliData does. The [README](../README.md) is the
short version; this is the detail. For *why* things were built the way they were,
see [`DECISIONS.md`](../DECISIONS.md) and [`docs/spec-amendments.md`](./spec-amendments.md).

## Data sources

NakliData reads tabular data from local files/folders and five remote source
kinds. Bytes flow from the source directly to your browser — nothing relays
through a NakliData server (there isn't one). CORS or signed-URL access still
applies: the source has to be reachable from your browser context.

**File formats (15):** CSV · TSV · JSONL · Parquet · Arrow IPC (`.arrow` /
`.feather`) · SQLite · DuckDB (`.duckdb`) · Excel `.xlsx` · SPSS (`.sav` /
`.zsav` / `.por`) · Stata `.dta` · SAS (`.sas7bdat` / `.xpt`) · GeoJSON · KML.
Statistical formats, SQLite, Excel, and spatial formats mount via vendored
readers / DuckDB extensions on first use.

**Remote sources:**

- **HTTPS by URL** — a CSV / Parquet / Arrow / JSONL file over HTTPS (server must
  send acceptable CORS headers). Bearer tokens follow the BYOK posture below.
- **S3-compatible** — AWS S3, Cloudflare R2, MinIO, B2, Wasabi. Anonymous public
  buckets or signed access (access key + secret); region + endpoint configurable.
  DuckDB's `httpfs` extension does the I/O.
- **Apache Iceberg by URL** — catalog-less; point at a table directory or
  `metadata.json` and the latest snapshot mounts via DuckDB's `iceberg` extension.
- **Iceberg REST catalog** — Nessie, Polaris, AWS Glue (REST adapter), etc.;
  Bearer auth. List namespaces + tables, pick one to mount.
- **Compute Bridge** — a small sidecar binary fronting your warehouse (DuckDB,
  Snowflake, BigQuery, Trino…) over HTTP + Arrow IPC. You write SQL against the
  warehouse; the bridge returns the result; NakliData registers it as a bounded
  Arrow buffer. Protocol: [`plan/compute-bridge-protocol.md`](../plan/compute-bridge-protocol.md).

## The notebook

An ordered list of cells. Reference other cells by `@cellName`.

- **SQL cell** — CodeMirror editor (lazy-loaded). Errors render inline.
  **Associative cross-filter:** click a value in any result and the engine paints
  SELECTED / ASSOCIATED / EXCLUDED states across results — non-co-occurring values
  grey out (absence-as-signal, Qlik's model). The **Associations** panel links
  columns across cells so a selection in one cross-filters the others.
- **Chart cell** — eleven types: bar, line, area, scatter, histogram, stat,
  table, pie, plus stacked-bar / area-stacked / heatmap. A `facet-by` picker draws
  small-multiples. A **Manual | Shelves** toggle adds VizQL-style drag authoring
  (Columns / Rows / Color drop-zones compile to the same chart config).
- **Stats cell** — descriptive statistics + a correlation matrix over an upstream
  cell's numeric columns, all in DuckDB SQL.
- **Report cell** — a paginated surface (KPI tiles + embedded cells); print to PDF
  via the browser's print dialog.
- **Pivot cell** — row / column / value + aggregation (sum / avg / min / max /
  count); totals render only when semantically meaningful.
- **Map cell** — tile-less MapLibre canvas (no basemap — privacy-clean); reads a
  GeoJSON geometry column, optionally colors by a categorical property.
- **Markdown cell** — a minimal hand-rolled subset for annotations.
- **Cohort cell** — SQL returning a `user_id` column; referenced via
  `@<cohort_name>` downstream (queries JOIN against it).
- **Assertion cell** — SQL that should return 0 rows when an invariant holds;
  PASS/FAIL pill + counter-example count. Catches data-quality regressions inline.
- **Input cell** — an interactive parameter (text / number / date / select);
  the value inlines into downstream SQL via `@<name>` (quote-doubled, injection-safe).
- **Dashboard cell** — a CSS grid of named markdown / chart / pivot / map cells,
  re-rendered with editing chrome stripped.
- **Facet cells** (graph + distribution explorers) — Embedding (scatter a
  precomputed projection), Network (force-directed graph, in-house Barnes–Hut
  layout up to ~30k nodes), Knowledge-graph, Weighted, Temporal (brushable
  timeline), Distribution (histogram / top-value bars). Temporal + Distribution
  selections cross-filter downstream SQL cells via the `CROSSFILTER(name)` macro.
- **Language cells** — Python (Pyodide + pandas) and R (WebR) run over an upstream
  result and re-register their output as a queryable table. Sovereign runtimes,
  vendored same-origin; CodeMirror editors with syntax highlighting.

## Result actions & sinks

Every SQL result carries one-click actions:

- **Save HTML** — export the notebook as a self-contained `.html` (markdown +
  chart SVGs + tables, no JS, no engine). Email it, drop it in a doc.
- **Embed** — wrap that export in a sandboxed `<iframe srcdoc>` snippet for a
  wiki / intranet (read-only, server-free, offline).
- **Export anonymized** — a per-column dialog (keep / hash / redact / bucket /
  drop) with defaults driven by the column's sensitivity badge; applied via a
  DuckDB SQL projection rewrite. Per-export salt, shown once, never persisted;
  a JSON manifest records the strategy map + taxonomy version.
- **Export golden table** (Resolve *own*) — collapse a result to one row per
  canonical entity with a per-column survivorship rule (keep-first / max / min /
  latest), written to a folder as CSV or Parquet.
- **Build a query (visual)** — a form (source, multiple joins, filters, GROUP BY
  + aggregates, LIMIT) with live SQL preview → "Insert as SQL cell." Multi-join,
  no nested subqueries; injection-safe emitter.
- **Calc field** — add a computed column: *Expression* mode (free expression over
  the result) or *Window (LOD)* mode (Tableau-style level-of-detail calc with
  optional `PARTITION BY`). Output is a new SQL cell.
- **X-Ray** — one click inserts + runs a stats cell bound to the result.
- **Cluster values** (Resolve *resolve*) — fuzzy-merge variant spellings into a
  canonical column. Two OpenRefine-standard methods: key collision (fingerprint,
  default) and nearest neighbour (edit distance, opt-in). Review clusters, then it
  emits a reproducible `CASE WHEN … END AS "col__merged"` SQL cell.
- **Suggest a chart** — asks the sidecar for a strict JSON chart config (no prose;
  columns validated against the result), materialised as a chart cell.
- **Check for source updates** (Refresh) — a single change-detection sweep (FSA
  folders re-fingerprint; HTTP URLs HEAD-probe) showing which sources changed and
  which cells are downstream; re-run the stale cells on click. No background polling.
- **Cell lineage** — a panel answering "where does this number come from?", built
  by walking the DuckDB `EXPLAIN (FORMAT JSON)` plan (CTEs shadow tables correctly).
  List view + a hand-rolled SVG (sources / cells / sinks); persists into `.naklidata`.
- **Semantic layer** — named, versioned **measures** (`MEASURE(revenue)`),
  **dimensions** (`DIM(gstin_state)`), and **segments** (`SEGMENT(name)` WHERE
  predicates). All macro-expand in one audited pass; a "View as code" toggle shows
  the layer as editable JSON, round-tripped in the `.naklidata` description.
- **Presentation mode** — `?present=1` hides editing surfaces; markdown / chart /
  pivot / map keep rendering.

## The schema panel

The taxonomy is what makes NakliData feel different — it knows what your columns
*mean*, not just their SQL types.

- **Auto-classify** runs in a Web Worker against `taxonomy/v0.1` (48 semantic
  types: GSTIN, HSN, IFSC, PAN, ISO currency, email, vendor name, timestamp, log
  level, `event_name` / `user_id` / `utm_*`, …). Confidence scores + evidence
  shown; auto-accept threshold is configurable.
- **Sensitivity badges** — each type carries `public` / `pii` / `financial` /
  `secret`; PII / financial columns get a badge.
- **Quick-chart suggestions** — a per-column affordance emits ready-to-run SQL +
  chart + markdown based on the assigned type and same-table partners.
- **Column profile** — cardinality, null %, length distribution, top-5 values,
  plus a five-number distribution + IQR outlier count for numeric columns.
- **Override** a column, or "Remember rule" to promote it to an `override_rules`
  entry applied on every future mount.
- **Define a new type** — a modal to write a spec (header match + regex + checksum
  + sql_type); user types persist per-workspace and feed back to the classifier.
- **Compare tables** — pick a join key (auto-suggested from shared types) →
  FULL OUTER JOIN + bucket aggregate + sampled per-row diff.
- **Schema graph** — a Cytoscape modal of taxonomy-type relationships.
- **Demo mode** — masks paths + column names (`col_1`, `tbl_1`, …) for
  screenshots (SQL text + data values are not masked — clear those manually).

## AI sidecar (BYOK, optional)

Off by default. Settings → AI sidecar to enter a key. Eight narrow jobs, each with
a hallucination guard in the parser (not just the prompt), and **never prose
narration, never auto-executed SQL**:

1. **Explain query error** — plain prose + an optional "Copy SQL" fix (you run it).
2. **Disambiguate type** — one-token answer among the plausible candidates.
3. **Define a new type** — fills regex / checksum / sql_type guesses; you edit.
4. **Recommend reports** — ranks candidate report templates against your schema.
5. **NL → SQL** — plain English → a DuckDB `SELECT`, behind five parser safety
   guards (must start SELECT/WITH; write/DDL keywords rejected; multi-statement
   rejected; replacement-scan FROM rejected; every table in an allowlist). Lands
   as a cell you Run. Only table + column names are shipped — no row data.
6. **Summarise result** — a one-line observation (column refs must match a real
   result column). Only columns + 5 sample rows are shipped.
7. **Propose a chart** — strict JSON chart config; columns validated against the
   result. Only column names + 10 sample rows shipped.
8. **Propose a merge** — adjudicates only the borderline value pairs clustering
   didn't group; structured decisions, per-pair allowlist guard, fully removable.

**BYOK posture:** keys live in `sessionStorage` by default (cleared on tab close).
"Remember on this device" stores plaintext in IndexedDB with honest labelling +
a "Forget" affordance; "Forget all stored keys" lives in settings.

**Providers (four):** Anthropic, OpenAI, Custom OpenAI-compatible endpoints
(Ollama / vLLM / LM Studio / llamafile), and a fully in-browser **Local** runtime
(Transformers.js). A "Test connection" button verifies cloud / custom endpoints;
custom URLs are `https://`-only with the resolved host surfaced inline.

**Local provider** (no API key, no network after the one-time model download):
Qwen2.5-1.5B-Instruct (~0.9 GB, recommended), Phi-3.5-mini-instruct (~2.3 GB, best
NL→SQL), Llama-3.2-1B-Instruct (~0.7 GB, smallest). Weights cache in OPFS,
inspectable + deletable from Settings; auto-load at boot when cached. Runs on the
`wasm` device (WebGPU opt-in is a planned follow-up).

## Sessions & sharing

- **Multi-session** — create / switch / rename / delete named sessions; each has
  its own IndexedDB snapshot; auto-save writes to the active session.
- **Auto-restore** — sources, column assignments, cells, settings, and FSA folder
  handles restore on tab open (folder permission re-verifies silently, else a
  "Reconnect" banner appears).
- **Share link** (`?lens=`) — serializes the notebook to gzip + base64url and
  copies a URL. It carries the *description* of your work — never your data. Remote
  sources trigger a confirmation modal listing every host the link would fetch from.
- **PWA installable** — `manifest.webmanifest` + service worker; shell + lazy
  chunks precache; the large vendored runtimes (Pyodide / WebR / DuckDB-ext) cache
  in a separate deploy-independent runtime cache. Load with `?offline=1` once to
  warm the DuckDB-fallback bytes.

## The `.naklidata` file format

Save (Cmd/Ctrl+S) → a `.naklidata` file: JSON, versioned, human-readable. It
describes your work but never contains your data:

- mounted sources (label, kind, ref, table names — not bytes)
- column type assignments (typeId, origin, confidence, evidence)
- notebook cells (ordered)
- user types (per-workspace taxonomy extensions)
- override rules
- workspace settings

On load, NakliData re-mounts each source (example bundle auto-remounts; FSA
folders prompt for permission re-grant). Format identifier `"format": "naklidata"`,
version `1.0`, additive — new fields round-trip through older readers.

## Taxonomy contribution flow

The v0.1 bundle (`taxonomy/v0.1/`) ships 48 semantic types across four domains
(Indian SMB finance, generic finance, generic logs, product analytics). Each type
has a header-match list, optional regex / checksum / value-set, an SQL-type
compatibility set, and a `sensitivity` field.

To add or improve a detector, edit `taxonomy/v0.1/types.jsonl` and open a PR.
Agent-seeded types (`"seed_origin": "agent_v1.0"`) carry a tighter confidence floor
and are flagged for human review. Workspace-specific types are better defined
in-app as user types (they live in the `.naklidata` file, not the shared bundle).
A dedicated `nakli-taxonomy` repo for community types is planned.
