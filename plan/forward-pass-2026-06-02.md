# Forward-pass audit — 2026-06-02

**Scope:** whole codebase, read-only fresh-eyes audit across three lenses
(bugs / security / stray). Five parallel subagents fanned out by
subsystem: engine+mount+persistence; sidecar+BYOK; charts+classifier+
templates; notebook+cells+modals+export; build+CSP+lazy+SW.

**Summary counts:** **1 Critical · 8 High · 15 Medium · 9 Low · 0 Stray**
(33 actionable findings + 2 false-positives recorded).

This is a baseline audit covering the v1.0/v1.1/Wave 4 surface plus
infrastructure (build, worker, CSP, deploy) that hadn't been adversarially
reviewed. Wave 5/6 surface and the v1.2.0 audit fixes were excluded from
the brief as pre-cleared (a forward-pass + codex pass already cleaned
those). Codex caught two real bugs after the internal pass on Wave 5/6 —
that prior is a reminder that no single review-pass catches everything.

---

## Verification reality

NakliData is browser-only. The verification stack:

- **vitest (370 cases)** — pure-logic + DOM-via-happy-dom for cell renderers,
  classifier, persistence, taxonomy detectors, notebook-graph, sidecar
  parsers. Fast (~600ms). Good fit for parser/rewriter/regex/algorithm
  fixes.
- **Playwright e2e (51 cases, real Chromium + DuckDB-wasm)** — modal
  flows, focus restoration, dashboard wiring, smoke through the real
  engine. Slow (~30s). Required for CSP changes, modal focus, lens-link
  flow, mount paths.
- **Smoke (scripts/smoke.mjs)** — headless puppeteer one-shot. Catches
  CSP / FSA / worker-bootstrap / classification regressions.
- **eval (60 fixtures × 6 sidecar jobs)** — golden prompt/response cases
  for the sidecar.

Most findings here are testable. The lens-link confirmation flow (H1) and
modal focus regressions (M11) need Playwright. CSP additions (H7) need
smoke. The Math.min stack overflow (H5) needs a vitest with a large input
array. Bearer-token CRLF rejection (M1) and SQL allowlist tightening
(H2, H3) are pure-logic — vitest sufficient.

`[test]` markers below distinguish runtime-only verifications from
static/unit-testable ones.

---

## Findings

### Critical

**C1 [Security] Templates panel XSS via unescaped column names**
File: `src/ui/templates/templates-panel.ts:134-150`.
`renderTemplateCard` builds the "Matched columns" `<details>` body as a
template literal: `${ref.table}.${ref.column} → ${typeId}` joined with
`<br/>`, then dropped into `innerHTML`. Column / table / typeId all flow
from MOUNTED files (xlsx, CSV, parquet) — user-controlled and untrusted.
Why CRITICAL: a malicious xlsx with a header `<img src=x onerror=alert(1)>`
triggers XSS as soon as the classifier surfaces it in the Suggested
Reports panel — no further user click. XSS in NakliData reaches BYOK keys
in sessionStorage (and any IDB-persisted keys if the user opted in) →
straight exfil path to any `https:` endpoint via the wide-open
`connect-src 'self' https:`.
Fix: `escapeHtml(ref.table)` + `escapeHtml(ref.column)` + `escapeHtml(typeId)`
before joining; the helper already exists in the file. Or build via
`textContent`-only DOM construction. **[test: vitest case with a
hostile column name, asserting the rendered DOM has no `<img>`.]**

### High

**H1 [Security] SSRF via auto-applied `?lens=` shared link**
Files: `src/core/mount.ts:475-499`, `src/main.ts:228-235`, `src/main.ts:1338-1359`.
A `?lens=<base64gzip>` link decodes a PersistedSource and silently
re-mounts on page load. For `kind === 'http' | 'iceberg-table' |
'iceberg-catalog' | 'compute-bridge' (no requires_bearer)`, no
confirmation; `clearLensFromLocation()` then strips the param. DuckDB-wasm
fetches from the victim's browser — usable for internal network probing
(`http://10.0.0.5:8080/`), and any persisted bearer-token replay if
secrets are IDB-persisted. The lens decode does toast, but the fetch
fires automatically.
Fix: before auto-mounting any non-`fsa-*`/non-`example-bundle` source
from a lens, surface a "this link will fetch from these hosts — continue?"
confirm dialog. Or downgrade lens to "remote source remembered — click to
reconnect" tiles. **[test in Chrome: Playwright with a crafted lens
param, assert no engine fetch fires before user clicks.]**

**H2 [Security] NL→SQL table-allowlist bypass via comma-join**
File: `src/core/sidecar/client.ts:653`.
`TABLE_REF_REGEX` matches `\b(?:FROM|JOIN)\s+<ident>`. SQL-89 comma-join
(`FROM allowed, secret_table`) and identifiers after `,` inside the FROM
clause are not validated — `secret_table` slips through. Once the user
clicks Run on the cell, DuckDB executes the multi-table query.
Fix: extend regex (or AST-walk the FROM-clause body) to also match
`\b(?:FROM|JOIN|,)\s+(?:"…"|<ident>)` within the FROM window. CROSS JOIN
already covered by JOIN. **[test: vitest case `parseNlToSqlResponse(
"SELECT * FROM allowed, secret_table", ["allowed"])` must reject.]**

