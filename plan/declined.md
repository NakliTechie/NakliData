# Declined features

Things we've explicitly looked at and chosen not to do. Reasons given so future-us doesn't relitigate.

---

## Vision / posture violations

- **AI chat / NL-to-SQL / SQL-fix auto-suggestions** — vision §"What it is not". The v1.1 sidecar Jobs 1–3 (type disambiguation, error explanation, define-new-type assist) are the allowed scope; anything that generates prose or auto-applies a query is out.
- **Recursive AI sub-agents** (OpenPlanter pattern) — vision forbids auto-execute and narration. The sidecar is a narrow classifier, not an agent loop.
- **Multi-user collab / share-via-link with login** — vision: single-operator. URL-state sharing (privacy-preserving, no data sent) is the alternative.
- **Hosted / SaaS variant** — never. The product IS the local-first posture.
- **Server-side data crunching** — DuckDB-wasm runs in the tab; that's the whole point.

---

## Shape mismatches

- **Spreadsheet-cell metaphor** (Quadratic, OpenSheet style) — spec §3.3 locks us to a notebook with named cells. A pivot-table cell type (pending.md Theme 2) is a notebook cell, not a spreadsheet pivot.
- **Tauri / desktop binary distribution** — spec §1.4 locks us to Cloudflare Pages, no backend. Browser-native or nothing.

---

## Format imports we won't pursue

- **Apple Numbers (.numbers)** — proprietary protobuf, no clean OSS reader.
- **Lotus 1-2-3 (.wk1 / .wk3)** — effectively unmaintained; defer indefinitely.
- **MS Access (.mdb / .accdb)** — mdb-tools (C) hasn't been cleanly WASM-compiled in a maintained build. Would require original engineering work for a niche format.
- **PDF table extraction** — pdfjs + tabula-style parsing is fragile. Quadratic markets this; we'll let them. Vision is "show me what I have", not "OCR my PDFs."

---

## Library / dependency choices we won't make

- **Tauri / Electron wrapper** — see "shape mismatches" above.
- **Cytoscape.js for chart cells** (versus our hand-rolled canvas+SVG) — spec §3.3 is explicit "no D3, no Plotly". Cytoscape is fine for a *schema-graph* view (different surface from chart cells), so it's on the pending list there.
- **Vega / Vega-Lite as the chart cell engine** — ~600 KB runtime would blow the shell budget. Observable Plot is the chosen alternative (smaller, MIT, declarative).
- **markdown-it / marked** for the markdown cell — our hand-rolled subset is sufficient for notebook annotations; adding a 50 KB lib for headings + lists + bold isn't worth it.
- **Pyodide** for Python in the browser — DuckDB-wasm + the v1.1 sidecar cover the analysis surface; Pyodide is a 10+ MB dep with overlapping value.

---

## What changed since the original spec

Two posture items the spec declined that we've since amended:

- **Persistent storage of workspace state** — spec §2.3 implied "no persistence beyond `.naklilens` files." Amended: workspace state persists in IDB + FSA, the user shouldn't have to start over each session. See [spec-amendments.md](./spec-amendments.md).
- **"Encrypted in IDB" BYOK storage was previously declined here**. Re-classified: persistence is allowed, but only with explicit per-key opt-in. Honest plaintext storage by default; passphrase-encrypted variant planned for v1.2. See [spec-amendments.md](./spec-amendments.md).
