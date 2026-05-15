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
