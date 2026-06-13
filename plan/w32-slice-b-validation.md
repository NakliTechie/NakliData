# W3.2 slice B — per-job manual validation

**Status: RAN 2026-06-13 (real Chrome + WebGPU box, via Chrome MCP, against
the live deployed build). VERDICT: ❌ FAIL — the local-model path does NOT
function on the wasm device. 0/6 sidecar jobs could be exercised because no
curated model loads.** Details in the "Validation run" section below; the
original checklist (kept for reference) follows.

---

## Validation run — 2026-06-13 — VERDICT: ❌ FAIL (0/6 jobs runnable)

Driven via Chrome MCP against `https://naklidata.naklitechie.com/` (the live
HEAD build) in a real Chrome on a 16 GB / 14-core macOS box **with WebGPU
available** (`navigator.gpu` present).

### Blocking finding — model fails to LOAD on wasm (`std::bad_alloc`)

The recommended default **Qwen2.5-1.5B downloads fully but fails to load**:

```
Load failed: Can't create a session. ERROR_CODE: 6, ERROR_MESSAGE: std::bad_alloc
```

Reproduced across **two fresh sessions**, including a clean load **from the
OPFS cache** (no re-download). The wasm32 onnxruntime can't allocate the q4
weights (~1.7 GB) in linear memory — the contiguous-allocation ceiling on
wasm32 is well below what a 1.5B q4 model needs, even on a 16 GB machine.

Because nothing loads, **Steps 1 (load), 2 (auto-load), and 3 (the 6 jobs)
cannot complete.** This is a real defect in the shipped local path, not a
test-environment issue.

### Supporting findings

1. **Model-size labels are ~2× understated.** Settings labels vs actual
   OPFS download:
   - Qwen2.5-1.5B "~0.9 GB" → **1.67–1.79 GB** on disk.
   - Llama-3.2-1B "~0.7 GB" → **~1.58 GB** of q4 weights.
   - (Phi-3.5-mini "~2.3 GB" → not tested, but proportionally larger.)
2. **WebGPU is available but unused.** `src/lazy/transformers.ts:262`
   hard-codes `device: 'wasm'`; the WebGPU opt-in (chunk-3 note) was never
   wired. WebGPU offloads weights to GPU memory and is the standard way to
   avoid this exact wasm-heap OOM for Transformers.js — the likely fix.
3. **The failed load blocks the main thread** (~45 s `document_idle`
   freeze during session creation). Even the *attempt* hangs the tab; it
   should be off-main-thread and/or guarded.
4. **Llama-3.2-1B (smallest) not conclusively tested** — its weights
   download was interrupted by a mid-run crash. But at ~1.58 GB it has
   essentially the same footprint as Qwen, so it would very likely hit the
   same `bad_alloc`.

### What DID pass

- **Download pipeline works** — Transformers.js chunk loads, files stream to
  OPFS, per-file progress renders (`Downloading onnx/model_q4.onnx: …`).
- **Cache UI works** — "Cached on this device" lists each model + size, with
  per-model `×` delete and "Forget all cached models".
- **Cleanup works** — "Forget all cached models" deletes the OPFS files
  (verified: `navigator.storage` usage dropped from ~1.68 GB back to ~2 MB),
  shows the empty state, and after reload **no auto-load toast** fires
  (correct — nothing cached). Partial weights from the interrupted download
  were auto-cleaned (Llama left at 11.2 MB, just the tokenizer).
- **Settings persistence** — sidecar-enabled + provider=Local + selected
  model survived a tab crash + reload (IDB).

### Disposition

Slice B is **NOT clear to close as "validated"**. Filed as v1.4.1 follow-up
work (see `plan/pending.md` "Now open" + DECISIONS AT). Recommended fixes,
in priority order:
1. **Wire the WebGPU device path** — detect `navigator.gpu`, use
   `device: 'webgpu'` with a wasm fallback. Primary fix for the OOM.
2. **Fix the model-size labels** to reflect actual q4 download sizes.
3. **Graceful OOM handling** — catch the session-creation failure and
   surface "model too large for the CPU runtime — enable WebGPU or pick a
   smaller model" instead of a raw `std::bad_alloc`; move the load
   off the main thread.
4. Consider adding a genuinely small (≤0.5B / more-quantized) model that
   fits the wasm heap for non-WebGPU browsers.

---

## Original checklist (reference — pre-run)

Run this checklist after loading the model in Settings. Fill in the
results inline (replace each `<TODO>`).

---

## Pre-flight

- [ ] Build is green at HEAD ≥ `6e8fed4`. (`npm run build`,
  `npm run smoke`, `npm run check` all clean.)
