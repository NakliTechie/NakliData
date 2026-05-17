## Last update: 2026-05-17T02:40:00Z
## Current milestone: Theme 1 wave 2 (lazy splitting + Arrow IPC) shipped; v1.0 + Theme 1 wave 1 + Theme 3 wave 1 already on `main`
## Build status: green — `dist/index.html` 312 KB; tsc clean; biome 0 errors / 14 warnings; 60 vitest + 4 e2e tests passing; headless smoke green
## Branch state: `main` and `claude/agent-handoff-start-3c2Ib` aligned; pushed
## Deploy status: not yet deployed

## Pick-up next session — see `plan/progress.md` for the full checkpoint

Recommended order:
  1. **Pre-v1.0-tag gates** — first real user of the new lazy-splitting infra. CodeMirror 6 in `src/lazy/codemirror.ts` + SRI pinning for DuckDB-wasm + README pass per spec §3.10 + tag `v1.0.0`.
  2. **Theme 3 wave 2** — URL-state sharing + PWA install + multi-session sidebar.
  3. **Theme 2** — visualization upgrade (Observable Plot lazy chunk + MapLibre map cell + pivot table).

## Session highlights — 2026-05-16

- v1.0 merged to `main`.
- Spec amendments locked in (`plan/spec-amendments.md`): workspace state persists in IDB; BYOK opt-in plaintext (default A) + passphrase-encrypted (v1.2 B); data-plane / control-plane split; project naming.
- Portfolio-wide directive committed: every NakliTechie project must include AI sidecar + BYOK (`~/.claude/CLAUDE.md` + project `CLAUDE.md`).
- Enterprise strategy doc landed (`plan/enterprise-strategy.md`): Compute Bridge as sibling OSS repo (`NakliTechie/nakli-compute` working name), AI split between browser baseline + bridge enhancement, self-hosted + "deploy for me" professional services later.
- Sidecar architecture doc landed (`plan/sidecar-architecture.md`): LoRA-Gemma phasing, eval-harness foundation, browser/bridge split.
- Filestores-as-database options laid out (`plan/remote-sources.md`).
- Plan/ folder structure formalized (`plan/README.md` indexes the lot).
- Theme 1 wave 1: SQLite + DuckDB + Excel + SPSS/SAS/Stata via DuckDB extensions. Spec §3.1 formats 6 → 12.
- 20 new vitest tests for format detection + mount routing; total now 56.

## Sandbox limitation
Dev sandbox blocks `extensions.duckdb.org` so Theme 1 mounts requiring extensions can't be exercised in the local smoke. User's browser works fine; vendoring extensions (Theme 1 wave 2) closes the local gap.

## Earlier work — preserved from prior check-in
- v1.0 build-order steps 1-11, 13, 14 complete (per `02-SPEC.md` §9)
- 16 commits on `claude/agent-handoff-start-3c2Ib` merged to `main` at `ec35c71` (pre-Theme-1)
- Theme 1 wave 1 lands at `25ebe14` (current HEAD)
## Deploy status: not yet deployed

## What's done since last check-in (combined with prior)
- Build order step 10 (action sinks) and step 8 (.naklilens save/load) done
- 5 action sinks (`src/ui/sinks/sinks.ts`): CSV, Parquet, KanZen, Bahi proposal, NakliPoster
  - CSV / Parquet via DuckDB `COPY ... TO` + `db.copyFileToBuffer`
  - KanZen / Bahi / NakliPoster emit downstream-compatible JSON via FSA `showSaveFilePicker`
  - Type-gated menu surface inside SQL cells (incompatible sinks shown disabled with reason)
- `.naklilens` persistence (`src/core/persistence.ts`):
  - Save: serialize sources + assignments + cells (results stripped) + threshold
  - Load: re-mount example-bundle sources by ref; flag FSA sources as "Reconnect needed"
  - Version gate: refuses files newer than 1.0 with a clear message (spec §3.9)
  - Cmd/Ctrl+S keyboard shortcut wired
- Header now has Open + Save buttons (Save was previously disabled)

