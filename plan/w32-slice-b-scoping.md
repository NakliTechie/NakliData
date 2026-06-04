# W3.2 slice B — Transformers.js chunk + real local inference — scoping

Status: **DEFERRED**. This doc isn't an implementation; it's the
ready-to-`/decide` artifact for when the next session picks it up. The
seam (W3.2 slice A) is in place; the chunk + model + UI for downloading
+ caching are what's owed.

Background: `plan/sidecar-architecture.md` covers the base-vs-LoRA
question + the spec's three jobs (now six since Wave 3+5). This doc
narrows to the slice-B-specific decisions.

---

## What's already built (slice A, shipped in v1.1)

- `src/core/sidecar/local-runtime.ts` — registry seam.
  `registerLocalGenerator(fn)` / `unregisterLocalGenerator()` /
  `getLocalGenerator()` / `isLocalModelReady()`.
- `src/core/sidecar/client.ts` — dispatch routes `provider: 'local'`
  through `getLocalGenerator()`; throws actionable
  `SidecarError('Local model is not loaded yet …', 'no-provider')`
  when no generator is registered. Forward-pass L3 then extended
  both `runExplainError` and `runSummariseResult` error branches to
  show "Open Settings" on `no-provider` (covers the local path).
- `src/ui/settings-modal.ts` — `local` provider is selectable in
  the radio group. Model field accepts an HF ONNX repo id (empty
  by default in `DEFAULT_PROVIDER_CONFIG.local`).

What's missing: the chunk that loads Transformers.js + the model
weights + calls `registerLocalGenerator()` once ready.

---

## Decision 1 — Model choice (the load-bearing one)

The slice-A spec comment names "Phi-3-mini-4k-instruct quantized, or
successor at build time" as the target shape. Since that note was
written, the model landscape has moved. The choice for slice B should
explicitly account for:

| Candidate | Params | 4-bit ONNX size | Token throughput target | Notes |
|-----------|-------:|----------------:|------------------------:|-------|
| Phi-3-mini-4k-instruct | 3.8B | ~2.3 GB | ~5–20 tok/s | The slice-A reference. Microsoft-licensed (MIT). Quality bar for the 6 sidecar jobs is met. |
| Phi-3.5-mini-instruct | 3.8B | ~2.3 GB | ~5–20 tok/s | Phi-3 successor. Same shape, slightly better instruction-following. |
| Qwen2.5-1.5B-Instruct | 1.5B | ~0.9 GB | ~10–30 tok/s | Smaller, faster. Quality acceptable for explain-error / disambiguate; marginal on NL→SQL. |
| Llama-3.2-1B-Instruct | 1.2B | ~0.7 GB | ~15–40 tok/s | Smallest credible chat model. Meta license. NL→SQL quality TBD. |
| Gemma-3-1B / Gemma-3-2B | 1B / 2B | ~0.6 GB / ~1.2 GB | similar | Google. The LoRA path in `sidecar-architecture.md` targets these. |

**The trade-off:**
- Bigger = better quality on NL→SQL (the highest-bar job), but slower
  initial load + slower per-token inference. A 2.3 GB download is a
  real friction event for users.
- Smaller = downloads fast, runs fast, but the 1B-class models are
  marginal at NL→SQL on the kinds of schemas NakliData mounts (long
  column lists, GST-shaped Indian-context schemas).

**My recommendation (subject to user override):** Start with
**Qwen2.5-1.5B-Instruct** as the v1.3.0-shippable default. Reasoning:

- 0.9 GB is at the painful-but-tolerable end of the download spectrum.
  Phi-3-mini at 2.3 GB is a "do I really want this?" decision; 0.9 GB
  is "yes, fine."
- Quality is good on the 5 narrower jobs (explain-error, disambiguate,
  define-type, recommend-reports, summarise-result). NL→SQL on simple
  schemas works; on complex ones it falls short — but the same is
  true of Phi-3-mini, just less often.
- Apache 2.0 license — minimal legal surface vs Gemma/Llama license
  quirks.
- The bigger Phi-3.5 model can be a v1.4 upgrade once the seam +
  cache + UI are proven on Qwen.

**Alternative defendable choice:** Phi-3.5-mini if "quality > size"
weighting wins. Or both — let user pick from a curated list in
Settings.

**Reversibility:** Easy. The model id is a string in settings; the
chunk loads whatever HF ONNX repo it points at. Swapping the default
is a one-line change.

---

## Decision 2 — Where the model weights live

Transformers.js downloads weights on first use and caches in
OPFS / IndexedDB. The default cache key includes the HF repo id, so
multiple models can co-exist if the user switches.

**Options:**

1. **Default (Transformers.js builtin cache).** Weights cache in
   IDB / OPFS managed by the library. Quota concerns: a 0.9 GB
   model fits comfortably under the typical 50% origin quota; 2.3 GB
   is closer to the edge but still under for most users.
