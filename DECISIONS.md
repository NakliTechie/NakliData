# Decisions log

Append-only. Format per AGENTHANDOFF §5.

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