## What's done since the previous check-in
- Build order step 7 (notebook UI) and step 9 (chart renderer) done as a first cut
- Cells: SQL / markdown / chart, with a Notebook orchestrator that owns:
  - Run with AbortSignal-aware engine.query
  - `@cellName` rewrite to `cell_<id>` views for chain composition
  - Run-all over document order (real topo-sort deferred)
  - Cmd/Ctrl+Enter (run cell), Cmd/Ctrl+Shift+Enter (run all)
- SQL cell: tab-aware textarea + run button + paginated result table
  (CodeMirror 6 deferred — see DECISIONS 14:10)
- Markdown cell: minimal renderer (headings, paragraphs, bold/italic, code, lists)
- Chart cell: 7 chart types (bar / line / area / scatter / histogram / stat / table)
- Chart renderer (`src/charts/render.ts`): pure canvas/SVG, Rangrez palette only,
  hidden `<table>` mirror per spec §3.9 (a11y / copy-paste)
- Notebook seeds with one empty SQL cell on first mount; `+ SQL / Markdown / Chart`
  buttons at the bottom add more

## What's in progress right now
- (commit boundary)

## What's next (in order)
- Restore CodeMirror 6 as a lazy chunk (decision log 14:10) — pre-tag gate
- SRI-pinning for DuckDB-wasm CDN load (gate artifact §7.1) — pre-tag gate
- Auto-restore workspace on app boot (currently only on .naklilens load)
- Cloudflare Pages deploy
- README pass for spec §3.10

## Just done — headless browser smoke test passes
- `scripts/smoke.mjs` exercises 12 steps end-to-end against a built dist/
  served from a tiny static server, via Playwright + the pre-installed
  Chromium 1194. `npm run smoke` runs build + smoke.
- Live run: 20/20 columns classified, 19 at ≥80% confidence, Vendor
  concentration template instantiates and runs, chart renders, syntax
  error surfaces inline, type override sticks. See tests/smoke-v1.0.log.
- Fixed 5 real bugs the smoke test caught:
  1. CSP blocked the inlined script (no 'unsafe-inline'); now compute
     and inject SHA-256 of the script body at build time.
  2. Vendored DuckDB-wasm fallback URLs were root-relative; blob: worker
     base couldn't resolve them — now absolute against location.origin.
  3. example-bundle mount aborted on the first failing file; now
     tolerant per-file (logs JSONL fails in this sandbox because the
     DuckDB JSON extension is auto-fetched from blocked CDN — works on
     a normal network).
  4. headerMatch returned the first pattern match rather than the best
     across all patterns — short patterns like "vendor" shadowed exact
     matches like "vendor_name".
  5. sqlCompatible was strict-string-substring; BIGINT columns weren't
     accepted by types declaring INTEGER. Now treats the integer family
     as one bucket.
- Template column picker now uses same-table cohesion: required types
  for a given template are pulled from one table when possible (the
  Vendor concentration SQL had been mixing tables, producing a Binder
  Error).

## Earlier — FSA folder mount + IndexedDB handle persistence (build order step 3)
- `src/core/handles.ts`: IDB store for FSA `FileSystemDirectoryHandle`
  objects, with permission re-query / re-request flow per handoff §3.1
- `mountFolder(engine, dirHandle)` walks the top level, registers each
  supported file as a table named after the file stem
- `remountFolderFromHandle()` for the .naklilens load path
- `applyLoadedFile` now attempts to recover folder sources from the
  persisted handle and re-mount them in-place; falls back to "Reconnect
  needed" banner if the handle is gone or permission denied
- "Add folder" CTA in the empty state is now wired

## Just done — report templates (build order step 11)
- 6 templates surfaced in a type-gated "Suggested reports" panel:
  AR aging, Vendor concentration, GSTIN spend by state,
  Error frequency, P95/P99 latency, Column profile
- Each template = markdown + 1-2 SQL cells + 1-2 chart cells
- "Add" button instantiates into the current notebook, wiring chart cells
  to their upstream SQL cells by id (resolved from name during instantiation)

## Known gaps the human should look at
- 11 agent-seeded taxonomy types in `taxonomy/v0.1/types.jsonl` for review
- Editor is a textarea, not CodeMirror 6 (see DECISIONS 14:10 — fix planned before v1.0 tag)
- Build order step 3 (FSA folder mount) not yet built; example-bundle + single-file mount carry the smoke test for now
