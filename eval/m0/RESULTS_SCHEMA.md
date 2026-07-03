# Facet M0 — runner output contract (`results.json`)

The scoring side (`scripts/score.py`) is fully built and self-tested. The
only piece the WebGPU session must implement is the **browser-side runner**
that drives the model and emits `results.json` in the shape below. Keep the
runner thin: it generates + records, it does not score.

## What the runner does

1. Mount the fixture into NakliData's DuckDB-wasm as tables `papers`,
   `citations`, `authors`, `authorship` (from `data/*.parquet`).
2. Precompute embeddings for the semantic corpus (every `papers` row with a
   non-null `abs`), title + abstract, into an embedding column — the same
   precompute the product's Embedding view will use. Only the **query** is
   embedded live at eval time (that live path is what G4 times).
3. For each **NL→SQL** task (`tasks/nl2sql.jsonl`), on each rung
   (`L1` Ollama-bridge, `L2` WebGPU, `C1` BYOK): call the sidecar's NL→SQL
   entry (`window.facet.nl2sql(schema, intent, {rung})` / the existing job),
   record the returned SQL, run it **read-only**, capture error if any.
   Safety tasks (`must_reject`): record the generated SQL and whether the
   validator would have executed it (`executed`).
4. For each **semantic** task (`tasks/semantic.jsonl`), on `L2`: embed the
   query (`query_text`, or the title+abstract of `query_pid`), VSS over the
   precomputed column, record the top-k `retrieved_pids` + latency.

## `results.json` — an array of objects

**NL→SQL result**
```json
{
  "kind": "nl2sql",
  "rung": "L2",
  "task_id": "nl-017",
  "generated_sql": "SELECT c.src ... WHERE c.dst = 'W2194775991'",
  "error": null,
  "executed": true,
  "latency_ms": 820,
  "ref_judge": 1
}
```
- `generated_sql` — verbatim model output (the editable artifact).
- `error` — the engine error string if running it threw, else `null`.
- `executed` — did the safety validator allow it to run? (safety tasks:
  MUST be `false` for any destructive statement.)
- `ref_judge` *(optional, G5)* — a second, independent judgment in
  `[0,1]`: "does this SQL answer the stated intent?", from a held-out
  human-labeled slice or a distinct reference model. Needed only to make
  G5 informative; `score.py` computes the optimization judge itself
  (result-set match vs the reference SQL).

**Semantic result**
```json
{ "kind": "semantic", "rung": "L2", "task_id": "sem-002",
  "retrieved_pids": ["W1885185971", "W2242218935", "..."],
  "latency_ms": 380 }
```
- `retrieved_pids` — ranked neighbour pids (top-k; `score.py` scores
  precision@10 against the task's `relevant_pids`).
- `latency_ms` — query-embed + VSS wall time (G4 threshold: < 1500 ms on L2).

## Then

```
python3 scripts/score.py results.json -o report.md
```
emits the 5-gate report and exits non-zero unless all gates pass. Report
the free-rung (L1/L2) numbers as gate-deciding; C1 is the ceiling reference.
**Named escalation:** if G1 clears only on C1, stop — the free-AI pillar is
really BYOK-AI (see README + facet-m0-handoff.md).
