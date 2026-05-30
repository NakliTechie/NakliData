# End-of-day checkpoint — 2026-05-23

Day-end snapshot. Written to read cold tomorrow morning and resume work
without paging through commits. Supersedes
[`checkpoint-2026-05-21-eod.md`](./checkpoint-2026-05-21-eod.md) (the
2026-05-21 EOD, when Theme 4 closed). Between then and now: 2026-05-22
was a quiet day, and today (2026-05-23) Theme 1 wave 3's vendoring
half landed, plus the three-wave workplan got captured in
`plan/pending.md`.

---

## Day in one paragraph

Started the day with Tier 1 of yesterday's pickup list (Theme 1 wave 3
test infrastructure — sample-data regen + vendor DuckDB extensions).
By end of day the vendoring half is live and the workplan for the next
three waves is in `plan/pending.md`. Two commits on `main`: `d81881c`
(Theme 1 wave 3 — vendor json + sqlite_scanner, engine offline-repo
wiring, JSONL mount now offline-clean, sidecar e2e workers=2 race fix)
and (this commit, after this EOD) the docs update for the three-wave
workplan + EOD. Shell stayed at **408 KB / 600 KB budget**. Vendored
extensions add ~2.3 MB under `public/duckdb-extensions/` — not in the
PWA precache. Zero new runtime dependencies. The fix for the sidecar
e2e race was an unintended-but-clean bonus: my new offline-extensions
spec changed Playwright's workers=2 scheduling enough to expose a
latent race in `sidecar-flow.spec.ts`, and the fix (wait for the
classifier to stabilise) is straightforward.

---

## Repo state at day end