2. **Custom cache.** Implement our own OPFS layer so we can show
   download progress + cache size + "delete cached model" UI.
   Same posture as the BYOK key store — predictable, inspectable.

**My recommendation:** Option 2. The user signing up for a multi-GB
download deserves a "Cached: 1.2 GB · Delete cached model" affordance
in Settings, matching the BYOK posture. Also gives us first-class
download progress UX (the alternative is a black-box "loading…"
spinner that lasts minutes).

**Implementation cost:** Maybe ~150 lines in a new
`src/core/sidecar/local-cache.ts` plus the Settings UI hook.

---

## Decision 3 — Chunk strategy

The Transformers.js npm package is ~5 MB minified (the library
itself; weights are downloaded separately). Plus the WebGPU/wasm
runtime adapter.

**Options:**

1. **Single chunk.** `src/lazy/transformers.ts` imports the library +
   the model. Loaded on first call to a `local` job.
2. **Two chunks.** Library separately from model registration. Lets
   us show "library loaded, downloading weights…" granularly.

**My recommendation:** Single chunk. The library import is already
~5 MB; splitting saves negligible UX time. Keep it simple.

---

## Decision 4 — Bundle-size impact

The library itself isn't in the main shell (it's a lazy chunk),
so the 600 KB shell budget isn't affected. But:

- `dist/chunks/transformers.js` — ~5 MB. Sits next to
  `dist/chunks/maplibre-map.js` (1.0 MB), `codemirror.js` (364 KB),
  etc. No formal budget on lazy chunks yet (per stop-checklist they
  fall outside the 600 KB gate).
- Vendored ONNX runtime weights for the BUILD itself — not vendored;
  Transformers.js fetches them from CDN on first use.

**Decision needed:** add a separate lazy-chunk budget? Or treat
`transformers.js` as "the cost of having local inference at all,"
not budget-gated?

**My recommendation:** Don't add a budget for slice B. Lazy chunks
that load only when a feature is used (like `local` provider)
shouldn't share the shell's tight budget. Document this in
`scripts/check-bundle-size.mjs` (or its comment block) as the
intentional carve-out.

---

## Decision 5 — Eval harness coverage

`eval/run.mjs` runs 60 golden cases (6 jobs × 10 fixtures) against
the cloud providers (Anthropic / OpenAI). For `local` it currently
no-ops since no generator is registered.

**Options:**

1. **Add `local` provider runs to the eval harness.** Requires headless
   browser context with the Transformers.js chunk loaded. Slow
   (minutes per job × 6 jobs = ~30 min full run).
2. **Skip eval for local; rely on per-job manual probes.** Documented
   pattern: when shipping a new local model, manually exercise each
   of the 6 jobs in the workbench and record the result.

**My recommendation:** Option 2 for slice B. Eval harness coverage
for local can be a v1.3.x follow-up once the deploy pipeline is
proven. Headless Playwright + multi-GB model download in CI is a
heavy commitment.

---

## Implementation order (after the user decides 1–5)

Rough sequence, all behind a single feature flag (`?local=1` until
ready) so it can land incrementally:

1. **`src/core/sidecar/local-cache.ts`** — OPFS-backed weights cache.
   Inspectable + deletable from Settings.
2. **`src/lazy/transformers.ts`** — chunk. Imports Transformers.js,
   instantiates pipeline against the model, wires
   `registerLocalGenerator`.
3. **Settings UI** — model picker (curated list from decision 1),
   download-progress UI, cache-status display.
4. **Boot-path hook** — load the chunk lazily when the user picks
   `provider: 'local'` in Settings; show progress; register.
5. **Per-job validation** — manual exercise of all 6 sidecar jobs;
   capture results to a new `plan/w32-slice-b-validation.md`.
6. **Spec amendment A24** — formalise the local-runtime contract.
   Update `plan/sidecar-architecture.md` with the chosen model +
   posture.
7. **Tag v1.3.0** — slice B shipping is the natural v1.3.0 trigger
   per Decision J (DECISIONS.md 2026-06-02).

**Estimated effort:** ~half day per chunk × 5 chunks = ~2.5 days
full-time. Probably realistic as a 1-week-elapsed effort with
verification in between.

---

## What to do at /resume time

1. Pull this doc up. Run `/decide` to lock decisions 1–5 (or accept
   the defaults I've recommended).
2. Start with chunk 1 (local-cache).
3. Each chunk → vitest + manual exercise + commit + push.
4. Tag v1.3.0 when chunk 7 closes per Decision J.

No work to do right now (without a user decision in the room). The
seam is correctly in place; the chunk slot is correctly empty; the
"no-provider" error is correctly surfacing via the L3 UI hook.