**H3 [Security] NL→SQL WRITE_KEYWORDS missing INSTALL / LOAD / SET / USE / RESET**
File: `src/core/sidecar/client.ts:646`.
DuckDB executes multi-statement input. A response like
`SELECT 1; SET enable_external_access=true; SELECT 1;` evades the
write-keyword filter. SET in particular can mutate the engine's network
posture for the rest of the session.
Fix: add `INSTALL|LOAD|SET|RESET|USE` to the alternation. Stronger:
split on `;`, require each top-level statement to start with
`SELECT|WITH`. **[test: vitest cases for each new keyword.]**

**H4 [Bug] Templates panel chart-to-SQL binding ignores `_inputName`**
File: `src/ui/templates/templates-panel.ts:175-189` (`instantiateTemplate`).
`chart(...)` partial carries a `_inputName` field indicating which SQL
cell it bound to. The walker ignores it and uses "the nearest previously
inserted named SQL cell". For ERROR_FREQUENCY (md, sql(errors_by_service),
sql(errors_over_time), chart('bar',→errors_by_service), chart('line',→
errors_over_time)) both charts bind to `errors_over_time` because that's
the most recent named cell.
Fix: index named SQL cells by name during instantiation; bind by
`_inputName` when present, fall back to nearest-prev. **[test: vitest
case instantiating ERROR_FREQUENCY, asserting bar/line bind to the right
SQL cells.]**

**H5 [Bug] `Math.min(...vals)` / `Math.max(...vals)` stack overflow on large columns**
Files: `src/charts/render.ts:344-347, 380-381, 256-257`.
Spread-call on numeric arrays. V8 limits arguments around 65k–125k; a
histogram of a 200k-row numeric column throws
`RangeError: Maximum call stack size exceeded`. Scatter caps at 5k so
safe; histogram + line don't cap.
Fix: single-pass loop: `let min=Infinity, max=-Infinity; for (const v of
vals) { if (v < min) min = v; if (v > max) max = v; }`. **[test: vitest
case with a 200k-element array.]**

**H6 [Security] postinstall fetches duckdb-extension WASM without checked-in hash**
Files: `scripts/fetch-duckdb-extensions.mjs:101-119`,
`scripts/fetch-duckdb-fallback.mjs:55-60`.
`integrity.json` is built AFTER fetching, hashing whatever bytes arrived
during `npm install`. A network MITM, DNS hijack, or compromised CDN
during install substitutes attacker bytes and the recorded hash
"ratifies" the swap. The resulting `dist/` ships those bytes to all
deployed users.
Fix: ship a checked-in expected-hash table (committed to repo); compare
downloaded bytes against it; hard-fail on mismatch. Or pin strictly to
bytes inside `node_modules` and refuse silent network fetch.

**H7 [Security] CSP missing `frame-ancestors`, `base-uri`, `object-src`, `form-action`**
Files: `src/index.html:14`, `esbuild.config.mjs:91-108`.
Without `frame-ancestors 'none'`, the app is clickjackable — an attacker
iframe wraps NakliData and tricks users into clicking mount/save/share
over BYOK creds. Without `base-uri 'none'` (or `'self'`), an injected
`<base href>` (which CSP `script-src 'self'` does NOT cover) redirects
every relative URL (`./chunks/*.js`, `./duckdb-fallback/*`, `./sw.js`) to
an attacker origin. Compounds with C1.
Fix: append `frame-ancestors 'none'; base-uri 'self'; object-src 'none';
form-action 'self'` to the policy in both the static
`<meta http-equiv="Content-Security-Policy">` and the computed CSP in
`esbuild.config.mjs`. **[test: smoke run + manual `curl` of headers.]**

**H8 [Security] Iceberg catalog bypasses scheme allowlist on table-load `metadata-location`**
Files: `src/core/mount.ts:653-672`, `src/core/engine.ts:468-480`.
`mountIcebergTable` enforces `https://` or `s3://`. `mountIcebergCatalog`
takes the metadata URL returned by the catalog and passes it to
`engine.registerIcebergTable` WITHOUT scheme check. A malicious or
compromised catalog (or `?lens=` restored attacker URL) can return any
URI scheme; DuckDB's `iceberg_scan` then attempts to fetch it.
Fix: after `client.loadTable` in mount.ts:655-662, validate
`metadataLocation` against the same allowlist `mountIcebergTable` applies.
Apply equivalent guards to any other client-resolved URL handed off to
the engine. **[test: vitest mocking the iceberg client to return a
non-https/non-s3 location; assert MountError.]**