- [ ] Browser is recent Chrome / Edge / Safari with OPFS. (Firefox
  pre-111 private browsing is not supported — surface area is
  documented in chunk 3's no-OPFS bail.)
- [ ] At least 2 GB of free disk for the OPFS cache + browser quota
  headroom.

## Step 1 — Load the model

1. Open Settings (cog icon in the header).
2. Sidecar section → set **AI sidecar enabled** if not already.
3. Provider → pick **Local (in-browser, no API key)**.
4. The Local model section should appear with three radios.
5. Pick **Qwen2.5-1.5B-Instruct (recommended)** (the default).
6. Click **Download & load**.
7. Watch the status line; it should progress through:
   - `Loading Transformers.js chunk…`
   - `Preparing onnx-community/Qwen2.5-1.5B-Instruct…`
   - `Downloading <file>: <loaded> / <total> (<pct>%)` for each
     model file (largest is the .onnx weights file at ~0.9 GB).
   - `onnx-community/Qwen2.5-1.5B-Instruct loaded and ready.`
8. The "Cached on this device" list should now show one entry with
   the size.

**Record**:
- Total download time: `<TODO>`
- Final cache size shown: `<TODO>`
- Any console errors during load: `<TODO>`

## Step 2 — Reload the page

Refresh the browser tab.

- [ ] After boot, a toast appears: "Local model
  onnx-community/Qwen2.5-1.5B-Instruct ready (loaded from cache)."
- [ ] No download progress bar — load is from cache.
- [ ] Time-to-ready (approx wall clock): `<TODO>`

This validates the chunk-4 auto-load path.

## Step 3 — Exercise each sidecar job

Use the example bundle (Browse example data → invoices) or any
mounted workbook with > 0 columns. For each job below: trigger the
job from the UI, paste the model's response into the slot, mark
PASS / FAIL based on whether the response is structurally valid
and topically relevant.

### Job 1 — Explain query error (`explain-error`)

1. Add an SQL cell with a deliberate error, e.g. `SELECT no_such_col FROM invoices`.
2. Click Run; cell shows the DuckDB error.
3. Click "Ask sidecar to explain" under the error.
4. Expect: a 1-3 sentence plain-English explanation referencing the
   missing column + a suggested fix.

- [ ] **PASS** / **FAIL**: `<TODO>`
- Response excerpt: `<TODO>`

### Job 2 — Disambiguate type (`disambiguate-type`)

1. Mount a workbook with a column whose top type candidates are in
   the 0.5..0.9 confidence band (use the GST invoice fixture if
   none surface naturally).
2. In the schema panel, find that column → click the "ambiguous"
   indicator (or open Define type if available).
3. Sidecar should propose one of the candidate type ids.

- [ ] **PASS** / **FAIL**: `<TODO>`
- Picked type id: `<TODO>`
- Was that the correct pick? `<TODO>`

### Job 3 — Define new type (`define-type`)

1. Open a workbook with at least one unclassified column.
2. Click the column header → Define new type → "Ask sidecar to
   suggest".
3. Expect: a JSON spec with id / display_name / category / regex (or
   value_set, depending on the column).

- [ ] **PASS** / **FAIL**: `<TODO>`
- Suggested spec: `<TODO>`
- Validity: `<TODO>` (parses as JSON, fields make sense)

### Job 4 — Recommend reports (`recommend-reports`)

1. Mount a workbook where multiple report templates are applicable.
2. In the Suggested reports panel, click "Ask sidecar to rank".
3. Expect: templates re-order with score badges (0-100%).

- [ ] **PASS** / **FAIL**: `<TODO>`
- Top-ranked template + score: `<TODO>`

### Job 5 — NL → SQL (`nl-to-sql`)

1. In a SQL cell, click "Ask sidecar in plain English" (or the NL
   icon, depending on UI).
2. Ask: "Sum the amounts by vendor for last quarter."
3. Expect: a SQL query that produces aggregates against the mounted
   tables — must be SELECT-only (other forms rejected by the
   parser per A23).

- [ ] **PASS** / **FAIL**: `<TODO>`
- Generated SQL: `<TODO>`
- Did it run cleanly? `<TODO>`

### Job 6 — Summarise result (`summarise-result`)

1. Run any SQL cell that returns 5-50 rows.
2. Click "Summarise" under the result.
3. Expect: one sentence describing the result.

- [ ] **PASS** / **FAIL**: `<TODO>`
- Summary text: `<TODO>`

## Step 4 — Delete model + verify

1. Settings → Local model section → click the X next to the cached
   model row → confirm.
2. Verify "Cached on this device" goes to empty state.
3. Reload the page.
4. After boot, the auto-load toast should NOT appear (no cache to
   load from).
5. Sidecar jobs hit the L3 "no-provider" UI (Open Settings link).

- [ ] **PASS** / **FAIL**: `<TODO>`

## Verdict

- Pass count: `<TODO>` / 6
- Fail count: `<TODO>` / 6

If 6/6 PASS: clear to tag v1.3.0. Walk through the v1.3.0 tag
sequence (release notes draft → tag → push) per the chunk 7 plan.

If any FAIL: file as a `plan/pending.md` "Now open" item; the slice
B v1.3.0 tag waits until they're addressed.

---

## Notes during validation

`<TODO — captured-as-you-go observations: weird latencies, browser
quirks, output quality oddities, anything worth recording for the
v1.3.x follow-up work.>`
