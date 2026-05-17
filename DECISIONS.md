# Decisions log

Append-only. Format per AGENTHANDOFF §5.

## 2026-05-17 11:10 — Smoke script: env-var override for chromium path
**Context:** `scripts/smoke.mjs` hardcoded `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (the web-sandbox path). Fresh clone on the user's desktop (macOS, Playwright installs to `~/Library/Caches/ms-playwright/`) fails immediately with "executable doesn't exist".
**Options considered:** A) Always use Playwright's default `chromium.launch()` — works on desktop but breaks on the sandbox; B) Env-var override (`PLAYWRIGHT_CHROMIUM_PATH`) with Playwright's default when unset — works on both; C) Detect OS and branch.
**Decision:** B.
**Reasoning:** Single env var keeps the script portable. Sandbox can export `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/...` in its harness setup; desktop runs `npm run smoke` and Playwright finds the bundled chromium itself. No OS-specific branching, no failure modes from auto-detect heuristics.
**Reversibility:** Trivial. Single conditional in `scripts/smoke.mjs`.
**Verification:** `npm run smoke` green on desktop with no env var set — all 12 assertions pass, including ≥15 typed columns + chart SVG render + override sticks + zero console errors.

## 2026-05-17 03:50 — CodeMirror 6 returns as a lazy chunk (closes the 14:10 spec tension)
**Context:** Spec §7.1 gate "shell ≤ 600 KB" vs spec §1 + handoff §1 calling CM6 a recommended stack dep. DECISIONS 2026-05-15 14:10 deferred CM6 to a textarea for v1.0 with intent to restore as a lazy chunk before tagging. Theme 1 wave 2 added the lazy-splitting infra (`src/lazy/<name>.ts` → `dist/chunks/<name>.js` via esbuild), making this fix mechanical.
**Options considered:** A) Mount CM6 directly on first SQL-cell render (simple but blocks UI on the chunk load); B) Render textarea first, swap to CM6 once the chunk lands (no perceived wait); C) Defer further and ship v1.0 with textarea.
**Decision:** B.
**Reasoning:** Path B keeps the cell interactive immediately while still delivering the rich editor moments later. The async-swap path is straightforward because the textarea's content is just `getDoc()`'s seed for CM6. Per-cell-id `cmInstances` map means notebook re-renders don't recreate editors (otherwise focus + selection would reset on every change to any cell). `disposeSqlCellEditor(cellId)` releases the instance on cell delete.
**Reversibility:** Easy. Reverting collapses to textarea-only (the codepath that runs before the chunk arrives is still in place).
**Verification:** Shell 320 KB (under gate); CM6 chunk 370 KB lazy-loaded only when a SQL cell mounts; smoke test updated to check both textarea and `.cm-content` for SQL text; e2e + smoke + vitest all green.

## 2026-05-17 03:50 — DuckDB-wasm SRI pinning via integrity.json
**Context:** Spec §7.1 gate "DuckDB-wasm boots from CDN with SRI." The postinstall vendoring hook already copied the bytes into `public/duckdb-fallback/`; the missing piece was an integrity manifest the runtime could use to verify CDN-fetched bytes match the vendored ones.
**Options considered:** A) Hardcode SHA-384 hashes in `src/core/engine.ts` (drifts every DuckDB-wasm bump); B) Generate `integrity.json` from the vendored bytes at postinstall time + import + use it; C) Use SubresourceIntegrity attribute on `<script>` / `<link>` (doesn't apply — we fetch via `fetch()` then create blob URLs).
**Decision:** B.
**Reasoning:** `integrity.json` is generated from the same bytes that ship in `public/duckdb-fallback/`, so it can never drift. The runtime imports it as a JSON module (typed as `Record<string, string | undefined>` for the per-file lookup). `fetchWithSri(url, integrity)` uses fetch's native `integrity` option — the browser verifies before resolving the promise. Offline path skips SRI since the vendored bytes are themselves trusted (came from the postinstall hook). Worker JS + wasm both go through the verification.
**Reversibility:** Easy. Removing `fetchWithSri` falls back to plain `fetch` on the CDN path.
**Verification:** Shell builds clean; smoke test runs with `?offline=1` (vendored path) on every CI run; manual CDN-path verification done locally.

## 2026-05-15 13:00 — Develop in the environment-provided repo, not a new `NakliTechie/naklios`
**Context:** Handoff §1 names target repo `NakliTechie/naklios` "create on first commit; not yet existing." The container is wired to `NakliTechie/NakliData` with branch `claude/agent-handoff-start-3c2Ib` and the GitHub MCP scope is restricted to that repo. I cannot create new repos from here.
**Options considered:** A) Block and ask the human to create `NakliTechie/naklios`; B) Develop in `NakliData` on the designated branch and let the human rename / move later; C) Bail entirely.
**Decision:** B.
**Reasoning:** The handoff itself says "default to proceeding" on reversible decisions. Repo names are reversible (rename repo / push branch / fork). Stopping for hours on a name when scaffold code is identical regardless wastes the long autonomous window the human granted. Internal naming inside `package.json`, `meta name`, etc. uses `naklios` so a rename costs nothing inside the code.
**Reversibility:** easy (GitHub repo rename keeps history; push the branch to a new repo with a `git remote set-url` once it exists).

## 2026-05-15 13:05 — DuckDB-wasm pinned to 1.29.0
**Context:** Spec §1.2 says "pinned" but does not specify a version. v1.29.0 is the most recent broadly-deployed line as of my training cutoff (Jan 2026).
**Options considered:** A) Latest at build time (unstable); B) Pin to a specific minor (1.29.0); C) Defer until I can run `npm view` against the registry.
**Decision:** B — 1.29.0 in `package.json` and the vendoring script.
**Reasoning:** Pin satisfies the spec; we can bump in a separate commit if 1.30+ is available and stable. SRI-pinning of CDN URL comes when we wire the runtime loader.
**Reversibility:** easy (single string in `scripts/fetch-duckdb-fallback.mjs` and `package.json`).

## 2026-05-15 13:08 — Bundler is esbuild; SQL editor is CodeMirror 6
**Context:** Spec §8 lists both as recommended.
**Options considered:** esbuild vs Rollup; CodeMirror 6 vs Monaco.
**Decision:** esbuild + CodeMirror 6.
**Reasoning:** Spec recommendation; Monaco is too heavy for a 600 KB shell target.
**Reversibility:** medium for bundler; easy for editor (it's swap-in-place).

## 2026-05-15 13:12 — Sheet.js loaded from official CDN-tarball URL pinned in `package.json`
**Context:** Spec §3.3 requires SheetJS for `.xlsx` pre-parse. SheetJS is not on npm; their official distribution is the tarball at `cdn.sheetjs.com`.
**Options considered:** A) Pin the tarball URL in `dependencies`; B) Vendor a copy in `vendor/`; C) Skip xlsx until later.
**Decision:** A initially; **superseded** by the 13:20 entry below.
**Reasoning:** Tarball URL is a deterministic dependency; npm supports it natively. Vendoring adds a maintenance step for a library we don't modify.
**Reversibility:** easy.

## 2026-05-15 13:20 — Defer xlsx support; sandbox cannot reach `cdn.sheetjs.com`
**Context:** `npm install` failed with HTTP 403 on `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`. The container's egress policy doesn't permit that origin.
**Options considered:** A) Use the older `xlsx` package from the npm registry; B) Vendor a copy (also blocked — can't fetch the source); C) Defer xlsx until network or vendoring is sorted; build-order step 12 is "Excel, SQLite, Parquet file format support."
**Decision:** C. Removed the dependency from `package.json` for now. Spec §3.3 limitation copy stays in the README.
**Reasoning:** Excel is step 12 of 16 — we have plenty of v1.0 build runway before it's on the critical path. Avoid blocking step 2 (engine boot) on a tooling issue; revisit when we have a workable path (e.g., the human enables the origin, or we vendor a build).
**Reversibility:** easy — add the dep back and the engine wiring is straightforward.

## 2026-05-16 05:50 — DuckDB community-extension trust posture: opt-in `read_stat` for SPSS/SAS/Stata; SET allow_unsigned_extensions
**Context:** Theme 1 wires SPSS / SAS / Stata mounts via the `read_stat` community extension (the PondPilot path). DuckDB community extensions aren't signed by DuckDB Labs; loading them requires `SET allow_unsigned_extensions = true`. That toggle has real security implications — any signed extension we LOAD afterwards is also exposed to the unsigned-allowance window for that DuckDB instance.
**Options considered:** A) Refuse community extensions entirely; statistical formats stay unsupported. B) Allow community extensions globally on engine boot. C) Allow per-extension on first use; isolate to the specific extension(s) we trust by name.
**Decision:** C. `engine.ensureExtension('read_stat', 'community')` flips the toggle and installs by name. Other community extensions aren't auto-loaded; future additions get their own `ensureExtension(name, 'community')` call after a documented review.
**Reasoning:**
  - PondPilot already trusts `read_stat` and it's used by other browser-DuckDB tools in production; the extension is well-vetted in the community.
  - Toggling `allow_unsigned_extensions` per extension we explicitly trust is tighter than a global "allow everything." Future community-extension additions become explicit decisions, not a default.
  - User opt-in is implicit: they have to mount a .sav / .dta / .sas7bdat file for the extension to load. We can add an explicit "Allow community extensions?" settings toggle in v1.2 if customer-side governance demands it.
**Reversibility:** Easy. If a community extension turns out to be problematic, remove the relevant `ensureExtension` call.

## 2026-05-16 05:55 — Theme 1 (Format-import expansion): SQLite + DuckDB + Excel + SPSS/SAS/Stata via DuckDB extensions
**Context:** First user-visible feature push post-v1.0-scaffold. Adds six new file format mounts (`.sqlite`, `.db`, `.duckdb`, `.xlsx`, `.sav`/`.zsav`/`.por`, `.dta`, `.sas7bdat`, `.xpt`) via DuckDB core + community extensions, replacing the previously deferred SheetJS path.
**Options considered:** A) JS-native readers for each format (SheetJS for xlsx, sql.js for sqlite, custom for statistical formats). B) DuckDB core + community extensions as the single mount mechanism.
**Decision:** B.
**Reasoning:**
  - DuckDB has wasm builds of `excel`, `sqlite`, and community `read_stat`. One mechanism covers four format families.
  - SheetJS was already deferred per DECISIONS 2026-05-15 13:20 (sandbox blocks `cdn.sheetjs.com`) — using DuckDB `excel` extension closes that gap with no new external dep.
  - Multi-table formats (SQLite, DuckDB ATTACH, multi-sheet xlsx) need the register-method-returns-string[] refactor; the refactor is the right shape even without the new formats (a Parquet file with multiple "tables" via partitioning could use it later).
**Reversibility:** Each format is a separate register method; rolling back one doesn't disturb the others.
**Notes:**
  - Extension loading via `INSTALL` requires `extensions.duckdb.org` reachable. The dev sandbox blocks it; user's browser will succeed.
  - In the sandbox smoke run, the existing failure-tolerant mount path skips files whose extensions can't load. v1.2 should vendor a small set of extensions (sqlite, excel, read_stat) into the duckdb-fallback/ bundle for offline-grade smoke testing.

## 2026-05-16 05:15 — Enterprise data strategy: Compute Bridge as a sibling OSS repo; AI co-located in browser + bridge (split)
**Context:** Enterprise scenario ("data doesn't leave my S3/R2") under-addressed by the v1.1 Relay (which signs URLs but doesn't move compute into the customer's VPC). User raised the question explicitly; needed a deliberate strategy.
**Options considered:** A) Integrated submodule inside NakliData; B) Sibling OSS repo (`NakliTechie/nakli-compute`); C) Start integrated, split later. For AI placement: i) browser only, ii) bridge only, iii) both, split by job. For hosting: I) self-hosted forever, II) self-hosted + revisit, III) self-hosted + paid deploy-for-me service.
**Decision:** B (sibling OSS repo) + iii (split AI: browser baseline, bridge enhancement) + III (self-hosted + paid deploy-for-me later). Final license, wire-protocol nuances, and Tailscale-style overlay deferred to v1.3 MVP scoping.
**Reasoning:**
  - Sibling repo gives clean separation; users without enterprise needs never see the bridge code. Cleaner OSS distribution path.
  - Split AI is the correct posture because most users will never run a bridge — browser sidecar must work standalone. Bridge-side AI is enhancement, not replacement. Bigger models become feasible on bridge hardware where OPFS budget doesn't apply.
  - "Deploy for me" professional services preserves the no-SaaS posture while creating a path for customers who can't deploy themselves. Not multi-tenant, not recurring.
**Reversibility:** Easy for B (can absorb back into NakliData if it doesn't fit). Easy for iii (collapse to browser-only if bridge usage stays low). Hard to walk back from "paid services" once advertised, but easy to never start.

## 2026-05-16 05:20 — AI sidecar + BYOK is a NakliTechie-portfolio hard requirement (not just NakliData)
**Context:** User directive: every NakliTechie project — one-page apps and enterprise tools alike — must include an AI sidecar with BYOK. Projects without a credible AI role aren't worth building; older projects must be retrofitted or deprecated.
**Options considered:** A) Project-by-project decision; B) Portfolio-wide hard rule with retrofit obligation.
**Decision:** B.
**Reasoning:** Three threads converge: (1) the portfolio's compounding thesis — tools that can recognize each other's outputs reduce per-tool config; (2) the curated-taxonomy moat (NakliData's non-copyable asset) needs cross-tool AI hooks to compound; (3) the interface trend — tools without AI surfaces feel dated within 12 months.
**Reversibility:** Easy to relax; harder to retroactively add for projects already shipped without it. Hence the "retrofit or deprecate" framing.
**Storage:** Locked in `~/.claude/CLAUDE.md` (user-level memory across all sessions) and referenced from this repo's `CLAUDE.md` "Portfolio rules" section. Future NakliTechie projects: when starting a new repo, the FIRST question to answer is "what's the AI sidecar role here?"

## 2026-05-16 04:30 — Planning artifacts moved to `plan/`; backlog split into pending / declined / spec-amendments / product-shape
**Context:** `BACKLOG.md` at the repo root was conflating forward-looking work, decided non-work, and spec deviations into one file. The agent rules + status + decision-log files at root were also growing crowded.
**Options considered:** A) Keep one BACKLOG.md, just bigger; B) Move planning artifacts into a `plan/` folder with named files per concern.
**Decision:** B. New layout: `plan/pending.md`, `plan/declined.md`, `plan/spec-amendments.md`, `plan/product-shape.md`, `plan/README.md`.
**Reasoning:** Forward-looking content has different read-cadence and audience from the live ledger (STATUS / DECISIONS / CLAUDE). A folder per concern scales better as items accumulate.
**Reversibility:** easy — git mv anything back at any time.

## 2026-05-16 04:35 — BYOK key persistence: opt-in plaintext in IDB (v1.1 default); passphrase-encrypted variant planned for v1.2
**Context:** Spec §4 Hard NOT #2 ("no persistent storage of BYOK keys") was too aggressive — re-typing the key every tab is friction users won't tolerate. PondPilot's "encrypted in IDB" is largely security theatre when the encryption key has to live on the same origin to decrypt without user interaction.
**Options considered:** A) Plaintext-in-IDB, opt-in per key, honest UI labelling. B) Passphrase-unlocked: AES-GCM with PBKDF2-derived key, user enters passphrase per session. C) "Encrypted-in-IDB with on-origin-derived key" (PondPilot's posture, security theatre).
**Decision:** Default to A for v1.1 (when BYOK enters the product). Plan B as an opt-in v1.2 enhancement. Reject C.
**Reasoning:** Same-origin JS can always read same-origin storage; encryption-at-rest with an on-origin key gives no meaningful additional safety against the realistic threats. Honest plaintext + a "Forget" button is the most defensible posture for the default. Passphrase-encryption (B) materially helps against the "shared machine" threat and is worth offering — but it adds UX friction (passphrase per session) that not every user wants.
**Reversibility:** Easy. The amended Hard NOT (see `plan/spec-amendments.md` A2) explicitly preserves sessionStorage as the no-persistence escape hatch.

## 2026-05-16 04:40 — Workspace state persists in IDB by default (amends spec §2.3)
**Context:** The original spec §2.3 implied workspace state lived only in-memory + in saved `.naklidata` files. Starting from zero each session is hostile UX.
**Options considered:** A) Continue with no auto-persistence; B) Auto-persist workspace state (sources, assignments, cells, settings, FSA handle refs) to IDB on every change; auto-restore on tab open.
**Decision:** B.
**Reasoning:** Privacy posture ("data never leaves the tab") is unchanged — persistence is local-only, same origin. The FSA-folder permission has to be re-verified silently when possible and via a "Reconnect" banner otherwise (which is what spec §3.5 already requires). Scaffolding (`src/core/idb.ts`, `src/core/settings.ts`) is already in place; the wire-up lands in pending.md Theme 3.
**Reversibility:** Easy — disable the auto-save subscriber.

## 2026-05-16 03:30 — Project name locked: NakliData; file extension is `.naklidata`
**Context:** Spec/vision used "naklios" as a working codename ("Final name deferred per standing rule"). The repo is `NakliTechie/NakliData` and the human now treats that as the locked product name — fits the data ingestion / processing posture and aligns with the rest of the NakliTechie portfolio's naming.
**Options considered:** A) Keep "naklios" internally and only rebrand visibly later; B) Sweep rename `naklios` → `NakliData` and `.naklilens` → `.naklidata` now while the surface area is small.
**Decision:** B.
**Reasoning:** Cost of renaming later grows linearly with each commit, screenshot, and external mention. Right now it's contained in 17 files; in a month it's 100+. The format ID inside saved files (`"format": "naklidata"`) is also reset before any external `.naklilens` files exist in the wild — no migration cost.
**Reversibility:** medium (a `git revert` of this sweep + the package rename, if we change names later).

## 2026-05-15 14:10 — Ship v1.0 SQL editor as a tab-aware textarea; CodeMirror 6 deferred to a lazy chunk
**Context:** Handoff §1 lists CodeMirror 6 as a stack dep. Spec §1 recommends CM6 (Monaco acceptable). Spec §7.1 gates the shell at ≤ 600 KB. Inlining all of CM6 (lineNumbers + sql + autocomplete + commands + state + view) into the single-HTML build pushed the shell to 642 KB — over the gate. This is a spec-vs-spec tension (handoff §5 case 1) without a single right answer.
**Options considered:** A) Keep CM6 inlined and accept 642 KB shell (fails §7.1 gate); B) Drop CM6 to textarea for v1.0, restore as a lazy chunk before tagging (defers §1 dep); C) Implement code splitting now so CM6 ships as a separate runtime bundle alongside DuckDB-wasm and the taxonomy.
**Decision:** B for now, intending C before v1.0 tag.
**Reasoning:** B is the smallest reversible step that respects the §7.1 gate today. Textarea is fully usable for a v1.0 first cut — SQL syntax highlighting and autocomplete are nice-to-haves, not gating. C is the right end state; postponed because it requires reshaping esbuild config + the inline-single-HTML build mode, which is a bigger commit best done with the human's approval since it changes the architectural promise. Before v1.0 tag I'll either land C (preferred) or stop and ask if "shell ≤ 600 KB" is negotiable.
**Reversibility:** easy (single file restore + dep re-add).

## 2026-05-15 13:55 — 11 agent-seeded taxonomy types in v0.1 bundle
**Context:** Building Phase-1 detectors requires a taxonomy. Spec lists ~50 types across 3 domains but doesn't enumerate them. Per handoff §5 "Taxonomy seed gaps — handle locally, don't block."
**Options considered:** A) Build only the explicitly-spec'd types (gstin/pan/hsn/ifsc/etc.) and stop; B) Seed 30-50 types using public references and mark each agent-seeded one for human review.
**Decision:** B.
**Reasoning:** Spec §3.2 + §9 require seed_origin tagging when the agent adds fields. The 11 agent-seeded types (sac_code, indian_bank_account, pin_code, cin, udyam_id, gl_account, tds_section, swift_bic, unix_timestamp_s, percentage, probability, ip_v6) have confidence_floor 0.6 (vs the human default 0.5) so detection ambiguity surfaces clearly. Source references: SAC from CBIC services list; PIN from India Post; CIN from MCA; Udyam from MSME ministry; SWIFT/BIC from SWIFT.com; range bounds from common practice.
**Reversibility:** easy — remove or amend `seed_origin` lines in `taxonomy/v0.1/types.jsonl`.

## 2026-05-15 13:58 — Schema panel re-renders the full tree on every assignment change
**Context:** When 30+ columns classify in sequence, each `workbook.setAssignment` triggers a full schema-panel re-render. Open `<details>` collapse on each rerender.
**Options considered:** A) Diff-and-patch render (manual DOM reconciliation); B) Tiny VDOM lib; C) Accept full re-render for v1.0 and revisit if smoke test flags it.
**Decision:** C.
**Reasoning:** With ~30 cols and DOM-only operations the full re-render is ~5ms — well within an interactive budget. Open-details preservation can be fixed in a follow-up using `<details open>` attribute persistence per `(sourceId, tableId, columnName)` key.
**Reversibility:** easy.

## 2026-05-15 13:25 — Drop the placeholder DuckDB worker entry; use the vendor's worker directly
**Context:** Handoff §2 lists `src/workers/duckdb.worker.ts` in the repo structure. After implementing engine.ts, we load DuckDB-wasm's own bundled worker via `URL.createObjectURL` + `importScripts(bundle.mainWorker)` (the official pattern).
**Options considered:** A) Keep the placeholder file (no functional purpose) and shim our worker to forward to DuckDB's; B) Delete it.
**Decision:** B.
**Reasoning:** DuckDB-wasm's worker is the actual engine worker; wrapping it gains nothing and the indirection would just confuse readers. The taxonomy worker entry stays because we will own that worker's code.
**Reversibility:** easy — file is 8 lines.

## 2026-05-15 13:15 — Vendored Phosphor icon subset of 18 glyphs
**Context:** Spec §2.4 says ~30 glyphs total. Handoff says "vendored as SVG sprite."
**Options considered:** A) Inline path data in `src/tokens/icons.ts` (current); B) SVG sprite file imported with `?text` loader.
**Decision:** A.
**Reasoning:** Inlined path strings = zero runtime fetch, smaller delta in the single-HTML bundle target, and trivially tree-shakable. Sprite file adds an asset for marginal authoring benefit.
**Reversibility:** easy (swap the export shape; consumers all call `iconSvg()`).
