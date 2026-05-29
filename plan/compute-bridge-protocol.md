# Compute Bridge — wire protocol + client integration (W3.3 design)

Companion to [`enterprise-strategy.md`](./enterprise-strategy.md) (the
strategy: who it's for, the sibling-OSS-repo posture, deployment, auth
model) and [`remote-sources.md`](./remote-sources.md) (the data-plane
modes). That doc settles the *what*; this doc settles the *wire
contract* — the concrete browser↔bridge API that has to exist before
either side can be built.

**Status:** design only. W3.3 (the bridge binary) is a separate repo
and multi-week; W3.4 (the NakliData client) builds on this contract.
This doc is the artifact that unblocks both.

---

## The one decision that drives everything: HTTP + Arrow IPC, not Flight

`enterprise-strategy.md` calls Arrow Flight the "canonical query API"
with HTTP + Arrow IPC as a "fallback." **For the NakliData browser
client, HTTP + Arrow IPC is THE path, not the fallback** — and that's a
hard constraint, not a preference:

- Arrow Flight is gRPC (HTTP/2 with trailers + bidirectional streams).
  Browsers cannot speak native gRPC. gRPC-web exists but needs a proxy
  (Envoy / the grpc-web shim) and doesn't do server-streaming cleanly.
- NakliData already reads Arrow IPC: `Engine.registerArrow` uses
  DuckDB-wasm's `insertArrowFromIPCStream` (shipped Theme 1 wave 2). A
  bridge query result that comes back as an Arrow IPC stream drops
  straight into that existing path — it becomes a local DuckDB table.

So: **Arrow Flight stays the canonical API for non-browser clients (BI
tools, CLI, future).** The bridge ALSO exposes a plain HTTP + Arrow IPC
surface, and that's what NakliData uses. The bridge implements both over
the same query engine.

---

## Endpoints (HTTP, versioned under `/v1`)

All requests carry `Authorization: Bearer <token>` (v1.3 MVP auth).
All error responses are non-2xx with a JSON body
`{ "error": { "code": "<machine-code>", "message": "<human text>" } }`.

### `GET /v1/health` — discovery + capability negotiation

The reachability probe + handshake. The client calls this first; if it
fails (network, 401, non-2xx), the source enters a graceful
"bridge unreachable / reconnect" state and the rest of the NakliData
session keeps working.

```json
{
  "name": "nakli-compute",
  "version": "0.1.0",
  "auth": "bearer",            // "bearer" | "oauth2" | "none"
  "single_tenant": true,        // false → authorization layer active (v1.4)
  "capabilities": ["query", "tables", "arrow-ipc"]
}
```

### `GET /v1/tables` — catalog

What's queryable, so the schema panel + templates can see bridge
tables alongside local mounts.

```json
{
  "tables": [
    {
      "name": "lakehouse.sales",
      "source": "iceberg",                       // informational
      "schema": [
        { "name": "gstin", "type": "VARCHAR" },
        { "name": "amount", "type": "DECIMAL(18,2)" }
      ]
    }
  ]
}
```

### `POST /v1/query` — SQL → Arrow IPC stream

Request: `{ "sql": "SELECT ... FROM lakehouse.sales WHERE ..." }`

Response (2xx): `Content-Type: application/vnd.apache.arrow.stream`,
body = an Arrow IPC stream of the result set. The client feeds the
bytes to `insertArrowFromIPCStream` and registers the result as a local
DuckDB table.

This is the crux of the value: **the heavy scan/join runs in-VPC next
to the data; only the (small) result set crosses to the browser as
Arrow.** Bytes never leave the customer's cloud except the rows the
analyst's query actually returns.

