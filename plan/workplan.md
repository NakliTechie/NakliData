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

## Chunk 1 — Spec amendment A30 + STATUS/DECISIONS hygiene (keystone, ~30 min)

The bundle-size script (raised to 750 KB in commit `a0fa5cf`)
cites "spec amendment A30" that was never written. STATUS.md
still reads `590.6 KB / 600 KB` from v1.2 M5. DECISIONS.md has
no entry for v1.3. Closes the doc debt blocking everything else.

- [ ] **C2** — Write A30 in `plan/spec-amendments.md` (mirrors
      A25–A29 shape): cap raise 600 → 750 KB, rationale (v1.3
      adds 6 surfaces, original 600 was v1.0-era, lazy-load
      remains default), status pointer to `a0fa5cf`.
- [ ] **C2** — STATUS.md new top-of-file last-update entry
      covering v1.2 M1–M5 + v1.3 M0–M6: 18 commits, 695 vitest,
      142 KB headroom on the raised cap, Phase 2 wire-up gaps.
- [ ] **C2** — DECISIONS.md `## 2026-06-11 — v1.3 close + bundle
      budget raise` with the load-bearing v1.3 decisions: M2
      measure-as-FILTER-aggregate, M3 print-CSS-over-pdf-lib,
      engine-boundary lint contract, Phase 1 ship strategy for
      M1/M3/M5/M6.

**Why keystone:** every other batch references A30 in commit
messages. Land first so the rest doesn't fork doc debt.

---

## Chunk 2 — CI infrastructure (~45 min)

`deploy.yml` runs only `npm ci && npm run build` — a red gate
ships to GH Pages today. Land this BEFORE the fix batches so
they're protected against regression as they go in.

- [ ] **M20** — Add `verify` job to `deploy.yml` running
      `npm run check && npm test && npm run smoke` before the
      build/deploy job. Gate deploy on verify passing.
- [ ] **M21** — Add `pull_request` trigger to the verify job.
- [ ] **M22** — Add `src/core/chart-shelves.ts` +
      `src/core/lineage-edit.ts` to `WATCHED_OPTIONAL` in
      `check-engine-boundary.mjs`. Two-line change.
- [ ] **L19** — Switch `scripts/smoke.mjs` `waitUntil` from
      `'domcontentloaded'` to `'load'`.
- [ ] **L20** — Add `AbortSignal.timeout(60_000)` to postinstall
      fetchers.

---

## Chunk 3 — High-severity correctness + security (~2 hours)

Each item is small (one-line to ~20-line fix); together they
kill the highest-impact bugs surfaced by the audit. Order
within the chunk: one-liners first (C1, H5), then C3 (modest
reasoning cost), then H1–H4 (security-sensitive).

- [ ] **C1** — Remove static `hidden` attribute from
      `src/ui/cells/sql-cell.ts:234`. The v1.1 Explain-error
      sidecar job has been silently broken since shipping.
      **[test in Chrome]** — boot, run errored SQL cell,
      assert button visible when sidecar enabled.
- [ ] **H5** — Reject non-finite `limit` in
      `src/core/query-builder.ts validateSpec`. One line.
      Add regression test.
- [ ] **C3** — Rewrite `roundTripInvariantHolds` in
      `src/core/lineage-edit.ts:144-153`. Currently calls
      applyCanvasOp twice with identical inputs (tautology).
      Design a genuinely-differing path: serialise the applied
      graph → load via `fromJson` → re-project + compare against
      in-memory projection. Update three round-trip test cases.
- [ ] **H1** — Add `deleteHandle(ps.ref)` callsites in
      `sessions.deleteSession()` and the `'removeSource'` action
      handler. FSA handle IDB leak — two one-liners.
- [ ] **H2** — Extend `lens-confirm-modal.ts` to surface SQL
      cell bodies + a "this notebook will run when you click
      cells" warning before auto-mounting a lens-loaded workbook.
- [ ] **H3** — Cap `decodeLensParam` decompression at 2 MB.
      Reject early with clear error.
- [ ] **H4** — Add `WeakSet<object>` cycle guard to `walk()` in
      `src/core/lineage.ts`. Mirror the pattern from
      `refresh.ts:106`.

---

## Chunk 4 — v1.3 wire-up gaps (Phase 2 starters, ~3 hours)

v1.3 milestones shipped data layer + tests; this chunk closes
the user-visible gaps. Order by impact + dependency.

- [ ] **H8** — Extend `scripts/smoke.mjs` to click `add-stats`
      + `add-report` toolbar buttons, assert cell DOM renders.
      Mirror Wave 5/6 checks at smoke.mjs:368-396.
      **[test via npm run smoke]**
