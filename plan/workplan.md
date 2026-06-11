# Workplan — 2026-06-11 (post v1.4 feature build)

v1.3.0 is released + deployed. The entire **v1.4 feature slate (F1–F9)**
from the competitive analysis is built, gated, Chrome-verified, and on
`origin/main` (19 commits `07f9eb9..f01c21d`). 798 vitest / 55 e2e /
smoke / check all green; bundle 666.9 KB / 750 KB. Detail in
`plan/2026-06-11-summary.md` (session 3).

What's left: cut the **v1.4.0 release**, the deferred **WebGPU slice-B
validation**, and parked polish. No open question blocks the top chunk.

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

## Chunk 3 — Deferred stretches + parked audit minors (anytime, ~2–3 hours)

Batch opportunistically; none is urgent.

- [ ] **F6 multi-step pipelines** — grow the query builder to
      filter→summarise→re-summarise (currently single-step multi-join).
- [ ] **F5 multi-column window partitions** — currently single-column.
- [ ] **Parked forward-pass minors** — M9 (measures form Enter), M10
      (`window.confirm`→modal), M11 (measures-change → schema-panel
      refresh), M14 (runAll DAG order), M17, M19; remaining L-items
      (L1–L5, L7, L9, L11, L12, L14, L15, L17, L18, L23, L24) + S-items
      (S1–S3, S9–S13, S16–S18). Detail in
      `plan/forward-pass-2026-06-10.md`. Good `/replan` candidate.

---

## Pickup order (recommended)

1. **Chunk 1** — cut v1.4.0 (the slate's done; lock it in).
2. **Chunk 2** — slice-B validation when on a capable machine.
3. **Chunk 3** — parked minors / stretches, batched.

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
