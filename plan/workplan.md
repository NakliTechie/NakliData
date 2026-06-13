# Workplan — 2026-06-13 (post v1.4.0 release + Chunk 3 backlog pass)

**v1.4.0 is released + tagged** (`1d45510`, Chunk 1) and the **Chunk 3
backlog is cleared** (parked forward-pass minors + the F5/F6 deferred
stretches, 5 commits `df54216`…`9a984a5`, Chunk 3). 819 vitest / smoke /
check green; bundle 677.3 KB / 750 KB. Detail in `plan/2026-06-13-…`
(this session) + DECISIONS AP–AS.

**The ONLY thing left is Chunk 2 — WebGPU slice-B validation** — which
needs a real WebGPU browser and can't run headless. Everything else on
the workplan is done.

---

## Chunk 1 — v1.4.0 release + tag (keystone, ~1 hour)

The v1.4 slate is done + green. Cut the release.

- [ ] Write `plan/v1.4.0-release-notes.md` (mirror the v1.3.0 notes shape;
      cover F1–F9 + the M2 split-singleton fix; commits `07f9eb9..f01c21d`
      minus the v1.3.0 ones already in v1.3.0 notes — i.e. the post-tag
      `0f0cd54..f01c21d` set).
- [ ] Refresh the README feature list with the v1.4 surfaces (Semantic
      panel dimensions + code view, Calc field, multi-join builder,
      X-Ray, Embed).
- [ ] Tag `v1.4.0` on `main` + push the tag (package.json stays `0.1.0`
      per convention — no version-badge surface to bump).

**Prereq:** none — the slate is shipped + green. (Slice-B validation,
Chunk 2, is NOT a release blocker — same logged posture as v1.3.0,
DECISIONS AG.)

---

## Chunk 2 — W3.2 slice-B validation (needs a WebGPU browser, ~1–2 hours)

The only owed v1.3 item. Can't run headless.

- [ ] **W3.2 slice B** — manual per-job validation of all 6 sidecar jobs
      against a loaded local Transformers.js model. Checklist in
      `plan/w32-slice-b-validation.md`. → a v1.4.1/v1.3.1 if it surfaces
      fixes. **[test in a real WebGPU browser]**

---

## Chunk 3 — Deferred stretches + parked audit minors — ✅ DONE (2026-06-13)

Autonomous backlog pass — 5 commits `df54216`…`9a984a5`; 819 vitest ·
check · smoke green; bundle 677.3 KB / 750 KB. DECISIONS AQ/AR/AS.

- [x] **F6 multi-step pipelines** — derived filter→summarise→re-summarise
      steps via `emitPipeline` (nested-subquery aliases reuse the
      injection-safe emitter); full N-step modal UI (`9a984a5`).
- [x] **F5 multi-column window partitions** — calc-field window mode
      checkbox group; core was already array-capable (`3c06ba0`).
- [x] **Parked forward-pass minors** — fixed M9, M10, M14, M17, M19 +
      L1–L5, L12, L14, L15 + S1; S2/S11 already resolved. The remainder
      (M11/S3, L7/L9/L11/L17/L18/L23/L24, S9/S10/S12/S16/S17/S18) are
      logged **won't-fix with rationale** in DECISIONS AQ (audit
      misjudgements, persistence-risk, or cosmetic-no-payoff).

---

## Pickup order (recommended)

1. ~~**Chunk 1** — cut v1.4.0~~ ✅ done (`1d45510`).
2. **Chunk 2** — slice-B validation when on a WebGPU-capable machine. **(only remaining item)**
3. ~~**Chunk 3** — parked minors / stretches~~ ✅ done (`df54216`…`9a984a5`).

---

## ✅ Completed this session (2026-06-11 session 3)

- **v1.3 Phase 2 UI:** `07f9eb9` M1 grey-out · `2480c50` M5 shelves ·
  `a3c4145` M6 lineage-edit · `53979b4` M1 associations · `de1a309`
  lineage fix.
- **Release/infra:** `87b7c49` v1.3.0 · `0f0cd54` Chunk-4 minors ·
  `4f8506f`+`e20f339` e2e-in-CI · `1b3e2fe` GH-Pages retired (Cloudflare
  canonical) · `7e5595f` README link.
- **Research:** `0ff40aa`/`4fa0d42` competitive analysis + feature list.
- **v1.4 F1–F9:** `d27d5a9` (F1/F2/F3 + M2 fix) · `5faa598` (F4/F5) ·
  `a34f1e0` (F6) · `c390cc3` (F7/F8) · `f01c21d` (F9).
