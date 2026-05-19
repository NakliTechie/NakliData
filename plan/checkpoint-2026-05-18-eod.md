# End-of-day checkpoint — 2026-05-18

Day-end snapshot. Written to read cold tomorrow morning and resume
work without paging through every commit. Supersedes both
[`checkpoint-2026-05-17.md`](./checkpoint-2026-05-17.md) (midday
2026-05-17, pre-Theme-2-finish) and
[`checkpoint-2026-05-17-eod.md`](./checkpoint-2026-05-17-eod.md)
(end-of-day 2026-05-17, pre-sidecar). Those earlier files remain as
historical artifacts.

---

## Day in one paragraph

At session start today the AI sidecar was zero-implemented despite
having mature planning docs (`plan/sidecar-architecture.md` + spec
§4.3). By end of day all three spec §4.3 jobs are live: **explain
query error**, **type disambiguation**, and **define-new type
assist**. Full BYOK plumbing landed with two providers (Anthropic +
OpenAI), the settings modal with verbatim spec-amendment-A2 wording,
and per-workbook user-defined types — the `.naklidata` `user_types`
field finally gets populated after being a placeholder since v1.0.
Three commits on `main`, +2,758 lines. The repo was also moved
externally between sessions: NakliData now lives under
`/Users/chiragpatnaik/Code/naklios-universe/NakliData/` (post-reorg
that consolidates 60+ NakliTechie projects under one umbrella). Shell
stayed at **372 KB** — well under the 600 KB budget.

---

## Repo state at day end

