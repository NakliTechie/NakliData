# WebR (R cell) de-risk — FINDINGS

*2026-07-05 · throwaway probe, no product code*

**Gate:** can WebR run R in-browser under the project's sovereign posture — no
COOP/COEP headers (they collide with the cross-origin DuckDB CDN / OSM tiles / HF
+ BYOK fetches; DECISIONS BS deliberately avoided them), strict CSP (no
`unsafe-eval`)?

## Verdict: **BLOCKED on infrastructure Pyodide didn't need. Needs a decision.**

Unlike Pyodide (which ran with zero infra), WebR needs cross-origin isolation OR a
service worker — both non-trivial and at odds with the current architecture.

## What the probe showed (WebR 0.2.0, latest)

- With the app's real headers, `crossOriginIsolated=false`, `SharedArrayBuffer`
  absent. WebR's **default (Automatic) channel throws on init.**
- Forcing the **PostMessage** channel (the only no-SAB option in the enum —
  `{Automatic, SharedArrayBuffer, PostMessage}`, no ServiceWorker exported) →
  **init times out.** It does not work for real R evaluation (R's REPL needs to
  block; PostMessage can't).
- WebR **does** ship `webr-serviceworker.js` + `webr-worker.js` (HTTP 200) — the
  documented **ServiceWorker channel** is the no-COOP/COEP path.

## Why it's not a drop-in

1. **COOP/COEP path** — enabling cross-origin isolation (even with
   `COEP: credentialless`) is an app-wide header change that must be re-validated
   against the cross-origin DuckDB CDN load, OSM tiles, HF model fetches, and the
   BYOK sidecar — the exact set BS routed around. Broad, risky, its own project.
2. **ServiceWorker path** — WebR's SW channel needs its service worker to control
   the page and intercept sync-emulation requests. **The app already ships its own
   `public/sw.js`** (offline caching). One SW controls a page → the two conflict;
   reconciling them (scope, fetch interception, lifecycle) is real work + risk.

## Good news (if we do proceed)

- WebR's package repo has **`nanoarrow`, `duckdb`, `jsonlite`** — several clean
  interchange options (Arrow IPC via nanoarrow; or DuckDB-in-R reads the same
  Parquet the Python cell uses; or NDJSON via jsonlite). Interchange is not the
  blocker.
- Core payload ~6 MB (`R.bin.wasm`) + base-R VFS — vendorable same-origin like
  Pyodide.

## Recommendation

**Defer the R cell** and document the blocker, unless R is a hard requirement.
Python already delivers the core "modelling SQL can't" value; R is the *second*
language (the vision itself made it secondary). Revisit if (a) real R demand
appears, or (b) the app takes on cross-origin isolation for another reason (e.g.
`@antv/layout-wasm` for 1M-node Facet layouts — the other COOP/COEP customer),
at which point WebR comes along for the ride.