### Medium

**M1 [Security] Bearer-token CRLF injection in iceberg + bridge configs**
Files: `src/core/engine.ts:454-456`, `src/core/bridge/bridge-client.ts:71-73`.
`configureIceberg` interpolates the bearer token into a SQL string literal
via `escapeLiteral` (which only doubles single quotes). DuckDB's httpfs
writes the literal string into outgoing `Authorization` headers. A
token containing `\r\n` survives SQL escaping → CRLF injection in the
HTTP request (response splitting / extra header injection) IF DuckDB's
httpfs doesn't validate header bytes. The browser `fetch` in bridge-client
typically rejects bad headers, but defensive validation is cheap.
Fix: validate token charset against RFC 7230 (`[A-Za-z0-9._~+/=-]`
covers OAuth bearer); reject in `configureIceberg`, in `BridgeClient`
constructor, and in the modal that captures the token.

**M2 [Bug] compareTables sanitizeIdent column-alias collision**
File: `src/core/engine.ts:866-913`.
Sample-row projection aliases each common column as `a_${sanitizeIdent(c)}`
/ `b_${sanitizeIdent(c)}`. `sanitizeIdent` collapses every non-alphanumeric
to `_` → `"col 1"` and `"col-1"` both alias to `a_col_1`. The second
projection clobbers the first in the result row map; the JS loop reads
wrong/missing values and the diffs array is silently wrong for those
columns.
Fix: switch to index-based aliasing — `a.${safeC} AS a_${i}` — and look
up by index. **[test: vitest with two columns differing only in
non-alphanumerics.]**

**M3 [Security] Custom sidecar endpoint URL has no scheme/format validation**
Files: `src/ui/settings-modal.ts:302`,
`src/core/sidecar/providers/custom-openai.ts:34`.
The `<input type="url">` is cosmetic; only `.trim()` is applied before
persist. CSP `connect-src https:` blocks `http:/data:/javascript:` at
fetch time (so the threat is bounded), but a typo / clipboard-swap /
hostile-pasted-instructions can direct keys + prompts to any HTTPS
origin. No domain-allowlist warning, no "you'll send keys to <host>"
confirm.
Fix: parse with `new URL(value)`, reject non-`https:`, surface the
resolved host on the Settings row, one-time "we'll send keys to <host>"
confirmation before first save.

**M4 [Security] Sidecar error body slice can leak BYOK key when server echoes Authorization**
Files: `src/core/sidecar/providers/custom-openai.ts:70`,
`providers/openai.ts:47`, `providers/anthropic.ts:51`.
`text.slice(0, 240)` of the response body is interpolated into a thrown
`SidecarError.message`. Some misconfigured proxies / debug endpoints echo
`Authorization` on 4xx — the BYOK key then renders in the cell's
sidecar-error UI and could end up in the toast.
Fix: scrub before throwing:
`s.replace(/(Bearer\s+\S+|sk-[A-Za-z0-9_-]+|sk-ant-[A-Za-z0-9_-]+)/g, '[REDACTED]')`.
Apply to `json.error.message` paths too.

**M5 [Bug] summarise-result hallucination guard doesn't trim whitespace on inputs**
File: `src/core/sidecar/client.ts:585`.
The guard builds `allowed = new Set(columns.map(c => c.toLowerCase()))`.
A result column literally named `"total "` (trailing space from
`SELECT … AS "total ";`) is added as `"total "`. A backticked reference
`` `total` `` fails the check; the whole observation is dropped as
hallucinated — false-positive rejection.
Fix: `new Set(columns.map(c => c.trim().toLowerCase()))` and apply
`.trim()` symmetrically to the `ref` lookup.

**M6 [Bug] `buildSchemaHint` duplicates column lists across tables**
File: `src/main.ts:2005`.
The walker filters by `a.columnName && t.name` but doesn't gate on the
column belonging to the current table. Every assignment's columnName is
concatenated into every table's hint — same column list duplicated.
Model sees noise, explain-error suggestions degrade.
Fix: filter by `key.startsWith(\`${source.id}::${t.id}::\`)`.

**M7 [Bug] Classifier worker `ensureReady()` never times out / doesn't handle error events**
File: `src/taxonomy/client.ts:66-78`.
Init Promise resolves on a 'ready' message; never rejects on `error` or
`messageerror`. If `taxonomy.worker.js` 404s under a misconfigured deploy
prefix or throws on import, the schema panel stays at "Classifying
columns…" forever.
Fix: also `worker.addEventListener('error', reject)` +
`worker.addEventListener('messageerror', reject)` + ~10s timeout.

**M8 [Bug] `renderPie` faceted empty grid (no fallback empty-state)**
File: `src/charts/render.ts:399-472`.
When `partitions.size >= FACET_MIN_PARTITIONS` but every facet
aggregates to zero positive slices (e.g. all-null `num` per partition),
the loop appends nothing and the cell mounts an empty `<div>` with no
fallback message.
Fix: track whether any partition appended; if not, replace `mount` with
the standard "No positive values to plot." empty-state.

