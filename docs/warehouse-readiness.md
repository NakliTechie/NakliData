# Warehouse readiness

Status: the portable Iceberg REST control plane and credential-free
vendor-shaped fixtures are implemented, and the current Databricks/Snowflake
semantic-model formats have explicit compatibility accounting. This is not a
claim of live Databricks or Snowflake compatibility. Both branded entry points
remain disabled.

## Next implementation boundary

The next local checkpoint is the bounded storage-read data plane: apply vended
S3/GCS/ADLS credentials in memory, own their provider-specific expiry and
refresh lifecycle, cancel reads cleanly, and keep diagnostics redacted. Live
catalog matrices follow only when safe test endpoints and credentials are
available.

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
7. in-memory credential application, expiry, and refresh;
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
7. in-memory S3, GCS, or ADLS credential application and provider-specific
   expiry/refresh handling;
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
