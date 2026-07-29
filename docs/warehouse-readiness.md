# Warehouse readiness

Status: the portable Iceberg REST control plane, opaque in-memory
credential-lease boundary, credential-free vendor-shaped fixtures, and current
Databricks/Snowflake semantic-model compatibility accounting are implemented.
This is not a claim of live Databricks or Snowflake compatibility. Both branded
entry points remain disabled.

## Next implementation boundary

The catalog client can now apply short-lived S3/GCS/ADLS credentials only
through an opaque, revocable target capability. Mock targets prove atomic
replacement, expiry gating, load-table refresh, secret-free serialization, and
cleanup on failure.

The next checkpoint is a real bounded storage-read target. It is blocked on a
separately authorized DuckDB-WASM/extension migration: the pinned
`@duckdb/duckdb-wasm` 1.29.0 embeds DuckDB 1.1.1 and cannot load the Iceberg
WASM extension. The migration must first prove a reviewed package pin, signed
same-origin extension vendoring, public Iceberg scans, S3/GCS/ADLS target
cleanup, cancellation, existing format behavior, supply-chain hashes, and the
768 KiB shell budget. See [`BLOCKER.md`](../BLOCKER.md).

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
7. live in-memory credential application, expiry, refresh, and engine cleanup;
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
7. live in-memory S3, GCS, or ADLS credential application and provider-specific
   expiry/refresh plus engine cleanup;
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
