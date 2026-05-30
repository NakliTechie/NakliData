# End-of-day checkpoint — 2026-05-24

Day-end snapshot, written to read cold and resume in a new session
(literally — the project is being extracted out of
`~/Code/naklios-universe/NakliData/` and into `~/Code/Apps/NakliData/`
immediately after this doc lands). Supersedes
[`checkpoint-2026-05-23-eod.md`](./checkpoint-2026-05-23-eod.md).

---

## Day in one paragraph

Picked up the three-wave workplan and marched through most of Wave 1 in
one go. Pie chart + faceted small-multiples (W1.5a / W1.5b) landed.
All four v1.0 review carryover items (W1.3a–d) closed — with a real
finding in each: a CM6 EditorView memory leak across
`.naklidata` loads, an SRI manifest round-trip test (including a
negative tamper case), and three taxonomy edits (a real CIN regex
bug, an `iso_country_code` header noise removal, and UUID added as
the 41st type). The save-load test ran 5/5 stable at ~2.0s; no
flakiness. Bonus catch along the way: a **latent CSP-hash bug in
`esbuild.config.mjs`** — `String.prototype.replace` was interpreting
`$&` in the minified script body as the matched substring, drifting
the inlined CSP hash off the actual bytes; fix is the function-form
replacer (three call sites). The Wave 1 pie + facet additions were
what tipped the minified bundle past the threshold where `$&` first
appeared, surfacing it. **W1.4 (naklios.dev mirror) was opened but
deferred** — NakliData is multi-file with a build step, and the
existing `sync-mirrors.sh` only knows `raw.githubusercontent.com`;
end-to-end mirror needs a deploy workflow + a sync-script
extension, both bigger than Wave 1's scope. **W1.2 (README refresh)
and W1.1 (v1.1.0 tag + release notes) didn't get to**; they're the
clean next pickup. Three Wave 1 commits + this docs commit on `main`.

---

## Repo state at day end

