## Last update: 2026-05-15T13:10:00Z
## Current milestone: v1.0
## Build status: green — `npm run build` produces `dist/index.html` (235 KB); `tsc --noEmit` and `biome check` clean
## Deploy status: not yet deployed

## What's done since last check-in
- v1.0 build order step 1 complete: shell + design tokens + esbuild pipeline
- v1.0 build order step 2 in progress: DuckDB engine client (`src/core/engine.ts`)
  - Bundle selection (MVP / EH) via `@duckdb/duckdb-wasm`'s `selectBundle`
  - CDN load (jsdelivr) + vendored fallback via `?offline=1`
  - `query`, `exec`, `registerCsv`/`Tsv`/`Jsonl`/`Parquet`, `drop`, `close`
  - AbortSignal-aware query with `cancelSent()` on abort (spec §3.8 Esc shortcut)
  - Status events wired to the footer dot
- Build pipeline verified end-to-end (npm install → tsc → biome → build)

## What's in progress right now
- (nothing mid-flight; engine module ready for sample-data smoke test)

## What's next (in order)
- Bundled example data under `public/examples/` so we can demo the engine without an FSA mount (helps step 3 too)
- Wire "Browse example data" CTA: download bundled CSVs as Blobs, registerCsv, list tables in the sources panel
- SRI-pinning: generate SHA-384 of the duckdb-wasm worker/module via postinstall, verify in engine before `importScripts`
- FSA folder mount + IndexedDB handle persistence (build order step 3)

## Anything the human should look at
- `DECISIONS.md` — note the sandbox blocks `cdn.sheetjs.com`. xlsx support is build-order step 12; deferred and logged.
- DuckDB-wasm pinned to `1.29.0` (latest 1.x line at training-data cutoff). Bump in a follow-up if 1.30+ is available and stable.
