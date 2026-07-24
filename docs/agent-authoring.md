# NakliData — agent contract (driving & authoring)

> Audience: an **external agent** (an LLM/agent that wants to work *with* a user's
> NakliData). For rules on developing the NakliData codebase itself, see the
> repo-root `AGENTS.md` / `CLAUDE.md` instead.

NakliData is a **browser-native semantic data workbench**: mount data (CSV,
Parquet, SQLite, …), it classifies every column into a ~193-type semantic
taxonomy with a sensitivity tier, and you query it with DuckDB-in-the-browser.
The data never leaves the tab.

An agent can work with NakliData two ways. Both are **propose-don't-execute** by
design — the model is never the safety boundary.

---

## 1. Drive a live tab — `window.naklidata`

When a NakliData tab is open, it exposes a verb namespace on `window.naklidata`.
Every verb returns `{ ok: true, data }` or `{ ok: false, error }` (a UI-safe
message). All verbs are async.

| Verb | Reads/writes | Gated? | What it does |
|---|---|---|---|
| `describe()` | read | no | Every table + column with **semantic type, sensitivity tier, universal term, null %, cardinality, and (public columns only) min/max range**, plus source provenance and a versioned envelope. No values — this is the grounding, redacted by design. |
| `listTables()` | read | no | Lightweight table index (row/column counts). |
| `listCells()` | read | no | Notebook cells (id, kind, name, code). Never results. |
| `query(sql)` | read | no | Runs a **read-only** SQL SELECT and returns rows. See the safety model below. Non-public columns are redacted in the output. Capped at 1000 rows. |
| `proposeCell(sql)` | write | **yes** | Adds an **un-run** SQL cell for the human to review and run. Returns `{ id, sql, editable: true }`. |
| `runCell(id)` | write | **yes** | Runs an existing cell. |

`window.naklidata.listTools()` returns the full catalogue (name, description,
JSON input schema, annotations) — WebMCP's tool shape, so a WebMCP-capable agent
sees the same verbs.

### The safety model (what `query` enforces)

Every SQL string passes a read-only validator **before** the engine sees it:

- Only a **single read-only statement** — SELECT / WITH / FROM-first / VALUES /
  TABLE / DESCRIBE. Any write, DDL, PRAGMA, ATTACH, COPY, INSTALL, or session
  statement is rejected — including one buried in a CTE or subquery.
- Every table position must be a **mounted table** (or a subquery). A string
  literal there (a file/URL scan) or a table function (`read_csv`,
  `parquet_metadata`, `sqlite_scan`, …) is rejected.
- Output columns whose **sensitivity tier is not public** are redacted.

Rejections are loud (`{ ok: false, error }`), never silent. **Writes are your
proposal; the human runs them** — `proposeCell` and `runCell` are off unless the
user turns on agent write access in Settings.

---

## 2. Author a workbook — `.naklidata`

You can hand a user a complete workbook **without a live tab**. A `.naklidata`
file is versioned JSON they open in NakliData. Because they open and run it, it
is propose-don't-execute by construction.

- **Schema:** [`docs/naklidata-file.schema.json`](naklidata-file.schema.json)
  (JSON Schema draft-07). Author against it.
- **Never** put source row data in the file — it describes mounts, schema
  assignments, and notebook cells only.
- **What round-trips:** `format`, `version`, `name`, `sources`, `assignments`,
  `cells`, `user_types`, `settings`, plus optional extensions (measures,
  selections, associations, dimensions, segments, lineage). Only example-bundle
  and single-file sources persist a reusable `ref`; others show a "Reconnect
  needed" banner on load and the user re-mounts.

### Minimal example

```json
{
  "format": "naklidata",
  "version": "1.0",
  "name": "Revenue by region",
  "sources": [],
  "assignments": [],
  "cells": [
    { "id": "c1", "kind": "sql", "name": "by_region",
      "code": "SELECT region, SUM(amount) AS revenue FROM orders GROUP BY 1 ORDER BY 2 DESC" }
  ],
  "user_types": [],
  "settings": { "auto_accept_threshold": 0.9 }
}
```

### Handoff: file vs. URL

NakliData round-trips the **entire** `.naklidata` through the `?lens=` URL
parameter (gzip + base64url). It's the zero-infra channel — but:

- The soft cap is **7,800 characters** (warn-only, not blocked) — many chat
  clients truncate a URL sooner. The hard inbound cap is 2 MB decompressed.
- A realistic agent-authored workbook (several cells + assignments) will exceed
  the soft cap. **Prefer handing over the `.naklidata` file** for anything beyond
  a couple of cells; reserve `?lens=` for tiny share links.

---

## Rules of the house (things NakliData will not do)

No telemetry. No auto-execution of agent/LLM SQL (you propose, the human runs).
No prose "insights" over results. No third-party runtime scripts beyond the
SRI-pinned DuckDB load. BYOK keys are session-only.