**M9 [Bug] `rangeNumeric` detector uses wrong denominator**
File: `src/taxonomy/detectors.ts:138-144`.
"In-range" ratio = `inRange / sample.values.length`, not `inRange /
parsed`. A column where half the values are strings (e.g. `"N/A"`
placeholders) caps at 0.5 score even when 100% of NUMERIC values are
in-range. Depresses scores for `gst_rate`, `gst_state_code`, `hsn_code`,
etc. when columns carry occasional non-numeric junk.
Fix: divide by `parsed` when `parsed > 0`; keep evidence string honest
about parsed-vs-total. **[test: vitest case with a mixed string+numeric
column.]**

**M10 [Bug] Pivot + Map cells missing the name input that dashboards reference**
Files: `src/ui/cells/pivot-cell.ts:26-49`, `src/ui/cells/map-cell.ts:28-51`.
Both `PivotCellState` and `MapCellState` carry a `name` field per
`types.ts`, but neither renderer exposes a `<input data-region="cell-name">`
in its head. W6.4 dashboards explicitly list pivot/map as valid embed
targets, but a user can't name them → "No cell named X" forever. Also:
`export-html.ts:54` reads the cell-name input to emit `<h3>`, so
pivot/map export without headings.
Fix: add the same name input that chart-cell.ts:25-31 uses; wire
`nameInput.addEventListener('change', ...)` to `onChange({ name })`.
**[test: e2e — dashboard referencing a named pivot cell renders the
table.]**

**M11 [Bug] 5 modals use raw `_previouslyFocused?.focus()` instead of `restoreModalFocus`**
Files: `src/ui/mount-compute-bridge-modal.ts:41`,
`mount-iceberg-modal.ts:38`, `mount-iceberg-catalog-modal.ts:41`,
`mount-url-modal.ts:38`, `mount-s3-modal.ts:45`.
The `restoreModalFocus` helper exists in `modal-focus.ts` precisely to
handle the case where the surrounding panel re-renders mid-modal
(workbook tick → schema-panel re-render → stored ref detached). Direct
`.focus()` on a detached node silently no-ops → focus jumps to `<body>`.
Already documented as the exact regression the helper guards against
(see define-type-modal.ts:165-168 + schema-graph.ts:106-110).
Fix: replace with `restoreModalFocus(_previouslyFocused)` and import from
`./modal-focus.ts` in all five files. **[test: e2e — open each modal,
trigger a workbook tick, close, assert focus is on the trigger button.]**

**M12 [Bug] Service worker `CACHE_VERSION` never bumped by the build**
File: `public/sw.js:14`.
Hard-coded `'v1'`. When the inlined `main.js` SHA-256 bumps (i.e. any
rebuild changes the CSP), the SW happily serves stale `index.html` from
cache → CSP whitelists OLD inline-script hash, new inline body fails to
match, page won't boot. Network-first usually masks this, but a
just-came-online user can race the cache.
Fix: have esbuild inject `CACHE_VERSION` (e.g. the inline-script hash or
build timestamp) into `dist/sw.js` post-build.

**M13 [Security] `xlsx ^0.18.5` is unpinned + unmaintained on npm**
File: `package.json:34`.
SheetJS Community Edition 0.18.x is unmaintained on npm (the maintainers
moved distribution off npm; CVE-2024-22363 / CVE-2023-30533 advisories
apply to the npm-distributed builds). `^0.18.5` lets `npm ci` pull any
0.18.x. Sheet content is user-controlled — a malicious xlsx exploiting
parser issues runs in the main thread.
Fix: pin exactly to `0.18.5`, or vendor from the official SheetJS CDN
per their guidance; document the trust boundary. Also drop `^` from
every other dep — `package-lock.json` is the only thing between you and
a malicious release on next `npm install`.

**M14 [Bug] Dev server path traversal in `esbuild.config.mjs`**
File: `esbuild.config.mjs:155-198`.
`createServer` resolves `req.url` via `join(OUT_DIR, path)` /
`join('public', path)` with no normalization. `/../../etc/passwd` joins
to a parent dir; `stat` succeeds and the file body is served as
`application/octet-stream`. Local-only today, but if dev mode is ever
exposed via `--host`, it's directory traversal.
Fix: reject decoded paths containing `..` segments or use a hardened
static-file handler that resolves and checks containment.

**M15 [Bug] postinstall errors swallowed via `process.exit(0)`**
Files: `scripts/fetch-duckdb-fallback.mjs:96-99`,
`fetch-duckdb-extensions.mjs:128-131`.
Top-level `main().catch()` ends in `process.exit(0)`. Network down,
disk full mid-write leaving partial files → postinstall silently
"succeeds", build looks fine until smoke fails. `alreadyVendored()` may
return true on truncated files on next install.
Fix: `exit(1)` on real errors. Delete partial output before exit.

