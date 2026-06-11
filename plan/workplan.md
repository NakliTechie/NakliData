# Workplan — 2026-06-11 snapshot (post v1.2 + v1.3 + forward-pass)

Today closed v1.2 (Lakehouse Parity, M1–M5) + v1.3 (Prior Art,
M0–M6) — 11 milestones in one session, 18 commits on origin/main.
The forward-pass audit produced `plan/forward-pass-2026-06-10.md`
with 3 Critical · 16 High · 33 Medium findings batched A–F.

The next session picks up **Chunk 1** (keystone — A30 amendment +
STATUS + DECISIONS), then has 5 chunks to choose from.
Estimated total: ~6–8 hours of focused work.

The previous workplan (2026-06-02 snapshot, post v1.2.2) lived
here; archived in this session's commits + the
`plan/forward-pass-2026-06-02.md` audit report. All v1.2.2 chunks
shipped through commit `40360b1`.

---

## Chunk 1 — Spec amendment A30 + STATUS/DECISIONS hygiene (keystone, ~30 min) — ✅ DONE 2026-06-11

The bundle-size script (raised to 750 KB in commit `a0fa5cf`)
cites "spec amendment A30" that was never written. STATUS.md
still reads `590.6 KB / 600 KB` from v1.2 M5. DECISIONS.md has
no entry for v1.3. Closes the doc debt blocking everything else.

- [x] **C2** — Write A30 in `plan/spec-amendments.md` (mirrors
      A25–A29 shape): cap raise 600 → 750 KB, rationale (v1.3
      adds 6 surfaces, original 600 was v1.0-era, lazy-load
      remains default), status pointer to `a0fa5cf`. Added a
      threat-model note (no trust boundary moves) + index row.
- [x] **C2** — STATUS.md new top-of-file last-update entry
      (`2026-06-11T04:00:00Z`) covering v1.2 M1–M5 + v1.3 M0–M6:
      18 commits, 695 vitest, 607.4 KB / 750 KB (142 KB headroom),
      Phase 2 wire-up gaps + CI/M22/H8 owed-items.
- [x] **C2** — DECISIONS.md `## 2026-06-11 — v1.3 close + bundle
      budget raise` with decisions V–AA: V bundle cap raise (A30),
      W Phase 1 ship strategy, X engine-boundary contract, Y M2
      measure-as-FILTER-aggregate, Z M3 print-CSS-over-pdf-lib,
      AA M5 one-schema-three-producers.

**Why keystone:** every other batch references A30 in commit
messages. Land first so the rest doesn't fork doc debt.

---

## Chunk 2 — CI infrastructure (~45 min) — ✅ DONE 2026-06-11

`deploy.yml` runs only `npm ci && npm run build` — a red gate
ships to GH Pages today. Land this BEFORE the fix batches so
they're protected against regression as they go in.

- [x] **M20** — Added `verify` job to `deploy.yml` running
      `npm run build && npm run check && npm test && npm run smoke`
      (build-first so the bundle-size gate has a dist/ to measure).
      `build` + `deploy` now `needs: verify`. Workflow renamed
      "Verify and Deploy".
- [x] **M21** — Added `pull_request` trigger; `build`/`deploy`
      gated `if: push || workflow_dispatch` so PRs stop after
      verify. Concurrency scoped to `${{ github.ref }}` so PR runs
      don't cancel a main deploy.
- [x] **M22** — Added `src/core/chart-shelves.ts` +
      `src/core/lineage-edit.ts` to `WATCHED_OPTIONAL`. Verified
      both are pure (no browser globals); check now reports
      "10 required + 6 optional".
- [x] **L19** — `scripts/smoke.mjs` `waitUntil` → `'load'` (+
      comment). Smoke still green.
- [x] **L20** — `AbortSignal.timeout(60_000)` on both postinstall
      fetchers (`fetch-duckdb-fallback.mjs`,
      `fetch-duckdb-extensions.mjs`).

---

## Chunk 3 — High-severity correctness + security (~2 hours) — ✅ DONE 2026-06-11

Each item is small (one-line to ~20-line fix); together they
kill the highest-impact bugs surfaced by the audit. Order
within the chunk: one-liners first (C1, H5), then C3 (modest
reasoning cost), then H1–H4 (security-sensitive).

- [x] **C1** — Removed static `hidden` attribute from the
      explain-error button (`src/ui/cells/sql-cell.ts`); it's now
      CSS-gated by `.app-sidecar-enabled` like its two sibling
      sidecar buttons. **Verified in Chrome**: button shows with
      sidecar on (display:flex, 137px), hides with it off, no
      `hidden` attr.
- [x] **H5** — `validateSpec` now rejects non-finite `limit`
      (`!Number.isFinite(spec.limit) || spec.limit < 1`) — NaN/∞
      slipped past `< 1` and emitted `LIMIT NaN`. +3 test cases.
