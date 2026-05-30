# Checkpoint — 2026-05-17

Frozen snapshot of where NakliData stands at end of the 2026-05-17
desktop session, before any potentially-direction-changing
conversations land. Use this when a future agent (or future-you)
needs to understand the full state without paging through every
commit, decision, and progress entry.

Live state continues to live in `STATUS.md` (current build), `DECISIONS.md`
(append-only log), and `plan/progress.md` (session journal). This
checkpoint synthesizes those into one place at this point in time.

---

## At a glance

NakliData v1.0.0 is tagged and on origin. Theme 3 wave 2 (URL-state
sharing, PWA installability, multi-session sidebar) is complete.
Theme 2 wave 1 (Observable Plot lazy chunk) is complete. The shell
budget (≤ 600 KB) is intact at 324 KB; heavy deps (CodeMirror 6,
Observable Plot) live as lazy chunks that load only when needed.
Single `main` branch — the bootstrap `claude/agent-handoff-start-3c2Ib`
branch has been deleted local + remote. All gate tests green: 77
vitest, 12 Playwright e2e, headless smoke.

The remaining v1.1 work is bounded and well-understood: Theme 2 has
three open sub-items (map cell, pivot, schema-graph), Theme 1 wave 3
is testing-infrastructure work, Theme 4 is quality polish. Theme 6
(Compute Bridge, enterprise) is v1.2+.

---

## Repo state

