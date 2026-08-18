# Warehouse live matrix — 2026-08-18

This record covers the customer-deployed Compute Bridge profiles only. It does
not prove Databricks Unity Catalog Iceberg REST or Snowflake Open
Catalog/Polaris. Those catalog matrices remain separate.

No secret value, signed result URL, private key, bearer token, or returned row
value is recorded here.

## Databricks SQL Warehouse

Profile:

- AWS Databricks workspace with a Small serverless SQL warehouse.
- OAuth M2M service principal `naklidata-live-matrix-reader`.
- Read fixture `samples.bakehouse.sales_transactions`.
- Human administrator: `chirag@prashnam.ai`.
- OAuth secret issued at 2026-08-18 09:55:14 IST with a one-day maximum
  lifetime. The secret was deleted after the matrix.

Live evidence:

- OAuth client-credential exchange returned a one-hour bearer token.
- Statement Execution submitted and polled a bounded five-row read to
  `SUCCEEDED`.
- The packaged Worker returned one opaque inventory object.
- Table-query returned Arrow with 5 rows and 10 columns.
- Direct query returned Arrow with 5 rows and 2 columns.
- The external result request carried no workspace authorization header.
- The observed external result media type was `binary/octet-stream`.
- A bridge write request stopped at `unsafe_query` before vendor access.
- A direct no-op `DELETE ... WHERE 1 = 0` reached Databricks and failed under
  the restricted identity.
- A submitted five-row read reached terminal `CANCELED` after the cancel API
  call.
- A one-millisecond bridge deadline returned HTTP 504 with `timeout`.
- The warehouse was stopped after the matrix and displayed zero active
  clusters.
- The service principal was deactivated and its OAuth secret list was empty.
- The previously issued one-hour token remained accepted after deactivation;
  deleting the client secret prevents renewal but does not revoke an already
  issued access token. Local copies were removed after evidence capture.

Live defects found and repaired:

1. Workerd converted `redirect: "error"` for the signed result fetch into an
   opaque `TypeError`. The adapter now uses `redirect: "manual"` and rejects
   every non-2xx response through the existing response-status branch.
2. Databricks returned Arrow as `binary/octet-stream`. The bounded Arrow reader
   now accepts that observed media type alongside the two existing Arrow media
   types.

Remaining live gates:

- multi-chunk external-link pagination;
- a true client-disconnect path through the Worker to terminal vendor state;
- expired-token classification after expiry;
- an induced 429 throttle path;
- a result large enough to exercise cumulative row and byte ceilings without
  exceeding the approved trial budget.

## Snowflake Virtual Warehouse

Profile:

- AWS Snowflake account in `ap-south-1`.
- X-Small `COMPUTE_WH` warehouse.
- Service user `NAKLIDATA_BRIDGE_SVC` with role `NAKLIDATA_READER`.
- Key-pair JWT authentication.
- Read fixture `SNOWFLAKE_SAMPLE_DATA.TPCH_SF1.LINEITEM`.
- The role had warehouse usage and imported privileges on the read-only sample
  database. It had no account-administration role.

Live evidence:

- Worker health, readiness, and one-object inventory returned protocol-v2
  responses.
- Table-query returned Arrow with 5 rows and 16 columns.
- Direct query returned Arrow with 5 rows and 2 columns.
- A write-shaped bridge request stopped at `unsafe_query` before vendor access.
- Snowsight displayed `COMPUTE_WH` as suspended with zero active clusters after
  the matrix.
- The RSA public key was removed and the service user was disabled.
- The former key-pair credential returned HTTP 401 with Snowflake code
  `390101` after revocation.
- A follow-up attempt to reuse the human administrator session for the direct
  write-denial probe stopped at `USE ROLE NAKLIDATA_READER`: Snowflake reported
  that the role is not assigned to the human user. This is not service-identity
  evidence; the probe still requires a fresh, short-lived service credential.
- Snowsight still displayed `$400 of $400 left` after the bounded trial reads.

Live defect found and repaired:

1. Apache Arrow's `vectorFromArray` path performs runtime string compilation.
   Workerd forbids that operation. The bridge now builds UTF-8 vectors from
   explicit offsets, bytes, validity bitmaps, and Arrow data objects without
   runtime code generation.

Remaining live gates:

- an asynchronous statement that requires status polling;
- a complete multi-partition JSONv2 result;
- terminal cancellation through the Snowflake cancel endpoint;
- expired-token, timeout, and 429 throttle distinctions;
- a direct vendor write-denial attempt in addition to the proven bridge parser
  rejection and least-privilege grant layout;
- cumulative result-byte and partition bounds against a larger safe fixture.

## Release consequence

Both live reads now cross the packaged Worker and return valid Arrow. The
matrices are not exhaustive enough to enable either branded card. The checked-
in environments remain `BRIDGE_ADAPTER=unconfigured`, and both product cards
remain unavailable until their remaining profile-specific gates pass.

The generic Iceberg REST card remains independently blocked on the Databricks
Unity Catalog and Snowflake Open Catalog/Polaris catalog matrices.
