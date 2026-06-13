# R&D — local in-browser inference output quality (W3.2 slice-B, Layer 3)

**Status:** OPEN — deferred (noted 2026-06-13; we'll take it up later).
**Grounded in:** the slice-B re-validation run, DECISIONS AT + AU,
`plan/w32-slice-b-validation.md`.

This is the one un-fixed layer of the local-model sidecar. The load
(Layer 1: WebGPU + q4f16) and registration (Layer 2: split-singleton)
bugs are fixed + confirmed. What remains is that the in-browser model
**generates incoherent output**, so the sidecar jobs can't use it.

## Objective (why this matters)

The portfolio mandate + spec §4.3 make the local-model path the
**privacy-maximal** sidecar option: weights cached in OPFS, no API key,
**no network calls after download**, data never leaves the tab. It's the
only sidecar mode that needs zero trust in a third party. Cloud BYOK
covers the capability today; local is the differentiator we want to make
actually usable. Constraints are unchanged: browser-native, no server,
SRI-pinned deps only, bundle budget (the transformers chunk is lazy).

## What we observed (2026-06-13, real Chrome + WebGPU, 16 GB / 14-core)

Verbatim symptoms, so we don't re-derive them:

1. **Load** (now fixed): `Qwen2.5-1.5B` q4 → `std::bad_alloc` on wasm;
   GPU-OOM on plain-q4 WebGPU. With `dtype:'q4f16'` on WebGPU it loads
   (q4f16 download 1.14 GB). `Qwen2.5-0.5B` loads on WebGPU too.
2. **Registration** (now fixed): jobs reached the model only after the
   split-singleton fix (chunk returns generator → main bundle registers).
3. **Output (THE open problem):** with the model loaded + registered,
   every structured-output job fails at the parse step because the model
   emits garbage:
   - greedy (`do_sample:false`): `{SQL!!!!!!` (repeated-token degeneracy)
   - low-temp sampling (`temperature:0.3, repetition_penalty:1.2`):
     `'\'%-*02*'`
   - Seen on BOTH the 0.5B and the 1.5B, across summarise + explain-error
     + nl-to-sql. The garbage is **near-random, not "almost-right JSON"** —
     and **consistent across jobs**, so it's not a per-job prompt issue.

The near-random character is the key signal: this looks like a
**numerical / decoding correctness** problem, not a model-too-dumb
problem (a weak-but-working 0.5B would produce coherent-but-wrong text,
not `'\'%-*02*'`).

## Hypotheses (ranked by likelihood given the above)

1. **onnxruntime-web WebGPU q4/q4f16 kernel correctness.** The WebGPU
   execution provider's fp16/quantized kernels for some ops can emit
   wrong values → garbage logits → garbage tokens. Known fragility for
   in-browser quantized inference. **Highest suspicion.**
2. **Chat template not applied / mis-applied.** `pipe(messages, …)`
   relies on the tokenizer's `chat_template`. If the onnx-community
   tokenizer config lacks it (or transformers.js doesn't apply it), the
   model sees a malformed prompt → garbage. Plausible + cheap to rule out.
3. **Model-export / dtype mismatch.** The specific q4/q4f16 ONNX export
   may be miscalibrated for this runtime. Try fp16 or q8, or a different
   export / model family known-good with transformers.js WebGPU.
4. **Generation config** — largely ruled out (greedy AND sampling both
   garbage), but confirm `max_new_tokens` / EOS handling isn't truncating.

## Method (when we pick this up)

Do this in a focused session with a real browser + the eval harness —
NOT by live-poking models (which is how this note got written).

1. **Capture RAW output** (pre-parse). Add a temporary debug log of the
   model's raw string in `transformers.ts generate()`. Characterise the
   garbage: empty? short? repetitive? random unicode? length?
2. **wasm-vs-WebGPU numerical A/B.** Load a model small enough to fit
   wasm (0.5B) on BOTH `device:'wasm'` and `device:'webgpu'`, same fixed
   prompt, compare. If wasm is coherent and WebGPU is garbage →
   hypothesis 1 confirmed; gate WebGPU behind a correctness self-check or
   prefer wasm for small models.
3. **Verify the chat template.** Log the tokenized prompt; compare to a
   manually-built ChatML string. If they differ → hypothesis 2.
4. **Try alternate exports/dtypes** (fp16, q8) + a second model family.
5. **Optional:** a tiny in-repo "does this model generate coherent text?"
   self-test the app can run once after load, to fail loud instead of
   shipping garbage to the parsers.

## Exit criteria

A curated model that, in a supported browser, **deterministically passes
≥1 structured-output job's parser** (e.g. summarise → valid
`{"observation": "…"}`). Then re-run the slice-B 6-job checklist
(`plan/w32-slice-b-validation.md`) and update the verdict.

## Until then

- Local provider stays **experimental** (labelled in Settings).
- Sidecar jobs should use a **cloud BYOK provider** (the default; its
  prompt/parse logic is covered by the 60-case eval harness — though that
  harness uses recorded fixtures, so the live network path is verified by
  the new cloud-path browser smoke check, not the eval).
