# Progress log

Append-only checkpoint journal. Each entry: where we are, what just shipped, where to pick up. Read the **bottom** entry first — that's the current state.

---

## 2026-05-16 — Session winding down. Theme 1 wave 1 shipped.

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
