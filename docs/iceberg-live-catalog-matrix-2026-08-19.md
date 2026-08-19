# Iceberg live catalog matrix — 2026-08-19

This record covers the Databricks Unity Catalog Iceberg REST control plane on
the existing AWS trial workspace. It does not establish an Iceberg table data
plane, credential vending, Databricks SQL Warehouse support, or a releasable
catalog profile.

No bearer, OAuth client secret, storage credential, metadata location, row
value, signed URL, or private object path is recorded here.

## Profile

- Workspace: AWS `us-west-2`, Premium trial, serverless-only.
- Endpoint: workspace-owned
  `/api/2.1/unity-catalog/iceberg-rest` over HTTPS.
- Warehouse/catalog identifier: `samples`.
- Principal: `naklidata-live-matrix-reader`.
- Human administrator: `chirag@prashnam.ai`.
- OAuth secret: one-day maximum, issued 2026-08-19 05:06 IST and deleted
  before 2026-08-19 05:12 IST.
- Compute: the SQL warehouse remained stopped throughout this catalog slice.
- Remote writes: zero. No catalog, schema, table, privilege, storage object,
  or metastore setting changed.

## Live control-plane evidence

- OAuth M2M returned a one-hour bearer after the existing principal was
  temporarily activated.
- `GET /v1/config?warehouse=samples` returned HTTP 200.
- Configuration overrode the route prefix to `catalogs/samples`.
- The response advertised 17 endpoints, including namespace listing, table
  listing, load-table, and the table-credential route.
- The production `IcebergCatalogClient` negotiated that configuration without
  a vendor-specific code path.
- The production client listed 11 visible namespaces without a continuation
  token.
- The production client listed six `bakehouse` tables.
- The bounded discovery inspected the first 100 visible sample-table
  identifiers sequentially. Every load-table request returned HTTP 400.
- Databricks identified `samples.bakehouse.sales_transactions` as not
  Iceberg-compatible. The production client preserved the HTTP 400 failure as
  `catalog_error`.
- No load-table response, metadata location, vended credential, or storage
  request occurred.
- The OAuth secret was deleted and the service principal was deactivated after
  the slice.

## Gate result

Live configuration negotiation, server-selected prefix routing, namespace
browse, table browse, bearer authentication, redacted failure handling, and
cleanup now have AWS Databricks evidence.

The exact `databricks-unity-catalog-aws` profile remains
`verification-pending`. The account contains no read-only Iceberg-compatible
fixture available to this principal. Creating the named fixture would require
remote catalog and storage writes, which this run did not authorize. Therefore
load-table, vended S3 credentials, expiry/refresh, bounded object-storage
reads, cancellation, and engine-secret cleanup remain unproved.

## Smallest unblock

Provide an independently owned, read-only Iceberg-compatible table to the
named principal. The preferred object remains
`naklidata_verify.iceberg.lineitem_iceberg` from
`docs/iceberg-live-fixture-envelope.md`. Its owner must preconfigure external
data access, `EXTERNAL USE SCHEMA`, table read privileges, and table-scoped S3
credential vending. NakliData must not create or mutate that fixture during
the release matrix.

## Trial-only storage follow-up

Read-only account inspection later on 2026-08-19 showed:

- the existing workspace is serverless-only and uses Databricks default
  storage;
- the trial displayed $35 of $40 remaining;
- no compute started and no workspace object changed.

Databricks supports managed Iceberg tables on default storage. Its Iceberg
limitations also state that credential vending is unavailable for workspaces
using default storage. A managed table created in this trial therefore cannot
prove NakliData's required vended-S3 lifecycle. The matrix retains the
independently owned S3-backed fixture as its smallest valid unblock. No trial
credit was spent creating an unusable substitute.

References:

- <https://docs.databricks.com/aws/en/external-access/iceberg>
- <https://docs.databricks.com/aws/en/external-access/admin>
- <https://docs.databricks.com/aws/en/external-access/credential-vending>
- <https://docs.databricks.com/aws/en/iceberg/>
- <https://docs.databricks.com/aws/en/storage/default-storage>
