# Workplan — 2026-06-11 (post forward-pass close)

The `/forward-pass` audit is fully closed — all 6 chunks shipped,
pushed, and deployed (7 commits `9a6027a..f8542e5`; detail in
`plan/2026-06-11-summary.md` and the "✅ Closed" block of
`plan/pending.md`). 732 vitest + smoke green; the CI verify gate is
live.

What's left is **Phase 2 UI** (make the v1.3 data layers user-visible),
a **v1.3 release**, the **deferred local-model validation**, and minor
parked polish. The top chunk has a real open question — answer it first
(see `## Open questions`).

---

## Chunk 1 — v1.3 Phase 2 UI wire-up (keystone, ~1 day) — has an open question

The v1.3 data layers all ship + are tested, but several surfaces are
still data-only. This chunk makes them user-visible. **Blocked on a
scheduling/scope decision — see Open questions.**

- [x] **M1 UI grey-out** — DONE (2026-06-11). `computeIntraCellValueStates`
      (pure, intra-cell, JS over materialised rows) + `paintResultSelectionStates`
      binder + `repaintSelectionStates` surgical subscriber + token CSS.
      737 vitest / check / smoke green; **Chrome-verified**. See STATUS +
      DECISIONS W/X/Y.
- [x] **M1 UI manual-associations panel** — DONE (2026-06-11). Hybrid:
      auto-suggest (type/name) + manual link form + active-links list.
      `associations.ts` (store + `resolveEffectiveSelectionsForTable` +
      `suggestAssociations`) + modal + paint propagation + persistence.
      Inter-cell cross-filter via in-memory propagation (DECISIONS AE/AF).
      770 vitest / check / smoke green; **Chrome-verified**.
- [x] **M5 UI** — DONE (2026-06-11). Manual|Shelves mode toggle on the
      chart cell; field tray + x/y/color drop-zones (DnD + select
      fallback) → `compileShelvesToConfig` → cell config. `inferFieldClass`
      pure helper + 8 tests. 745 vitest / check / smoke green;
      **Chrome-verified**. DECISIONS Z/AA/AB.
- [x] **M6 UI** — DONE (2026-06-11). Edit|Done toggle on the lineage
      panel; per-node delete (dependents-listed inline confirm) +
      per-edge insert wired to `applyCanvasOp`, persisted via
      `loadFromJson`. Reposition deferred (layout-only no-op; DECISIONS
      AC). 745 vitest / check / smoke green; **Chrome-verified**.
      DECISIONS AC/AD.

**Phase 2 UI is COMPLETE** (M1 grey-out + M1 associations panel + M5 +
M6). The lineage-empty bug flagged during M6 was investigated + fixed
(`de1a309` — duckdb-wasm 1.29.0 inlines view-backed mounts; plan walk now
unions a CTE-aware SQL sniff). **Next up: Chunk 2 — v1.3.0 release.**

**Prereq:** decide the Phase 2 scope/scheduling question first. Each
sub-item is independently shippable, so this can land incrementally.

---

## Chunk 2 — v1.3.0 release + tag (~1 hour)

v1.2 (Lakehouse Parity) + v1.3 (Prior Art) + the forward-pass are all
done. Cut the release once Phase 2 UI is shipped (or explicitly
deferred) and W3.2 slice B is validated (Chunk 3).

- [x] Write `plan/v1.3.0-release-notes.md` — DONE.
- [x] Tag `v1.3.0` on `main` + push the tag — DONE (`87b7c49`, deployed).
- [x] README refreshed with the v1.3 surfaces (no version-badge to bump;
      package.json stays `0.1.0` per established convention).

**v1.3.0 SHIPPED 2026-06-11** with a logged decision (DECISIONS AG) to
ship without the WebGPU slice-B validation (autonomous/user-away; can't
run headless). e2e gate run green first (DECISIONS AH).

---

## Chunk 3 — W3.2 slice B validation + e2e re-run (~1–2 hours, needs a real browser)

Carried deferred work + the verification owed from the forward-pass
pass.

- [ ] **W3.2 slice B** — manual per-job validation of all 6 sidecar
      jobs against the loaded local Transformers.js model. Checklist in
      `plan/w32-slice-b-validation.md`. Needs WebGPU — can't be
      smoke-tested headless.
- [x] **e2e** — DONE (2026-06-11). `npm run test:e2e` → 55/55 green
      before the v1.3.0 tag. **Now also wired into the CI verify job**
      (`deploy.yml` runs check → test → smoke → e2e on every push + PR;
      closes DECISIONS AH's follow-up).

---

## Chunk 4 — Parked audit minors (anytime, ~1–2 hours)

Low-priority items the 6-chunk pass deliberately skipped. Batch
opportunistically.

- [x] **M12** (addCell exhaustiveness `never` guard) + **L6** (selection-bar
      palette → tokens) + **L21** (e2e `retries: 2` in CI — fixed the
      focus-restoration flake surfaced when e2e joined the CI gate) DONE
      2026-06-11. M13/M23/M24 already closed earlier; M9–M11/M14/M17/M19
      remain parked (UX/intentional/needs-decision).
- [ ] **Remaining L-items** (L1–L7, L9–L12, L14, L15, L17, L18, L21,
      L23, L24) — polish.
- [ ] **Remaining S-items** (S1–S3, S9–S13, S16–S18) — stray cleanup.

---

## Open questions (answer before Chunk 1)

- **Phase 2 UI scheduling** — autonomous-proceed on M1/M5/M6 UI, or
  user-gate each? They're independently shippable.
- **Manual associations panel scope** (handoff §M1) — smallest useful
  starter shape?
- **v1.3.0 tag timing** — cut now, or after Phase 2 UI + slice-B
  validation?

## Working-tree note

- `.github/workflows/deploy.yml` has an **uncommitted** bump of all
  four actions to `@v5` (Node 20 → 24 deprecation fix; all v5 tags
  verified to exist). Owned by a separate task the user started —
  reconcile/commit there.

## Pickup order (recommended)

1. Answer the Phase 2 scheduling/scope open question.
2. **Chunk 1** Phase 2 UI (keystone — makes v1.3 user-visible).
3. **Chunk 3** slice-B validation + e2e (unblocks the release).
4. **Chunk 2** v1.3.0 release + tag.
5. **Chunk 4** parked minors (anytime).

---

## ✅ Completed — forward-pass Chunks 1–6 (2026-06-11)

All ticked + shipped. One-line index (full detail in the summary):

- **Chunk 1** `06ae2aa` — A30 + STATUS/DECISIONS (C2).
- **Chunk 2** `196ab28` — CI verify gate + M22/L19/L20.
- **Chunk 3** `8568530` — C1/C3 + H1–H5.
- **Chunk 4** `f4fd713` — H8–H16 (v1.3 Phase 2 data + print).
- **Chunk 5** `047e8a7` — H6/H7 + 17 M-items.
- **Chunk 6** `4fe90b9` — S4–S8/S14/S15 + L8/L13/L16/L22.