| Field | Value |
| --- | --- |
| Repo | [NakliTechie/NakliData](https://github.com/NakliTechie/NakliData) |
| Local path at EOD-write | `/Users/chiragpatnaik/Code/naklios-universe/NakliData/` |
| Local path after move | `/Users/chiragpatnaik/Code/Apps/NakliData/` |
| Default branch | `main` |
| Tag | `v1.0.0` at `5b10b93` (still the v1.0 release point) |
| Latest commit | `bc78d4a` (this docs commit will follow) |
| Working tree | Clean after this docs commit |
| Pushed to origin | Yes |

### Build sizes

| Artifact | Size | Δ vs 2026-05-23 EOD |
| --- | --- | --- |
| `dist/index.html` | **413 KB** | +5 KB (pie renderer + facet wiring + CM6 dispose loop) |
| `dist/chunks/codemirror.js` | 370 KB | unchanged |
| `dist/chunks/observable-plot.js` | 280 KB | +7 KB (facet `fy` wiring) |
| `dist/chunks/cytoscape-graph.js` | 443 KB | unchanged |
| `dist/chunks/maplibre-map.js` | 1.0 MB | unchanged |
| `dist/duckdb-extensions/v1.1.1/wasm_eh/` | 2.3 MB | unchanged |
| `dist/sw.js` | 2.7 KB | unchanged |

Well under the 600 KB shell budget.

### Test counts

| Suite | Count | Δ vs 2026-05-23 EOD |
| --- | --- | --- |
| Vitest | **165** (16 files) | +9 (6 pie aggregation + 3 SRI manifest) |
| Playwright e2e | **27** (20 spec files) | +2 (pie-and-facet + offline-extensions stayed at +1) |
| Smoke (headless) | green | unchanged assertions |
| tsc / biome | clean | 0 errors / 14 pre-existing warnings |
| Stable under workers=2 | yes | unchanged |

### Commits today (3 since 2026-05-23 EOD docs commit)

| Hash | Subject |
| --- | --- |
| (this) | docs: EOD 2026-05-24 + Wave 1 progress + extract-from-naklios-universe handoff |
| `bc78d4a` | v1.1: v1.0 review carryover — CM6 dispose leak + SRI manifest test + taxonomy editorial pass |
| `983827f` | v1.1: Wave 1 polish — pie chart + faceted small-multiples |
| `7a73bc4` | build: esbuild HTML inliner — use function-form replacers for $&-safe insertion |

---

## What landed today, by Wave 1 item

| Item | Status | Notes |
| --- | --- | --- |
| W1.1 — Tag v1.1.0 + release notes | **Pending** | Did not start. Natural opener for the next session. |
| W1.2 — README v1.1 refresh | **Pending** | Did not start. Should land before the tag. |
| W1.3a — CM6 audit | ✅ Done | Memory leak fix: `notebook.load()` now disposes outgoing-set SQL cells. |
| W1.3b — SRI scenario coverage | ✅ Done | `tests/sri-integrity.test.ts` — 3 vitest specs incl. negative tamper. |
| W1.3c — Save-load flake confirm | ✅ Done | 5/5 stable runs at ~2.0s each. No flakes seen. |
| W1.3d — Taxonomy editorial pass | ✅ Done | CIN regex bug fixed (`[LUu]` → `[LU]`); `iso_country_code` `iso3` header noise removed; UUID added (41 types total). |
| W1.4 — naklios.dev Immersive mirror | **Deferred** | See "What's deferred" below. Real fix needs cross-repo deploy work. |
| W1.5a — Pie chart mark | ✅ Done | Custom SVG arc renderer. Plot doesn't ship a pie mark by design. |
| W1.5b — Faceted small-multiples | ✅ Done | Plot uses native `fy`; pie partitions into a grid. Facet picker only shows for facetable types (pie + 3 Plot types). |
| W1.6 — Map cell basemap (stretch) | Not started | Touches CSP posture; defer with no urgency. |

### Bonus find — latent build bug

The CSP-hash drift in `esbuild.config.mjs` is a latent bug that has
existed since the build script was written. The previous string-form
`.replace('<!-- INLINE_JS -->', `<script>${scriptBody}</script>`)`
calls would have triggered on any past bundle that contained `$&`;
we just hadn't tripped it until today's pie + facet additions pushed
the minified output across the threshold. Three call sites switched
to function-form replacers; the diagnostic was a 16-byte body-length
mismatch (the length of `<!-- INLINE_JS -->` minus the length of
`$&`), which made the root cause unambiguous.

---

## What's deferred (and why)

### W1.4 — naklios.dev Immersive same-origin mirror

The CLAUDE.md mirror flow assumes the source app is a single
`index.html` in the repo root (Tijori, Books). NakliData is multi-file:
the shipping artifact is built at `dist/index.html` from `src/` via
`npm run build`, and `dist/` is gitignored. So
`raw.githubusercontent.com/NakliTechie/NakliData/main/index.html`
returns 404 → the existing `sync-mirrors.sh` can't pull NakliData.

End-to-end fix needs two pieces, both bigger than Wave 1:

1. **A reachable URL for the built single-file app.** A GitHub Pages
   deploy workflow (build on push to main → publish `dist/` to
   `gh-pages` branch or via `actions/deploy-pages`). Once live,
   NakliData is at `https://naklitechie.github.io/NakliData/`.
2. **A way for `sync-mirrors.sh` (in `nakli-dev`) to pull from that
   URL.** Today the script only knows `raw.githubusercontent.com`. A
   small extension to `apps/manifest.json` schema (`source_url` /
   `pages_url`) + a branch in the script.

Plus the source-side bits (mirror notify workflow +
`NAKLIOS_DISPATCH_TOKEN`) as before.

Path forward: pick this up as its own short wave after W1.1 + W1.2
ship the v1.1.0 tag. Tag first, mirror later — the mirror is purely
about discoverability inside the launcher, doesn't gate the release.

### W1.6 — Map cell basemap with CSP carve-out for OSM tiles

Stretch goal. Touches the privacy posture (third-party tile server
network calls) so it warrants a real decision entry, not a quick
flip. Defer until someone actually asks for a basemap.

---

## Architectural decisions made today

No new `DECISIONS.md` entry yet (will write one as part of the next
session's pre-tag pass). The three things worth a decision log:

1. **CM6 EditorView lifecycle across notebook reloads.** Old SQL cells'
   editors get disposed on `notebook.load()`. Stops a slow memory
   creep across `.naklidata` loads + session switches.
2. **SRI manifest is now test-covered.** The actual SHA-384 check is
   the browser's; the test covers the manifest-vs-bytes round-trip,
   which was the only un-tested link in the chain.
3. **Build inliner uses function-form replacers.** Prevents the
   `$&` / `$$` / `` $` `` token interpretation hazard in template
   substitutions. This is invariant — any future expansion of the
   inline-script body benefits.

---

## How to resume in the new session

The repo is moving from `~/Code/naklios-universe/NakliData/` to
`~/Code/Apps/NakliData/` immediately after this doc commits.

**Resume checklist:**

1. `cd ~/Code/Apps/NakliData/` and open Claude in that directory.
2. **Read this file first.** Self-contained snapshot of today.
3. Read the bottom of `STATUS.md` for one-paragraph current state.
4. Open `plan/pending.md`. The "Workplan — next three waves" section
   has been updated — Wave 1 marks done items, calls out W1.4 as
   deferred to its own wave, and queues W1.2 + W1.1 as the next
   immediate pickups.
5. **Recommended next two steps, in order:**
   - **W1.2** — README v1.1 refresh (sidecar, user types, sessions,
     share links, the four Theme 4 surfaces, vendored DuckDB
     extensions, PWA, Theme 2 surfaces, pie + facet).
   - **W1.1** — Draft `plan/v1.1.0-release-notes.md`, run the full
     gate (smoke + check + test + e2e + bundle budget + schema
     panel manual look), then tag `v1.1.0`. **Ask before pushing
     the tag.**

Working tree is clean (after this docs commit). Tests + smoke + bundle
budget all green at workers=2.

---

## Open questions for the new session

- **NakliData GitHub Pages deploy?** Once we tag v1.1.0, the natural
  follow-on is a deploy workflow. That unblocks W1.4 (mirror) and
  gives the README a "visit the hosted build" link instead of the
  current "URL TBD when published" placeholder.
- **Any wave naming change after extracting?** The "Wave 1 / Wave 2 /
  Wave 3" labels were chosen when NakliData lived inside
  `naklios-universe/`. They still work standalone — no rename
  needed, just noting.
