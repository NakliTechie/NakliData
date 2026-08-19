# Physical macOS evidence — 2026-08-19

Status: the physical Safari functional replay passed after one development-
server defect was repaired. A background physical-Chrome pass now covers a
bounded 50,000-row memory-pressure result, source teardown, remount, and query
recovery. VoiceOver speech evidence, visible native-picker evidence, native
Chromium dialogs, and NVDA remain open.

## Host evidence

- macOS: 26.5.2 (`25F84`)
- Safari: 26.5.2 (`21624.2.5.11.8`)
- Safari WebDriver: `/System/Cryptexes/App/usr/bin/safaridriver`
- local application: `http://localhost:5173`
- base commit: `4027a00`
- rendered build during repair: `v1.7.0-242-g4027a00-dirty`
- Safari viewport: `docs/evidence/safari-26-demo-2026-08-19.png`

The user enabled macOS Accessibility and screen capture permissions. The user
also authenticated Safari's **Developer Settings → Automation → Allow remote
automation** control. SafariDriver then created W3C session
`7CBF3B0E-F66D-46C8-B561-7DA56C8E2E19`.

## Defect found and repaired

The first same-origin boot remained at `Engine: booting…` for more than 20
seconds. Safari fetched the vendored EH worker and WASM. macOS unified logs then
recorded a WebContent crash. The official jsDelivr path reached `Engine: ready`
in the same Safari session.

Header comparison isolated the difference:

- local dev server: `content-type: application/octet-stream`
- jsDelivr: `content-type: application/wasm`

The development server now resolves MIME types through
`scripts/dev-server-mime.mjs`. Its `.wasm` mapping is
`application/wasm`. `tests/dev-server-mime.test.ts` protects that mapping and
the binary fallback.

After restart, `/?offline=1&verify=0` reached `Engine: ready`. The default `/`
path also reached `Engine: ready` with the integrity manifest loaded. No
Safari-specific worker fork was retained.

## Safari replay results

| Workflow | Result | Evidence |
|---|---|---|
| First load | passed | Title `NakliData`; default engine state `ready` |
| Integrity-enabled local boot | passed | `integrity.json` loaded; engine state `ready` |
| Demo mount | passed | Five tables across three synthetic sources; four starter cells |
| Notebook execution | passed | Ten-row vendor result; quality assertion `PASS` |
| Schema override | passed | `vendor_id → Record / surrogate ID`; overridden at 100% |
| Report creation | passed | KPI tiles, chart, result, provenance, and print action rendered |
| Error display | passed after repair | Invalid table produced an inline DuckDB catalog error with `role="alert"` and `aria-atomic="true"` |
| Error recovery | passed | Restored SQL returned ten rows and removed the errored cell state |
| Workbook save | passed through fallback | Toast: `Saved untitled.naklidata.` |
| Static HTML export | passed through fallback | Toast named the generated `.html` file |
| CSV result export | passed through fallback | Toast reported 466 bytes and the generated `.csv` file |
| Classic file-input cancellation | passed in automated fallback | Source count remained three; focus returned to `data-action="add-source"` |

Safari uses browser downloads because `showSaveFilePicker` is absent. The
replay did not claim a native save panel. The file-input picker did not remain
visible as a Safari sheet under WebDriver, so visible native-picker behavior
still requires the user-present Chromium/Safari dialog pass.

No external dataset was selected. No path entered the DOM evidence. The
mounted sources were NakliData's synthetic demo. Export messages recorded only
generated filenames and byte counts.

The same replay initially found that SQL errors had no alert semantic. SQL,
Python/R, and stats-cell errors now expose atomic alerts. The smoke test asserts
the SQL error contract. Safari reran the invalid query and returned
`role="alert"` plus `aria-atomic="true"`; restoring the original query then
returned ten rows.

## Physical Chrome memory and recovery replay

Chrome 151.0.7922.138 ran in a separate browser-control process on the same
macOS host. The app reached `Engine: ready`, loaded the three-source synthetic
demo, and returned the ten-row vendor-spend result. The browser had also loaded
the cached Qwen2.5-0.5B local model on WebGPU.

A notebook cell materialized 50,000 uncapped rows with a distinct 510-character
payload per row:

```sql
SELECT i, repeat(lpad(CAST(i AS VARCHAR), 6, '0'), 85) AS payload
FROM range(50000) t(i)
```

The result completed in 291 ms and rendered its first 50 rows. macOS
`footprint` recorded the NakliData renderer at a 168 MB physical-footprint peak
and 120 MB current footprint after recovery.

Removing the three synthetic sources left zero sources, zero cells, and
`Engine: ready`. Remounting the demo restored three sources. A fresh
`SELECT 42 AS answer` then returned one row in 94 ms. This closes the physical-
device memory-pressure and recovery evidence item for the bounded workload; it
does not establish an unbounded file-size promise.

The Add-file cancellation probe remained background-only. The File System
Access path did not expose a classic Playwright file chooser. Foregrounding the
browser would have interrupted the user's active Codex window, so the pass
cancelled without selecting a file and retained the visible native-dialog gate.
No local dataset path or bytes entered browser evidence.

## Remaining replay matrix

### VoiceOver

Run first load, schema override, notebook execution, report creation, the SQL
error, report export, and Add source cancellation with VoiceOver active. Record
actual spoken names, roles, states, values, error association, live-region
announcements, modal boundaries, focus return, and export feedback. Do not
infer speech from the DOM accessibility tree.

### Native dialogs

In user-present physical Chrome, exercise **Add folder**, **Add file**, workbook open/save,
HTML export, and one data export. Cancel each once. Then use a user-selected
public fixture and destination. Confirm that cancellation is silent and no
selected path or file bytes enter logs or evidence.

Repeat the visible Add file cancellation once in Safari if the physical UI
exposes a native picker outside WebDriver.

### Separate host requirement

NVDA remains a Windows-host requirement.
