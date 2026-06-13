# Workplan — 2026-06-13 (session 4 close)

Everything from the prior workplan shipped today: **v1.4.0 released**
(`1d45510`), the **Chunk 3 backlog cleared** (parked minors + F5/F6), and
the **slice-B validation ran → found bugs → load + registration FIXED**
(`9703a5f`), plus **cloud-BYOK smoke coverage** (`78fce01`). All on `main`,
CI-green, deployed. Detail: `plan/2026-06-13-summary.md`; DECISIONS AP–AU.

**What's left:** cut the next release (today's work is unreleased since
v1.4.0), the deferred Layer-3 local-inference R&D, and optional polish.

---

## Chunk 1 — Cut the next release (keystone, ~45 min)

10 commits since `v1.4.0` (`df54216..78fce01`) are unreleased on `main`:
F5 + F6 (features), the parked-minor batches, the local-model load/
registration fixes, and the cloud-BYOK smoke. Features present → likely a
**minor bump (v1.5.0)**; decide patch-vs-minor when cutting.

- [ ] Write `plan/v1.5.0-release-notes.md` (mirror v1.4.0 shape) — F5
      multi-column partitions, F6 multi-step pipelines, the parked-minor
      fixes (M14 runAll order, M9/M10, etc.), and the **local-model fixes**
      (WebGPU+q4f16 load, split-singleton registration) with the
      **experimental** caveat (inference quality still open — DECISIONS AU).
- [ ] README touch: note the local provider is experimental + needs WebGPU.
- [ ] Tag the release on `main` + push the tag (package.json stays `0.1.0`).

**Prereq:** none — all green. Decide v1.4.1 (patch) vs v1.5.0 (minor; F5/F6
are features) at cut time.

---

## Chunk 2 — Layer-3: local-inference output quality (deferred R&D, needs a WebGPU box)

The one un-fixed layer of the local sidecar. The user said "take it up
later." Grounded plan: **`plan/w32-local-inference-rnd.md`**.

- [~] **Diagnose the garbage output** (`{SQL!!!!!!` / `'\'%-*02*'`). Done:
      load + registration fixed, symptom characterised, hypotheses ranked.
      Left: the actual diagnosis. Un-defers when we sit down with a WebGPU
      browser + the eval harness. **[test in a real WebGPU browser]**
  1. [ ] Capture RAW pre-parse output; characterise it.
  2. [ ] wasm-vs-WebGPU numerical A/B on a fixed prompt (0.5B fits wasm) —
         is the WebGPU q4 backend the culprit?
  3. [ ] Verify the tokenizer chat template is applied to the local prompt.
  4. [ ] Try alternate exports/dtypes (fp16, q8) / a different model family.
- **Exit:** one structured-output job's parser passes deterministically →
  re-run the slice-B 6-job checklist (`plan/w32-slice-b-validation.md`).

---

## Chunk 3 — Optional polish (~1–2 hours, anytime)

- [ ] **NL→SQL quality** — few-shot DuckDB examples in the prompt + a
      dry-run-`EXPLAIN` self-correction retry (constraint-safe; no data
      returned). Helps weak/local models on the A23 NL→SQL job. (Decided
      NOT to adopt GoogleCloudPlatform/nl2sql — see summary.)
- [ ] **Manual real-key cloud-BYOK check** — one live call with your own
      key (the smoke covers the wiring; the live network/auth leg is manual).

---

## Pickup order (recommended)

1. **Chunk 1** — cut the next release (lock in today's shipped work).
2. **Chunk 2** — Layer-3 R&D when on a WebGPU box with time to dig.
3. **Chunk 3** — polish, opportunistically.

---

## ✅ Completed 2026-06-13 (session 4)

v1.4.0 release (`1d45510`) · Batch A/B/C parked minors (`df54216`,
`85d34af`, `811d5cc`) · F5 (`3c06ba0`) · F6 (`9a984a5`) · slice-B validation
+ docs (`0a5b98e`) · local-model load+registration fix (`9703a5f`) ·
cloud-BYOK smoke + R&D note (`78fce01`). Full detail in the day summary.