| Field | Value |
| --- | --- |
| Repo | [NakliTechie/NakliData](https://github.com/NakliTechie/NakliData) |
| Local path | `/Users/chiragpatnaik/Code/naklios-universe/NakliData/` |
| Default branch | `main` |
| Tag | `v1.0.0` at commit `5b10b93` (still the v1.0 release point) |
| Latest commit | `d81881c` at EOD-write time; +1 follow-up for workplan docs after |
| Working tree | Will be clean after the docs commit |
| Pushed to origin | Yes |

### Build sizes

| Artifact | Size | Δ vs 2026-05-21 EOD |
| --- | --- | --- |
| `dist/index.html` | **408 KB** | unchanged (~150 bytes for the engine SET) |
| `dist/chunks/codemirror.js` | 364 KB | unchanged |
| `dist/chunks/observable-plot.js` | 273 KB | unchanged |
| `dist/chunks/cytoscape-graph.js` | 436 KB | unchanged |
| `dist/chunks/maplibre-map.js` | 1.0 MB | unchanged |
| `dist/duckdb-extensions/v1.1.1/wasm_eh/` | **2.3 MB** total | NEW — `json` 680 KB + `sqlite_scanner` 1.6 MB + `sqlite` alias 1.6 MB + integrity.json. Not precached. |
| `dist/sw.js` | 2.7 KB | unchanged |

### Test counts

| Suite | Count | Δ vs 2026-05-21 EOD |
| --- | --- | --- |
| Vitest | **156** (13 files) | unchanged |
| Playwright e2e | **25** (19 spec files) | +1 (offline-extensions) |
| Smoke (headless) | green | tightened the table count assertion ≥3 → ≥4 |
| tsc / biome | clean | 0 errors / 14 pre-existing warnings |
| Stable under workers=2 | **yes** | Fixed sidecar-flow #2 latent race |

### Commits since v1.0.0 tag (3 new since 2026-05-21 EOD)

| Hash | Subject | Day |
| --- | --- | --- |
| (this) | docs: 3-wave workplan + EOD 2026-05-23 | 2026-05-23 |
| `d81881c` | Theme 1 wave 3: vendor DuckDB extensions + JSONL offline mount | 2026-05-23 |
| `3bf15d6` | docs: plan/checkpoint-2026-05-21-eod — Theme 4 complete | 2026-05-21 |
| `0b14ff7` | Theme 4 wave 2: compare-tables (B2) + override learns (B3) + demo mode (B4) | 2026-05-21 |
| `a5e8f85` | Theme 4 wave 1: column-profile panel + GeoJSON fixture | 2026-05-21 |
| `a71ebf7` | v1.1: classifier integration of user types | 2026-05-19 |
| `…` | (15 earlier commits back to v1.0.0) | |

---

## What the product can do at end of day

(Unchanged from 2026-05-21 EOD aside from offline JSONL mount.)

- **File formats**: 15 (CSV, TSV, JSONL, Parquet, Arrow IPC, DuckDB, SQLite, Excel, SPSS×3, Stata, SAS×2, GeoJSON, KML)
- **Cell kinds**: 5 (SQL with CM6 lazy, Chart with 7+3 marks, Markdown, Pivot, Map)
- **AI sidecar**: all three spec §4.3 jobs live (explain-query-error, disambiguate-type, define-new-type); BYOK with Anthropic + OpenAI providers
- **Schema panel**: per-column row with Accept / Override / Evidence / Profile + optional Ask-sidecar; toolbar with Bulk accept, Re-classify (when user types exist), Override rules (when rules exist), Compare tables (when ≥2 tables)
- **Persistence**: URL state share, PWA shell, multi-session sidebar, IDB workbook snapshots
- **Override rules**: persisted to `.naklidata` as `override_rules`; applied forward on classify
- **Demo / censor mode**: settings toggle; stable `<prefix>_<n>` token masking across sources, schema, SQL result headers
- **NEW today**: offline JSONL mount via vendored `json` extension; sidecar e2e stable under workers=2

---

## Architectural decisions made today

One DECISIONS.md entry, dated 2026-05-23 23:00. The five sub-decisions:

- **(a) Vendor only `json` + `sqlite_scanner` at v1.1.1/wasm_eh.** `excel` + `read_stat` aren't published for that revision/platform — would require a DuckDB-wasm bump. Ship what's available; defer what isn't.
- **(b) Pin revision to v1.1.1.** Read empirically from the wasm binary's strings table. Keep in sync if DuckDB-wasm package bumps.
- **(c) URL override via `SET custom_extension_repository`.** Offline boot only; online boots leave the default so users can grab any extension on demand.
- **(d) SQLite mount stays bundle-unwired.** Extension loads but ATTACH fails because the sqlite_scanner's VFS doesn't bridge to DuckDB-wasm's in-memory VFS. Real limitation; fixture stays for when upstream fixes it.
- **(e) Alias copies for the `INSTALL sqlite` → `sqlite_scanner` aliasing.** Cheap (~1.6 MB doubled); bullet-proofs URL resolution.

**Side effect:** added test exposed a latent sidecar-flow workers=2 race. Fix is to wait for classification to stabilise before triggering Explain.

---

## What landed in the workplan reorg

`plan/pending.md` got a new top-level **Workplan — next three waves**
section. Each wave is a small list of numbered, ship-able items
(W1.1, W1.2, …). The pre-existing themed backlog (Theme 1 / 2 / 3 /
4 / 6) stays as the historical detail. A cross-reference table at the
bottom of the workplan maps waves to themes.

- **Wave 1** — Close v1.1 cleanly + small polish (housekeeping). v1.1 tag, README, v1.0 carryover, naklios.dev Immersive mirror, Theme 2 polish pickups. Cheap, no upstream blockers.
- **Wave 2** — Strategic v1.2: lakehouse + endpoint flexibility. Iceberg + OAuth2/Bearer/SigV4, S3-compatible custom endpoints, custom-endpoint sidecar (CSP rework), sidecar eval harness. High-leverage; no new core deps.
- **Wave 3** — Sidecar maturation + Compute Bridge MVP. Job 4 (report-template recommendation), local-model path (Transformers.js + Phi-3-mini), `nakli-compute` sibling repo with Arrow Flight + HTTP, `compute-bridge` source kind, bridge-side sidecar with LoRA-Gemma 4 E4B.

**Out of scope for these three waves** (called out explicitly in pending.md): excel/read_stat (blocked on DuckDB-wasm bump), SQLite mount VFS bridge (upstream), shapefile (FSA limitation), v1.4 multi-team, v2.0 DB Relay, v2.x edge compute, embeddable widget.

---

## How to resume tomorrow

1. **Read this file first.** Self-contained snapshot.
2. Check `STATUS.md` for the one-paragraph current state.
3. Read the bottom entry of `plan/progress.md` for what just shipped.
4. Open `plan/pending.md`, scroll to "Workplan — next three waves".
5. **Wave 1 is the recommended next pickup.** Start with W1.1 (tag v1.1.0 + release notes) — it's the lowest effort and the cleanest boundary before bigger work.
6. If wanting a bigger lift: W2.1 (Apache Iceberg REST). DuckDB has the iceberg extension; the work is plumbing the source picker + auth modes.

Working tree is clean (after this docs commit). No abandoned branches.
Tests + smoke + bundle budget all green at workers=2.