### Low

**L1 [Bug] Blob URL + worker leaked when DuckDB instantiate fails**
File: `src/core/engine.ts:222-234, 266-270`.
Cross-origin worker path: `bootstrapToRevoke = URL.createObjectURL(...)`
on :224, `new Worker(...)` on :227, `db.instantiate` on :231-233. If
instantiate throws, the revokeObjectURL on :234 is never reached and the
catch on :266-270 doesn't terminate the worker. Retries compound the
leak.
Fix: wrap :223-234 in try/finally with revoke in `finally`; in the outer
catch also `this.worker?.terminate(); this.worker = null` before
re-throwing.

**L2 [Security] `allow_unsigned_extensions` stays on for the session after community install**
File: `src/core/engine.ts:494-515`.
The community branch issues `SET allow_unsigned_extensions = true` and
never restores. Every subsequent core INSTALL/LOAD runs unsigned-allowed
for the connection lifetime, weakening signature-verification posture
for any later extension load in the same session.
Fix: read prior value via `current_setting`, restore in try/finally; or
explicitly `SET allow_unsigned_extensions = false` after the community
LOAD succeeds (only needed during INSTALL).

**L3 [Bug] Local provider 'no-provider' error doesn't surface a "Set up local model" UX**
File: `src/core/sidecar/client.ts:78-95` + handlers in `src/main.ts`.
When `provider === 'local'` and no generator is registered, dispatchJob
throws `'no-provider'`. The UI handlers (`runExplainError`,
`runSummariseResult`) only special-case `'no-key'` to show "Open
Settings". Local users get the generic toast with no obvious path
forward.
Fix: extend the `'no-key'` UI branch to also handle `'no-provider'`
when provider is `'local'`.

**L4 [Security] `defaultTransport` falls through to OpenAI for unknown provider values**
File: `src/core/sidecar/client.ts:96-103`.
Corrupted settings (`provider: 'evil'`) silently send the user's OpenAI
key + prompt to `api.openai.com`. Defence-in-depth gap; not exploitable
through normal UI.
Fix: explicit `if (req.provider === 'openai')` else throw
`'unsupported'`.

**L5 [Bug] Pivot `computePivot` lexicographic sort breaks numeric-string axes**
File: `src/ui/cells/pivot-cell.ts:159-160`.
`rowKeys.sort()` / `colKeys.sort()` use default ordering — "1","10","2"
ordering for numeric-string keys. ISO week strings are fine but numeric
axes look broken.
Fix: comparator prefers numeric ordering when every key parses as a
finite number.

**L6 [Bug] `engineLabel()` escapes for innerHTML but is later assigned to textContent**
File: `src/ui/shell.ts:255, 323`.
First render uses `innerHTML` (line ~240, escape needed). Status
updates assign the same return to `region.textContent` (line 323) —
`&amp;` and `&lt;` render literally. XSS-safe (textContent), just
visibly wrong on engine-error messages.
Fix: build the message without escapeHtml, assign to textContent only;
or split into two helpers.

**L7 [Bug] `sinks.ts` `COPY ... TO 'tmp_export_${cellId}.csv'` interpolation unescaped**
File: `src/ui/sinks/sinks.ts:185, 200`.
`cellId` flows into the single-quoted SQL string literal without `'`
escaping. `genCellId()` produces `c_<base36-timestamp>_<seq>` so runtime
is safe today. Threat is a malicious `.naklidata` file with a
hand-crafted `cell.id` containing `'`.
Fix: `.replace(/'/g, "''")` before interpolating; or use a fresh UUID
for the temp filename instead of cellId.

**L8 [Bug] SQL cell CM6 race when cell deleted during chunk load**
File: `src/ui/cells/sql-cell.ts:88-92, 102-110`.
If a SQL cell is created → deleted within the chunk-load window
(~hundreds of ms on first load), the `.then()` proceeds to mount an
EditorView on a now-detached host that never gets disposed. The
`editorMount.isConnected` check at line 105 partially guards but the
cmInstance-disposal sentinel isn't checked.
Fix: in the `.then()` block, also check that `cmInstances.get(cell.id)`
hasn't been set+disposed during the await window, or use a per-cell
mount token. **[probe: stress-create+delete in a tight loop.]**

**L9 [Bug] `lazy-loader.ts` uses a Vite-specific magic comment in an esbuild project**
File: `src/core/lazy-loader.ts:48`.
`import(/* @vite-ignore */ url)` — Vite magic. Harmless today (esbuild
ignores), misleading for future readers.
Fix: drop the comment.

### Stray

None above threshold. Subagents did NOT find significant dead code,
commented-out blocks, orphaned files, or TODO/FIXME markers that
represent unfinished work. The codebase has been actively pruned (every
removed feature surfaces in DECISIONS.md), which shows.

---

## False positives / non-issues (verified)

- **A2 L4 — CTE matcher whole-string regex edge case** (`client.ts:683`).
  Even if the regex accidentally whitelists a table name via odd
  parenthesised context, DuckDB will still fail at execute time. Inert.
