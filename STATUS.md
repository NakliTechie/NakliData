## Last update: 2026-05-17T05:45:00Z
## Current milestone: **v1.0.0 tag landed on origin.** Annotated tag points at `5b10b93` per the handoff notes; pushed from desktop session. GitHub default branch switched to `main` (was the leftover `claude/agent-handoff-start-3c2Ib`). Now opening Theme 3 wave 2.
## Build status: green — `dist/index.html` 316 KB; `dist/chunks/codemirror.js` 364 KB lazy; tsc clean; biome 0 errors / 14 warnings; 60 vitest + 4 e2e tests passing; headless smoke green on desktop (4 source tables mounted vs the sandbox's 3 — desktop reaches `extensions.duckdb.org` for the JSONL extension).
## Branch state: `main` and `claude/agent-handoff-start-3c2Ib` both at the latest desktop commit (smoke-script portability fix on top of the handoff-notes commit). `v1.0.0` tag pushed.
## Deploy status: not yet deployed; tag is the release source-of-truth.

## Active work — Theme 3 wave 2

Order in this push:
  1. URL-state sharing (`?lens=<base64>` round-trip of the `.naklidata` JSON, no data).
  2. PWA installability (`manifest.webmanifest` + service worker caching the shell + DuckDB-fallback).
  3. Multi-session sidebar (OpenPlanter-style per-session workspaces).

After Theme 3 wave 2:
  - **Theme 2** — visualization upgrade (Observable Plot lazy chunk + MapLibre map cell + pivot table).
  - **Theme 1 wave 3** — sample-data regen + vendor DuckDB extensions for offline smoke.

## Session highlights — 2026-05-17 (desktop pickup, tag landed)

- **v1.0.0 tag pushed** — annotated tag at `5b10b93` per `plan/v1.0-handoff-notes.md`. Web session created the tag locally but couldn't push (sandbox 403 on tag pushes); desktop session landed it cleanly.
- **GitHub default branch switched to `main`** — was the bootstrap leftover `claude/agent-handoff-start-3c2Ib`. Both branches stay tracked.
- **Smoke script made portable** — `scripts/smoke.mjs` no longer hardcodes the sandbox chromium path. Uses `PLAYWRIGHT_CHROMIUM_PATH` env var if set; otherwise lets Playwright pick the bundled chromium. DECISIONS entry at 2026-05-17 11:10.
- Desktop-handoff checklist passed end-to-end: install (postinstall vendored DuckDB + integrity.json), check (clean, 14 expected biome warnings), test (60/60), smoke (all 12 assertions; mounted 4 source tables = sandbox's 3 + the JSONL log that needs `extensions.duckdb.org`), build size under budget.

## Session highlights — 2026-05-17 (pre-tag bundle)

- **CodeMirror 6 returns as a lazy chunk.** `src/lazy/codemirror.ts` exports `mountSqlEditor(host, opts)` (SQL syntax + autocomplete + line numbers). `src/ui/cells/sql-cell.ts` renders a textarea first and asynchronously upgrades to CM6 once the chunk lands; per-cell-id `cmInstances` map preserves editor state across notebook re-renders. `disposeSqlCellEditor(cellId)` released on cell delete. Shell stays under the 600 KB gate (320 KB); CM6 chunk is 370 KB, fetched only when a SQL cell renders. Closes the §7.1 vs §1 spec tension recorded in DECISIONS 2026-05-15 14:10.
- **DuckDB-wasm SRI pinning.** `scripts/fetch-duckdb-fallback.mjs` now sources from `node_modules/@duckdb/duckdb-wasm/dist/` first (with CDN fallback) and writes `public/duckdb-fallback/integrity.json` with SHA-384 hashes per file. `src/core/engine.ts` imports the integrity manifest and, on the CDN path (`!opts.offline`), calls `fetchWithSri(url, integrity)` for the worker JS + wasm before passing them to DuckDB as blob URLs. Closes the §7.1 gate artifact "DuckDB-wasm boots from CDN with SRI."
- **README pass per spec §3.10.** Full rewrite: what it is, what it isn't, browser support (Chrome/Edge/Opera 122+ / Firefox partial / Safari unsupported), quick start (end-user + dev), example data, `.naklidata` format, taxonomy contribution flow, privacy posture (SRI verification + workspace IDB persistence + BYOK sessionStorage default with opt-in IDB), license, links to STATUS / DECISIONS / plan / CLAUDE.md.

## Session highlights — earlier 2026-05-17

- Theme 1 wave 2: lazy code-splitting infra + Apache Arrow IPC mount. 5 new tests; spec §3.1 formats list at 13.
- Theme 3 wave 1: workspace state auto-saves + auto-restores from IDB (per spec amendment A1). 2 new e2e tests.

## Sandbox limitation
Dev sandbox blocks `extensions.duckdb.org` so Theme 1 mounts requiring DuckDB extensions can't be exercised in the local smoke. User's browser works fine; vendoring extensions (Theme 1 wave 3) closes the local gap.