- [x] **C3** — Added `lineageGraphFromJson` (untrusted-input
      validator/reviver) to `lineage-store.ts`; rewrote
      `roundTripInvariantHolds` to use a real serialise → revive →
      project path instead of the double-apply tautology. +6 tests
      (3 existing round-trip cases now exercise the real path).
- [x] **H1** — `deleteHandle(s.ref)` for fsa-folder/fsa-file
      sources in both `sessions.deleteSession()` and the
      `remove-source` handler (`main.ts`). Best-effort, guarded.
- [x] **H2** — `lens-confirm-modal.ts` now surfaces executable
      (sql/cohort/assertion) cell bodies + a "runs SQL against your
      data when you click Run" warning; gated on remotes OR
      exec-cells so a local-only-but-SQL lens still gets reviewed.
      **Verified in Chrome** with a crafted `?lens=` link.
- [x] **H3** — `gzipDecompress` reads incrementally and aborts
      past a 2 MB cap (gzip-bomb guard). +1 test (a tiny
      compressed payload that expands past the cap rejects).
- [x] **H4** — `WeakSet<object>` cycle guard added to `walk()` in
      `lineage.ts`, mirroring refresh.ts. +1 test (self-referential
      plan terminates + still extracts inputs).

Gates: check / test (704, +9) / smoke all green; C1+H2 verified
via a temporary headless-Chrome script (removed — proper smoke
coverage is H8/Chunk 4).

---

## Chunk 4 — v1.3 wire-up gaps (Phase 2 starters, ~3 hours) — ✅ DONE 2026-06-11

v1.3 milestones shipped data layer + tests; this chunk closes
the user-visible gaps. Order by impact + dependency.

- [x] **H8** — `scripts/smoke.mjs` now clicks `add-stats` +
      `add-report`, asserts the stats cell (Run button + body) and
      report cell (`.report-paper` + Print button) render. Smoke green.
- [x] **H9** — `'stats'` branch added to `cellWithoutResults`
      (zeroes descriptives/correlations/status/error). +2 round-trip
      tests (stats + report).
- [x] **H10** — Report print CSS scoped to `.report-cell[data-printing]`
      + `:not([data-printing]) { display:none }`. **Verified in Chrome**
      via `@media print` emulation: only the printing report shows. +1 test.
- [x] **H11** — `beforeprint`/`afterprint` listeners (boot-installed)
      clone the referenced cell DOM (chrome stripped) into
      `.report-cell-ref` placeholders + restore + clear `data-printing`.
      Shared `triggerReportPrint` for button + `naklidataRenderReport`.
      **Verified in Chrome**.
- [x] **H15** — Stats renderer resolves `cell.inputCell` → upstream
      `.name` (was the internal id); `renderStatsCell` now takes the
      cell list, mirroring chart/pivot.
- [x] **H16** — try/catch teardown around the `_modalEl = overlay`
      sequence in lens-confirm / nl-to-sql / settings modals — a
      half-open modal no longer strands the singleton or leaks the
      keydown listener.
- [x] **H12** — `LineageNode.cellKind` (new `LineageCellKind` in
      lineage-store, single source of truth; `NewCellKind` aliases it);
      `applyCanvasOp` carries `op.newCellKind`; `lineageGraphFromJson`
      preserves it. +1 test.
- [x] **H13** — `SelectionEntry.type` + type-correct emission in
      `buildIntraTableSelectionPredicate` (bare numbers, TRUE/FALSE,
      typed DATE); threaded through the store (toggle/setEntry/list/
      round-trip). +9 tests.
- [x] **H14** — demo mode strips click-to-select entirely (the real
      column name leaked via `td.dataset.column` even with masked
      headers; masking it would break the cross-filter query).

---

## Chunk 5 — Query / stats / measures correctness corner cases (~2 hours) — ✅ DONE 2026-06-11

Pure-logic fixes, mostly one-liners with a regression test
added per fix. All 19 closed; +17 vitest cases.

- [x] **H6** — `extractFilePath` string-blob regex now matches
      s3:// / gs:// / http(s):// / azure:// URLs + `.gz` + query
      strings. +2 tests.
- [x] **H7** — `validateSpec` throws when a plain SELECT column is
      neither grouped nor aggregated (was silently dropped). +3 tests.
- [x] **M1** — stats descriptives aliases are now index-prefixed
      (`c<i>__<stat>`) — injective regardless of column names. Emit +
      parse updated; +1 collision test.
- [x] **M2** — `validateMeasureExpression` strips `"..."` identifiers
      before the keyword scan (a column named `"insert"` no longer
      false-trips). +1 test.