- [ ] **H9** — Add `'stats'` branch to `cellWithoutResults` in
      `persistence.ts` zeroing transient fields. Add round-trip
      test.
- [ ] **H10** — Scope report print CSS via `[data-printing]`
      attribute on target cell; rewrite `@media print` rules so
      only the printing cell un-hides. **[test in Chrome]** —
      actually open print dialog.
- [ ] **H11** — `beforeprint` listener cloning
      `.report-cell-ref[data-cell-ref]` placeholders' referenced
      cell DOM. Restore on `afterprint`. **[test in Chrome]**
- [ ] **H15** — Resolve `cell.inputCell` → upstream `.name` in
      stats cell renderer (currently shows internal cell id).
- [ ] **H16** — try/finally guards around `_modalEl = overlay`
      in `lens-confirm-modal.ts`, `nl-to-sql-modal.ts`,
      `settings-modal.ts`.
- [ ] **H12** — Carry `newCellKind` into `LineageNode` (M6
      Phase 2 prep — supports future canvas-to-cell
      materialisation).
- [ ] **H13** — Selection `(type, value)` shape; emit
      type-correct SQL literals in
      `buildIntraTableSelectionPredicate`.
- [ ] **H14** — Plumb masked column name through
      `td.dataset.column` in demo mode (or strip click-to-select
      in demo mode).

---

## Chunk 5 — Query / stats / measures correctness corner cases (~2 hours)

Pure-logic fixes, mostly one-liners with a regression test
added per fix. Ship in 2–3 sittings without UI dependencies.

- [ ] **H6** — Extend `extractFilePath` regex for query strings
      + gz + s3:// + https:// schemes.
- [ ] **H7** — Enforce selectColumns + aggregates GROUP BY rule
      in `validateSpec`.
- [ ] **M1** — Non-injective alias scheme in `stats.ts` (e.g.,
      `${i}_${stat}` index-prefixed); add `__`-collision test.
- [ ] **M2** — Strip `"..."` identifier literals before keyword
      scan in `validateMeasureExpression`.
- [ ] **M3** — Coerce + clamp margins in `buildPageCss` +
      `validateReport` (CSS injection guard).
- [ ] **M4** — Early-return on duplicate `newCellId` in
      `applyCanvasOp`.
- [ ] **M5** — Walk `measureExpanded.sql` for `@-name` captures
      in `recordLineageForCell`.
- [ ] **M6** — Kind-guard `handleRunStats`'s manual `inputCell`
      branch.
- [ ] **M7** — Widen typeof to `number | bigint` in stats
      column bucketing.
- [ ] **M8** — `CSS.escape(reportCellId)` in
      `naklidataRenderReport`.
- [ ] **M13** — Source chart-cell picker options from type
      union (add `'funnel'`, `'path'`).
- [ ] **M15** — Extend QB date regex for TZ offsets.
- [ ] **M16** — Cap FSA folder walk at 5000 files.
- [ ] **M18** — Greedy markdown-fence strip in
      `parseProposeChartResponse`.
- [ ] **M25** — Validate version regex in `compareVersion`.
- [ ] **M26** — `trimStart` before JSON-prefix check in
      `explainPlan`.
- [ ] **M29** — try/catch+engine.drop around mount* row-count
      steps.
- [ ] **M31** — `Number.isFinite` filter for mean/stddev/median.
- [ ] **M32** — Static cycle pre-pass in `validateMeasuresFile`.

---

## Chunk 6 — Stray cleanup (~30 min)

Polish; not gate-blocking. Mostly delete-or-rename one-liners.

- [ ] **S6** — Fix or delete `CellKind` alias in
      `src/ui/cells/types.ts:3-12` (missing `'stats'`, `'report'`).
- [ ] **S8** — Drop duplicate `quoteIdent` in `sinks.ts:224-226`;
      import from `core/anonymize.ts`.
- [ ] **S4** — Delete `_resetMeasuresStoreForTests` /
      `_resetSelectionsStoreForTests` (unused).
- [ ] **S5** — Drop `StatsColumnType` re-export from
      `stats-cell.ts`.
- [ ] **S7** — Drop `printReportCell` from `report-cell.ts`.
- [ ] **S14, S15** — Move probe scripts +
      `verify-demo-ecommerce.mjs` to `archive/` or delete.
- [ ] **L8** — Delete `let totalsCount; void totalsCount` in
      `pivot-cell.ts:182`.
- [ ] **L13** — Collapse duplicate `quoteIdent` calls in
      `anonymize.ts:163-164`.
- [ ] **L16** — Delete dead `Number.POSITIVE_INFINITY` assignment
      in `lineage-panel.ts:316`.
- [ ] **L22** — Add `npm run gen-examples` to `package.json` OR
      update README.

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
