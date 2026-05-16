# Sidecar architecture — base model vs LoRA-tuned specialist

Working through the question: "should we ship a LoRA-fine-tuned Gemma 4 E2B/E4B as the v1.1 sidecar, scoped to taxonomy recommendation + report suggestion + the existing three jobs?"

Honest read: **the idea is sound, but it's a v1.2+ move, not a v1.1 move.** Reasoning below.

---

## The spec's sidecar today

Spec §4.3 (v1.1) defines three jobs:

1. **Type disambiguation** — column with multiple type candidates in [0.5, 0.9] confidence → pick one type id or `unknown`. Strict one-token answer, temperature 0.
2. **Explain query error** — failed SQL + DuckDB error + schema → 1–3 sentence plain-English explanation + suggested fix.
3. **Define-new type assist** — column header + 20 sample values → suggested `{id, display_name, category, regex}` spec.

Default runtime: Transformers.js with "a small model suitable for classification + short generation (Phi-3-mini-4k-instruct quantized, or successor at build time)." Spec says ~50 MB cached in OPFS — that figure is likely aspirational; realistic on-device LLMs in this class are 100 MB (heavily distilled) to 2 GB (4-bit quantized Phi-3-mini at ~3.8B parameters). Worth correcting in a spec amendment.

BYOK alternative: Claude / OpenAI / OpenAI-compatible endpoint, session-only keys.

The spec is **explicit and narrow** about what the sidecar does. It is not a general-purpose assistant. That narrowness is the whole posture.

---

## What LoRA-tuned Gemma 4 E2B/E4B could change

Gemma 4 E2B / E4B are Google's "Effective 2B / 4B" parameter models targeting on-device inference. 4-bit quantized → roughly 1.2 GB (E2B) / 2.5 GB (E4B) in OPFS. License: Gemma terms (permissive for commercial use with some restrictions).

LoRA fine-tuning adds task-specific weight deltas on top of a frozen base model. Delta weights are typically 10–50 MB — cheap to ship per-task LoRAs.

For our narrow jobs, fine-tuning is the right shape:

| Job | Why LoRA fits | Training-data source |
| --- | --- | --- |
| Type disambiguation | Effectively N-way classification with structured input (column header + samples + candidate typeIds). Generic prompted models meander; a tuned classifier is sharp. | Synthetic: generate (column_name, samples, correct_type) from our existing example bundle + every taxonomy type. ~10k tuples without human curation. |
| Explain query error | Structured input (SQL + error message + schema). Output is short, formulaic. | Synthetic: enumerate common DuckDB errors against deliberate-bug SQL; LLM-bootstrap a draft explanation; human-review the seed set. ~500 tuples is plenty. |
| Define-new type | Header + samples → JSON type spec. Tight output schema. | Each existing taxonomy type IS one labeled example. Augment with synthetic variants. |

**New jobs LoRA enables that the prompted-base sidecar can't reliably do:**

- **Report-template recommendation** — given a workbook's column-assignment state, rank the 6 (or 60) templates by applicability and confidence. Strict output: list of `{templateId, score}`. Generic models hallucinate template ids that don't exist.
- **Taxonomy-extension suggestion** — given an unrecognized column with samples, propose a candidate type spec plus a one-line "this looks like X domain knowledge". Different from Job 3 because here the model is suggesting *unsolicited* additions to the user's seen taxonomy gaps.
- **Schema-relationship hinting** — given two tables' assignments, suggest "these two columns look like a foreign-key pair." Maps to v1.2's schema-relationship-diagram view.

---

## Costs LoRA introduces

What we'd be signing up for:

1. **Training pipeline ownership.** We need GPU access (a couple of A100s for a few hours is enough for a small LoRA on Gemma E2B). Cheap as a one-off; pricey if we need monthly re-training.

2. **Labeled-data pipeline.** Spec §6 forbids telemetry → we cannot collect user assignments invisibly. Synthetic data only, unless we add an **explicit opt-in "contribute to model"** flow with full inspection of what gets sent.

3. **Versioning + distribution.** Each LoRA needs a stable hash, an upgrade path, and OPFS-cache invalidation when we ship a new revision. The base model also needs versioning if Google bumps Gemma 4 → 4.1.