- **A5 L2 — `integrity` field typing in `fetch-duckdb-fallback.mjs:78`**
  is cosmetic; `.mjs` isn't typechecked.
- **A5 L3 — Smoke server `extname(reqUrl)` edge** at smoke.mjs:62-66.
  Agent re-checked; MIME table indexes by `extname(filePath)` not
  `reqUrl`; already correct.

---

## Worth a look (lower confidence)

- **W1.** Cross-origin DuckDB-wasm loaded from `https://naklitechie.github.io`
  and `https://cdn.jsdelivr.net` — does the build verify SRI on those?
  `script-src` allows the hosts; if the project relies on SRI for byte
  integrity, verify it's actually computed and present in the script
  tags. (Not checked in this pass — subagent flagged as worth verifying.)
- **W2.** The `?lens=` decoder applies `clearLensFromLocation()` AFTER
  the auto-mount fires. Browser history may retain the lens hash in
  back/forward navigation, replaying the mount. Test the back-button
  flow.
- **W3.** Service worker scope — if SW caches the shell and the user
  clears IDB ("Forget all"), the cached shell still holds the prior
  CSP + prior bundle (which may reference IDB keys the user thinks
  they've forgotten). Investigate whether "Forget" should also
  `unregister()` the SW.

---

## Coverage map

**Reviewed (read line-by-line or close to it):**
- `src/core/engine.ts`, `mount.ts`, `persistence.ts`, `workbook.ts`,
  `idb.ts`, `handles.ts`, `sessions.ts`, `settings.ts`, `url-state.ts`,
  `demo-mode.ts`, `lazy-loader.ts`, `secrets/`, `bridge/`, `iceberg/`
- All of `src/core/sidecar/` (byok, client, types, local-runtime,
  providers/{anthropic, openai, custom-openai})
- `src/ui/nl-to-sql-modal.ts`, `settings-modal.ts`, and the sidecar
  dispatch sections of `src/main.ts`
- `src/charts/render.ts`
- `src/ui/schema-panel.ts`, `templates/templates.ts`,
  `templates/templates-panel.ts`, `quick-aggregations.ts`
- `src/taxonomy/{types,detectors,classify,client,checksums,user-types,load}.ts`,
  `src/workers/taxonomy.worker.ts`, `taxonomy/v0.1/types.jsonl`
- `src/ui/notebook.ts`, `notebook-graph.ts`, all `src/ui/cells/*.ts`,
  all `src/ui/*-modal.ts`, `modal-focus.ts`, `export-html.ts`,
  `sinks/sinks.ts`, `sinks/gating.ts`, `shell.ts`
- `esbuild.config.mjs`, `src/index.html`, `src/main.ts` boot path,
  `src/lazy/*.ts`, `src/workers/`, `scripts/*.mjs`,
  `public/sw.js` (where present)

**Not reached / skipped (blind spots):**
- **Tests** (`tests/`, `tests/e2e/`) — out of scope by brief.
- **Eval fixtures** (`eval/fixtures/`) — golden cases, not source.
- **Vendored bundles** (`public/duckdb-fallback/`,
  `public/duckdb-extensions/`) — third-party WASM.
- **CSS files** (`*.css.ts`) — surveyed for `innerHTML` template
  literals but not deep-reviewed for token leakage.
- **Schema-graph (Cytoscape) modal** — small file, briefly reviewed; no
  obvious findings but not deep-checked for graph-data XSS.
- **Build artifacts** (`dist/`) — verified as generated, not source.

---

## Workplan — batched, ordered

Group by theme (not severity); keystone first. Tri-state checkboxes
(`[ ]` open · `[x]` done · `[~]` partial).

### Batch A — XSS + CSP hardening (keystone) ✅

The combination of **C1** (XSS via column names) + **H7** (CSP missing
`base-uri`/`frame-ancestors`/`object-src`/`form-action`) is the most
exploitable chain in this audit. Fix together; CSP additions make C1
harder to exploit even if a future XSS slips through.

- [x] **C1** Escape `ref.table` / `ref.column` / `typeId` in
  `renderTemplateCard` (`src/ui/templates/templates-panel.ts:134-150`).
  Refactored into `formatUsedColumnsHtml` helper for testability;
  7 vitest cases lock in the escape contract
  (`tests/templates-panel-xss.test.ts`).
- [x] **H7** Appended `base-uri 'self'; object-src 'none'; form-action
  'self'; frame-ancestors 'none'` to CSP in both `src/index.html:14`
  and the computed policy in `esbuild.config.mjs`. `frame-ancestors`
  is documented as `<meta>`-ignored per CSP L3 (GitHub Pages doesn't
  speak custom headers); the other three enforce via meta.
- [x] **L6** Fixed `engineLabel()` escape-then-textContent bug
  (`src/ui/shell.ts:246-257, 232-244`). Helper now returns raw text;
  innerHTML interpolation in `renderFooter` wraps with `escapeHtml`;
  `updateEngineStatus` keeps the raw assignment to `textContent`.

### Batch B — Sidecar guardrails ✅

NL→SQL is the sidecar's most-dangerous response surface. Tighten now;
recheck the eval harness for regression cases.

- [x] **H2** Replaced `TABLE_REF_REGEX` with `extractFromTables` —
  walks every FROM/JOIN window and captures all comma-separated
  identifiers within. 4 vitest cases lock in
  (`sidecar-parser-hardening.test.ts`).
- [x] **H3** Added `INSTALL|LOAD|SET|RESET|USE` to `WRITE_KEYWORDS`
  + new multi-statement gate `/;\s*\S/` catches anything else.
  7 vitest cases (one per keyword + trailing-`;` happy path).
- [x] **M3** Custom-endpoint URL validation: `new URL` parse + reject
  non-`https:` at both UI (live inspector showing resolved host /
  warning red) and use site (`callCustomOpenAI` hard rejects before
  fetch).
- [x] **M4** Created `providers/redact.ts` — scrubs `Bearer …`, `sk-…`,
  `sk-ant-…`, `x-api-key: …` from response bodies. Wired into all
  three providers' HTTP/json.error paths.
- [x] **M5** `parseSummariseResultResponse` now applies
  `.trim().toLowerCase()` symmetrically to both `allowed` set and `ref`
  lookup. 3 vitest cases including a trailing-space column name.
- [x] **M6** `buildSchemaHint` now filters by `${src.id}::${t.id}::`
  key prefix — each table's hint only includes its own columns.
- [x] **L3** Both `runExplainError` and `runSummariseResult` error
  branches now show "Open Settings" for `'no-provider'` (covers the
  local-no-generator + unknown-provider cases) in addition to
  `'no-key'`.
- [x] **L4** `defaultTransport` now requires an explicit
  `req.provider === 'openai'` match before routing to OpenAI; falls
  through to a thrown `SidecarError('Unsupported sidecar provider …')`.

### Batch C — Lens link safety / SSRF ✅

Independent surface; can run in parallel with B.

- [x] **H1** Lens-link auto-mount gated behind `openLensConfirmModal`
  (new file `src/ui/lens-confirm-modal.ts`). The modal lists every
  remote host the link would fetch from, dedupes by host, defaults
  focus to Cancel so Enter dismisses safely. Local kinds
  (`example-bundle`, `fsa-folder`) still auto-restore. Cancel falls
  back to the saved session. Existing share-link e2e still passes
  (it mounts example-bundle only → no prompt).
- [x] **H8** `mountIcebergCatalog` now re-validates `metadataLocation`
  returned by the catalog client against the same `^https?://|^s3://`
  allowlist `mountIcebergTable` applies. A compromised catalog
  returning `http://internal/` is rejected with a clear `MountError`.
- [x] **M1** New `src/core/bearer-token.ts` with
  `assertSafeBearerToken` (RFC 7235 token68 charset). Wired into:
  - `engine.configureIceberg` (before the SQL literal interpolation).
  - `BridgeClient` constructor (before any fetch).
  9 vitest cases (CR/LF, whitespace, quotes, paren — all
  rejected; standard JWT / opaque tokens / empty — all accepted).

### Batch D — Supply chain + dev-server

- [ ] **H6** Check in expected-hash table for fetched duckdb-extension
  + fallback bytes; hard-fail mismatch
  (`scripts/fetch-duckdb-extensions.mjs:101-119`,
  `fetch-duckdb-fallback.mjs:55-60`).
- [ ] **M13** Pin `xlsx` to exact `0.18.5` (or vendor from official
  SheetJS CDN); drop `^` from all deps in `package.json`. **[test: `npm
  ci` + smoke.]**
- [ ] **M14** Hardened static-file handler in dev server — reject `..`
  segments / resolve+containment-check
  (`esbuild.config.mjs:155-198`).
- [ ] **M15** Make postinstall scripts `exit(1)` on real errors; delete
  partial output before exit
  (`fetch-duckdb-fallback.mjs:96-99`,
  `fetch-duckdb-extensions.mjs:128-131`).

### Batch E — Chart + classifier correctness

- [ ] **H4** Bind `chart()` by `_inputName` first, nearest-prev only on
  miss (`src/ui/templates/templates-panel.ts:175-189`). **[test: vitest
  case instantiating ERROR_FREQUENCY.]**
- [ ] **H5** Replace `Math.min(...vals)` / `Math.max(...vals)` with
  single-pass loops (`src/charts/render.ts:344-347, 380-381, 256-257`).
  **[test: vitest with 200k-element array.]**
- [ ] **M7** Add `error` + `messageerror` handlers + ~10s timeout to
  taxonomy worker `ensureReady` (`src/taxonomy/client.ts:66-78`).
  **[test: vitest mocking a failing worker.]**
- [ ] **M8** Fallback empty-state message in `renderPie` faceted path
  when no facet appends (`src/charts/render.ts:399-472`).
- [ ] **M9** Fix `rangeNumeric` ratio denominator
  (`src/taxonomy/detectors.ts:138-144`). **[test: vitest case with
  mixed string+numeric column.]**
- [ ] **L5** Numeric-aware comparator in `computePivot.sort()`
  (`src/ui/cells/pivot-cell.ts:159-160`).

### Batch F — Engine + mount housekeeping

- [ ] **M2** Index-based aliases in `compareTables` projection
  (`src/core/engine.ts:866-913`). **[test: vitest with `"foo bar"` +
  `"foo-bar"` columns.]**
- [ ] **L1** try/finally + worker.terminate on engine.boot failure
  (`src/core/engine.ts:222-234, 266-270`).
- [ ] **L2** Restore `allow_unsigned_extensions` after community LOAD
  (`src/core/engine.ts:494-515`).

### Batch G — Modals + cell-naming lifecycle

- [ ] **M10** Add name input to pivot + map cells; wire to
  `onChange({ name })` (`src/ui/cells/{pivot,map}-cell.ts`). **[test:
  e2e — dashboard referencing a named pivot renders the table.]**
- [ ] **M11** Replace `_previouslyFocused?.focus()` with
  `restoreModalFocus(_previouslyFocused)` in five modals
  (`mount-compute-bridge-modal.ts:41`, `mount-iceberg-modal.ts:38`,
  `mount-iceberg-catalog-modal.ts:41`, `mount-url-modal.ts:38`,
  `mount-s3-modal.ts:45`). **[test: e2e focus assertions for each.]**
- [ ] **L8** Mount-token guard for SQL cell CM6 chunk-load race
  (`src/ui/cells/sql-cell.ts:88-92, 102-110`). **[probe: tight
  create+delete loop.]**

### Batch H — Build + SW + misc

- [ ] **M12** Inject `CACHE_VERSION` (inline-script hash or build
  timestamp) into `dist/sw.js` post-build (`esbuild.config.mjs` +
  `public/sw.js:14`).
- [ ] **L7** Escape `'` in cellId before interpolating into COPY SQL
  literal (`src/ui/sinks/sinks.ts:185, 200`).
- [ ] **L9** Drop the `/* @vite-ignore */` magic comment
  (`src/core/lazy-loader.ts:48`).

---

## Progress log

- 2026-06-02: forward pass complete via 5 parallel subagents. 1 Critical,
  8 High, 15 Medium, 9 Low, 0 Stray = 33 actionable findings. Workplan
  created. Keystone is **Batch A — XSS + CSP hardening** (C1 + H7 + L6).
- 2026-06-02: **Batch C landed.** H1, H8, M1 fixed.
  - H1: lens-link auto-mount gated behind a confirmation modal listing
    every remote host. Cancel falls back to saved session; Continue
    proceeds. Local kinds still auto-restore silently.
  - H8: iceberg catalog `metadata-location` re-validated against the
    same scheme allowlist used for direct mounts.
  - M1: new `src/core/bearer-token.ts` + RFC 7235 token68 validator.
    Wired into engine.configureIceberg and BridgeClient. 9 new vitest
    cases.
  - Gates: 408 vitest (+9) / 51/51 e2e / smoke / check / bundle 529.2 KB.
- 2026-06-02: **Batch B landed.** H2, H3, M3, M4, M5, M6, L3, L4 fixed.
  - H2 + H3: NL→SQL parser now uses a positional `extractFromTables`
    walker (handles SQL-89 comma-join + quoted idents + alias) plus
    multi-statement gate. 22 new vitest cases.
  - M3: settings-modal grew a live inspector below the URL field
    (shows resolved host on https; red warning on non-https or
    unparseable). Use-site (`callCustomOpenAI`) hard rejects too.
  - M4: new shared `providers/redact.ts` scrubs Bearer / sk-* /
    sk-ant-* / x-api-key from response bodies before they reach
    SidecarError messages.
  - M5/M6/L3/L4: small targeted fixes.
  - Gates: 399 vitest (+22) / 51/51 e2e / smoke / check / bundle 524.0 KB.
- 2026-06-02: **Batch A landed.** C1, H7, L6 fixed.
  - C1 vitest: 7 cases covering hostile column/table/typeId, ampersand
    no-double-escape, multi-row separator, undefined refs.
  - H7 build: dist/index.html CSP now contains
    `base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'`.
    Smoke notes the documented "frame-ancestors ignored when delivered
    via <meta>" browser warning — expected on GitHub Pages until a
    header-capable deploy path exists.
  - L6 fix: engineLabel returns raw text; renderFooter escapes at
    innerHTML; updateEngineStatus continues to use textContent.
  - Gates: 377 vitest / 50 e2e (1 flake on auto-restore passed on
    re-run) / smoke / check / bundle 521.0 KB.
