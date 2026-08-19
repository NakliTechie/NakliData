# Iceberg live-fixture envelope

Date: 2026-08-18
Decision: FJ
Status: public fixture and live-profile contract named. The Databricks AWS
control plane received a partial live matrix on 2026-08-19; its compatible
table/storage fixture remains unavailable. Snowflake Open Catalog/Polaris
access still awaits its exact live catalog profile.

This document defines the only fixtures and identities that may support the
first Iceberg availability claims. It authorizes no provider provisioning,
remote write, secret creation, card enablement, deployment, tag, or publish.

## Public table-by-URL fixture

| Field | Value |
| --- | --- |
| Owner | DuckDB project |
| Archive | `https://duckdb.org/data/iceberg_data.zip` |
| Pinned SHA-384 | `a845422c72559d1023fb564ffca1a9b3fd40c6045ef698d94a75ff6825678184dcc765c5dbba27961973b82cd5d32404` |
| Table path | `data/iceberg/lineitem_iceberg` |
| Query bound | `ORDER BY l_orderkey, l_partkey LIMIT 5` |
| Expected first key pairs | `(1,22)`, `(1,157)`, `(1,241)`, `(1,637)`, `(1,674)` |
| Authentication | none |
| Permitted traffic | HTTPS `GET`/`HEAD` and byte ranges only |

The release matrix must stage the pinned archive behind a CORS- and
range-capable HTTPS endpoint. It must retain negative cases for ignored ranges,
denied CORS, missing metadata, missing manifests/data, partial responses, and
redirects. A mutable upstream response never replaces the pinned hash as test
truth.

## Databricks Unity Catalog profile

| Field | Required value |
| --- | --- |
| Cloud | AWS only |
| REST endpoint | `<workspace>/api/2.1/unity-catalog/iceberg-rest` |
| Object | `naklidata_verify.iceberg.lineitem_iceberg` |
| Data | an independently owned copy of the pinned public fixture |
| Principal | dedicated verification service principal or temporary PAT owner |
| Catalog privileges | browse plus read/select on the one verification object |
| Storage privileges | S3 reads limited to that table prefix |
| Credential vending | requested explicitly through the Iceberg REST protocol |
| Credential owner | named Databricks workspace administrator in the run record |
| Revocation | immediately after the matrix; absolute timestamp required before use; maximum 24 hours after issuance |

The identity must lack table creation, mutation, deletion, ownership transfer,
credential creation, and unrestricted object-storage permissions. The matrix
tests the catalog path only. It does not establish SQL Warehouse support.

## Snowflake Horizon Catalog profile

This is the primary Snowflake boundary for new customers. Use the existing
regular Snowflake account and its Horizon Iceberg REST Catalog API.

| Field | Required value |
| --- | --- |
| Storage | S3 or GCS only |
| REST endpoint | account-owned Horizon Iceberg REST Catalog API base URI |
| Object | database `NAKLIDATA_VERIFY`, schema `ICEBERG`, table `LINEITEM_ICEBERG` |
| Table ownership | independently owned Snowflake-managed Iceberg table |
| Data | an independently owned copy of the pinned public fixture |
| Principal | dedicated read-only Snowflake user and role |
| Catalog privileges | endpoint access plus database/schema usage and table select only |
| Storage privileges | vended reads limited to that table prefix |
| Credential vending | requested explicitly through the Iceberg REST protocol |
| Credential owner | named Snowflake account administrator in the run record |
| Revocation | immediately after the matrix; absolute timestamp required before use; maximum 24 hours after issuance |

The matrix may not create or mutate the database, schema, table, external
volume, storage integration, user, role, or storage prefix. It does not
establish Snowflake Virtual Warehouse support.

## Snowflake Open Catalog/Polaris legacy profile

This boundary applies only to organizations that already own a Snowflake Open
Catalog account. Snowflake no longer permits new customers to create their
first Open Catalog account.

| Field | Required value |
| --- | --- |
| Storage | S3 or GCS only |
| REST endpoint | account-owned Open Catalog/Polaris base URI |
| Object | catalog `naklidata_verify`, namespace `iceberg`, table `lineitem_iceberg` |
| Data | an independently owned copy of the pinned public fixture |
| Principal | dedicated read-only service connection |
| Catalog privileges | namespace/table browse and read on the one verification object |
| Storage privileges | reads limited to that S3/GCS table prefix |
| Credential vending | requested explicitly through the Iceberg REST protocol |
| Credential owner | named Open Catalog account administrator in the run record |
| Revocation | immediately after the matrix; absolute timestamp required before use; maximum 24 hours after issuance |

The identity must lack namespace/table creation, mutation, deletion, principal
administration, credential creation, and unrestricted storage permissions.
The matrix does not establish Snowflake Virtual Warehouse support.

## Secret handling

1. Record endpoint, object, principal identifier, owner, issuance time,
   expiration, and revocation deadline without recording a credential value.
2. Accept only a short-lived access token in the browser. Do not enter a client
   secret, private key, refresh token, or object-storage key manually.
3. Keep the access token in the existing per-source `sessionStorage` path with
   persistence disabled. Do not select the opt-in IndexedDB option.
4. Let vended S3/GCS credentials cross only the opaque in-memory lease into
   temporary DuckDB secrets.
5. Exclude credentials from workbooks, URLs, screenshots, clipboard capture,
   logs, diagnostics, test artifacts, and Git.
6. Remove the source, clear its engine target, close the tab, revoke the
   principal/token, and record the revocation timestamp after the matrix.
7. Treat cleanup failure as a failed matrix and keep every branded capability
   unavailable.

## Access state on 2026-08-18

- Project infrastructure documentation names no Databricks, Snowflake, Open
  Catalog, or Polaris environment.
- Connected Chrome state exposes no vendor dashboard or account URL.
- No credential was read, created, entered, persisted, or transmitted.
- The public fixture can support Batches 1–3 without vendor access.
- Batches 4, 7, and 8 retain their live-account gates.

## Databricks access follow-up on 2026-08-19

- The existing AWS trial workspace negotiated the Iceberg REST configuration
  for catalog `samples` and selected prefix `catalogs/samples`.

## Snowflake access follow-up on 2026-08-19

- The trial organization exposed one regular Enterprise AWS account and no
  Open Catalog account.
- Horizon Catalog exposed four databases but no `NAKLIDATA_VERIFY` database or
  Snowflake-managed Iceberg verification table.
- The trial indicator displayed `$400 of $400 left` and 29 days remaining.
- No query, REST request, credential, database, schema, table, external volume,
  storage integration, account, or warehouse action ran.
- `docs/snowflake-horizon-catalog-readiness-2026-08-19.md` records the exact
  successor profile and smallest unblock.
- The production client listed live namespaces and tables.
- A bounded scan of 100 existing sample tables found zero Iceberg-compatible
  load-table targets.
- The one-day OAuth secret was deleted before 2026-08-19 05:12 IST.
- The principal was deactivated. The SQL warehouse remained stopped.
- No remote object, privilege, storage configuration, or metastore setting was
  created or changed.
- The named `naklidata_verify.iceberg.lineitem_iceberg` fixture still requires
  an independent owner. See `iceberg-live-catalog-matrix-2026-08-19.md`.
