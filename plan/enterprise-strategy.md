# Enterprise strategy

The deliberate answer to: "what's the NakliData story for organizations with TB-scale data, in-VPC compliance requirements, and shared-team taxonomy needs?"

This doc is the canonical writeup; sibling docs ([remote-sources.md](./remote-sources.md), [sidecar-architecture.md](./sidecar-architecture.md), [spec-amendments.md](./spec-amendments.md)) reference back to here for the enterprise-mode pieces.

---

## Who "enterprise" means for NakliData

Three concrete buyer profiles. We optimize the design for all three; the OSS posture covers them without forcing them through a sales funnel.

### Profile A — Mid-co with a 100s-of-GB lakehouse

- 50–500 GB of Parquet on S3 / R2 / Azure Blob, possibly as Iceberg or Delta tables.
- Analyst team of 5–20 people; mostly SQL-fluent.
- Won't pay seat-licensed BI; will deploy open infrastructure.
- **What they need:** in-VPC compute (because shipping 500 GB to each analyst's browser is absurd) + auth (OAuth2 against their IdP) + catalog support.

### Profile B — Regulated industry: finance, health, gov

- Strict compliance (SOC 2, HIPAA, ISO 27001, Indian RBI / SEBI norms, similar).
- Hard requirement: **no customer data leaves their cloud account.** "Third party never touches the bytes" is necessary but not sufficient — the bytes must also stay in their VPC.
- Frequently want audit trails of who-queried-what.
- **What they need:** Compute Bridge running entirely inside their VPC; bridge writes audit log to bridge-local storage; bridge optionally integrates with their existing IdP.

### Profile C — Multi-team org wanting a shared taxonomy + audit log

- Maybe also fits A or B, but the distinguishing trait is **organizational, not technical.** Multiple analysts, each running NakliData in their own browser, but they want a *shared* curated taxonomy ("we agreed that `vendor_short_code` is a `vendor_external_id` type") and a *shared* history of accept/override decisions.
- Without a central hub, every analyst re-curates from scratch.
- **What they need:** the bridge acts as the team hub. Taxonomy lives in bridge-local storage; browsers fetch and reconcile.

The three profiles share one architecture (Compute Bridge); they differ in which features they exercise. The bridge is deliberately scoped to serve all three.

---

## The data-plane / control-plane split (canonical version)

This distinction is foundational. It's already documented in [spec-amendments.md A4](./spec-amendments.md); restated here in full because every architecture decision in this doc derives from it.

| | Control plane | Data plane |
| --- | --- | --- |
| **What it does** | UI, SQL editor, schema panel, taxonomy, action sinks. The thinking layer. | Where bytes live and where queries execute. The compute layer. |
| **Where it runs** | Always the browser tab. Period. | Three modes depending on data size + compliance posture. |

NakliData *is* the control plane. The data plane has three modes:

```
                ┌──────────────────────────────────────────┐
                │ Control plane — always the browser tab    │
                │  (UI · taxonomy · schema · SQL · sinks)   │
                └──┬────────────────┬─────────────────┬─────┘
                   │                │                 │
                   ▼                ▼                 ▼
   ┌──────────────────────┐ ┌─────────────────┐ ┌────────────────────────┐
   │ Mode 1 — Browser     │ │ Mode 2 — Relay  │ │ Mode 3 — Compute Bridge│
   │ DuckDB-wasm in the   │ │ Stateless URL   │ │ User-deployed binary in│
   │ same tab.            │ │ signing.        │ │ customer VPC.          │
   │                      │ │ Bytes still     │ │ Bytes never leave the  │
   │ Small data; today.   │ │ traverse to     │ │ VPC. SQL/Arrow only.   │
   │                      │ │ browser.        │ │                        │
   │ Spec §3.1            │ │ Spec §4.1, §4.2 │ │ v1.3+ (this doc)       │
   └──────────────────────┘ └─────────────────┘ └────────────────────────┘
```

A NakliData session can use multiple modes simultaneously: a local CSV mount alongside an S3 Parquet alongside an in-VPC Postgres-via-bridge, all queryable from one notebook.

---

## Compute Bridge — sibling OSS project

**Status (locked):** Compute Bridge ships as its own repo (working name `NakliTechie/nakli-compute`, final name deferred per the standing rule). Not bundled with NakliData. Browser still mounts the bridge as a new source kind.

### What it is

A single static binary (Rust target) that:

- Embeds DuckDB.
- Listens on a port (`8088` default) speaking **Arrow Flight** as the wire protocol (canonical query API; Arrow IPC over gRPC; battle-tested). Falls back to **HTTP + Arrow IPC** for environments where gRPC is awkward.
- Authenticates client browsers via bearer token (default), mTLS, or OAuth2 against the customer's IdP.
- Has its own copy of the taxonomy bundle, kept in sync with the customer's chosen version.
- Optionally hosts a heavier AI sidecar (see [sidecar-architecture.md](./sidecar-architecture.md) — bridge-side enhancement layer).
- Writes an append-only audit log of queries + sink-fires to local disk (or syslog / cloud logging integration).

Size: 10–20 MB without the AI sidecar; 2–3 GB with the LoRA-Gemma weights bundled.

### What it is NOT

- It is not a multi-tenant SaaS. Each customer runs their own instance.
- It is not a database — it doesn't store the customer's data. It queries the customer's existing stores (S3, Postgres, Iceberg tables, etc.).
- It is not a NakliTechie-operated service. We ship the binary; the customer runs it.

### License

**Open question.** Leaning Apache 2.0 — more permissive than NakliData's MIT, which matters because enterprises will want to embed / modify / redistribute the bridge inside their own infrastructure. AGPL would force them to share modifications publicly, which is a non-starter for many enterprises. Final pick deferred.

---

## Deployment paths

Phase by user effort, in priority order for shipping:

| Path | Audience | When we ship |
| --- | --- | --- |
| **(i) Single binary curl-install** | `curl ... \| sh` on a Linux box. Bare-metal users, devs trying it locally. | v1.3 MVP |
| **(ii) Docker image** | One `docker run`. The common case. | v1.3 MVP |
| **(iii) Docker Compose** | For users wanting Postgres / cache next to the bridge. | v1.3 stretch |
| **(iv) Helm chart** | k8s shops. | v1.4 |
| **(v) Terraform module** | One-click VPC provisioning for AWS / GCP / Azure (EC2 / Compute Engine / Azure VM with the right security groups). | v1.4 |
| **(vi) CloudFormation / Pulumi templates** | AWS-native one-clicks. | v1.5+ |

The "deploy for me" professional service (see below) targets enterprises who don't want to do (iv) or (v) themselves.

---

## Connection / auth model

Browser → bridge connection has three layers:

### 1. Discovery + connection

Bridge listens on a port (default `8088`); browser is configured with the bridge URL via:
- Settings panel ("Compute Bridge endpoint: https://nakli-compute.your-vpc.internal:8088")
- URL parameter (`?bridge=https://nakli-compute.your-vpc.internal`)
- `.naklidata` file (saved sessions remember the bridge they were connected to)

The customer is responsible for the bridge being reachable from the analyst's browser — usually via VPN, Tailscale, or a private subdomain over a corporate VPN.

### 2. Authentication

In order of strength + customer effort:

- **Bearer token** (default). Bridge generates a token on first run; analyst pastes it into the browser settings. Survives across sessions per the existing BYOK-IDB pattern (opt-in).
- **mTLS.** Browser uses a client certificate the customer issues. Stronger; requires the customer's PKI.
- **OAuth2 against customer IdP.** Bridge speaks OIDC; analyst signs in with their corporate identity. Strongest for the multi-team case; lets the audit log key on the analyst's email.

Default for v1.3 MVP: bearer token. v1.4 adds OAuth2. mTLS lands when a customer asks.

### 3. Authorization (multi-team feature)

When the bridge is shared across a team, individual analysts may need different permissions (e.g., the `finance/` data lake should only be queryable by the finance team). Layered on top of OAuth2:

- Bridge config defines roles (`finance-reader`, `ops-analyst`, etc.) and maps each role to a set of allowed source paths.
- Audit log records the analyst's role + identity per query.
- v1.4+ feature; v1.3 ships single-tenant (every analyst has full access).

---

## What NakliData NEVER hosts

To make the trust story unambiguous:

- We don't run EC2 / GCE / Azure VMs for the customer.
- We don't host a multi-tenant Compute Bridge service.
- We don't store the customer's queries, results, taxonomy state, or audit log.
- We don't run inference on the customer's data.
- We don't have credentials to the customer's cloud account at any point.

What we do offer (post-v1.3):

- The bridge binary, OSS, free.
- Documentation + deployment templates.
- Optional **"deploy for me" professional services**: paid help with first deployment in the customer's VPC. One-time engagement, scoped per customer, not a recurring subscription. Same posture as the rest of the portfolio's non-hosting stance — we help configure, but the customer owns the deployment.

---

## AI co-located with the bridge

Per the portfolio-wide directive ([CLAUDE.md](../CLAUDE.md) + `~/.claude/CLAUDE.md`), every NakliTechie project has an AI sidecar with BYOK. For NakliData, this resolves into a **split sidecar architecture**:

- **Browser-side sidecar** = baseline. Always present. Small model (Phi-3-mini-class). Spec §4.3 jobs + Job 4 (report-template recommendation). Works standalone when no bridge is connected — critical, because **most NakliData users will never deploy a bridge**.
- **Bridge-side sidecar** = enhancement. Heavier LoRA-tuned model (Gemma 4 E4B at ~2.5 GB cached on bridge disk — no OPFS budget). Unlocks new jobs that browser-side can't reasonably do:
  - **Large-scale auto-classification.** 10k+ columns batch-classified with the same LoRA-tuned head.
  - **AI-assisted join inference.** Given the taxonomy assignments across all mounted tables, suggest plausible joins (FK candidates).
  - **Scheduled enrichment runs.** Cron-style "every morning, re-run my saved reports against fresh data" — runs on the bridge, results streamed to subscribers when they open the tab.
  - **Multi-table relationship hinting.** Schema-graph view backfill: which columns probably reference which.

When both are present, the control plane routes each job to the side that fits:

| Job | Browser-side | Bridge-side |
| --- | --- | --- |
| Type disambiguation (1 column) | ✓ default | bridge if browser is slow / offline |
| Explain query error | ✓ default | bridge if more context needed |
| Define-new type | ✓ default | bridge for richer regex/checksum suggestions |
| Report-template recommendation (Job 4) | ✓ default | bridge for higher-quality recommendations |
| Auto-classify 10k columns | ✗ | ✓ exclusive |
| Join inference | ✗ | ✓ exclusive |
| Scheduled enrichment | ✗ | ✓ exclusive |

Same training-data pipeline, same eval harness (see [sidecar-architecture.md](./sidecar-architecture.md)). The bridge-side LoRA weights ship with the bridge image; updates are versioned.

---

## Multi-team / shared taxonomy (v1.4+)

This is the killer feature for Profile C, and it's why the bridge becomes the team hub rather than just a compute box.

- Bridge holds the canonical taxonomy file (an extension of `taxonomy/v0.1/types.jsonl`).
- Each analyst's browser fetches the taxonomy from the bridge on session boot.
- When an analyst accepts / overrides / defines-new on the schema panel, the change is staged locally (existing behavior) and **proposed** back to the bridge.
- The bridge applies a configurable workflow: auto-merge low-risk changes; queue higher-risk ones for an admin to approve. Audit log records every change.
- Other browsers connected to the bridge pull updates on their next session.

This is essentially git-for-taxonomy with the bridge as the central remote. v1.4 ships a simple variant (auto-merge with audit log); v2.0 adds the review queue + role-based gating.

---

## Phasing

| Version | Item |
| --- | --- |
| **v1.1 (planned)** | No bridge work. Keep the URL-signing Relay primitive as scoped. |
| **v1.2** | Catalog auth + S3-compatible endpoints — enables Profile A's lakehouse case without a bridge. Foundation for later bridge work. |
| **v1.3** | **Compute Bridge MVP.** Sibling OSS repo `NakliTechie/nakli-compute`. Single binary + Docker image. Bearer token auth. Arrow Flight + HTTP fallback. Browser source kind `compute-bridge` added. No multi-team features yet. |
| **v1.4** | Bridge-side AI sidecar (heavier LoRA model, the new exclusive jobs). OAuth2 against customer IdP. Helm + Terraform deployment paths. Shared-taxonomy v1 (auto-merge + audit log). |
| **v2.0** | Multi-team v2: role-based auth, review queues for high-risk taxonomy changes. DB Relay (Postgres / MySQL / Snowflake / BigQuery) as a sibling to the storage Relay. Tailscale-style overlay for NAT/firewall traversal (if customer demand justifies). |
| **v2.x** | Edge-compute deployment option (Cloudflare Worker / AWS Lambda running DuckDB) for users who don't want a long-running bridge instance. |

---

## Open questions deferred to follow-up

These aren't blockers; they're flagged for resolution before the v1.3 MVP starts:

1. **License for the bridge.** Apache 2.0 vs MIT vs AGPL. Lean Apache. Final pick before the `nakli-compute` repo is created.
2. **Wire protocol.** Arrow Flight (gRPC) is the standard choice but has WebTransport / WASM-gRPC quirks in the browser. HTTP + Arrow IPC is simpler but loses Flight's streaming control. Likely ship both; need to confirm.
3. **Tailscale-style overlay relay.** Should the URL-signing Relay primitive be extended to handle NAT/firewall traversal for the bridge? Adds complexity; defer to v2.0 unless v1.3 customers demand it.
4. **AI training data for bridge-mode exclusive jobs.** "Auto-classify 10k columns" is a different scale than the browser sidecar's per-column work; the eval harness in v1.2 needs to cover bridge-mode jobs too. Plan that with v1.2 scoping.
5. **Pricing / GTM for the "deploy for me" service.** Out of scope for this doc. Worth a separate conversation when v1.3 lands.
