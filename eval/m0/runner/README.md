# Facet M0 runner

The browser-side driver — the one piece of M0 that needs a **WebGPU box**
(L2), and optionally a **BYOK key** (C1) / a local **Ollama** (L1). It imports
the real NakliData modules (Engine, mount, the sidecar `dispatchJob`, the
transformers chunk, `embed-search`) and drives every labeled task through them,
writing `../results.json` for `scripts/score.py`. It touches no product code.

## Files

- `harness.ts` — the in-browser harness (boots Engine, mounts the fixture,
  drives NL→SQL via `dispatchJob` on each rung + local embedding via
  `embedSearchInMemory` on L2). Bundled by `build.mjs` → `harness.js`
  (gitignored).
- `harness.html` — the page that loads `harness.js`.
- `build.mjs` — esbuild bundle of the harness (reuses the product's build opts).
- `run.mjs` — launches WebGPU Chromium, serves `eval/m0/`, injects config,
  waits, writes `results.json`.

## Run (at a WebGPU machine)

```sh
node eval/m0/runner/build.mjs                          # bundle the harness

# L2 only (free WebGPU rung — the gate-deciding one):
M0_RUNGS=L2 M0_HEADED=1 node eval/m0/runner/run.mjs

# add the BYOK ceiling (C1) and/or a local Ollama (L1):
M0_RUNGS=L2,C1 M0_C1_KEY=sk-ant-... node eval/m0/runner/run.mjs
M0_RUNGS=L1,L2 M0_L1_URL=http://localhost:11434/v1 M0_L1_MODEL=qwen2.5:0.5b node eval/m0/runner/run.mjs

python3 eval/m0/scripts/score.py eval/m0/results.json -o eval/m0/report.md
```

### Env

| var | default | meaning |
|-----|---------|---------|
| `M0_RUNGS` | `L2` | csv of `L1,L2,C1` |
| `M0_HEADED` | (unset) | set to run headed — often required for a real WebGPU adapter |
| `M0_LOCAL_MODEL` | Qwen2.5-0.5B | L2 generation model (Transformers.js) |
| `M0_EMBED_MODEL` | all-MiniLM-L6-v2 | L2 embedding model |
| `M0_L1_URL` / `M0_L1_MODEL` | localhost:11434/v1 · qwen2.5:0.5b | Ollama (OpenAI-compatible) |
| `M0_C1_PROVIDER` / `M0_C1_MODEL` / `M0_C1_KEY` | anthropic · haiku · — | BYOK ceiling |

## Known gotchas to expect on first run

- **WebGPU under headless Chromium is unreliable.** Use `M0_HEADED=1`; if the
  adapter still doesn't resolve, the harness falls back to `wasm`, where the
  0.5-2B generator may OOM (`std::bad_alloc`) — this is the exact Layer-1 issue
  from the slice-B validation (DECISIONS AT/AU). A real WebGPU adapter is the
  point of the test.
- **`array_cosine_similarity`** is used by `embedSearch`'s DuckDB path (the
  runner uses the JS path, so this doesn't gate the run) — confirm the wasm
  engine revision exposes it before wiring the product Embedding view to it.
- **L1** requires Ollama serving its OpenAI-compatible API; the runner sends a
  dummy key (dispatch requires a non-empty key; Ollama ignores it).
- The run is **slow** (model download + inference over ~50 NL→SQL × rungs +
  embedding ~2000 papers). `run.mjs` waits up to an hour.
