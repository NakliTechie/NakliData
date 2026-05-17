# Progress log

Append-only checkpoint journal. Each entry: where we are, what just shipped, where to pick up. Read the **bottom** entry first — that's the current state.

---

## 2026-05-17 (later) — Theme 1 wave 2 shipped.

### What landed

- **Lazy code-splitting infrastructure.** New `src/lazy/<name>.ts` entries are built standalone into `dist/chunks/<name>.js` by an added esbuild pass. New `src/core/lazy-loader.ts` exposes a typed `loadChunk(name)` that dynamic-imports at runtime — the URL is constructed from a runtime variable so esbuild doesn't inline. Tiny `_demo.ts` chunk verifies the pipeline end-to-end via an e2e spec. Ready for CodeMirror 6 (next push) and Observable Plot / MapLibre (Theme 2).
- **Apache Arrow IPC mount.** `.arrow` / `.feather` files mount via DuckDB-wasm's `insertArrowFromIPCStream` — turns out the `apache-arrow` JS lib isn't needed, DuckDB reads IPC bytes directly. ~30 lines added. `Engine.drop()` is now dual-mode (DROP VIEW then DROP TABLE) since Arrow files become TABLEs while CSV/Parquet/Excel are VIEWs.
- **File picker accept list** extended for `.arrow` / `.feather`.
- **5 new tests** (mount routing for Arrow, lazy-chunk e2e); totals now 60 vitest + 4 e2e.

### Quality

- `dist/index.html` 312 KB (under 600 KB shell budget); `dist/chunks/_demo.js` 126 bytes (tiny demo).
- `tsc --noEmit` clean. `biome check` 0 errors / 14 warnings (pre-existing).
- 60 vitest + 4 Playwright e2e + headless smoke all green.

### Deferred

- Sample-data regen (`.sqlite`, `.xlsx`, `.sas7bdat`) — needs node-sqlite / exceljs / readstat deps; defer to when offline-extension vendoring is also addressed.
- Vendor DuckDB extensions (`sqlite`, `excel`, `read_stat`) into `public/duckdb-fallback/` — needs sandbox-permitted access to community-extensions.duckdb.org which is blocked here.

Both items are testing infrastructure (let the smoke test exercise the new format paths in this sandbox) — production users hit extensions.duckdb.org just fine.

### What's next

1. **Pre-v1.0-tag gates** — first user of the new lazy-splitting infra. CodeMirror 6 as a chunk in `src/lazy/codemirror.ts`, then SRI pinning for DuckDB-wasm, README pass per spec §3.10, tag `v1.0.0`.
2. **Theme 3 wave 2** — URL-state sharing + PWA install.
3. **Theme 2** — visualization upgrade (Observable Plot + MapLibre + pivot table).

---

## 2026-05-17 — Theme 3 wave 1 shipped (persistence wire-up).

### What landed today

- **Unified IDB connection.** `handles.ts` was writing to a different IDB database (`'NakliData'`, case-sensitive) than `idb.ts` (`'naklidata'`). Both now share `openNakliDataDb()` from `idb.ts`. Latent bug fixed before it hurt anyone.
- **Settings persistence.** `loadSettings()` + `saveSettings()` (already in `src/core/settings.ts` as orphan code) are now wired into boot. `autoAcceptThreshold` survives a reload.
- **Workbook auto-save / auto-restore.** New `saveWorkbookSnapshot()` / `loadWorkbookSnapshot()` / `clearWorkbookSnapshot()` in `persistence.ts`. Boot-time `restoreFromIdb()` runs before any auto-save subscriber is installed (avoids race). Snapshot keyed at `workbook/current` in the shared kv store. Same JSON shape as `.naklidata` files; we reuse `serialize()` for fidelity.
- **Silent boot-time restore.** `applyLoadedFile()` got a `{ silent }` option. Boot path uses `queryReadPermissionQuiet` for FSA folder handles (no prompt without user activation); explicit `.naklidata` load still uses `ensureReadPermission`.
- **Debounced auto-save.** 300 ms debounce on workbook + notebook changes. Empty state doesn't write (avoids stale empty snapshots).
- **Two new e2e tests** in `tests/e2e/auto-restore.spec.ts`:
  1. Mount example bundle → reload tab → workbook + assignments restored automatically.
  2. Slider threshold change → reload → restored value present.
  - Plus a `waitForClassificationStable()` helper that polls until the schema-panel column count stops growing (replaces fragile fixed sleeps).

### Quality

- `dist/index.html` 310 KB (under 600 KB shell budget).
- `tsc --noEmit` clean. `biome check` 0 errors / 14 warnings (pre-existing).
- 56 vitest tests + **3 e2e tests** (was 1) all green.
- Headless smoke test green.

### What's next

Theme 3 wave 2 (lower priority):
- URL-encoded query state for sharing
- PWA installability
- Multi-session sidebar

Other open work, in suggested order:
1. **Theme 1 wave 2** — esbuild lazy code-splitting infra, then Apache Arrow IPC via lazy chunk, then vendor DuckDB extensions for offline-grade smoke.
2. **Pre-v1.0-tag gates** — CodeMirror 6 lazy chunk (uses wave 2 splitting), SRI pinning, README pass, tag `v1.0.0`.
3. **Theme 3 wave 2** — URL-state sharing + PWA install.

