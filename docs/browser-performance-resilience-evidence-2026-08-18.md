# Browser, performance, and resilience evidence — 2026-08-18

Scope: the checked-in production build on this macOS host. This is dated lab
evidence, not a field-performance or universal browser-support claim.

## Browser matrix

| Engine | Evidence | Result |
|---|---|---|
| Chromium | Production smoke plus focused resilience matrix | Full checked-in smoke path exercised |
| Firefox 150.0.2 | FSA-absent file import plus accessibility matrix | 4/4 cases passed |
| Playwright WebKit 26.4 | FSA-absent file import plus accessibility matrix | 4/4 cases passed after removing the Safari UA block |

The WebKit result covers engine behavior. Physical Safari remains untested.
Native file, folder, and save dialogs remain untested. The deterministic tests
cover classic file-input fallback, mocked FSA open/save, and download paths.

The 2026-08-19 physical preflight identified the exact host permission gap:
Safari remote automation is disabled, command-line enablement requires an
administrator password, macOS UI scripting is unavailable, and system capture
returned a black frame. The physical Chrome session rendered the local first
run surface, but no native dialog was selected or cancelled. See
[`physical-macos-readiness-2026-08-19.md`](physical-macos-readiness-2026-08-19.md).

## Performance trace

Chrome DevTools recorded an unthrottled cold local navigation to
`index.html?offline=1`:

| Metric | Observed |
|---|---:|
| TTFB | 35 ms |
| First contentful paint | 324 ms |
| Largest contentful paint | 506 ms |
| LCP render delay | 471 ms |
| Cumulative layout shift | 0.0002 |
| DOM content loaded | 66 ms |
| Load event | 69 ms |

The LCP element was text. DevTools reported no estimated LCP or CLS savings.
The local static server exposed a zero-TTL lazy chunk with zero wasted bytes, so
the cache insight does not justify a product change. INP, TBT, Speed Index, and
field data were unavailable in this trace and remain unclaimed.

## Workflow timings

All timings are unthrottled single-run observations from the same local host.

| Workflow | Input | Observed |
|---|---|---:|
| Example readiness | 20 schema columns and first result table | 493 ms |
| First report scaffold | Report cell plus existing charts | 34 ms |
| Large-schema readiness | 2,401,890-byte CSV; 5,000 rows × 200 columns | 51,526 ms |
| Large-source removal | Remove the preceding source and restore 42 prior schema rows | 86 ms |

The automated resilience case uses 2,000 rows × 120 columns. It removes that
source, observes zero remaining schema rows, then mounts and classifies the
example workspace again.

## Cancellation and recovery

The browser regression starts a billion-row trigonometric aggregate, presses
Escape while the cell is running, requires cancellation within ten seconds,
then runs `SELECT 42` in a later cell. Signal-bearing result queries use the
cancellable stream API. The engine replaces only the interrupted connection,
retaining database-owned relations. Non-result statements remain materialized
and check cancellation before and after execution.

## Storage quota and bounded memory pressure

Chromium's origin quota was reduced to 4 KiB above the existing workspace
usage. A 16 KiB typed-but-unrun SQL change then exhausted IndexedDB snapshot
storage. The app retained the active workbook and existing query result while
showing a persistent `Local changes not saved · Export now` warning. After the
test restored 64 MiB of origin quota, the next autosave cleared the warning and
the recovered workbook survived reload.

A separate browser case allocated and touched 128 MiB across eight JavaScript
arrays. The demo mounted and returned its vendor-spend result under that
pressure. After releasing the arrays and requesting Chromium heap collection,
a later `SELECT 42` query returned the expected value.

These are bounded local-host observations. They do not establish behavior at
device exhaustion or under operating-system memory termination.

## Physical WebGPU local-model path — 2026-08-19

Chrome loaded `onnx-community/Qwen2.5-0.5B-Instruct` from OPFS on WebGPU. A
compact disambiguation request classified `invoice_no` in two seconds. The
standalone ontology chunk initially failed to see the main-shell generator;
the runtime registration now uses one versioned page-global slot.

The 232-type assignment prompt exposed WebGPU execution faults. q4f16 returned
`memory access out of bounds`; q4 returned memory or unaligned-access errors.
The response-token budget and sampling mode did not cause the fault. Batching
the complete catalog into 16-type local prompts completed the request in eight
seconds. A 48-type batch remained outside the reliable envelope.

The small model then selected GSTIN for `payment_id`. The taxonomy already
mapped `order_id` to `ut:transaction_identifier`, so payment-reference header
coverage now resolves that field deterministically as `Transaction / order ID`.
This physical run proves the bounded WebGPU execution path. It does not prove
general structured-output quality or larger curated models.

The follow-up matrix exercised all eight current structured jobs through the
visible product controls:

| Job | Physical outcome |
|---|---|
| `disambiguate-type` | Accepted `Invoice number` for `invoice_no` |
| `recommend-reports` | One rerun recovered five allowlisted scores from a valid object plus trailing text |
| `assign-type` | Parsed, but incorrectly mapped `REF##########` values to GSTIN |
| `define-type` | Failed closed on malformed JSON with a control character |
| `summarise-result` | Emitted labelled prose containing a false numerical claim; prose fallback removed |
| `explain-error` | Emitted non-contract text and failed JSON parsing |
| `nl-to-sql` | Returned output rejected by the SQL safety parser |
| `nl-to-schema` | Failed closed on truncated JSON at position 1,842 |

The shared parser now extracts one complete balanced JSON object before the
existing job-specific guards run. It does not repair truncated JSON. This
recovered report ranking without accepting the malformed definition or schema.
The local provider remains experimental.

The same manual pass found schema rows nested under a closed cleaning popover
when a table had cleaning suggestions. The column-list selector is now
explicit, with focused Playwright containment coverage and a physical override
check.

## Evidence still required

- Physical Safari on macOS with real file and save dialogs.
- Native Chromium folder and save pickers on a user-selected fixture.
- A release-quality local-model matrix across all eight current jobs.
- Physical-device memory pressure beyond the bounded 128 MiB browser case.
- Throttled Lighthouse or equivalent Speed Index, TBT, and interaction runs on
  the deployed origin.

Commands:

```text
npx playwright test --config tests/e2e/playwright.config.ts --browser=firefox tests/e2e/file-input-fallback.spec.ts tests/e2e/accessibility-matrix.spec.ts --workers=1
npx playwright test --config tests/e2e/playwright.config.ts --browser=webkit tests/e2e/file-input-fallback.spec.ts tests/e2e/accessibility-matrix.spec.ts --workers=1
npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/resilience-matrix.spec.ts --workers=1
```