4. **Eval discipline.** Without a held-out eval set per job, we can't honestly claim the LoRA is better than the base. This is foundational infrastructure that doesn't exist today.

5. **Bundle / cache tax.** 1.2 GB cached vs 50–200 MB for the spec's tiny default is a real ask on the user's machine. Almost certainly an opt-in (`Settings → Use larger local model for better accuracy?`), not the default.

6. **Vendor stability.** Gemma's tokenizer + license can change. We'd want at least one alternative base model evaluated (Phi-3.5-mini, Llama-3-3B, Qwen2-1.5B) so we're not locked.

---

## The cleanest path

Don't try to ship the LoRA in v1.1. Do this instead:

### v1.1 — ship the sidecar per the spec (3 jobs, base model, BYOK fallback)

Confirms the architecture works end-to-end. Establishes the IPC + UI surface. We learn what users actually use the sidecar for. Defer to **prompted Phi-3-mini-equivalent** (or whatever's current at build time); document the realistic cache size (~150 MB at 4-bit, not 50 MB) — that's a spec amendment.

### v1.2 — build the eval harness + synthetic data pipeline

For each of the 3 jobs, collect a held-out set of 100–500 known-correct answers. Measure base-prompted sidecar against it. Publish accuracy + latency numbers in the repo. **This is the foundation; without evals we can't claim a LoRA model is better than a base model.**

Synthetic data pipeline:
- Generator script (deterministic, like `scripts/gen-examples.mjs`) produces (input, correct-output) tuples for each job.
- For Job 1 (type disambiguation): each taxonomy type yields N synthetic column variations → ~50 types × 50 variants = ~2.5k tuples.
- For Job 3 (define-new type): each taxonomy type IS one positive example; randomize headers and sample sets.

### v1.3 — first LoRA experiment on Job 1

Train a Gemma 4 E2B LoRA on Job 1 (type disambiguation). Compare to base-prompted on the eval set. **Only ship if the LoRA wins by ≥5% accuracy or ≥2× latency.** Otherwise the engineering tax isn't worth it.

If it ships: it goes in **as an opt-in "high-accuracy mode"** in settings. Default stays the smaller base model.

### v1.4 — extend LoRA to Jobs 2, 3, and the new Job 4 (report recommendation)

By this point we have:
- A working eval harness
- Confidence that LoRA beats base on at least one job
- A user-facing settings switch for the bigger model

Adding more LoRAs (one per job, or one multi-job LoRA) is incremental.

### v2.0 — opt-in contribution flow for taxonomy + training data

If users want to help improve the model, **explicit opt-in** with full preview of what gets sent. Sent data is the column header + sample values + their accept/override choice — never source-data rows wholesale, never anything outside the column they were curating. Spec §6 stays clean because this is explicit user action, not telemetry.

---

## Things to be careful about

### Vision §"What it is not" — narration boundary

Vision says:
> No "AI insights" prose narration. LLMs hallucinate confident summaries; the tool shows charts, not paragraphs.

A **report-template recommendation** is on the right side of this line (it's a structured action: "instantiate template X"). A recommendation that comes with prose justification ("you should run this because…") is on the wrong side. The LoRA's output schema needs to be:

```json
{
  "recommendations": [
    {"template_id": "vendor_concentration", "score": 0.94},
    {"template_id": "ar_aging", "score": 0.78}
  ]
}
```

Not:

```
"Based on your data, I think you should look at vendor concentration because..."
```

The constraint is enforceable at training time: the LoRA is trained on JSON-only outputs and never sees prose examples.

### Hard NOT #4 — no auto-execute of LLM-generated SQL

LoRA-recommended templates instantiate as **un-run** cells. The user clicks Run. This is unchanged from how `findApplicableTemplates` works today.

### Hard NOT #1 — no telemetry

The training-data contribution flow has to be opt-in, with full preview, and zero traffic by default. Even error reports for the model's wrong predictions need to be a deliberate user action.

---

## What I'd add to the spec right now

A new §4.3a clause to the spec:

> **§4.3a — Future sidecar specialization.** The v1.1 sidecar uses a prompted small base model. A v1.3 enhancement may ship task-specific LoRA-tuned weights on top of a small base (Gemma 4 E2B as the current candidate base). LoRA specialization is opt-in via settings ("high-accuracy mode") and never the default; the base model alone must remain a viable option for users on bandwidth-constrained machines. New sidecar jobs introduced as part of the LoRA work (e.g., report-template recommendation) follow the same constraints as v1.1 jobs: structured outputs only, no prose narration, no auto-execute.

---

## AI in the browser vs AI in the bridge

The enterprise Compute Bridge ([enterprise-strategy.md](./enterprise-strategy.md)) changes the sidecar story by introducing a second place AI can run. The split is deliberate:

### Browser-side sidecar — baseline (always present)

Per spec §4.3 + the planned Job 4 (report-template recommendation). Small model (Phi-3-mini-class, 4-bit quantized, ~150 MB in OPFS). Runs in every NakliData session. **Critical reasoning:** most users will never deploy a Compute Bridge. The baseline AI must work standalone — anything that depends on bridge-side compute is a feature for a subset of users, not the default.

### Bridge-side sidecar — enhancement layer (when bridge is connected)

Heavier LoRA-tuned model (Gemma 4 E4B at 4-bit, ~2.5 GB cached on bridge disk). The OPFS budget that constrains the browser doesn't apply: the bridge runs on real hardware in the customer's VPC, and 2.5 GB on disk is unremarkable.

The bridge-side sidecar takes on jobs the browser-side can't reasonably do:

| Job | Why it needs the bridge |
| --- | --- |
| Auto-classify 10k+ columns in a batch | Throughput. Browser-side at Phi-3-mini-class doing 10k inferences serially is hours; bridge with batched GPU/CPU inference is minutes. |
| AI-assisted join inference | Needs the full schema context across all mounted tables; bridge already has bridge-local catalog state. |
| Scheduled enrichment runs | Long-running background work doesn't belong in a browser tab the user closes. |
| Multi-table relationship hinting | Same context-window argument as join inference. |
| Higher-quality variants of the four browser jobs | When latency tolerance allows, route to the bigger model for better accuracy. |

### Routing

When both are present, the control plane (browser) routes each job to the appropriate side:

```ts
// Pseudocode in the sidecar client
function dispatchSidecarJob(job: SidecarJob): SidecarTarget {
  if (job.kind === 'auto_classify_batch' || job.kind === 'join_inference'
      || job.kind === 'scheduled_enrichment') {
    return 'bridge_required';
  }
  if (bridge.isConnected() && job.latencyToleranceMs > 500) {
    return 'bridge_preferred'; // bigger model, more accurate
  }
  return 'browser';
}
```

The browser-side sidecar stays the offline-capable fallback. If the bridge is connected when a job dispatches, the bridge takes the heavier work; if not, the browser handles what it can and the bridge-exclusive jobs are simply unavailable (with clear UI messaging).

### Same eval harness, same training data pipeline

The phasing in this doc still applies — v1.2 builds the eval harness, v1.3 trains the first LoRA for Job 1, v1.4 extends to other jobs. The only differences for bridge-side:

- The eval set for bridge-exclusive jobs (batch classification, join inference) is more synthetic data work in v1.2.
- The LoRA weights ship in the bridge image rather than the browser.
- Update cadence is per-bridge-release, not per-NakliData-release. The bridge's OPFS-equivalent (its on-disk model cache) is decoupled from the browser's.

---

## TL;DR

- Yes, LoRA-Gemma 4 E2B/E4B is a real upgrade path for the sidecar's narrow jobs.
- No, it shouldn't land in v1.1 — the spec's intended posture is "ship the simple thing first, then specialize."
- **The actual missing piece today is the eval harness.** Without it, we can't tell if any sidecar approach (LoRA or prompted) is helping. Build the eval harness in v1.2; LoRA falls out naturally once we can measure.
- The new sidecar job worth scoping now is **report-template recommendation** — it's the user-visible win and it fits cleanly inside the vision's anti-narration boundary as long as the output is structured (template ids + scores), not prose.

See also: vision's "What's the non-copyable thing" — a curated taxonomy that learns from human-in-the-loop overrides. The LoRA pathway is **how that curation could compound back into the model** in v2.0+, with explicit consent.