---

## 2026-05-16 — Theme 1 wave 1 shipped.

### Where things stand

- `main` and `claude/agent-handoff-start-3c2Ib` both at `25ebe14` and pushed.
- v1.0 is feature-complete on `main`; v1.1 work has started.
- Build green (`dist/index.html` 308 KB), 56 vitest tests, headless smoke + Playwright e2e both pass.

### What landed today

| Item | Status |
| --- | --- |
| Repo merged to `main` (was `claude/agent-handoff-start-3c2Ib` only) | ✓ done |
| Spec amendments (persistence + BYOK + plane split + naming) | ✓ in `plan/spec-amendments.md` |
| AI sidecar + BYOK as portfolio-wide hard requirement | ✓ `~/.claude/CLAUDE.md` + project `CLAUDE.md` |
| Enterprise strategy (Compute Bridge, data/control plane, sibling OSS repo) | ✓ in `plan/enterprise-strategy.md` |
| Sidecar architecture (LoRA-Gemma + browser/bridge split + phasing) | ✓ in `plan/sidecar-architecture.md` |
| Filestores-as-database options (5 options ranked) | ✓ in `plan/remote-sources.md` |
| Theme 1 wave 1: SQLite + DuckDB + Excel + SPSS/SAS/Stata via DuckDB extensions | ✓ shipped on `main` (commit `25ebe14`) |

### Theme 1 status

Wave 1 (extensions-based mounts) — done. Six new formats: `.sqlite` / `.db` / `.sqlite3` / `.duckdb` / `.xlsx` / `.sav` / `.zsav` / `.por` / `.dta` / `.sas7bdat` / `.xpt`. Spec §3.1 supported-formats list: 6 → 12.

Wave 2 (deferred) — see the unchecked items in `plan/pending.md` Theme 1:
- Apache Arrow IPC via `apache-arrow` lazy chunk
- Lazy code-splitting infrastructure in esbuild (precondition for the above + CodeMirror 6 + Observable Plot)
- Regenerate sample data with `.sqlite` + `.xlsx` for production smoke
- Vendor `sqlite` / `excel` / `read_stat` DuckDB extensions into `public/duckdb-fallback/` for offline-grade smoke (sandbox blocks `extensions.duckdb.org`)

### Open decisions queued for next session

- **License for `nakli-compute` bridge repo** — leaning Apache 2.0 (per `plan/enterprise-strategy.md` "Open questions"). Final pick needed before the repo is created.
- **Wire protocol for the bridge** — Arrow Flight (canonical) vs HTTP + Arrow IPC (simpler). Probably both; need to confirm.
- **11 agent-seeded taxonomy types** in `taxonomy/v0.1/types.jsonl` (search `seed_origin`) still want human review before v1.0 tag.

### Where to pick up tomorrow

Pick one of these to start the next session:

1. **Theme 1 wave 2** — esbuild lazy code-splitting infra, then Arrow IPC, then vendor extensions for offline smoke. ~1 session. Closes the Theme 1 loop and unblocks Theme 2/4 viz work.
2. **Theme 3 — Persistence wire-up** — connect the orphan `src/core/settings.ts` + `src/core/idb.ts` to boot; auto-save workbook on every change; auto-restore on tab open. Quick win, honors the persistence amendment locked in today. ~1 session.
3. **Pre-v1.0-tag gates** — CodeMirror 6 lazy chunk (needs wave 2 splitting infra) + SRI pinning for DuckDB-wasm + README pass per spec §3.10 + tag `v1.0.0`. Mostly mechanical; closes the v1.0 chapter cleanly.

My recommendation order: **1 → 3 → 2** (build the splitting infra once, reuse it; close v1.0; then unlock the persistence UX win). User may differ.

### Live ledger files

| File | Purpose |
| --- | --- |
| `STATUS.md` | Current build state, deploy state, what's done since last check-in |
| `DECISIONS.md` | Append-only decisions log |
| `CLAUDE.md` | Agent rules for this project + pointer to portfolio rules |
| `~/.claude/CLAUDE.md` | Portfolio-wide rules (AI sidecar + BYOK mandate) |

### Live planning files in this folder

| File | Purpose |
| --- | --- |
| `pending.md` | The open backlog: PondPilot parity, OSS reuse, 6 themed pushes |
| `declined.md` | "Do not borrow" with reasons |
| `spec-amendments.md` | Ratified divergences from the original `02-SPEC.md` |
| `product-shape.md` | Phase model — 4-phase pitch + 7-axis honest view |
| `remote-sources.md` | Filestores-as-database options |
| `enterprise-strategy.md` | Compute Bridge + buyer profiles + deployment paths |
| `sidecar-architecture.md` | LoRA-Gemma phasing + browser/bridge split |
| `progress.md` | This file — session checkpoint journal |

### Sandbox limitation to remember next session

The dev sandbox blocks `extensions.duckdb.org`. Theme 1 wave 1 mounts (sqlite/xlsx/read_stat) require that egress to install extensions on first use. In the user's actual browser, they work fine; in our smoke-test environment they'd fail silently per the per-file-tolerant mount path. Vendoring extensions into `public/duckdb-fallback/` (Theme 1 wave 2) closes this gap and makes the smoke test fully exercise the new format paths.