Errors (non-2xx, JSON): `query_error` (bad SQL), `unauthorized`,
`forbidden` (v1.4 authz), `timeout`, `result_too_large` (a configurable
row/byte cap so a `SELECT *` on a TB table doesn't OOM the browser).

### Deferred endpoints

- `POST /v1/cancel` (cancel a running query) — v1.3 stretch.
- `GET /v1/audit` (audit-log read) — v1.4 multi-team.
- OAuth2 device-flow endpoints — v1.4.

---

## Client side — `compute-bridge` source kind (W3.4)

NakliData-repo work, buildable + mockable here (same shape as the
Iceberg REST client — inject `fetchImpl`, test against canned responses).

- **New `SourceKind` `'compute-bridge'`.** `MountedSource` carries the
  bridge URL + the selected table name(s). One mounted source ≈ one
  bridge table exposed as a local DuckDB view backed by a materialized
  Arrow result (or re-queried on demand — see open question below).
- **`src/core/bridge/bridge-client.ts`** (mirrors
  `iceberg/rest-client.ts`): `health()`, `listTables()`,
  `query(sql) → ArrayBuffer (Arrow IPC)`. Injected `fetchImpl`.
- **Mount flow:** user supplies bridge URL + Bearer token → client
  `health()` handshake → `listTables()` → user picks table(s) → for
  each, the client issues a bounded `SELECT * ... LIMIT <cap>` (or the
  user's own SQL) and registers the Arrow result via the existing
  `registerArrow` path.
- **Bearer token** via the W2.2 `source-secrets` module
  (sessionStorage default + opt-in IDB). Same posture as S3 + Iceberg.
- **Graceful fallback:** if `health()` fails on mount or re-mount, the
  source shows a "Compute Bridge unreachable — Reconnect" state
  (reuses the FSA `reconnectNeeded` pattern). The session, other
  sources, and the notebook keep working. A bridge dependency never
  takes down the tab.
- **CSP:** the bridge URL is a user-configured `https:` endpoint —
  already allowed by `connect-src 'self' https:` (slice 1 / A5). A
  plain-`http://` localhost bridge is blocked by CSP; the bridge should
  serve TLS (self-signed is fine over a VPN) or sit behind an
  https tunnel. Document in the connection UI.
- **Persistence:** `.naklidata` stores the bridge URL + table
  selection (not the token); reload re-handshakes and re-queries (fresh
  data). Additive `PersistedSource.bridge` field, no format-version
  bump (per DECISIONS 2026-05-24 14:00).

---

## What's client (NakliData) vs binary (nakli-compute)

| Concern | NakliData (this repo) | nakli-compute (sibling repo) |
| --- | --- | --- |
| Wire protocol | HTTP client | HTTP + Flight server |
| Query engine | — (delegates) | DuckDB (native, in-VPC) |
| Result format | reads Arrow IPC | emits Arrow IPC |
| Auth | sends Bearer | validates Bearer; issues token on first run |
| Catalog | renders `/v1/tables` | builds it from configured sources |
| Audit log | — | writes bridge-local (v1.4) |
| Authorization (roles) | shows what's allowed | enforces (v1.4) |
| Bridge-side sidecar | — | optional heavier LoRA-Gemma (separate) |

The binary is genuinely its own project (Rust target, single static
binary, ~10–20 MB). It cannot be built or verified from the NakliData
repo. W3.3 proper = that repo; this doc + W3.4 (the client seam) are
what NakliData contributes.

---

## Open questions

- **Materialize vs re-query.** Does mounting a bridge table snapshot it
  into a local DuckDB table (fast, but stale + bounded by the row cap),
  or proxy every query to the bridge (always fresh, but every notebook
  cell round-trips to the VPC)? Leaning: **mount = bounded snapshot**
  (consistent with how local file mounts behave — a table is a table);
  a "refresh from bridge" affordance re-pulls. A true pass-through query
  cell is a separate, later feature.
- **Naming.** `nakli-compute` was named under the launcher-portfolio
  framing, which we dropped on 2026-05-24 (NakliData is an independent
  product). Reconsider before the repo is created: `naklidata-compute`?
  a neutral product name? Decision needed at repo-creation time, not
  now.
- **License.** `enterprise-strategy.md` leans Apache 2.0 for the bridge
  (vs NakliData's MIT) so enterprises can embed/modify privately.
  Confirm at repo creation.
- **Result cap default.** What row/byte cap on `/v1/query` balances
  "useful result sets" against "don't OOM the browser tab"? Start
  conservative (e.g. 100k rows / 256 MB) + make it bridge-configurable.

---

## Slicing for v1.3

1. **W3.4a (NakliData, this repo, mockable now):** `bridge-client.ts`
   + `compute-bridge` source kind + mount flow + graceful fallback +
   tests against a mocked bridge. Ships behind the same opt-in posture
   as the other remote sources.
2. **W3.3 (nakli-compute repo, separate, multi-week):** the binary —
   HTTP + Arrow IPC + Flight, Bearer auth, DuckDB engine, source config,
   `curl | sh` install + Docker image.
3. **Integration test:** once both exist, an end-to-end test with the
   binary running locally (Docker) + NakliData pointed at it. Can't be
   the headless smoke test — needs the binary in CI or a manual pass.
