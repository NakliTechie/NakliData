# W3.2 slice B — per-job manual validation

**Status:** OWED — autonomous chunks 1-4 shipped the code, but the
6 sidecar jobs need real-model exercise before tagging v1.3.0. Per
scoping doc Decision 5, eval harness coverage for `local` is a
v1.3.x follow-up — slice B's validation bar is "every job produces
sensible output via the real Qwen2.5-1.5B pipeline."

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
