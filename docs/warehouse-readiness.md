# Warehouse readiness

Status: the checked-in DuckDB-WASM 1.32.0/DuckDB v1.4.3 runtime, public
Iceberg table data plane, portable Iceberg REST control plane, opaque in-memory
credential-lease boundary, vendor-shaped catalog and Compute Bridge fixtures,
browser-proven S3/GCS DuckDB target, dependency-free Databricks/Snowflake
adapter reference cores, and current semantic-model compatibility accounting
are implemented. This is not a claim of live Databricks or Snowflake
compatibility. Both branded entry points remain disabled.

## Next implementation boundary

The catalog client can now pass short-lived S3/GCS/ADLS credentials only
through an opaque, revocable target capability. Mock targets prove lease
expiry, load-table refresh, secret-free serialization, and cleanup on failure.
A checked-in DuckDB target implements serialized, transactional temporary
secrets for S3 session credentials and GCS OAuth bearer tokens. It rejects
ADLS because the reviewed WASM candidate has no Azure extension artifact.

The authorized runtime migration is applied. Both EH and MVP core/worker assets
and the complete `httpfs`, `iceberg`, `parquet`, and `avro` closure are pinned
under the same-origin production paths. `npm run warehouse:iceberg-runtime`
proves those checked-in bytes in Chromium. `npm run warehouse:iceberg-public`
drives the product mount boundary against DuckDB's public MotherDuck S3 fixture,
including offline retry, cancellation, persistence, remount, removal, teardown,
CORS, byte-range capability, and zero remote writes.
`npm run warehouse:iceberg-candidate` retains the independent upstream proof
from pinned upstream bytes and requires network-evidenced failure for a missing
extension, ignored ranges, denied CORS, missing metadata, and missing Parquet
data. The gate now also proves actual authenticated ranged Parquet reads,
transactional rotation, rollback, and clear against local S3/GCS endpoints,
while confirming Azure artifacts are absent for both variants. It exposed
mandatory `httpfs`, `parquet`, and `avro` dependencies. The production mirror
now carries the same required closure for both variants. The probe also records
the misleading “no version-hint” diagnostic seen when CORS is denied. See
[`duckdb-wasm-iceberg-spike-2026-07-29.md`](duckdb-wasm-iceberg-spike-2026-07-29.md).

The public table-by-URL card is enabled. The generic REST card remains gated on
live catalog evidence. Azure/ADLS remains unavailable pending a browser-capable
data plane. The closed migration record remains in [`BLOCKER.md`](../BLOCKER.md).

The exact pending catalog profiles and independent table/REST release switches
now live in `src/core/product-capabilities.ts`. REST enablement requires both a
verified profile and its release flag; either gate fails closed. Operational
enablement, persistence, limitations, troubleshooting, and rollback steps are
recorded in [`iceberg-rest-release-gate.md`](iceberg-rest-release-gate.md).

The local engine gate has passed. Safe live catalog matrices are next. Real
authentication, authorization, vendor errors, rate limits, token refresh
behavior, and storage reads still need user-supplied test endpoints and
credentials.

The exact fixture names, identity restrictions, ownership record, maximum
credential lifetime, session-only handling, and current access gap are frozen
in [`iceberg-live-fixture-envelope.md`](iceberg-live-fixture-envelope.md).

Direct Databricks SQL Warehouse and Snowflake Virtual Warehouse access is a
separate packaged Compute Bridge concern. The browser contract is hardened and
exercised with credential-free vendor-shaped fixtures. Executable,
dependency-free reference cores cover the vendor state machines. The
`packages/compute-bridge` Cloudflare Worker now supplies protocol-v2 routes,
concrete Arrow assembly/encoding, parsed SQL allowlisting, exact bearer/CORS
boundaries, deadlines, disconnect propagation, readiness security assertions,
and fail-closed configuration. It is not imported by the browser. It configures
no vendor adapter or warehouse credential. Success on the package, browser
fixtures, or Iceberg REST path must not enable or imply a live bridge. See
[`compute-bridge-protocol.md`](compute-bridge-protocol.md).

Both reference cores are now wired behind disabled exact vendor factories and
secret-binding contracts. Credential-free Worker tests cover Databricks Arrow
assembly and signed-link isolation, Snowflake deterministic JSONv2-to-Arrow
encoding, opaque object lookup, parser allowlists, configuration rejection,
route capabilities, and security-readiness gating. The next direct-warehouse
checkpoint is the live matrix. Databricks remains the preferred first live
target because its Statement Execution API can return Arrow Stream chunks
directly. Each factory now needs a safe non-production workspace/account to
prove authentication,
read-only authorization, invalid/expired token handling, vendor error
translation, disconnect cancellation, complete bounded results, and zero
remote writes before any branded source card is enabled.

## Direct warehouse Compute Bridge matrix

Protocol version 2 now proves locally that:

1. direct SQL is rejected unless it is a single read-only statement;
2. every direct and catalog request carries an explicit row cap;
3. a complete vendor `qualified_name` is returned opaquely to the bridge rather
   than browser-quoted as one identifier;
4. the catalog flow requires the structured `table-query` capability;
5. browser cancellation reaches the HTTP request;
6. successful data must be Arrow IPC under the existing byte/deadline ceiling;
7. errors are bounded/redacted and public client results contain no bearer
   value; and
