# NakliData

> Browser-native semantic data workbench. Point it at your files, folders, or public data dumps; NakliData tells you what's in them, lets you query and chart, and writes results back into your other tools — without anything leaving the tab.

---

## What it is

A single-HTML-shell tool that reads tabular data from your local disk (via the File System Access API) and runs SQL against it using DuckDB-wasm. A versioned semantic taxonomy classifies your columns into types you recognize — GSTIN, HSN code, IFSC, ISO currency, email, vendor name, timestamp, log level, and so on. From a query result you can write CSV / Parquet to a folder you choose, push to KanZen as cards, propose a Bahi journal, or parametrize a NakliPoster collection. The notebook, the schema panel, the chart cells, the action sinks — all in the browser tab.

Supported file formats today: CSV · TSV · JSONL · Parquet · Arrow IPC (`.arrow` / `.feather`) · SQLite · DuckDB (`.duckdb`) · Excel `.xlsx` · SPSS (`.sav` / `.zsav` / `.por`) · Stata `.dta` · SAS (`.sas7bdat` / `.xpt`). The statistical formats, SQLite, and Excel mount via DuckDB extensions on first use.

## What it isn't

- **Not a hosted SaaS.** No server, no accounts, no login, no telemetry. NakliData is a static page; you can self-host it on a USB stick.
- **Not an ingestion pipeline.** The data stays on your disk. Even with cloud-storage sources (v1.1), bytes go from the bucket directly to your browser — no third party in the middle.
- **Not an "AI insights" generator.** The optional v1.1 LLM sidecar does narrow column classification + error explanation. It never writes prose narration of your results and never auto-executes SQL.
- **Not multi-user.** The `.naklidata` save file is the sharing primitive — send the file, not a link.

## Browser support

- **Supported:** Chrome / Edge / Opera 122+ (File System Access + OPFS).
- **Partial:** Firefox — single-file mounts work; folder mount unavailable until FSA lands ([Mozilla feature tracker](https://bugzilla.mozilla.org/show_bug.cgi?id=1748582)).
- **Not supported:** Safari (yet). The app detects and shows a respectful "not supported here yet" page.

## Quick start

For end users: visit the hosted build (URL TBD when published), click **Browse example data**, and start querying. No install. Your browser stores your workspace in IndexedDB so reopening the tab restores everything.

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
npm run test:e2e         # build + Playwright e2e tests (auto-restore, save/load, lazy-chunk)
npm run build            # → dist/index.html (the shell) + dist/chunks/ (lazy chunks)
```

`SKIP_DUCKDB_FETCH=1` on `npm install` skips the postinstall vendoring (useful in network-restricted CI).

## Example data

`public/examples/` ships a small synthetic bundle of Indian-SMB-finance shape (~25 vendors, 80 invoices, 65 payments with valid-checksum GSTINs, PANs, IFSCs, HSN codes) plus a small NDJSON access-log fixture. The schema panel auto-classifies ~25 columns on first mount, which is the fastest way to see the taxonomy in action without bringing your own data.

Regenerate the fixtures with `node scripts/gen-examples.mjs` (deterministic; same seed → same output). The GSTIN generator implements the real base-36 check-digit algorithm so the GSTIN-checksum detector lights up.

## The `.naklidata` file format

Save the current notebook (Cmd/Ctrl+S) and you get a `.naklidata` file — JSON, versioned, human-readable. It describes your work but never contains your data:

- mounted sources (label, kind, ref, table names — not bytes)
- column type assignments (typeId per column, origin: detector/user_accept/user_override, confidence, evidence)
- notebook cells (SQL / markdown / chart, ordered)
- workspace settings (auto-accept threshold, etc.)

On load, NakliData re-mounts each source. Example-bundle sources auto-re-mount; FSA folder sources prompt for permission re-grant if needed; bytes are never embedded in the lens file.

Schema canonical: spec §5. Format identifier: `"format": "naklidata"`, currently at version 1.0.

## Taxonomy contribution flow

The v0.1 taxonomy bundle ships in `taxonomy/v0.1/` — ~40 semantic types across three domains (Indian SMB finance, generic finance, generic logs). Each type has a header-name match list, an optional regex, optional checksum (e.g., the GSTIN base-36 check digit), optional value-set lookup, and an SQL-type compatibility set.

To add a new type or improve an existing detector, edit `taxonomy/v0.1/types.jsonl` and open a PR. The agent-seeded types are marked `"seed_origin": "agent_v1.0"` and have a tighter `confidence_floor` (0.6 vs the human-curated 0.5) — those are explicitly flagged for human review.

A dedicated `nakli-taxonomy` repo for community-contributed types is planned for v1.1+.

## Privacy

Your data never leaves the tab. The shell HTML is static. DuckDB-wasm loads from jsDelivr with subresource integrity (SHA-384 verified against vendored copies at build time), or from a same-origin vendored fallback (`?offline=1`). Action sinks write to local folders you explicitly pick via the OS file picker. The `.naklidata` file is a description of your work — sources, types, queries — never a copy of your data.

Workspace state (sources, assignments, cells, settings) persists across tab reloads via IndexedDB on your machine. BYOK API keys for the v1.1 LLM sidecar live in `sessionStorage` by default (cleared on tab close); opt-in IDB persistence will be available with honest UI labelling and a "Forget" button. See `plan/spec-amendments.md` A2.

## License

MIT — see [LICENSE](./LICENSE).

## More

- `STATUS.md` — current build state
- `DECISIONS.md` — running decisions log
- `plan/` — pending backlog, declined items, spec amendments, product shape, remote-sources strategy, sidecar architecture, enterprise strategy
- `CLAUDE.md` — agent rules for working in this repo