- [x] **M3** — `buildPageCss` coerces + clamps margins to finite
      [0,100] mm; `validateReport` rejects bad margins (CSS injection
      guard). +2 tests.
- [x] **M4** — `applyCanvasOp` no-ops on a duplicate `newCellId`. +1 test.
- [x] **M5** — `recordLineageForCell` scans the MEASURE-expanded SQL
      for `@refs`, so a measure body's cell refs contribute edges.
- [x] **M6** — `handleRunStats` kind-guards the manual `inputCell`
      (a markdown/chart ref now errors clearly).
- [x] **M7** — `fmtMaybe` coerces `bigint` (BIGINT min/max) so it
      formats as a number, not `"100n"`.
- [x] **M8** — `CSS.escape` on the cell ids in `triggerReportPrint` +
      the cell-ref embed selector.
- [x] **M13** — chart picker options moved to a `satisfies`-checked
      const; `'funnel'` + `'path'` added (were missing from the union).
- [x] **M15** — QB date regex accepts numeric TZ offsets. +1 test.
- [x] **M16** — FSA folder walk capped at 5000 entries.
- [x] **M18** — `parseProposeChartResponse` extracts the fenced block
      (tolerates a prose tail after the closing fence). +1 test.
- [x] **M25** — `parse` validates the version string shape (`1.x`
      no longer slips past the newer-version guard). +1 test.
- [x] **M26** — `explainPlan` `trimStart`s before the JSON-prefix
      check (a newline-prefixed plan no longer forces the regex path).
- [x] **M29** — `getRowCount` drops the table on a failed COUNT then
      rethrows — no orphaned view (single-point fix, all mounts).
- [x] **M31** — `parseDescriptivesRow` coerces non-finite
      mean/stddev/median to null. +1 test.
- [x] **M32** — `validateMeasuresFile` runs a static cycle pre-pass
      over the `MEASURE()` graph. +3 tests.

---

## Chunk 6 — Stray cleanup (~30 min) — ✅ DONE 2026-06-11

Polish; not gate-blocking. Mostly delete-or-rename one-liners.

- [x] **S6** — Deleted the unused `CellKind` alias from
      `types.ts` (it was stale — missing stats/report; `CellState['kind']`
      is the authoritative union).
- [x] **S8** — `sinks.ts` imports `quoteIdent` from `core/anonymize.ts`;
      local duplicate removed.
- [x] **S4** — Deleted `_resetMeasuresStoreForTests` /
      `_resetSelectionsStoreForTests` (no callers).
- [x] **S5** — Dropped the dead `StatsColumnType` import + re-export
      from `stats-cell.ts`.
- [x] **S7** — Dropped `printReportCell` from `report-cell.ts`
      (orphaned by the Chunk 4 print refactor).
- [x] **S14, S15** — Moved `probe-cm6-survival.mjs`,
      `probe-hash-mismatch.mjs`, `verify-demo-ecommerce.mjs` to
      `scripts/archive/`.
- [x] **L8** — Deleted the dead `totalsCount` accumulator in
      `pivot-cell.ts`.
- [x] **L13** — Collapsed the duplicate `quoteIdent(col.columnName)`
      in `anonymize.ts` to a single `ident`.
- [x] **L16** — Deleted the never-read `Number.POSITIVE_INFINITY`
      sink-depth seed in `lineage-panel.ts`.
- [x] **L22** — Added `"gen-examples"` npm script; README now says
      `npm run gen-examples`.

---

## Unbatched / parked

- **L1–L24** — polish items detailed in audit report; revisit
  individually when convenient.
- **S1–S3, S9–S13, S16–S18** — stray cleanup; ship in a future
  windup batch.
- **M9–M14 (UX), M17, M19, M23, M24, M28, M30, M33** — minor UX
  + redundancy notes; can ride along with related chunks.

## Open questions (need answers before they're tasks)

- **A30 amendment shape** — lean decision-only entry, or full
  threat-model rewrite of spec §7.1?
- **Phase 2 UI scheduling** — autonomous proceed vs. user gate?
  M1 grey-out renderer + M3 cell-ref embedding are the highest-
  impact UI completions.
- **Manual associations panel** (handoff §M1) — smallest useful
  starter shape?
- **C3 round-trip rewrite** — serialise-replay oracle vs.
  in-memory two-path comparison?

## Pickup order (recommended)

1. **Chunk 1** keystone (~30 min) — unblocks doc debt
2. **Chunk 2** CI infra (~45 min) — protects everything else
3. **Chunk 3** high-severity (~2 hours)
4. **Chunk 4** v1.3 UI gaps (~3 hours)
5. **Chunk 5** correctness corner cases (~2 hours)
6. **Chunk 6** stray cleanup (anytime)

Total ~6–8 hours focused work to close the audit.
