# Sidecar eval harness (W2.4)

Objective, deterministic scoring of the AI sidecar's three jobs. Built
as the foundation for the v1.3 LoRA work — it's the surface that lets
us compare a prompted base model against a prompted+LoRA model on the
same held-out set.

Lives entirely under `eval/`. **No runtime dependency is added to the
main app** — the harness reuses the app's exported prompt builders +
response parsers (from `src/core/sidecar/`) and is bundled for Node
via esbuild (already a devDep).

## Run it

```bash
# Offline self-test — scores the recorded fixture responses, no network.
# Should print 34/34 and exit 0. This is the harness's own regression check.
npm run eval -- --dry-run

# Live — call a provider. Key comes from the environment.
OPENAI_API_KEY=sk-…    npm run eval -- --provider openai    --model gpt-4o-mini
ANTHROPIC_API_KEY=sk-… npm run eval -- --provider anthropic --model claude-3-5-haiku-latest
CUSTOM_API_KEY=…       npm run eval -- --provider custom    --model mixtral --endpoint https://llm.local

# One job only (repeatable flag):
npm run eval -- --provider openai --job explain-error

# Custom report path:
npm run eval -- --dry-run --out /tmp/eval.html
```

The run writes a self-contained HTML report (default `eval/report.html`,
gitignored) and prints a per-job + total summary. Exit code is non-zero
when any case fails — useful for CI gating a live run later.

## How it works

```
eval/
  run.mjs        entry point — parses CLI, reads the API key from env,
                 bundles harness.ts via esbuild into eval/.cache/, runs it
  harness.ts     orchestration — loads fixtures, builds prompts via the
                 app's buildXxxPrompt(), calls the provider (live) or uses
                 the recorded response (dry-run), parses via the app's
                 parseXxxResponse(), scores, writes the report
  score.ts       per-job scoring functions (deterministic, no LLM judge)
  report.ts      self-contained HTML report generator (no chart libs)
  fixtures/      held-out cases, one JSON file per job
```

Why esbuild instead of running `harness.ts` directly: Node's native
type-stripping rejects the codebase's TS parameter properties (e.g.
`SidecarError`'s constructor). esbuild does a full transform, so we
bundle `harness.ts` (+ its `src/` imports) into `eval/.cache/` and
import the result. The cache is cleaned after each run.

## Scoring

Deliberately rubric-based, not an LLM-judge — cheap, reproducible, and
exactly what a base-vs-LoRA comparison needs.

| Job | Pass criteria | Score |
| --- | --- | --- |
| `disambiguate-type` | chosen typeId === expected (or both null) | 0 or 1 |
| `define-type` | category matches (case-insensitive) **and** the suggested regex compiles + matches every sample | 0.4 category + 0.5 regex + 0.1 id-soft |
| `explain-error` | ≥50% expected-keyword coverage in the explanation **and** the suggested-fix check passes | 0.7 keyword coverage + 0.3 fix |

The scorers are unit-tested in `tests/eval-score.test.ts` (both pass and
fail directions). The fixtures use all-passing recorded responses so
`--dry-run` is a clean self-test; the scorer's ability to reject bad
output is proven by those unit tests, not by planting failing fixtures.

## Adding cases

Append to the relevant `eval/fixtures/<job>.json`. Each case needs:

- `id` — unique, kebab-case
- `input` — shaped like the job's input (minus the `kind` field)
- `expected` — the job's rubric (see `score.ts` for the exact shape)
- `recordedResponse` — a representative *raw* model output (the exact
  string a model would return). Used by `--dry-run`; ignored in live
  mode. Keep it a *good* answer so dry-run stays a clean self-test.

Current seed: ~10–12 cases per job. Grow toward 20–50 as real
production edge cases surface.
