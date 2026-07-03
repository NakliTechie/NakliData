# Facet M0 — free-AI eval harness

The riskiest-assumption gate for the **Facet track** (DECISIONS BE/BF, spec
A34). It proves — before any view shell is built — that Facet's **free tier
AI is useful AND safe**: schema-grounded, loud-failing NL→SQL + useful,
low-latency local embedding search on a **free** inference rung (L1 Ollama
bridge / L2 WebGPU), not only on BYOK. This is the same open problem as
NakliData's owed Layer-3 local-inference item, so one run gates both.

> No upstream product name appears anywhere in this harness, by rule. The
> engine is DuckDB-wasm + Transformers.js; the graph engine (deck.gl +
> `@antv/layout`) is a v1.0 concern, not exercised here.

## The 5 gates (binary; all must pass to open v1.0)

| Gate | Passes when |
|------|-------------|
| **G1 correctness** | NL→SQL result-set match ≥ T1 on **≥1 free rung** (L1/L2) |
| **G2 loud failure** | **0** wrong generations applied silently — every wrong one is an engine error or empty result, never a plausible-but-wrong result-set |
| **G3 safety** | **0** destructive statements executed (validator-enforced) |
| **G4 local embedding** | semantic neighbours useful (precision@k) **and** query-embed+VSS < T4 on L2 |
| **G5 no gaming** | optimization-judge vs reference-judge divergence < alarm |

Thresholds live at the top of `scripts/score.py` — targets to tune on first
data, not gospel.

## What's built (this pass — no model/WebGPU needed)

- **Dataset** — a real, messy OpenAlex Deep-Learning citation slice
  (2015-2023): 2,600 papers · 10,638 intra-set citation edges · 9,880
  authors. Deliberately ugly schema (cryptic column names, a citation
  **direction** trap, a **mixed-type** `score` column, ~24% null abstracts)
  to stress schema-grounding — a clean toy would false-pass G1. Schema:
  `data/SCHEMA.md`.
- **85 labeled tasks** — 48 NL→SQL (+6 safety) in `tasks/nl2sql.jsonl`,
  31 semantic-search in `tasks/semantic.jsonl`. Every NL→SQL reference SQL
  is **self-validated** against the fixture and deterministic.
- **Scoring + 5-gate report** — `scripts/score.py`, self-tested
  (`--selftest`). Result-set match (optimization judge), precision@k, the
  safety scan, and the two-judge divergence all compute with no model.

## What's owed (the WebGPU session)

- The **browser-side runner** that drives the sidecar's NL→SQL on L1/L2/C1
  and local embedding on L2, emitting `results.json` (contract in
  `RESULTS_SCHEMA.md`). Needs a WebGPU browser (L2) + a BYOK key (C1).
- The **G5 reference-judge** labels (a second, independent judgment on a
  held-out slice) to make G5 informative.

## Run it

```sh
# reproduce the fixture (only if regenerating — the Parquet is committed):
python3 scripts/fetch_openalex.py      # -> data/raw_works.jsonl (gitignored, 8 MB)
python3 scripts/build_dataset.py       # -> data/*.parquet + SCHEMA.md
python3 scripts/generate_semantic.py   # -> tasks/semantic.jsonl

# validate the reference set is sound (no model):
python3 scripts/validate_refs.py

# prove the gate math (no model):
python3 scripts/score.py --selftest

# after the WebGPU session produces results.json:
python3 scripts/score.py results.json -o report.md
```

Requires `pip install duckdb` (dev-only; the eval uses native DuckDB, the
same engine as the wasm build — not a project dependency, not bundled).

## Layout

```
eval/m0/
  README.md            this file
  RESULTS_SCHEMA.md    the runner's output contract (the one owed piece)
  data/
    SCHEMA.md          the ugly-schema ground truth
    *.parquet          committed fixture (papers/citations/authors/authorship)
    raw_works.jsonl    gitignored (regenerable via fetch)
  tasks/
    nl2sql.jsonl       48 NL→SQL + 6 safety, self-validated
    semantic.jsonl     31 semantic-search, topical relevance labels
  scripts/
    fetch_openalex.py  fetch the raw slice
    build_dataset.py   wrangle -> messy Parquet + SCHEMA.md
    generate_semantic.py  build semantic tasks from topical clusters
    validate_refs.py   self-validate reference SQL against the fixture
    score.py           scoring + 5-gate report (+ --selftest)
```
