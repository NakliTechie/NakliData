# `plan/`

Planning artifacts. Not source; not status. **What we want to build next, what we've chosen not to build, and where the live build diverges from the original spec.**

| File | What's in it |
| --- | --- |
| `pending.md` | The open backlog: PondPilot-parity items, second-wave OSS reuse, themed pushes ready to start. |
| `declined.md` | Explicit "do not borrow" with reasons. Future-us reads here before relitigating. |
| `spec-amendments.md` | Tracked divergences from the original `02-SPEC.md` (uploaded at handoff). Authoritative wording for the parts we've refined. |
| `product-shape.md` | The phase model — short four-phase pitch + the honest seven-axis view. |
| `progress.md` | Append-only session journal. Each entry: what landed, quality gates, what's next. Newest at top. |
| `remote-sources.md` | Five options for the filestores-as-database question. |
| `enterprise-strategy.md` | Compute Bridge phasing, buyer profiles, deployment paths. v1.2+ work. |
| `sidecar-architecture.md` | LoRA-Gemma vs prompted-base sidecar; the eval harness; report-recommendation job. |
| `v1.0-handoff-notes.md` | Web-session → desktop-session handoff for the v1.0 tag. Historical now. |
| `checkpoint-2026-05-17.md` | Midday synthesis snapshot (before Theme 2 + Theme 3 wave 2 finished). Substantively superseded by the eod file below; kept for historical context. |
| `checkpoint-2026-05-17-eod.md` | **End-of-day** snapshot. Theme 2 + Theme 3 wave 2 complete; v1.0.0 tagged. Includes the resume-tomorrow bring-up sequence. Read this first when picking back up. |

`STATUS.md`, `DECISIONS.md`, and `CLAUDE.md` (all at repo root) cover the orthogonal axes: what state we're in, what we decided and why, how the agent should operate. The split is intentional: this folder is forward-looking; those three are the live ledger.
