# Snowflake catalog readiness — 2026-08-19

Status: read-only account inspection complete. No live Iceberg REST request ran.
Every Snowflake catalog profile remains `verification-pending`.

## Account evidence

- The authenticated organization exposed one regular Enterprise account,
  `EM85690`, on AWS in Asia Pacific (Mumbai).
- The current account exposed both `ACCOUNTADMIN` and `ORGADMIN`.
- The trial indicator displayed `$400 of $400 left` and 29 days remaining.
- `Admin → Accounts` listed only `EM85690`. It listed no Snowflake Open Catalog
  account.
- Horizon Catalog listed four databases: `SNOWFLAKE`,
  `SNOWFLAKE_LEARNING_DB`, `SNOWFLAKE_SAMPLE_DATA`, and
  `USER$NAKLITECHIE`.
- The local learning database exposed only `INFORMATION_SCHEMA`. The account
  contained no `NAKLIDATA_VERIFY` database and no independently owned
  Snowflake-managed Iceberg verification table.

No account, database, schema, table, external volume, storage integration,
role, user, service connection, token, or warehouse was created. No query or
Iceberg REST request ran. Premium organization views and account upgrade were
left untouched.

## Product routing decision

Snowflake now directs new customers to Horizon Catalog for Apache Iceberg
multi-engine interoperability. A first Snowflake Open Catalog account is no
longer available to new customers. Existing Open Catalog customers can retain
and add Open Catalog accounts.

NakliData therefore tracks two Snowflake boundaries:

1. `snowflake-horizon-catalog-s3` and
   `snowflake-horizon-catalog-gcs` are the primary profiles for new customers.
2. `snowflake-open-catalog-s3` and
   `snowflake-open-catalog-gcs` remain legacy profiles for organizations that
   already own an Open Catalog account.

All four profiles remain fail-closed and independently gated. Horizon Catalog
evidence does not establish legacy Open Catalog behavior. Neither catalog path
establishes Snowflake Virtual Warehouse support.

## Horizon live-matrix prerequisites

The smallest usable AWS fixture is an independently owned Snowflake-managed
Iceberg table with this logical identity:

- database: `NAKLIDATA_VERIFY`
- schema: `ICEBERG`
- table: `LINEITEM_ICEBERG`
- storage: S3 prefix restricted to that table
- data: a copy of the pinned public `lineitem_iceberg` fixture
- principal: dedicated read-only Snowflake user and role
- privileges: endpoint access plus database/schema usage and table select only
- token: short-lived access token with an absolute revocation deadline

The complete matrix must prove configuration negotiation, the database prefix,
namespace and table browse, load-table, explicit vended credentials, bounded S3
reads, expiry/refresh, cancellation, cleanup, redacted errors, and zero remote
writes. NakliData must not create this fixture during its read-only release
matrix.

The account currently lacks that fixture and principal. Creating them would
write remote account and storage state. It would also require separate approval
of Snowflake trial-credit usage and the external S3 owner.

## Billing boundary

Snowflake documents the Horizon Iceberg REST Catalog API at 0.5 credit per one
million calls. Snowflake also states that billing timing is subject to change.
Cross-region storage access can add egress charges. Before a live run, record
the current trial balance, storage region, expected request count, and an
explicit zero-paid-spend ceiling.

## References

- <https://docs.snowflake.com/en/user-guide/opencatalog/create-open-catalog-account>
- <https://docs.snowflake.com/en/user-guide/tables-iceberg-use-external-query-engine>
- <https://docs.snowflake.com/en/user-guide/tables-iceberg-access-using-external-query-engine-snowflake-horizon>
- <https://docs.snowflake.com/en/user-guide/admin-trial-account>