| Field | Value |
| --- | --- |
| Repo | [NakliTechie/NakliData](https://github.com/NakliTechie/NakliData) |
| Default branch | `main` (formerly `claude/agent-handoff-start-3c2Ib`; that branch has been deleted) |
| Tag | `v1.0.0` at commit `5b10b93` (annotated tag, pushed) |
| Latest commit on main | `2d258d7` (Theme 2 wave 1) |
| Working tree | Clean |
| License | MIT |
| Node engine | ≥ 20 |

### Build sizes (after `npm run build`)

| Artifact | Size | Note |
| --- | --- | --- |
| `dist/index.html` | 324 KB | The inlined shell (HTML + CSS + main.js + inline favicon). Under the 600 KB spec §7.1 gate. |
| `dist/chunks/codemirror.js` | 364 KB | CodeMirror 6 lazy chunk; loaded the first time a SQL cell renders. |
| `dist/chunks/observable-plot.js` | 273 KB | Observable Plot + d3 internals; loaded when a chart cell picks stacked-bar / area-stacked / heatmap. |
| `dist/chunks/_demo.js` | 0.1 KB | Demo chunk verifying the lazy-chunk pipeline end-to-end (kept as the smallest possible e2e fixture for the loader). |
| `dist/sw.js` | 2.7 KB | Service worker. Precaches the shell + chunks + manifest + icon; SWR for other same-origin GETs. |
| `dist/manifest.webmanifest` | 0.4 KB | PWA manifest. |
| `dist/icon.svg` | 0.4 KB | PWA icon (256×256 search-glass on accent ground). |

### Test counts

| Suite | Specs | Status |
| --- | --- | --- |
| Vitest | 77 (6 files) | green |
| Playwright e2e | 12 (7 spec files) | green at `workers: 2` |
| Headless smoke | 12 assertions in `scripts/smoke.mjs` | green |

Pre-existing flake: `tests/e2e/save-load.spec.ts` uses a count-based
wait (`schema-column >= 10`) rather than the `waitForClassificationStable`
helper that `auto-restore.spec.ts` uses. It passes in isolation and at
the current `workers: 2` config but is intermittent under higher
parallelism. Worth a future cleanup — drop-in helper replacement.

### Commits since v1.0.0 tag

(All on `main`. Tag is at `5b10b93`; everything below is post-tag v1.1 work.)

| SHA | Title |
| --- | --- |
| `4638450` | docs: v1.0 handoff notes — tag push pending desktop session |
| `53342b9` | chore: smoke script — env-var override for chromium path |
| `295032b` | docs: STATUS + progress — v1.0.0 tag landed; opening Theme 3 wave 2 |
| `bf45db1` | v1.1: theme 3 wave 2 item 1 — URL-state sharing (`?lens=<base64>`) |
| `f81b660` | v1.1: theme 3 wave 2 item 2 — PWA installability (manifest + lite SW) |
| `c9fcb48` | v1.1: theme 3 wave 2 item 3 — multi-session sidebar (header dropdown) |
| `2d258d7` | v1.1: theme 2 wave 1 — Observable Plot lazy chunk (stacked-bar, area-stacked, heatmap) |

---

## What's shipped

### v1.0 baseline (pre-2026-05-17)

The v1.0.0 tag captures the entire pre-tag product. Highlights, from
`plan/progress.md` and `DECISIONS.md`:

- **Engine**: DuckDB-wasm 1.29.0, vendored into `public/duckdb-fallback/` at postinstall (`scripts/fetch-duckdb-fallback.mjs`). Boot path tries CDN first (with SRI verification via `integrity.json`); falls back to vendored bytes when `?offline=1` or CDN fails.
- **Mount layer** (`src/core/mount.ts`): 13 file formats supported — CSV / TSV / JSONL / Parquet / Arrow IPC (.arrow + .feather) / SQLite (.db + .sqlite + .sqlite3) / DuckDB (.duckdb) / Excel (.xlsx) / SPSS (.sav + .zsav + .por) / Stata (.dta) / SAS (.sas7bdat + .xpt). SQLite/Excel/SPSS/Stata/SAS use DuckDB extensions (`sqlite`, `excel`, `read_stat` community).
- **Taxonomy classifier** (`src/taxonomy/`): regex / value-set / checksum / header-match detectors run in a Worker; v0.1 bundle ships ~30 types in `taxonomy/v0.1/types.jsonl`. Schema panel is the spec's most-important surface (handoff §9); shows per-column candidate types with confidence + accept/override.
- **Notebook** (`src/ui/notebook.ts` + `src/ui/cells/`): three cell kinds — SQL (with CodeMirror 6 as a lazy chunk), chart (7 hand-rolled canvas+SVG types), markdown. Templates panel (`src/ui/templates/`) seeds common analyses based on classified types.
- **Sinks** (`src/ui/sinks/`): export to NakliPoster / Bahi / KanZen, gated by required input types via a declarative `Requirement` schema.
- **`.naklidata` file format** (`src/core/persistence.ts`): JSON-on-disk via FSA. Format ID `"format": "naklidata"`, version `"1.0"`. Sources + assignments + cells + settings. Never source data.
- **Build**: esbuild config inlines main.js + CSS + an SHA-256 of the script body into the CSP `script-src`. Lazy chunks built as separate ESM modules in `dist/chunks/`.

### 2026-05-17 desktop session

Six commits + the v1.0.0 tag push. By theme:

#### Tag + housekeeping (commits `4638450`, `53342b9`, `295032b`)

- **v1.0.0 tag pushed.** The web session had created the tag locally but the harness git proxy returned HTTP 403. Pushed cleanly from the desktop session.
- **GitHub default branch switched** from the bootstrap `claude/agent-handoff-start-3c2Ib` to `main`. The old branch was then deleted local + remote — there's only `main` now.
- **Smoke script portability** (`scripts/smoke.mjs`): no longer hardcodes `/opt/pw-browsers/...` (the web-sandbox chromium path). Uses `PLAYWRIGHT_CHROMIUM_PATH` env var if set; otherwise lets Playwright pick its bundled chromium. Same convention applied to `tests/e2e/playwright.config.ts`.
- **Playwright workers capped at 2** in config. Default (N-cores) caused intermittent "Engine: ready" timeouts from parallel DuckDB-wasm boots; `workers: 2` is the reliable middle ground for typical dev laptops.

#### Theme 3 wave 2 (commits `bf45db1`, `f81b660`, `c9fcb48`)

Wave 2 calls for sharing + offline installability + multi-session
support. All three landed:

1. **URL-state sharing** (`?lens=<base64>`). New `src/core/url-state.ts`: encode the `.naklidata` JSON via `CompressionStream('gzip')` + base64url. Decode reuses `persistence.parse()` for validation. Boot prefers `?lens=` over the IDB snapshot; on bad lens, falls back to IDB (not empty state) so a malformed link doesn't wipe the user's work. URL is stripped via `replaceState` after applying. Share button in the header next to Save. DECISIONS 11:30.
2. **PWA installability**. `public/manifest.webmanifest` (standalone display, theme/background colors, maskable icon) + `public/icon.svg` (256×256 brand mark) + `public/sw.js` (~85 lines, vanilla). SW strategy is **lite**: precache shell + chunks + manifest + icon + taxonomy worker; SWR for same-origin GETs; navigation requests offline → cached `index.html`. DuckDB-fallback bytes (~74 MB) are NOT precached — opportunistically cached if `?offline=1` boot fetches them. DECISIONS 11:50.
3. **Multi-session sidebar — header dropdown.** New `src/core/sessions.ts` owns per-session storage: `sessions/index` for the activeId + meta list; `sessions/<id>/snapshot` for the workbook JSON. CRUD + boot-time migration from the legacy single-key `workbook/current`. UI is a header chip + popup (NOT a 4th sidebar column — see DECISIONS 12:10 for the layout tradeoff). `switchToSession` flushes-then-flips so in-flight debounced saves land on the outgoing session.

#### Theme 2 wave 1 (commit `2d258d7`)

- **Observable Plot lazy chunk**. New `src/lazy/observable-plot.ts`: `mountPlotChart` dispatches `stacked-bar` → `Plot.barX` with fill stacking, `area-stacked` → `Plot.areaY` with monotone curve, `heatmap` → `Plot.cell` (auto-picks a numeric value column or uses `Plot.group({fill:'count'})` fallback). `pickCategory` heuristic for the fill channel; BIGINT-from-DuckDB coerced to Number so Plot's stack math doesn't choke. Existing 7 hand-rolled chart types (bar / line / area / scatter / histogram / stat / table) untouched. DECISIONS 13:00.

---

## What's not shipped

In priority order — top items are the natural next push if work continues
on the current trajectory; bottom items are explicitly v1.2+ or
out-of-scope for this product phase.

### Tier 1 — rest of Theme 2 (visualization upgrade)

Self-contained units; any can ship without blocking the others.

- **Map cell** (MapLibre GL JS + deck.gl as a lazy chunk). New cell kind (`MapCellState`) alongside SQL/chart/markdown. Cell needs an "input cell" picker (like chart cell) + a geometry-column picker. Likely 250–400 lines + a new lazy chunk. Largest remaining Theme 2 item.
- **DuckDB spatial extension mount** — GeoJSON / Shapefile / KML. Pairs naturally with the map cell (mount → query → render on map). Add `geojson` / `kml` / `shp` to `detectFormat` in `src/core/mount.ts` and route through `INSTALL spatial; LOAD spatial;` then `ST_Read`.
- **Pivot-table cell** — custom over DuckDB `GROUP BY CUBE` / `ROLLUP`. No third-party dep. Smallest sub-item; could ship in one focused push.
- **Schema-relationship-diagram view** via Cytoscape.js — fed by `taxonomy/v0.1/relationships.json`. Standalone view; not a cell kind. Could be a new region or modal.
- **Plot: pie + faceted small-multiples** (deferred from wave 1). Pie needs a custom arc adapter (Plot doesn't ship one); faceted needs a third "facet-by" picker on the chart cell — pair with the map cell's UI pass.

### Tier 2 — Theme 1 wave 3 (testing infrastructure)

Not new product surface; closes the local sandbox gap.

- **Sample-data regen** — produce `.sqlite`, `.xlsx`, and a small `.sas7bdat` for `tests/e2e/fixtures/` so the smoke + e2e suites exercise the new format paths in v1.1.
- **Vendor DuckDB extensions** into `public/duckdb-fallback/` (`sqlite`, `excel`, `read_stat`). Production users hit `extensions.duckdb.org` fine; the web sandbox blocks it. Vendoring closes the gap so the smoke test fully exercises the format expansion in any environment.

### Tier 3 — Theme 4 (schema + data quality polish)

Direct extension of the spec's "schema panel is the most important
surface" thesis.

- **Column-statistics panel** — cardinality, null %, length distribution, top-k. A `column-profile` mode for the schema panel.
- **Side-by-side data compare** — auto join-key detection from taxonomy + diff renderer using `EXCEPT`/`INTERSECT`.
- **Type-override learns** — "always treat columns named `vendor_id` as `gstin`" becomes a per-workspace seed.
- **Demo / censor mode** — mask user paths and column names in screenshots (handoff lessons doc item 9).

### Tier 4 — v1.0 review carryover

Three items flagged in the v1.0 handoff notes that wanted a manual
look before the v1.0 tag. The tag was pushed before the eyeballing —
worth doing whenever a human is at the screen:

- **CodeMirror 6 lazy mount** — confirm textarea-first render swaps to CM6 cleanly, editor state survives notebook re-render (`cmInstances` map), `disposeSqlCellEditor` fires on cell delete (memory leak vector).
- **DuckDB-wasm SRI** — read the call sites in `src/core/engine.ts`'s CDN path; ideally exercise a tampered-CDN scenario somehow.
- **README** — confirm browser-support claims match reality (Chrome/Edge/Opera 122+, Firefox partial, Safari unsupported).
- **11 agent-seeded taxonomy types** in `taxonomy/v0.1/types.jsonl` (search `seed_origin`) — human review wanted before they're considered canonical.

### Tier 5 — Theme 6 (enterprise / Compute Bridge)

v1.2+ in `plan/enterprise-strategy.md`. Out of scope for v1.1.

- v1.2: Iceberg REST Catalog + S3 custom endpoints via existing Relay primitive.
- v1.3: Sibling repo `NakliTechie/nakli-compute` (Apache 2.0 lean) as the bridge MVP. Single binary + Docker image; Arrow Flight + HTTP wire protocol; bridge-side AI sidecar with heavier LoRA-Gemma weights.
- v1.4 / v2.0 / v2.x: multi-team OAuth2 + IdP, DB Relay for Postgres/MySQL/Snowflake/BigQuery, edge compute via CF Workers / Lambda.

### Hard NOTs (still locked, do not implement)

From spec §6 + project `CLAUDE.md`:

- No telemetry, analytics, or error reporting.
- No persistent storage of BYOK keys (sessionStorage default in v1.1; opt-in plaintext IDB later; passphrase-encrypted variant parked for v1.2).
- No auto-execution of LLM-generated SQL.
- No prose "insights" or "narrations" of query results.
- No background polling of remote sources.
- No login, accounts, email, sharing-via-link (link sharing is URL-state, not a server-mediated share).
- No third-party scripts at runtime beyond the SRI-pinned DuckDB CDN load.
- No write operations to remote sources.

---

## Architectural decisions made

The most load-bearing choices made during this session, with the
reasoning and what would reverse them. Full entries in `DECISIONS.md`;
this is the synthesis.

### Lazy-loading by default for any heavy dep

Already-established by Theme 1 wave 2 (`src/lazy/<name>.ts` →
`dist/chunks/<name>.js` via esbuild). Reused this session for both
Observable Plot and for the lite SW's "shell stays inlined; chunks
fetch on demand" model. Anything > ~50 KB minified should be a chunk;
the 600 KB shell budget (spec §7.1) is the canonical gate. Reversing
would mean either accepting bigger shells or removing the heavy
features — neither attractive.

### URL-state sharing: gzip + base64url, not naive base64

Naive base64 of a realistic `.naklidata` JSON easily exceeds 8 KB
common URL limits. `CompressionStream('gzip')` is in the spec's
browser floor (Chrome/Edge/Opera 122+), so no new dep needed.
Base64url avoids `encodeURIComponent` wrapping. Soft warning at
> 7800 chars; we still copy the link but the toast hints that some
chat tools may truncate. On bad lens, fall back to IDB snapshot
(not empty state) so a malformed link doesn't wipe work.
**Reversible:** Easy. Remove the boot precedence + the Share button.

### PWA cache: lite (shell + chunks), not full (incl. DuckDB-fallback)

The DuckDB-wasm vendored fallback is 74 MB (MVP + EH wasm + 2 worker
JS). Precaching that means a 75 MB install footprint — hostile to
users who try and bounce. Lite cache is the shell + lazy chunks +
manifest + icon (~680 KB total). Users who *do* boot with `?offline=1`
once get the wasm cached opportunistically (the SW's SWR path).
**Reversible:** Trivial. Add the duckdb-fallback paths to PRECACHE_PATHS
in `public/sw.js` and bump CACHE_VERSION.

### Multi-session: header dropdown, not a 4th sidebar column

Pending.md wording was "Multi-session sidebar (à la OpenPlanter's
`.openplanter/sessions/<id>/`)". OpenPlanter uses a left-rail sidebar;
NakliData is already a three-column layout (Sources 240px / Notebook
fluid / Schema 320px). A fourth column would crowd 1280–1440 viewports
and dilute the Schema panel's primacy (handoff §9: "Schema panel is
the most important surface"). Sessions are low-frequency; a header
dropdown is the right affordance density. The third option considered
(collapsible activity-bar rail à la VS Code) is the right answer
*if/when* we have multiple navigation contexts to organize — revisit
then. **Reversible:** Easy. `renderSessionSwitcher` already lays out
a vertical list; lift it into a panel container.

### Observable Plot integration: chunk + dispatch, not migrate-all

Three options for adding new chart types: lazy Plot chunk only for
new types (chosen), inline Plot in main bundle (busts 600 KB budget),
migrate all 7 existing types to Plot (uniform but big refactor +
loses Rangrez palette tightness). Picked the chunk + dispatch because
it reuses Theme 1 wave 2 infra and leaves the 7 existing types alone.
**Reversible:** Easy. Remove the PLOT_TYPES dispatch + drop
`@observablehq/plot`.

### Sessions storage: migrate-and-delete legacy key, not parallel-store

`src/core/sessions.ts`'s `ensureActiveSession()` reads the legacy
`workbook/current` key once on first multi-session boot and adopts
it as the seed session, then deletes the legacy key. Alternative was
to keep both stores in sync indefinitely. Migrate-and-delete is
cleaner (single source of truth post-migration) and the round-trip
is observable via the auto-restore e2e tests (which still pass
because they start with `browser.newContext()`).

### Branch hygiene: deleted the bootstrap branch

The repo originally had `claude/agent-handoff-start-3c2Ib` as the
default. Switched to `main` and deleted the bootstrap branch local +
remote. Single-branch model going forward. **Reversible** but no
reason to: the SHA was identical, the tag is the canonical release
pointer.

### Workers capped at 2 in Playwright

`workers: 2` in `tests/e2e/playwright.config.ts`. Default (N-cores)
caused intermittent "Engine: ready" timeouts from parallel
DuckDB-wasm boots. Override with `--workers=N` on beefier boxes.

---

## Open questions queued

These came up earlier and are still open. Decision-points for whatever
direction work takes next.

### License for `nakli-compute` bridge repo

Leaning Apache 2.0 (per `plan/enterprise-strategy.md` "Open questions").
The bridge will be a sibling OSS project; license choice affects
enterprise adoption. Final pick wanted before the repo is created.
Not blocking v1.1 work.

### Bridge wire protocol

Arrow Flight (canonical, RPC-y) vs HTTP + Arrow IPC (simpler, REST-y).
Probably both — Arrow Flight for the bridge → engine path; HTTP for
browser → bridge for cases where Flight is awkward (CORS, gateway
shenanigans). Confirm before the v1.3 spec lands.

### 11 agent-seeded taxonomy types

In `taxonomy/v0.1/types.jsonl`, search `seed_origin`. The v1.0 review
notes flagged these as wanting a human pass before they're considered
canonical. Hasn't happened yet — the tag pushed first. If the
taxonomy is going to be treated as a public schema commitment (it
will be once people start using `.naklidata` files), this review
should happen sooner than later.

### Pie + faceted chart-type UI

Theme 2 wave 1 deferred both:
- **Pie**: Plot deliberately doesn't ship a pie mark. Custom arc
  adapter is the path. Question: is pie even worth adding given Plot's
  stance? Stacked bar covers most pie use cases.
- **Faceted small-multiples**: needs a third "facet-by" picker on the
  chart cell. Could be solved in the same UI pass that adds the map
  cell's geometry-column picker.

### Theme 2 sub-item order (when work resumes)

Three viable orders:
1. **Cheap first**: pivot-table → schema-graph → map cell. Wins quickly; saves the heaviest for last.
2. **Pair geo work**: map cell + spatial extension together (they're complementary), then pivot + schema-graph as a separate push.
3. **Schema-first**: schema-graph as a standalone view first (uses existing taxonomy relationships), then chart-type expansion (pivot), then map.

Order 1 maximizes momentum; order 2 maximizes coherence per push.

### AI sidecar (v1.1 spec §4.3 + portfolio mandate)

The portfolio-wide rule (`~/.claude/CLAUDE.md`) requires every
NakliTechie project to ship an AI sidecar with BYOK. NakliData
satisfies this on paper (spec §4.3 + `plan/sidecar-architecture.md`)
but the actual sidecar isn't wired yet. Three planned jobs:
explain-this-query / explain-this-error / recommend-a-template.
None implemented. The sidecar surface (UI affordances + BYOK key
plumbing) doesn't exist either. This is genuine open work, not just
spec.

### Deploy target

The product is an undeployed static HTML build. No mention of a
deploy target yet — CF Pages, GH Pages, S3, somewhere else? The v1.0
tag is the release source-of-truth right now. Once a deploy target
is picked, the `<base href="...">` semantics, the manifest's
`start_url` / `scope` paths, and the SW scope all need to be
revisited.

---

## Conventions + gotchas

Things future-you will trip on if not warned.

### Code conventions (project `CLAUDE.md`)

- **Color values** come from `src/tokens/colors.ts` only. No hardcoded hex in components or CSS-string-templates outside the tokens dir.
- **Spacing / type / radius** from `src/tokens/spacing.ts`.
- **Icons** from `src/tokens/icons.ts` (Phosphor, vendored as SVG path data). Add to that file before referencing a new glyph.
- **`exactOptionalPropertyTypes: true`** is on. Use explicit `null`, not `undefined`, when a field can be absent.
- **Biome is the formatter.** Don't argue with it.
- **Workers**: DuckDB's worker is loaded from the vendor's bundle via `importScripts`; the taxonomy worker is bundled as a separate file by esbuild. Don't bundle a third worker without a clear reason.
- **CSP**: the inlined `<script>` body's SHA-256 is computed at build time and injected into `script-src`. If you change how the bundle is produced, verify the page still loads — the smoke test catches this.

### Stop checklist (from `CLAUDE.md`)

Before declaring a task done:
1. `npm run smoke` passes (catches CSP / FSA / worker-bootstrap / classifier regressions).
2. `npm run check` clean (`tsc --noEmit` + `biome check`, ≤ 14 warnings).
3. `npm run test` green (vitest).
4. `dist/index.html` ≤ 600 KB (spec §7.1).
5. Schema-panel-touching changes get a manual look (spec's most important surface).
6. `STATUS.md` reflects reality.
7. Non-trivial decisions logged in `DECISIONS.md`.

### Build / test commands

```
npm install          # postinstall vendors DuckDB-wasm + writes integrity.json
npm run dev          # esbuild + dev server on :5173
npm run build        # → dist/index.html (single file) + chunks/
npm run check        # tsc --noEmit + biome check
npm run test         # vitest run
npm run test:e2e     # build + Playwright (defaults to workers: 2)
npm run smoke        # build + headless Playwright smoke (12 assertions)
```

### Environment

- **Playwright chromium path**: set `PLAYWRIGHT_CHROMIUM_PATH` (or legacy `CHROMIUM_PATH`) if running in a sandbox with vendored chromium; otherwise Playwright picks its bundled chromium. Same env var works for both `scripts/smoke.mjs` and `tests/e2e/playwright.config.ts`.
- **Sandbox limitation**: dev sandboxes that block `extensions.duckdb.org` can't exercise the SQLite / Excel / SPSS / SAS / Stata mounts in smoke. Production users hit that origin fine. Theme 1 wave 3 (vendor extensions into `public/duckdb-fallback/`) closes this gap.

### Portfolio-wide rules (`~/.claude/CLAUDE.md`)

NakliTechie-wide rules apply on top of project rules. The non-negotiable
one for NakliData:

- **AI sidecar with BYOK is a hard requirement** for every NakliTechie project. NakliData satisfies this on paper via spec §4.3 + `plan/sidecar-architecture.md` (LoRA-Gemma plans). Implementation is genuine open work — see "Open questions queued" above.
- **Persistence**: workspace state in IDB (done), BYOK keys session-default with opt-in plaintext persistence (option A) and a v1.2 passphrase-encrypted variant (option B) parked. See `plan/spec-amendments.md`.

---

## Live ledger files

When you need the canonical answer for a specific thing, go to these:

| File | Owns |
| --- | --- |
| `STATUS.md` | Current build state, branch state, deploy state, what's done since last check-in. Updated every session-close. |
| `DECISIONS.md` | Append-only decision log. Every non-trivial choice. Format per AGENTHANDOFF §5: Context / Options / Decision / Reasoning / Reversibility / Verification. |
| `CLAUDE.md` | Agent rules for this project + pointer to portfolio rules at `~/.claude/CLAUDE.md`. The stop checklist, the Hard NOTs, the conventions. |
| `02-SPEC.md` (uploaded at handoff) | Canonical product spec. Check `plan/spec-amendments.md` for divergences ratified since. |

| `plan/*.md` file | Owns |
| --- | --- |
| `plan/README.md` | One-line index of the plan/ folder. |
| `plan/pending.md` | Backlog: PondPilot parity table, OSS-component shortlist, themed roadmap with completion checkboxes. The most-referenced file for "what's next." |
| `plan/declined.md` | Explicit "do not borrow" with reasons. Read here before relitigating a known-no. |
| `plan/spec-amendments.md` | Ratified divergences from the original `02-SPEC.md`. Authoritative wording for the parts we've refined. |
| `plan/product-shape.md` | The phase model — four-phase pitch + seven-axis honest view. |
| `plan/progress.md` | Append-only session journal. Each entry: what landed, quality gates, what's next. Newest at top. |
| `plan/remote-sources.md` | Five options for the filestores-as-database question. |
| `plan/enterprise-strategy.md` | Compute Bridge phasing, buyer profiles, deployment paths. v1.2+ work. |
| `plan/sidecar-architecture.md` | LoRA-Gemma vs prompted-base sidecar, the eval-harness foundation, report-recommendation job. |
| `plan/v1.0-handoff-notes.md` | The web-session handoff that the desktop session worked through today. Historical now. |
| `plan/checkpoint-2026-05-17.md` | **This file.** |

---

## Pick-up paths

Three different next moves, depending on which way the
direction-changing conversation goes.

### Path A: continue Theme 2 (visualization upgrade)

Most natural if the conversation doesn't shift much. Order suggestion:
**pivot-table → schema-graph → map cell + spatial extension**. Pivot
is the smallest self-contained ship; schema-graph reuses existing
`taxonomy/v0.1/relationships.json`; map cell is heaviest and benefits
from being a fresh-session focus. Then circle back to pie (custom arc
adapter) and faceted small-multiples (pair with the map cell's UI
pass for the new pickers).

### Path B: ship the AI sidecar

The portfolio mandate says every NakliTechie project must ship a
BYOK-backed AI sidecar. NakliData's planning docs are mature
(`plan/sidecar-architecture.md` + spec §4.3) but the surface is
zero-implemented. Three jobs: explain-this-query / explain-this-error /
recommend-a-template. Plus the BYOK key plumbing (sessionStorage
default, opt-in plaintext IDB per spec amendments). This is a major
push — likely 3+ sessions — but it's the kind of work that, once
done, dramatically changes the product's daily UX.

### Path C: tighten v1.0 / close out review carryover

Three items from `plan/v1.0-handoff-notes.md` wanted a manual look
before the v1.0 tag; the tag pushed first. CodeMirror lazy-mount
memory-leak review, DuckDB SRI tampered-CDN scenario, README
browser-support audit, and the 11 agent-seeded taxonomy types review.
Plus the `save-load.spec.ts` parallel-flakiness cleanup. All small;
together they form a tidying-up push that could be done in one
session before any new feature work.

### Path D: pivot entirely

If the direction-changing conversation lands somewhere else
(rebranding, scope cut, new primary use case, etc.), the work to date
is preserved at the v1.0.0 tag + the v1.1 commits on main. The plan/
folder captures the why for every choice — easy to fork the planning
docs into a new direction without losing the reasoning trail.

---

*This checkpoint was written 2026-05-17 by Claude Opus 4.7 (1M context)
in the desktop session that landed the v1.0.0 tag and Themes 3 wave 2
+ 2 wave 1. For state after this point, see `STATUS.md` and the bottom
of `plan/progress.md`.*
