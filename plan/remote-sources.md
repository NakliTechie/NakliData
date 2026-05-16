# Remote sources & filestores-as-database

The honest take on the question: "can NakliData point at our S3/R2/Iceberg lakehouse and treat it as the database?"

---

## What the spec covers today (v1.1)

- **Public URL mount** (§4.1) — DuckDB-wasm `read_parquet('https://...')` against any CORS-open URL.
- **Public data catalog** (§4.1) — ~80 curated source entries, one-click mount.
- **Private bucket via Relay** (§4.1 + §4.2) — stateless Cloudflare Worker that signs S3 / GCS / Azure URLs on behalf of the user. **Relay never sees the data; only signs URLs.** Credentials session-only.

That's the design: keep the *control plane* (UI, SQL, schema panel) in the browser and the *data plane* (bytes) directly between the user's bucket and the user's browser. No third party in the middle.

For **personal-scale signed reads** — an analyst pointing at a few-GB Parquet on R2 — this is the right shape.

## Where it doesn't fit the enterprise case

When a company says "we don't want data leaving our S3 / R2", they usually mean one or more of:

1. **No third-party SaaS sees the bytes.** ✓ Relay design satisfies this.
2. **No bytes leave our cloud account at all.** ✗ Relay still has the user's browser fetching from the bucket — bytes leave the bucket boundary, even if they don't hit a third party.
3. **Compute must run inside our VPC for compliance.** ✗ NakliData runs in a browser tab on the analyst's laptop. By definition, not in the VPC.
4. **Catalog + query authentication uses our IdP** (OAuth2 / Okta / SAML). ✗ Spec only covers HMAC over IAM credentials.
5. **TB-scale full scans / joins.** ✗ Browser memory is the ceiling. Range-reads on Parquet help selective queries but won't save a full join.
6. **DB-protocol sources** (Postgres / MySQL / Snowflake / Redshift / BigQuery / MS SQL). ✗ Not in the spec.
7. **Audit log of who-queried-what.** ✗ Stateless Relay leaves no records.

For these, the v1.1 design isn't a flaw — it's a different problem. v1.1 scoped to "personal-scale signed reads," not "enterprise filestores-as-database."

---

## Control plane vs data plane

The mental model the spec doesn't make explicit, but should:

| | Today (v1.1) | Enterprise case |
| --- | --- | --- |
| **Control plane** (UI, SQL editor, schema panel, taxonomy, sinks) | Browser tab on analyst's laptop | Same — browser tab |
| **Data plane** (where bytes live, where queries execute) | DuckDB-wasm in the same browser tab | Compute next to the data — user's VPC, edge worker, or DB server |

NakliData *is* the control plane. The two scenarios differ entirely on where the data plane lives. Making this distinction first-class lets us scope new modes without disturbing the existing posture.

---

## Five options for a richer data plane

Ranked by lift-to-payoff.

### 1. Lakehouse catalogs with auth — Iceberg REST + OAuth2 / Bearer / SigV4

DuckDB-wasm reads Iceberg files via httpfs as of Dec 2025. Adding **REST Catalog support with the auth flows** closes the gap for the "we already have an Iceberg lakehouse" case. PondPilot ships this. The browser still fetches data files, but catalog ops are negotiated through the auth chain.

**Lift:** low — mostly auth-flow + REST client work; the underlying engine is already there.
**Payoff:** high. Iceberg is the dominant open lakehouse format. Delta works the same way.

### 2. S3-compatible custom endpoints

Let the Relay (and direct httpfs) sign against MinIO, R2, B2, Wasabi, etc. by accepting a custom endpoint URL. Just configuration.

**Lift:** trivial.
**Payoff:** opens up every non-AWS object store.

### 3. Compute Bridge — user-deployed DuckDB server

A small open-source binary (Rust, ~10–20 MB) the user runs inside their own VPC. Speaks Arrow over Flight / HTTP. Bytes never cross from the bucket to the browser — only SQL goes in, result rows come out.

**This is the genuinely zero-egress option** for enterprises that say "compute stays in my VPC."

> **Full writeup in [enterprise-strategy.md](./enterprise-strategy.md).** That doc covers: sibling-OSS-repo posture (`NakliTechie/nakli-compute`), the three buyer profiles, deployment paths (binary → Docker → Helm → Terraform), auth model (bearer token / mTLS / OAuth2 + IdP), AI co-location ([sidecar-architecture.md](./sidecar-architecture.md) — bridge-side enhancement layer), multi-team taxonomy hub, and v1.3 → v2.0 phasing.

**Lift:** medium — DuckDB-server precedent exists; bridge client + auth handshake is the new work.
**Payoff:** very high. The enterprise compliance / TB-scale / VPC-locked answer.

### 4. DB Relay — Postgres / MySQL / Snowflake / BigQuery via stateless proxy

A sibling to the storage Relay, but for DB protocols. Same posture: stateless, user-deployed, sees credentials only to authenticate. Bytes flow back to the browser as Arrow.

Doesn't deliver "stays in my VPC" (the result rows still leave) but **does** deliver "any existing database becomes a NakliData source."

**Lift:** medium — protocol bridging for each DB family is real work. Start with Postgres, add others.
**Payoff:** high — DB-protocol sources are the most common enterprise integration ask.

### 5. Edge compute — Cloudflare Worker / AWS Lambda running DuckDB

Same family as the Compute Bridge but using serverless runtimes. Faster cold start for ad-hoc use; weaker "stays in my VPC" guarantees (Cloudflare / AWS see the queries).

**Lift:** low — DuckDB-wasm runs in Cloudflare Workers; LIST → SCAN works.
**Payoff:** medium. Useful as a quick-start path for users who aren't ready to run their own infrastructure, before they graduate to a full Compute Bridge.

---

## Recommended phasing

| When | Items |
| --- | --- |
| **v1.1 (planned)** | Keep the Relay primitive as scoped. Tighten the wording in pending.md to say "Relay handles signed reads, not the full filestores-as-DB scenario." |
| **v1.2** | (1) Iceberg REST Catalog + auth. (2) S3-compatible custom endpoints. Cheap, high-leverage. |
| **v1.3** | (3) Compute Bridge as a separate OSS binary repo (`NakliTechie/nakli-compute`), with a `Connect to compute bridge` source kind in the UI. This is the big enterprise unlock. |
| **v2.x** | (4) DB Relay extending the storage Relay pattern to DB protocols. (5) Optional edge-compute deployments. |

---

## What honest copy looks like

External / on the README:

> NakliData is a browser-native lens over your data. Small to mid-size data queries directly in the tab — DuckDB-wasm engine, no upload. For S3, GCS, and Azure buckets, our stateless Relay primitive signs URLs so credentials stay with you and only your browser fetches the data — no third-party server in the middle.
>
> For larger or compliance-locked workloads, a companion **Compute Bridge** binary runs DuckDB inside your VPC. NakliData becomes the control plane; the bytes never leave your cloud account. *(Compute Bridge ships in v1.3.)*

This is the framing that lets us be honest in both directions: small-data users get the all-in-browser experience; enterprise users get a deployable companion that satisfies "data doesn't leave my account."
