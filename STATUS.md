## Last update: 2026-05-15T14:30:00Z
## Current milestone: v1.0
## Build status: green — `dist/index.html` 303 KB; tsc clean; biome 0 errors / 14 warnings; 11 tests passing
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
- Smoke-test the full flow in a browser (handoff §6)
  — only one of us can do this; running the smoke test needs a real browser
- README pass for spec §3.10

## Just done — FSA folder mount + IndexedDB handle persistence (build order step 3)
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
