## Last update: 2026-05-17T06:00:00Z
## Current milestone: **Theme 3 wave 2 — item 1 (URL-state sharing) shipped.** `?lens=<base64>` round-trips the `.naklidata` description (no data); Share button in header; boot prefers URL state over IDB snapshot. v1.0.0 tag landed earlier this session. Next: PWA installability, then multi-session sidebar.
## Build status: green — `dist/index.html` 316 KB; `dist/chunks/codemirror.js` 364 KB lazy; tsc clean; biome 0 errors / 14 warnings; **64 vitest + 6 Playwright e2e** passing; headless smoke green.
## Branch state: `main` and `claude/agent-handoff-start-3c2Ib` both at the latest desktop commit. `v1.0.0` tag pushed.
## Deploy status: not yet deployed; tag is the release source-of-truth.

## Active work — Theme 3 wave 2

Remaining in this push:
  1. ✅ URL-state sharing (`?lens=<base64>`) — shipped.
  2. PWA installability (`manifest.webmanifest` + service worker caching the shell + DuckDB-fallback).
  3. Multi-session sidebar (OpenPlanter-style per-session workspaces).

After Theme 3 wave 2:
  - **Theme 2** — visualization upgrade (Observable Plot lazy chunk + MapLibre map cell + pivot table).
  - **Theme 1 wave 3** — sample-data regen + vendor DuckDB extensions for offline smoke.

## Session highlights — 2026-05-17 (Theme 3 wave 2, item 1: URL-state sharing)

- **New `src/core/url-state.ts`** — `encodeLensParam` / `decodeLensParam` via browser-native `CompressionStream('gzip')` + base64url. `buildShareUrl()`, `readLensFromLocation()`, `clearLensFromLocation()` complete the surface. No new dependencies.
- **Boot precedence**: `?lens=` overrides the IDB workbook snapshot. On bad lens, fall back to IDB (not empty state) so a malformed link doesn't wipe the user's work. URL is stripped via `replaceState` after applying — refresh doesn't re-trigger.
- **Share button** in the shell header (next to Save). Action `share-link` serializes the workbook, encodes, copies to clipboard. Soft warning when URL > 7.8 KB (some chat tools truncate).
- 4 new vitest specs in `tests/url-state.test.ts` (round-trip, compression ratio, malformed-base64, non-`.naklidata` payload). 2 new Playwright specs in `tests/e2e/url-state-share.spec.ts` (Share-and-load round-trip with clipboard.writeText stubbed for headless determinism; corrupted-lens fallback).
- `tests/e2e/playwright.config.ts`: env-var aligned with `scripts/smoke.mjs` convention (`PLAYWRIGHT_CHROMIUM_PATH`, fallback to legacy `CHROMIUM_PATH`, fallback to Playwright bundled chromium). Capped at `workers: 2` — default `workers: N-cores` caused intermittent engine-boot timeouts from parallel DuckDB-wasm boots.

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
