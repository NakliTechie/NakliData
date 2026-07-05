# Fork 2 round-trip spike — FINDINGS

*2026-07-05 · throwaway spike, no product code · `eval/spikes/fork2-roundtrip/`*

**Gate (from `plan/polyglot-workbench-vision.md`):** does
`DuckDB → Arrow → pandas → (compute) → Arrow → DuckDB` stay fast and memory-sane
with two wasm heaps live in one tab, on ≥1M rows, with tolerable first-load?

## Verdict: **PASS.** Fork 2's Python cell is viable in-tab. Build it.

The named escalation ("if slow or OOMs on mid-sized data → reframe Python as an
export target") **does not trigger** — the round-trip is sub-second at 1M rows and
survives 5M.

## Setup

- One tab, real origin (local static server, no COOP/COEP — DuckDB picks the
  non-threaded EH bundle, Pyodide needs no isolation).
- DuckDB-wasm 1.29.0 + apache-arrow 17.0.0 (`tableToIPC`) + **Pyodide 0.27.7**
  (pandas + pyarrow), all from jsDelivr. Blob-worker shim for the cross-origin
  DuckDB worker.
- Round-trip: generate N rows in DuckDB (4 cols: id, val DOUBLE, cat, r) →
  `SELECT *` → Arrow IPC stream → pyarrow `open_stream` → `to_pandas` → transform
  (`val2 = val*2`; `rank_in_cat = groupby(cat).rank`) → `Table.from_pandas` →
  IPC stream → `insertArrowFromIPCStream` → verify counts. Integrity verified at
  every size (row counts + derived columns + rank correct).

## Numbers (Apple M-series, warm CDN)

| Metric | 100k | 1M | 5M |
|---|---|---|---|
| gen in DuckDB | 33 ms | 65 ms | 308 ms |
| DuckDB → Arrow IPC | 11 ms | 42 ms | 229 ms |
| Arrow bytes | 3.1 MB | 30.7 MB | 153 MB |
| pandas parse+transform+reserialize | 1275 ms\* | 412 ms | 2760 ms |
| Arrow IPC → DuckDB | 11 ms | 45 ms | 231 ms |
| **round-trip total** | 1297 ms\* | **499 ms** | 3220 ms |
| Pyodide heap | 124 MB | 309 MB | 1287 MB |
| JS heap | 279 MB | 331 MB | 580 MB |

\* the 100k row-trip ran **first**, so it eats the one-time pandas+pyarrow
import + JIT warmup (~1.2 s). The 1M trip (run second, warm) is the honest
per-row cost: **499 ms for 1M rows.**

## First-load latency

| | DuckDB | Pyodide core | pandas+pyarrow | total | transferred |
|---|---|---|---|---|---|
| **cold** (uncached) | 1121 ms | 854 ms | 2171 ms | **4145 ms** | **30.6 MB** |
| **warm** (HTTP cache) | 301 ms | 524 ms | 1522 ms | **2347 ms** | — |

## What this means for the build

1. **PASS at the 1M bar** — 499 ms round-trip, ~640 MB combined heaps. Two wasm
   heaps (DuckDB worker + Pyodide) coexist with no contention. Arrow is the right
   interchange: the DuckDB↔pandas hops are ~40 ms each; the cost is all pandas.
2. **Ceiling ≈ 5–8M rows (this width).** Memory scales ~linearly at ~300 MB
   Pyodide heap per 1M rows (4 cols). 5M works (1.3 GB Pyodide heap, 3.2 s); ~10M+
   would risk OOM on the Pyodide heap. The product should **cap the rows handed to
   a Python cell** (e.g. warn/refuse above a few million) rather than OOM the tab.
3. **Pyodide version pin is LOAD-BEARING.** `pyarrow` exists **only in Pyodide
   0.27.x** — 0.26 and 0.28 both lack it (checked the lockfiles). Fork 2 must pin
   **0.27.7** (or another 0.27.x that ships pyarrow) for the clean Arrow path.
   Without pyarrow the fallback is CSV/JSON interchange — slower, lossy on types —
   so the pin matters.
4. **~30 MB cold payload** (DuckDB + Pyodide core + pandas + pyarrow + numpy over
   the wire). Sovereign build must **vendor these same-origin** and cache to
   OPFS/HTTP so it's a one-time cost, behind an honest "Downloading Python
   (~30 MB)…" affordance. Warm re-init is ~2.3 s.
5. **Pre-warm the first call.** The first pandas/pyarrow import + JIT is ~1.2 s;
   do it when the cell is added (or on idle), not on first Run.
6. **Version compatibility clean:** apache-arrow 17 `tableToIPC` on a
   duckdb-wasm 1.29 Arrow `Table` works (matching arrow version), and pyarrow
   round-trips IPC streams both directions.

## Reproduce

```sh
PLAYWRIGHT_CHROMIUM_PATH=$(node -e "console.log(require('playwright').chromium.executablePath())") \
  node eval/spikes/fork2-roundtrip/run.mjs
```
