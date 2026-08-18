# Iceberg REST release gate

Status: pre-release preparation. The public table-by-URL path is available.
Iceberg REST remains unavailable. This document authorizes no credential use,
vendor provisioning, card enablement, deployment, tag, or publication.

## Exact support profiles

Exact profiles live in `src/core/iceberg-rest-release.ts`; their drift-checked
runtime gate lives in `src/core/product-capabilities.ts`. A profile can support
an availability claim only after its own dated live matrix passes.

| Profile ID | Provider boundary | Storage boundary | Current state |
| --- | --- | --- | --- |
| `databricks-unity-catalog-aws` | Databricks Unity Catalog Iceberg REST | AWS S3 | verification pending |
| `snowflake-open-catalog-s3` | Snowflake Open Catalog/Polaris | AWS S3 | verification pending |
| `snowflake-open-catalog-gcs` | Snowflake Open Catalog/Polaris | Google Cloud Storage | verification pending |

Azure/ADLS is excluded. Catalog support does not establish Databricks SQL
Warehouse or Snowflake Virtual Warehouse query support.

## Two-key enablement

`resolveSourceOptions(...)` requires both conditions before the REST card can
become available:

1. at least one exact profile has `readiness: "verified"`; and
2. `SOURCE_RELEASE_FLAGS.icebergRest` is `true`.

The default build has `icebergTable: true` and `icebergRest: false`. Changing
only the flag cannot enable a pending profile. Marking a profile verified while
leaving the flag off also keeps the entry point unavailable.

Enablement sequence:

1. Run the complete live matrix in `warehouse-readiness.md` against the exact
   endpoint, object, identity, and storage profile from
   `iceberg-live-fixture-envelope.md`.
2. Record endpoint ownership, issuance, expiration, cleanup, and revocation
   timestamps without recording credential values.
3. Mark only the passing profile `verified`.
4. Turn on the REST release flag.
5. Regenerate product truth and run unit, production smoke, readiness E2E, and
   the final static/bundle gate.
6. Obtain separate deployment, tagging, and publication authorization.

## Rollback

Set `SOURCE_RELEASE_FLAGS.icebergRest` to `false`, regenerate product truth,
rebuild, and deploy the fail-closed artifact. The table-by-URL flag remains
independent. Rollback does not alter persisted workbooks or delete local data;
it prevents the catalog action before modal loading or network access.

A profile whose live evidence expires or whose cleanup cannot be proved must
also return to `verification-pending`. Disabling the flag is the first response;
profile-state correction prevents an accidental later re-enable.

## Persistence and credentials

- Workbooks may persist catalog URL, namespace, table, and whether bearer
  access is required.
- Bearer values remain in the existing per-source session secret path unless
  the user explicitly opts into the documented BYOK persistence mode.
- Live release matrices must keep persistence off.
- Vended S3/GCS credentials cross only the opaque in-memory target boundary.
- Credentials must not enter workbooks, URLs, screenshots, logs, diagnostics,
  exported artifacts, generated documentation, or Git.
- Source removal, replacement, failure, cancellation, and workspace teardown
  must revoke the lease and clear the corresponding DuckDB secret.

## Supported behavior and limitations

The release matrix covers configuration negotiation, server-selected prefixes,
namespace separators, pagination, namespace/table browsing, load-table,
explicit credential vending, bounded reads, cancellation, refresh, redacted
errors, and zero remote writes.

The client is read-only. It does not create, replace, alter, insert, update,
merge, delete, optimize, or expire remote catalog objects. It does not promise
cross-vendor behavior beyond a separately verified profile. It does not
support Azure/ADLS in the reviewed browser runtime.

## Troubleshooting boundary

- **Card unavailable:** inspect the generated profile states and release flags.
  A pending profile or disabled REST flag is expected to fail closed.
- **Configuration rejected:** confirm the server advertises required endpoints
  and that its prefix and namespace separator pass the client allowlists.
- **Authentication rejected:** use a new short-lived catalog token. Do not paste
  refresh tokens, client secrets, private keys, or object-storage keys into the
  browser.
- **Storage read denied:** verify the vended credential covers only the named
  table prefix and has not expired. Do not broaden the storage role to diagnose
  the problem.
- **CORS, TLS, redirect, or range failure:** repair the endpoint response. Do
  not bypass browser security checks or proxy credentials through NakliData.
- **Cleanup failure:** treat the matrix as failed, keep the card unavailable,
  revoke the vendor identity, and record the failed cleanup step.

## Current evidence

Credential-free Databricks- and Snowflake-shaped fixtures cover protocol and
failure semantics. The public DuckDB Iceberg fixture covers browser data-plane
reads. Neither substitutes for a live vendor catalog matrix.
