## Last update: 2026-05-17T04:40:00Z
## Current milestone: Pre-v1.0-tag gates complete; `main` fast-forwarded to `5b10b93`; `v1.0.0` tag created locally but NOT pushed (harness git proxy returns 403). Desktop session needs to land the tag — see `plan/v1.0-handoff-notes.md`.
## Build status: green — `dist/index.html` 320 KB; `dist/chunks/codemirror.js` 370 KB lazy; tsc clean; biome 0 errors / 14 warnings; 60 vitest + 4 e2e tests passing; headless smoke green
## Branch state: `main` and `claude/agent-handoff-start-3c2Ib` both at `5b10b93` (pushed). `v1.0.0` annotated tag is local-only.
## Deploy status: not yet deployed; tag push pending desktop session

## Pick-up next session — see `plan/progress.md` for the full checkpoint

Recommended order:
  1. **Theme 3 wave 2** — URL-state sharing + PWA install + multi-session sidebar.
  2. **Theme 2** — visualization upgrade (Observable Plot lazy chunk + MapLibre map cell + pivot table).
  3. **Theme 1 wave 3** — sample-data regen + vendor DuckDB extensions for offline smoke.

## Session highlights — 2026-05-17 (pre-tag bundle)

- **CodeMirror 6 returns as a lazy chunk.** `src/lazy/codemirror.ts` exports `mountSqlEditor(host, opts)` (SQL syntax + autocomplete + line numbers). `src/ui/cells/sql-cell.ts` renders a textarea first and asynchronously upgrades to CM6 once the chunk lands; per-cell-id `cmInstances` map preserves editor state across notebook re-renders. `disposeSqlCellEditor(cellId)` released on cell delete. Shell stays under the 600 KB gate (320 KB); CM6 chunk is 370 KB, fetched only when a SQL cell renders. Closes the §7.1 vs §1 spec tension recorded in DECISIONS 2026-05-15 14:10.
- **DuckDB-wasm SRI pinning.** `scripts/fetch-duckdb-fallback.mjs` now sources from `node_modules/@duckdb/duckdb-wasm/dist/` first (with CDN fallback) and writes `public/duckdb-fallback/integrity.json` with SHA-384 hashes per file. `src/core/engine.ts` imports the integrity manifest and, on the CDN path (`!opts.offline`), calls `fetchWithSri(url, integrity)` for the worker JS + wasm before passing them to DuckDB as blob URLs. Closes the §7.1 gate artifact "DuckDB-wasm boots from CDN with SRI."
- **README pass per spec §3.10.** Full rewrite: what it is, what it isn't, browser support (Chrome/Edge/Opera 122+ / Firefox partial / Safari unsupported), quick start (end-user + dev), example data, `.naklidata` format, taxonomy contribution flow, privacy posture (SRI verification + workspace IDB persistence + BYOK sessionStorage default with opt-in IDB), license, links to STATUS / DECISIONS / plan / CLAUDE.md.

## Session highlights — earlier 2026-05-17

- Theme 1 wave 2: lazy code-splitting infra + Apache Arrow IPC mount. 5 new tests; spec §3.1 formats list at 13.
- Theme 3 wave 1: workspace state auto-saves + auto-restores from IDB (per spec amendment A1). 2 new e2e tests.

## Sandbox limitation
Dev sandbox blocks `extensions.duckdb.org` so Theme 1 mounts requiring DuckDB extensions can't be exercised in the local smoke. User's browser works fine; vendoring extensions (Theme 1 wave 3) closes the local gap.
