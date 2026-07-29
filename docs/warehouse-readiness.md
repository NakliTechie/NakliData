# Warehouse readiness

Status: the portable Iceberg REST control plane, opaque in-memory
credential-lease boundary, vendor-shaped fixtures, browser-proven S3/GCS
DuckDB target, and current Databricks/Snowflake semantic-model compatibility
accounting are implemented. This is not a claim of live Databricks or
Snowflake compatibility. Both branded entry points remain disabled.

## Next implementation boundary

The catalog client can now pass short-lived S3/GCS/ADLS credentials only
through an opaque, revocable target capability. Mock targets prove lease
expiry, load-table refresh, secret-free serialization, and cleanup on failure.
A checked-in DuckDB target implements serialized, transactional temporary
secrets for S3 session credentials and GCS OAuth bearer tokens. It rejects
ADLS because the reviewed WASM candidate has no Azure extension artifact.

The next checkpoint is a checked-in bounded storage-read target. A no-install
spike selected stable `@duckdb/duckdb-wasm` 1.32.0 (DuckDB v1.4.3) and proved
same-origin, dependency-complete Iceberg reads over both EH and MVP variants in
real Chromium. The public-fixture probe returned the same five rows with zero
console errors. `npm run warehouse:iceberg-candidate` now repeats the proof
from pinned upstream bytes and requires network-evidenced failure for a missing
extension, ignored ranges, denied CORS, missing metadata, and missing Parquet
data. The gate now also proves actual authenticated ranged Parquet reads,
transactional rotation, rollback, and clear against local S3/GCS endpoints,
while confirming Azure artifacts are absent for both variants. It exposed
mandatory `httpfs`, `parquet`, and `avro` dependencies, variant-asymmetric
current vendoring, and misleading “no version-hint” diagnostics when CORS is
denied. See
[`duckdb-wasm-iceberg-spike-2026-07-29.md`](duckdb-wasm-iceberg-spike-2026-07-29.md).

The project still pins `@duckdb/duckdb-wasm` 1.29.0 / DuckDB 1.1.1. Applying
the proven candidate is blocked on separate authorization because it changes
the shared runtime dependency, workers/WASM, extension mirror and integrity
hashes. The migration must wire and preserve S3/GCS cleanup, cancellation,
existing format behavior, CSP, supply-chain integrity, and the 768 KiB shell
budget. Azure/ADLS remains unavailable pending a separate browser-capable data
plane. See
[`BLOCKER.md`](../BLOCKER.md).

Only after that local engine gate passes do the safe live catalog matrices
begin. Real authentication, authorization, vendor errors, rate limits, token
refresh behavior, and storage reads still need user-supplied test endpoints and
credentials.

Direct Databricks SQL Warehouse and Snowflake Virtual Warehouse access is a
separate packaged Compute Bridge concern; success on the Iceberg REST path must
not enable or imply either bridge.

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
