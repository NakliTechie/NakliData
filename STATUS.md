## Last update: 2026-05-15T13:45:00Z
## Current milestone: v1.0
## Build status: green — `dist/index.html` 241 KB; tsc + biome clean
## Deploy status: not yet deployed

## What's done since last check-in
- Build order step 2 complete: DuckDB engine end-to-end queryable
- Bundled example data generator (`scripts/gen-examples.mjs`):
  - 25 vendors with valid-checksum GSTINs, PANs, IFSCs
  - 80 invoices with HSN codes, GST rates, payment status
  - 65 payments
  - 240 NDJSON access logs (service / endpoint / status / latency)
  - `public/examples/manifest.json` describes the bundle
- Mount layer (`src/core/mount.ts`): `mountExampleBundle`, `mountFile`, format detection, table-name sanitization
- Workbook state container (`src/core/workbook.ts`) with subscribe/notify
- Sources panel renders mounted sources + tables with row counts
- "Browse example data" CTA wired end-to-end (fetch → register → list)
- "Add file" CTA wired with `showOpenFilePicker` (FSA) or `<input type=file>` fallback
- Toast notifications for transient feedback
- Dev server now serves `public/` so example data is reachable from `npm run dev`

## What's in progress right now
- (commit boundary; taxonomy next)

## What's next (in order)
- Taxonomy bundle v0.1 vendored under `taxonomy/v0.1/` (types.jsonl + domains + relationships)
- Phase 1 detectors: header_match / regex / checksum (GSTIN/PAN) / value_set / range
- Classification orchestration: sample → dispatch → aggregate scores → assign type
- Schema panel UI: per-column type + confidence + evidence + accept/override
- FSA folder mount + IndexedDB handle persistence (build order step 3)

## Anything the human should look at
- `public/examples/` — sample data is committed (deterministic from seed in `scripts/gen-examples.mjs`); regenerate with `node scripts/gen-examples.mjs`.
