# Local-model varied fixture matrix — 2026-08-19

## Scope

- Runtime: physical Chrome, WebGPU, cached
  `onnx-community/Qwen2.5-0.5B-Instruct` q4 model.
- Data: ten synthetic fixtures. No dataset upload or cloud sidecar request.
- Contract: each response passed through the production dispatcher and parser.
- Runs: two consecutive runs in one physical browser session.

## Result

| Fixture | Run 1 | Run 2 | Finding |
|---|---:|---:|---|
| Explain unknown function | Reject | Reject | The explanation repeated the error. The repair used an incorrect `date_diff` signature. |
| Explain trailing comma | Reject | Reject | The explanation did not identify the comma. One repair retained it. |
| Define order number | Reject | Reject | The derived regex matched every sample. The model labelled the identifier as `Code`. |
| Define email | Accept | Accept | The category was `Email`. The deterministic sample regex matched every value. |
| Summarise payment modes | Reject | Reject | The model omitted required backticked columns. One run invented currency metadata. The parser returned an empty observation. |
| Summarise one statistic | Reject | Reject | The value was sample-backed. The model omitted the required backticked column. The parser returned an empty observation. |
| Count payments by mode | Reject | Reject | The SQL counted distinct modes instead of grouping payment counts by mode. |
| Top days by invoice total | Reject | Reject | The SQL used `COUNT` or invented columns and joins instead of the requested grouped sum. |
| Infer inventory schema | Accept | Accept | Both runs returned five accepted columns. |
| Infer event schema | Reject | Accept | Run 1 emitted commented, malformed JSON. Run 2 returned five accepted columns. |

Run 1 accepted 2 of 10 fixtures. Run 2 accepted 3 of 10 fixtures.

## Containment observed

- Malformed schema JSON raised a parse error. The parser did not repair it.
- Unsupported summary prose collapsed to an empty observation.
- The SQL parser retained read-only, table-allowlist, external-access, and
  multi-statement guards. It does not claim semantic equivalence to the user's
  question.
- Generated SQL remained review-only. Nothing auto-executed.

## Disposition

- Keep the browser-local 0.5B provider labelled experimental.
- Keep cloud BYOK and custom OpenAI-compatible endpoints as the dependable
  structured-job paths.
- Do not broaden local structured-output claims from a single passing fixture.
- Require a larger-model varied matrix before reconsidering the product label.
- Treat empty summaries and rejected JSON as contained failures. Treat
  syntactically safe but semantically wrong SQL as a visible review risk.

## Remaining evidence

- Run the same varied matrix against one larger curated model on compatible
  WebGPU hardware.
- Repeat assignment fixtures for types without deterministic value patterns.
- If a larger model still produces semantically wrong SQL, define an
  engine-backed preview validator before broadening NL-to-SQL claims.
