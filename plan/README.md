# `plan/`

Planning artifacts. Not source; not status. **What we want to build
next, what we've chosen not to build, and where the live build
diverges from the original spec.**

## Canonical (read these first)

| File | What's in it |
| --- | --- |
| [`pending.md`](./pending.md) | The open backlog — exhaustive flat list of what's queued. Source of truth. |
| [`workplan.md`](./workplan.md) | The curated play: chunks for the next session, ordered. Reads `pending.md`. |
| [`declined.md`](./declined.md) | Explicit "do not borrow" with reasons. Future-us reads here before relitigating. |
| [`spec-amendments.md`](./spec-amendments.md) | Tracked divergences from the original `02-SPEC.md` (uploaded at handoff). A1–A12. |

## Strategy + architecture

| File | What's in it |
| --- | --- |
| [`product-shape.md`](./product-shape.md) | Four-phase pitch + the seven-axis view. |
| [`remote-sources.md`](./remote-sources.md) | Five data-plane modes; where signed-URL ends and the bridge begins. |
| [`enterprise-strategy.md`](./enterprise-strategy.md) | Compute Bridge phasing, buyer profiles, deployment paths. |
| [`compute-bridge-protocol.md`](./compute-bridge-protocol.md) | The wire contract: browser uses HTTP + Arrow IPC (not Flight); the four endpoints; client-integration shape. Unblocks the sibling-repo binary + W3.4 client. |
| [`sidecar-architecture.md`](./sidecar-architecture.md) | LoRA-Gemma vs prompted-base; the eval harness; report-recommendation (Job 4). |
| [`wave-2-design.md`](./wave-2-design.md) | Wave 2 slicing + the CSP-broadening trade-off rationale. |
| [`warehouse-and-bi-question.md`](./warehouse-and-bi-question.md) | Parked thinking: do we need a data warehouse / something like Superset? |

## Day summaries (windup output)

The canonical day-end pattern going forward — per CLAUDE.md's
documentation-cadence rule. Tight, bulleted, signal-not-prose.

| File | Day |
| --- | --- |
| [`2026-05-24-summary.md`](./2026-05-24-summary.md) | v1.1.0 + Wave 1 close + post-tag `applyLoadedFile` mutex. |
| [`2026-05-29-summary.md`](./2026-05-29-summary.md) | W2.4 eval harness (Wave 2 closed) → W3.1 Job 4 → W3.2 slice A (local-model seam) → W3.3 wire-protocol design. |

## Releases

| File | What's in it |
| --- | --- |
| [`v1.1.0-release-notes.md`](./v1.1.0-release-notes.md) | Canonical changelog for the `v1.1.0` tag. 27 commits since `v1.0.0`. |

## Historical / archive

| File | What's in it |
| --- | --- |
| [`progress.md`](./progress.md) | Pre-windup append-only session journal. Newest at top. |
| [`v1.0-handoff-notes.md`](./v1.0-handoff-notes.md) | Web-session → desktop-session handoff for the v1.0 tag. |
| [`archive/`](./archive) | Old `checkpoint-*-eod.md` files (pre-windup pattern; superseded by the day summaries above). Kept for historical record. |

---

`STATUS.md`, `DECISIONS.md`, and `CLAUDE.md` (all at repo root) cover
the orthogonal axes: what state we're in, what we decided and why, how
the agent should operate. The split is intentional: this folder is
forward-looking; those three are the live ledger.
