# naklios

> Browser-native semantic data workbench. Point it at your files, folders, and public data dumps; it tells you what's in them, lets you query and chart, and writes results back into your other tools — without anything leaving the tab.

**Status:** v1.0 in active development. See `STATUS.md` for current state.

## What it is

A single-HTML-shell tool that reads CSV, TSV, JSONL, Parquet, SQLite, and Excel files from your local disk (via the File System Access API) and runs SQL queries against them using DuckDB-wasm. A versioned semantic taxonomy classifies columns into types you recognize — GSTIN, HSN code, IFSC, ISO currency, vendor name, timestamp, and so on — and the results can be written back as CSV/Parquet, KanZen card imports, Bahi journal proposals, or NakliPoster collections.

## What it isn't

- Not a hosted SaaS. There is no server, no login, no telemetry.
- Not an ingestion pipeline. Data stays where it is on your disk.
- Not an "AI insights" generator. The LLM sidecar (v1.1) does narrow column disambiguation, never prose narration.
- Not multi-user. The `.naklilens` save file is the sharing primitive.

## Browser support

- **Supported:** Chrome / Edge / Opera 122+ (File System Access + OPFS).
- **Partial:** Firefox — single-file mounts only; folder mount unavailable (FSA gap).
- **Not supported:** Safari (yet). The app detects and shows a respectful note.

## Quick start (developers)

```bash
npm install
npm run dev      # serves on http://localhost:5173
npm run check    # tsc + biome
npm run test     # vitest
npm run build    # → dist/index.html (single file)
```

`npm install` will attempt to vendor DuckDB-wasm into `public/duckdb-fallback/`. Set `SKIP_DUCKDB_FETCH=1` to skip; the app will use the CDN at runtime.

## Privacy

Your data never leaves the tab. The shell HTML is static. DuckDB-wasm loads from jsDelivr with subresource integrity, or from a vendored copy. Action sinks write to local folders you explicitly choose. The `.naklilens` file is a description of your work — sources, types, queries — never a copy of your data.

## License

MIT. See `LICENSE`.
