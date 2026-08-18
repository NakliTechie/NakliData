# Compute Bridge security boundary

## Threat model

The Worker treats browser input, SQL text, object identifiers, vendor
responses, Arrow bytes, and request headers as untrusted. It assumes HTTPS
terminates at Cloudflare. It does not treat CORS, bearer authentication, or the
browser SQL guard as a warehouse authorization boundary.

The bridge defends against unauthorized origins, guessed or leaked endpoints,
write-capable SQL, cross-object reads, oversized requests and results,
unbounded execution, credential forwarding to signed links, sensitive error
reflection, and abandoned downstream statements.

## Mandatory controls

- Authenticate every non-preflight route with one exact bearer token.
- Allow browser origins only through an exact origin set.
- Parse direct SQL with the selected vendor dialect.
- Accept exactly one read query whose physical tables all occur in the server
  allowlist.
- Resolve `qualified_name` through server-owned inventory.
- Reject write, DDL, session, stage, external-file, extension, and external
  access syntax.
- Use a warehouse principal whose grants cannot perform writes.
- Enforce request bytes, result bytes, row count, and execution deadline.
- Propagate disconnect and deadline aborts through the adapter.
- Return generic bounded failures without upstream bodies, credentials, SQL,
  signed URLs, object identifiers, or result values.
- Emit metadata-only local audit events.

The backend readiness contract requires explicit declarations for a read-only
identity, object allowlist, and terminal downstream cancellation. Any false
declaration makes health unready and blocks all data routes. These declarations
are deployer assertions until a vendor live matrix independently proves them.

## SQL subset

The package uses `node-sql-parser` ASTs rather than keyword-only acceptance.
Snowflake uses the parser's native dialect. Databricks uses a conservative
Flink/Spark-family subset until its live Statement Execution matrix expands it.
The Worker imports only these two dialect builds. Unsupported syntax fails
closed.

The parser boundary supplements warehouse grants. Parser acceptance never
authorizes an object absent from the configured table allowlist.

## Data and telemetry

The bridge returns successful query data only as bounded Apache Arrow IPC
streams. It does not persist requests, SQL, rows, result values, credentials,
or vendor error bodies. Checked-in Cloudflare observability remains disabled.
Customers who enable external logging assume responsibility for maintaining
the same metadata-only boundary.

The browser-facing `BRIDGE_AUTH_TOKEN` and warehouse credentials have separate
trust boundaries. A browser may retain its bridge bearer through NakliData's
documented source-secret posture. It never receives `DATABRICKS_TOKEN` or
`SNOWFLAKE_TOKEN`. Those values exist only as Worker secret bindings and
request-local adapter state. `BRIDGE_VENDOR_CONFIG_JSON` accepts only declared
non-secret keys at every parsed level; unknown fields fail closed.

## Supply chain

Production dependencies are pinned in `package-lock.json`. CI runs the high
severity advisory gate, validates a CycloneDX production SBOM, checks generated
Worker binding types, validates fail-closed configuration, executes the Workers
runtime conformance suite, and creates a dry-run bundle.

## Out of scope in Batch 6

This package contains concrete but disabled Databricks and Snowflake adapter
factories. It contains no configured adapter, live vendor credential, deployed
endpoint, custom domain, customer account integration, or branded availability
claim. Batches 7 and 8 retain their live-evidence gates.
