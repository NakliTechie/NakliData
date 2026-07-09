# NakliData

> Browser-native semantic data workbench. Point it at your files, folders, or public data dumps; NakliData tells you what's in them, lets you query and chart, and writes results back into your other tools — without anything leaving the tab.

**Try it:** [naklidata.naklitechie.com](https://naklidata.naklitechie.com/) → click **Browse example data**. No install, no account.

## What it is

A single-HTML-shell tool that reads tabular data — from your local disk (File
System Access API), S3-compatible storage, public URLs, Apache Iceberg tables, or
a local Compute Bridge — and runs SQL against it with DuckDB-wasm, entirely in the
browser tab. A versioned **semantic taxonomy** classifies your columns into types
you recognize (GSTIN, HSN code, IFSC, email, vendor name, timestamp, log level, …),
not just their SQL types. From a query result you can chart, pivot, map, run
Python/R, resolve messy entities, and export — nothing is uploaded.

It also **resolves** data locally — the sovereign, file-owned take on a CDP's
*resolve → segment → own* loop: fuzzy-cluster variant spellings, define reusable
`SEGMENT(name)` audiences, and own the deduped golden table as a file you keep.

Supports 15 file formats (CSV, TSV, JSONL, Parquet, Arrow, SQLite, DuckDB, Excel,
SPSS, Stata, SAS, GeoJSON, KML) plus five remote source kinds.

## What it isn't

- **Not a hosted SaaS.** No server, no accounts, no login, no telemetry — a static page you can self-host on a USB stick.
- **Not an ingestion pipeline.** Data stays on your disk; even cloud sources go bucket → browser with no third party in the middle.
- **Not an "AI insights" generator.** The optional BYOK sidecar does eight narrow jobs — it never narrates your results and never auto-executes SQL.
- **Not multi-user.** The `.naklidata` file (or a data-free `?lens=` link) is the sharing primitive — send the file, not a login.

## Browser support

- **Supported:** Chrome / Edge / Opera 122+ (File System Access + OPFS).
- **Partial:** Firefox — single-file mounts work; folder mount awaits FSA.
- **Not supported:** Safari (yet) — the app detects it and shows a graceful notice.

## Quick start

Developers cloning the repo:

```bash
git clone https://github.com/NakliTechie/NakliData
cd NakliData
npm install     # also vendors DuckDB-wasm locally with SRI hashes
npm run dev     # http://localhost:5173 with hot reload
```

Common scripts:

```bash
npm run check   # tsc --noEmit + biome check
npm run test    # vitest unit tests
npm run smoke   # build + headless browser smoke test
npm run build   # → dist/index.html (the shell) + dist/chunks/ (lazy chunks)
```

`SKIP_DUCKDB_FETCH=1` on `npm install` skips the postinstall vendoring (for
network-restricted CI). Example fixtures live in `public/examples/`; regenerate
with `npm run gen-examples`.

## Features at a glance

- **Notebook** — SQL, chart, pivot, map, stats, report, markdown, cohort,
  assertion, input, dashboard, Facet (graph/distribution), and Python/R cells.
  Reference cells by `@name`; associative cross-filtering across results.
- **Schema panel** — Web-Worker auto-classification into 48 semantic types with
  confidence + evidence, sensitivity badges, per-column profiles, overrides, and
  user-defined types.
- **Resolve** — cluster variant spellings, define `SEGMENT(name)` audiences, and
  export a golden (deduped) table you own.
- **Sinks** — save/embed self-contained HTML, anonymized export, golden table,
  visual query builder, calc fields, cell lineage, and a semantic layer
  (`MEASURE` / `DIM` / `SEGMENT`).
- **AI sidecar (BYOK, optional, off by default)** — eight narrow jobs (explain
  error, NL→SQL, summarise, propose chart, …). Cloud (Anthropic / OpenAI /
  custom) or fully in-browser local models. Never prose, never auto-run.

Full detail: **[docs/features.md](./docs/features.md)**.

## Privacy

Your data never leaves the tab. The shell is a static page; DuckDB-wasm loads
from jsDelivr with SRI verification (or a same-origin vendored fallback under
`?offline=1`). Sinks write only to local folders you pick. The `.naklidata` file
describes your work — sources, types, queries — never a copy of your data.
Workspace state persists in IndexedDB on your machine; BYOK keys live in
`sessionStorage` by default. The sidecar talks only to the provider you
configured. **No telemetry, no error reporting, no analytics** — the static shell
has nowhere to send them.

## License

MIT — see [LICENSE](./LICENSE).

## Docs

- [`docs/features.md`](./docs/features.md) — full feature reference
- [`STATUS.md`](./STATUS.md) — current build state
- [`DECISIONS.md`](./DECISIONS.md) — running decisions log
- [`docs/spec-amendments.md`](./docs/spec-amendments.md) — ratified spec changes
- [`docs/release-notes/`](./docs/release-notes) — per-version changelogs
- [`CLAUDE.md`](./CLAUDE.md) — agent rules for working in this repo