| Field | Value |
| --- | --- |
| Repo | [NakliTechie/NakliData](https://github.com/NakliTechie/NakliData) |
| Local path (post-reorg) | `/Users/chiragpatnaik/Code/naklios-universe/NakliData/` |
| Default branch | `main` |
| Tag | `v1.0.0` at commit `5b10b93` (annotated, pushed) |
| Latest commit | `b08d679` (Sidecar wave 3) |
| Working tree | Clean |

### Build sizes

| Artifact | Size | Note |
| --- | --- | --- |
| `dist/index.html` | **372 KB** | Inlined shell. Under the 600 KB spec §7.1 gate. +32 KB vs yesterday from the sidecar code, settings modal, define-type modal, schema-panel surface, persistence updates. |
| `dist/chunks/codemirror.js` | 364 KB | CM6 lazy chunk. |
| `dist/chunks/observable-plot.js` | 273 KB | Plot lazy chunk. |
| `dist/chunks/cytoscape-graph.js` | 436 KB | Cytoscape lazy chunk. |
| `dist/chunks/maplibre-map.js` | 1.0 MB | MapLibre lazy chunk. |
| `dist/chunks/_demo.js` | 0.1 KB | Lazy-loader e2e fixture. |
| `dist/sw.js` | 2.7 KB | PWA service worker. |
| `dist/manifest.webmanifest` | 0.4 KB | PWA manifest. |
| `dist/icon.svg` | 0.4 KB | PWA icon. |

### Test counts

| Suite | Count | Status |
| --- | --- | --- |
| Vitest | **123** (9 files) | green |
| Playwright e2e | **19** (9 spec files) | green at `workers: 2` |
| Headless smoke | 12 assertions | green |

### Commits since v1.0.0 tag (14 total)

| SHA | Title |
| --- | --- |
| `4638450` | docs: v1.0 handoff notes — tag push pending desktop session |
| `53342b9` | chore: smoke script — env-var override for chromium path |
| `295032b` | docs: STATUS + progress — v1.0.0 tag landed; opening Theme 3 wave 2 |
| `bf45db1` | v1.1: theme 3 wave 2 item 1 — URL-state sharing (`?lens=<base64>`) |
| `f81b660` | v1.1: theme 3 wave 2 item 2 — PWA installability (manifest + lite SW) |
| `c9fcb48` | v1.1: theme 3 wave 2 item 3 — multi-session sidebar (header dropdown) |
| `8787853` | docs: plan/checkpoint-2026-05-17 — midday synthesis snapshot |
| `2d258d7` | v1.1: theme 2 wave 1 — Observable Plot lazy chunk |
| `065b9f0` | v1.1: theme 2 wave 2 — pivot-table cell (new cell kind) |
| `c8b4eef` | v1.1: theme 2 wave 3 — schema-graph modal (Cytoscape lazy chunk) |
| `06c11ee` | v1.1: theme 2 wave 4 — map cell + GeoJSON/KML mount. Theme 2 complete. |
| `44e6435` | docs: plan/checkpoint-2026-05-17-eod — end-of-day synthesis |
| `d2250a8` | v1.1: AI sidecar wave 1 — BYOK + explain-query-error |
| `0c83cbe` | v1.1: AI sidecar wave 2 — type disambiguation on ambiguous schema columns |
| `b08d679` | v1.1: AI sidecar wave 3 — define-new-type assist + per-workbook user types |

---

## What the product can do at end of day

A snapshot of capability, not architecture. The cumulative picture
since v1.0 — most of which already existed yesterday EOD; **the
sidecar arc is the new substantial surface**.

### File formats (15)

CSV / TSV / JSONL / Parquet / Arrow IPC / SQLite (.db + .sqlite + .sqlite3) / DuckDB / Excel / SPSS / Stata / SAS / **GeoJSON / KML**. Unchanged from yesterday EOD.

### Cell kinds (5)

SQL (CodeMirror 6 lazy chunk) / Chart (10 chart types — 7 hand-rolled + 3 via Plot lazy chunk) / Markdown / Pivot / Map. Unchanged from yesterday EOD.

### AI sidecar (new today — all three spec §4.3 jobs live)

- **BYOK keys** stored per spec amendment A2: sessionStorage default, opt-in IDB with the verbatim "Stored on this device. Anyone with access to this browser profile can read it." label. "Forget" per provider + global "Forget all stored keys."
- **Two providers**: Anthropic Claude (via `anthropic-dangerous-direct-browser-access`) and OpenAI (Bearer token; open CORS).
- **Settings modal** in the header — enable toggle (sidecar off by default), active-provider radio, model input, per-provider key blocks. Wording matches the spec amendment.
- **Job 1 — explain query error**: "Explain this error" button on errored SQL cells (hidden until sidecar enabled). 1–3 sentence explanation + optional "Copy SQL" suggested-fix (no auto-apply per Hard NOT #4). DECISIONS 2026-05-18 17:00.
- **Job 2 — type disambiguation**: "Ask sidecar" button on schema columns where the classifier is uncertain (≥2 candidates, confidence ∈ [0.5, 0.9), origin = detector). One-token response matched case-insensitively to candidate list; chosen typeId applied via the existing `overrideAssignment` (origin = `user_override`). DECISIONS 2026-05-18 18:00.
- **Job 3 — define-new-type assist**: "+ Define new type from this column…" in the Override dropdown opens a modal. Re-samples values from engine. User can fill the form by hand OR click "Suggest with sidecar" to populate `{id, display_name, category, regex}` from samples. Save → `workbook.addUserType` + applies to the column. DECISIONS 2026-05-18 19:00.

### Persistence (Theme 3)

- `.naklidata` file save/load via FSA. Now includes **`user_types`** populated for real (wave-3 addition; was placeholder).
- IndexedDB auto-save + auto-restore of the active session's workbook (debounced 300 ms).
- Multi-session storage at `sessions/index` + `sessions/<id>/snapshot`; legacy migration handled.
- URL-state sharing (`?lens=<base64>`); workbook description round-trips, no data.
- PWA installability (manifest + lite SW; shell + chunks precached).

### Engine + classifier (v1.0 baseline, unchanged today)

- DuckDB-wasm 1.29.0 with SRI; vendored fallback.
- Taxonomy classifier (v0.1 bundle, ~30 types + 7 relationships) runs in a Worker.
- Schema panel — spec's most-important surface — shows candidates + confidence + accept/override + (new today) Ask-sidecar + Define-new-type.

---

## Architectural decisions made today (sidecar arc)

Three big calls, all in `DECISIONS.md`.

### 17:00 — Wave 1: BYOK-only first; two providers; no local model

- Skip the Transformers.js local-model path for v1.1 — depends on an eval harness that's explicitly v1.2+ work per `plan/sidecar-architecture.md`.
- Ship Anthropic + OpenAI from day one (no provider lock-in for the portfolio mandate).
- Browser-origin direct calls; no relay (the user's key is exposed to their tab either way; a server piece adds nothing today).
- CSP extended with `https://api.anthropic.com` + `https://api.openai.com` only — custom endpoints deferred.
- Sidecar disabled by default; `.app-sidecar-enabled` on root reveals UI entry points via CSS (no re-render on toggle).

### 18:00 — Wave 2: one-token output; reuse the override path

- Spec says "Strict one-token answer, temperature 0." Output is the chosen typeId or the word `unknown`; not JSON.
- Defensive parsing strips wrapping quotes / backticks / periods / fences; off-candidate strings coerce to `null` (user-friendly fallback) instead of throwing.
- Result applied via the existing `overrideAssignment` (origin = `user_override`). One audit trail; no new `'sidecar_override'` origin yet.
- CSS-only gating of the "Ask sidecar" button — instant on/off, no schema-panel re-render.

### 19:00 — Wave 3: per-workbook user types; Override-menu trigger; suggest-or-edit modal

- User types live on the workbook (per `.naklidata`), not in a global library. Cross-machine portability via file sharing. Global "my custom types" library is a possible v1.2+ feature.
- Trigger is "+ Define new type from this column…" at the bottom of the Override dropdown — discoverable in the natural workflow; doesn't clutter the schema row.
- Modal supports both AI-assisted ("Suggest with sidecar" populates the form) and pure manual entry; both paths go through the same `workbook.addUserType` + `overrideAssignment` save chain.
- Strict parser validation: snake_case id, all four fields non-empty, regex compiles. Bad responses throw `SidecarError` so the modal can surface the failure before saving a broken type.
- Classifier integration deferred — user types are application targets (via Override) but not auto-detection targets yet. The classifier worker would need to re-load on user-type changes; future wave.

---

## What's not shipped

Tier list, updated. Top items are the natural next pushes.

### Tier 1 — Sidecar polish + missing integration

- **Classifier integration of user types** — currently they're application-only (via Override). The classifier worker would need to re-load when user types change. Wave would add: regex/header_match detector synthesis from a UserType; worker re-init wiring.
- **Custom-endpoint support** — OpenAI-compatible URL for local llamafiles / vLLM / etc. Needs CSP rethink (current explicit-host whitelist won't work; would need `connect-src https:` or per-tab dynamic CSP).
- **Sidecar usage telemetry** — none today (per Hard NOT #1). But useful for the eval harness: a per-job opt-in "Was the answer correct?" thumbs that gets logged locally for later review. Different from telemetry because it's user-driven + local-only.

### Tier 2 — Theme 4 (schema + data quality polish)

Direct extension of the most-important surface.

- Column-statistics panel (cardinality, null %, length distribution, top-k).
- Side-by-side data compare (auto join-key + diff renderer).
- Type-override learns ("always treat columns named `vendor_id` as `gstin`").
- Demo / censor mode.

### Tier 3 — Theme 1 wave 3 (testing infrastructure)

- Sample-data regen (`.sqlite` / `.xlsx` / `.geojson` / `.sas7bdat`) for `tests/e2e/fixtures/`.
- Vendor DuckDB extensions (`sqlite` / `excel` / `read_stat` / `spatial`) into `public/duckdb-fallback/` for offline-grade smoke.

### Tier 4 — v1.0 review carryover

Small + batchable. Same items as yesterday's eod checkpoint.

- CM6 lazy-mount eyeball (cmInstances map + disposeSqlCellEditor memory check).
- DuckDB SRI tampered-CDN scenario.
- README browser-support claims audit.
- 11 agent-seeded taxonomy types review (`taxonomy/v0.1/types.jsonl`, search `seed_origin`). Higher priority now since wave-3 puts them in the schema-graph modal.
- `save-load.spec.ts` parallel-flake fix (uses count-based wait instead of `waitForClassificationStable`).

### Tier 5 — Theme 2 polish (deferred sub-items)

- Plot pie chart, Plot faceted small-multiples.
- Map cell basemap, deck.gl pairing.
- Shapefile mount.

### Tier 6 — Sidecar future (v1.2+)

- **Eval harness** — held-out per-job evals so prompted-vs-LoRA can be compared honestly. Per `plan/sidecar-architecture.md`.
- **Local-model path** — Transformers.js + Phi-3-mini-class (~150 MB OPFS). Opt-in fallback to BYOK.
- **LoRA-Gemma 4 E2B** — opt-in "high-accuracy mode"; never the default.
- **Opt-in training-data contribution flow** — explicit user action, never invisible.

### Tier 7 — v1.2+ / out-of-scope

- Theme 6 — Compute Bridge (enterprise; `plan/enterprise-strategy.md`).
- Deploy target — still no canonical home for the built artifact.
- Hard NOTs — still locked.

---

## Open questions still queued

- **License for `nakli-compute` bridge repo** — leaning Apache 2.0.
- **Bridge wire protocol** — Arrow Flight vs HTTP + Arrow IPC; probably both.
- **11 agent-seeded taxonomy types** — human review wanted (now higher priority because the schema-graph modal renders them).
- **Deploy target** — where does the built artifact actually go?
- **Naklios-universe integration** — NakliData lives under the umbrella now. Does it need to integrate with the naklOS launcher? Show up in the universe portfolio? See `~/Code/naklios-universe/CLAUDE.md` for the umbrella rules (mostly applies to single-file browser apps, not NakliData).

---

## Tomorrow's pickup paths

Five viable next moves, ranked by likely-value now that the sidecar
arc is done.

### A. Classifier integration of user types (Tier 1)

The sidecar can define new types but they don't auto-detect on new
columns yet. Synthesising regex/header_match detectors from a
UserType + wiring the worker to re-init on user-type change closes
the loop. Without this, user types are useful (you can override
columns to them, share them via `.naklidata`) but not as useful as
they could be (they don't fire on classification).

### B. Theme 4 — schema + data quality polish (Tier 2)

Column-statistics panel is high-leverage and fits naturally next to
the schema panel surface. Pair with type-override-learns for a
coherent push.

### C. Theme 1 wave 3 — test infrastructure (Tier 3)

Mechanical: regen sample data, vendor extensions. Closes the
offline-smoke gap. Less exciting but pays off forever.

### D. v1.0 review carryover (Tier 4)

One focused tidy-up session: CM6 audit, SRI scenario, README,
taxonomy types review, save-load flake fix. The 11 taxonomy types
got higher priority today since the schema-graph modal exposes them.

### E. Custom-endpoint sidecar support (Tier 1)

For users running local llamafiles / vLLM / Ollama. Smaller scope
than A/B/C but requires a CSP rethink (`connect-src https:` would
break privacy posture; per-tab dynamic CSP needs investigation).

---

## Resume tomorrow

Practical bring-up. Should take under 5 minutes.

```bash
cd /Users/chiragpatnaik/Code/naklios-universe/NakliData
git status              # should be clean on `main`
git pull origin main    # in case anything pushed from elsewhere
npm install             # only if package.json / lock changed
npm run check           # tsc + biome (expect 14 warnings, 0 errors)
npm run test            # vitest (expect 123 passing)
npm run smoke           # build + headless Playwright smoke (expect SMOKE TEST PASSED)
```

If anything's red on resumption, look at `STATUS.md` first — the
"Build status" line was green end-of-day-today.

For agent context on resumption, in order:

1. This file — `plan/checkpoint-2026-05-18-eod.md`
2. [`STATUS.md`](../STATUS.md)
3. [`plan/progress.md`](./progress.md) — top entries are today's sidecar waves
4. [`plan/pending.md`](./pending.md) — backlog with completion checkboxes
5. [`DECISIONS.md`](../DECISIONS.md) — today's entries are 17:00 / 18:00 / 19:00

---

## Conventions + gotchas

Same as yesterday's eod, with two additions from today:

- **Repo path changed**: NakliData is now at `~/Code/naklios-universe/NakliData/` (was `~/Code/NakliData/`). The reorg consolidates 60+ NakliTechie projects. `~/Code/naklios-universe/CLAUDE.md` is the umbrella context — applies to single-file browser apps, **not** to NakliData (which is structurally different: esbuild build, multi-file, tested). NakliData's own `CLAUDE.md` still governs.
- **Sidecar visibility**: `.app-sidecar-enabled` on the app root gates "Explain this error" + "Ask sidecar" + (renders the Override-menu "Define new type" entry only when sidecar is enabled? — actually no, it's always rendered). Sidecar is disabled by default; the user has to turn it on in Settings.

The rest still holds: `exactOptionalPropertyTypes`, biome formatter, lazy-chunk threshold, CSP gotcha, Playwright workers cap, sandbox limitation, stop checklist.

---

## Live ledger files

| File | Owns |
| --- | --- |
| `STATUS.md` | Current build state, branch state, what's done since last check-in. |
| `DECISIONS.md` | Append-only decision log. Today's: 17:00 / 18:00 / 19:00 (the three sidecar waves). |
| `CLAUDE.md` | Agent rules; stop checklist; Hard NOTs; conventions. |
| `plan/progress.md` | Session journal. Today's top entries: sidecar waves 1, 2, 3. |
| `plan/pending.md` | Backlog with completion checkboxes. |
| `plan/checkpoint-2026-05-17.md` | Midday 2026-05-17 (pre-Theme-2-finish). Historical. |
| `plan/checkpoint-2026-05-17-eod.md` | Yesterday EOD (post-Theme-2, pre-sidecar). Historical. |
| **`plan/checkpoint-2026-05-18-eod.md`** | **This file.** Today EOD (sidecar arc complete). |
| `plan/sidecar-architecture.md` | The "should we LoRA-Gemma?" reasoning. Still v1.2+ work. |
| `plan/spec-amendments.md`, `plan/product-shape.md`, `plan/remote-sources.md`, `plan/enterprise-strategy.md`, `plan/declined.md`, `plan/v1.0-handoff-notes.md` | Standing forward-looking artifacts. Unchanged today. |

---

*Written 2026-05-18 end-of-day. AI sidecar arc complete for v1.1.
v1.0.0 tagged. Single `main` branch. Resume bring-up: section "Resume
tomorrow" above.*
