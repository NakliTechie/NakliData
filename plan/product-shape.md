# Product shape

Working answer to "what are the phases of NakliData?" — useful for both marketing copy and code organization. Two readings: a clean four-phase pipeline that fits one breath, and a longer seven-axis view that's closer to how the code actually splits.

---

## The clean four-phase pipeline

The user's framing — accurate as far as it goes:

1. **Ingestion** — point at files / folders / URLs; mount as queryable tables. Maps to spec §3.1 (local), §4.1 (remote v1.1).
2. **Taxonomic classification** — column-level semantic types assigned by detectors, optionally aided by the v1.1 LocalMind sidecar; user curates. Maps to spec §3.2, §4.3.
3. **Analysis** — SQL notebook, named cells, joins, aggregations. Maps to spec §3.3.
4. **Presentation** — charts, tables, (v1.1+: maps and pivot tables). Maps to spec §3.3 chart cells.

This is a good short-form answer. It's the storyline a user follows for any single dataset.

---

## What that picture leaves out

Three things don't fit cleanly inside those four phases but live as first-class surfaces in the codebase and the spec. Anyone scoping work needs them on the page.

### 5. Action / writeback

Result rows → another tool's input. The five v1.0 sinks (CSV / Parquet / KanZen / Bahi journal / NakliPoster) are type-gated by the column assignments from phase 2.

This is **the differentiator.** Every other browser-native SQL tool stops at "here's a dashboard." NakliData stops at "here's a dashboard, plus the typed sinks that can consume the result." Vision §3 calls this the moat.

I'd argue this deserves to be phase 5 in any honest description, not folded into "presentation." A bar chart is presentation; a Bahi journal proposal isn't.

### 6. Curation / governance

The human-in-the-loop on the schema panel:
- Accept / override / define-new on a detector's suggested type
- Bulk-accept at a confidence threshold
- (v1.1) Sidecar disambiguation requests
- (v1.2) The history primitive — an audit log of every accept/override/sink-fire

This is technically a slice of phase 2 (classification), but it's important enough to call out. The schema panel is per handoff §9 "the single most important surface" — curation is the activity that surface exists to enable. The non-copyable thing the vision talks about is **the curated taxonomy**, not the engine.

### 7. Shareability / persistence

- Auto-restore the workbook on tab open (IDB-backed, see [spec-amendments.md A1](./spec-amendments.md))
- `.naklidata` file save / load
- URL-state sharing (`?lens=<base64>`) — share a session without sharing the data
- Embeddable `<nakli-data-widget src="...">` (v2.1)

Orthogonal to the linear pipeline but core to the product surface. Without it, you have a single-session toy.

---

## Picture

```
                ┌───────────────────────────────────────────────────┐
                │ 6. Curation / governance                          │
                │    accept · override · define-new · audit log     │
                └──┬───────┬───────┬───────┬───────┬────────────────┘
                   │       │       │       │       │
   ┌───────────────┴┐ ┌────┴────┐ ┌┴──────┐ ┌┴───────┐ ┌┴─────────┐
   │ 1. Ingestion   │→│ 2.      │→│ 3.    │→│ 4.     │→│ 5.       │
   │    mount       │ │ Classify│ │ Analy.│ │ Present│ │ Action   │
   │  CSV/Parquet/  │ │ taxonomy│ │ SQL + │ │ charts │ │ CSV/Pq/  │
   │  FSA/folder/   │ │ + side- │ │ note- │ │ + maps │ │ KanZen/  │
   │  URL/...       │ │ car     │ │ book  │ │ + pivot│ │ Bahi/    │
   │                │ │         │ │       │ │        │ │ NakliP.  │
   └────────────────┘ └─────────┘ └───────┘ └────────┘ └──────────┘

                ┌───────────────────────────────────────────────────┐
                │ 7. Shareability / persistence                     │
                │    IDB auto-restore · .naklidata · URL · widget   │
                └───────────────────────────────────────────────────┘
```

---

## How this maps to code

Today's `src/` layout:

| Phase | Modules |
| --- | --- |
| 1. Ingestion | `core/mount.ts`, `core/engine.ts`, `core/handles.ts` |
| 2. Classification | `taxonomy/{detectors,classify,client}.ts`, `workers/taxonomy.worker.ts` |
| 3. Analysis | `ui/notebook.ts`, `ui/cells/*.ts` |
| 4. Presentation | `charts/render.ts`, `ui/cells/chart-cell.ts` |
| 5. Action | `ui/sinks/{sinks,gating}.ts` |
| 6. Curation | `ui/schema-panel.ts` + `core/workbook.ts` (assignments) |
| 7. Shareability | `core/persistence.ts`, `core/idb.ts`, `core/settings.ts` (pending wire-up) |

The mapping is clean today, which is a good sign — the conceptual phases are also separable code units.

---

## When this matters

- **Marketing copy:** the four-phase model is the right answer. "Ingest → understand → query → see."
- **Roadmap / scoping:** the seven-axis view is the right answer. Phases 5–7 are where most of NakliData's actual differentiation lives.
- **Code organization:** the table above is the test — if a new module doesn't fit into one of these seven cleanly, that's a smell.