8. credential-free fixture success leaves Databricks/Snowflake source cards
   absent.

`npm run warehouse:adapter-conformance` additionally proves the two reference
state machines against synthetic vendor responses, including bounded
pagination, cumulative partition bytes, exact-token/signed-URL redaction,
timeout/throttle distinctions, and explicit completeness signals. Those checks
still do not prove a deployable server or live account. Any packaged bridge must
independently enforce read-only access with a warehouse role that cannot write,
honor row/byte/time ceilings, cancel the downstream vendor statement when the
browser disconnects, and poll to a terminal cancellation state.

### Databricks SQL Warehouse adapter

The reference core now proves items 1–6 synthetically. A packaged live adapter
must additionally prove the concrete Arrow implementation, dialect-aware
read/allowlist policy, server routing and secret configuration, plus:

1. configured `warehouse_id`, catalog, and schema context;
2. Statement Execution API submit, status polling, and terminal cancellation;
3. vendor row/byte ceilings in addition to the bridge cap;
4. `ARROW_STREAM` or external-link result handling, with no Databricks
   Authorization header sent to signed external URLs;
5. bounded Arrow IPC returned to the browser;
6. expired/invalid token behavior and redacted vendor errors; and
7. read-only warehouse permissions and zero remote writes.

References:

- [Databricks Statement Execution API](https://docs.databricks.com/api/workspace/statementexecution)
- [Databricks execute statement](https://docs.databricks.com/api/gcp/workspace/statementexecution/executestatement)
- [Databricks cancel execution](https://docs.databricks.com/api/workspace/statementexecution/cancelexecution)

### Snowflake Virtual Warehouse adapter

The reference core now proves items 1–5 synthetically, including complete
string/null JSONv2 partition collection into an injected Arrow boundary. A
packaged live adapter must additionally prove the concrete encoder,
dialect-aware read/allowlist policy, server routing and secret configuration,
plus:

1. configured database, schema, warehouse, and role context;
2. SQL API asynchronous submit, status polling, and terminal cancellation;
3. OAuth, key-pair, or programmatic-token handling entirely bridge-side;
4. retrieval of every bounded JSONv2 partition and deterministic Arrow IPC
   conversion;
5. expired/invalid token behavior and redacted vendor errors; and
6. read-only role permissions and zero remote writes.

References:

- [Snowflake SQL API reference](https://docs.snowflake.com/en/developer-guide/sql-api/reference)
- [Snowflake response handling](https://docs.snowflake.com/en/en/developer-guide/sql-api/handling-responses)
- [Snowflake request cancellation](https://docs.snowflake.com/en/en/developer-guide/sql-api/cancelling-requests)

## Databricks Unity Catalog matrix

A safe live endpoint must prove:

1. the `/api/2.1/unity-catalog/iceberg-rest` endpoint and TLS;
2. short-lived OAuth or PAT bearer authentication;
3. `warehouse=<Unity Catalog catalog>` configuration negotiation;
4. the returned or documented `catalogs/<catalog>` prefix;
5. namespace and table browsing;
6. load-table with explicitly requested vended credentials;
7. live in-memory S3 credential application, expiry, refresh, and engine
   cleanup for an AWS-backed catalog; Azure-backed workspaces remain
   unavailable on the reviewed WASM candidate;
8. bounded storage read, cancellation, redacted errors, and payload disclosure;
9. read-only NakliData behavior—no generated SQL execution or remote writes.

Passing this matrix verifies the Iceberg catalog path only. Databricks SQL
Warehouse support is a separate Compute Bridge adapter and must not be implied.

References:

- [Databricks Unity Catalog Iceberg REST access](https://docs.databricks.com/aws/en/external-access/iceberg)
- [Databricks credential vending](https://docs.databricks.com/aws/en/external-access/credential-vending)

## Snowflake Open Catalog/Polaris matrix

A safe live endpoint must prove:

1. the Open Catalog REST URI and TLS;
2. OAuth/service-connection token acquisition and expiry;
3. `warehouse=<catalog name>` configuration negotiation;
4. server prefix override and nested namespace encoding;
5. namespace and table browsing;
6. load-table with explicitly requested vended credentials;
7. live in-memory S3 or GCS credential application and provider-specific
   expiry/refresh plus engine cleanup; ADLS remains unavailable on the
   reviewed WASM candidate;
8. bounded storage read, cancellation, redacted errors, and payload disclosure;
9. read-only behavior.

Passing this matrix does not verify direct Snowflake Virtual Warehouse queries.
That remains a separate packaged Compute Bridge adapter.

References:

- [Snowflake Open Catalog OAuth connection](https://docs.snowflake.com/en/user-guide/opencatalog/external-oauth-connect)
- [Snowflake REST catalog configuration check](https://docs.snowflake.com/en/user-guide/tables-iceberg-configure-catalog-integration-rest-check-config)
- [Apache Polaris vended-credentials reference](https://polaris.apache.org/in-dev/unreleased/vended-credentials/)

## Release gate

Only enable a branded entry point after its full live matrix passes against a
safe test catalog and the result is recorded in `STATUS.md` and
`DECISIONS.md`. Fixture success alone is insufficient.
