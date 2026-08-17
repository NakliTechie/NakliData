# Iceberg live-fixture envelope

Date: 2026-08-18
Decision: FJ
Status: public fixture and live-profile contract named; vendor endpoints,
identity owners, issuance timestamps, and absolute revocation timestamps await
account access.

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

## Snowflake Open Catalog/Polaris profile

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
