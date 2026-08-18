# Compute Bridge operations

## Ownership and release boundary

The NakliData maintainers own the source package, protocol compatibility, and
credential-free conformance tests. The customer deploying the Worker owns its
Cloudflare account, warehouse identity, origin allowlist, secrets, network
policy, monitoring choice, and rollback.

The package follows semantic versioning independently from the browser app.
`BRIDGE_VERSION` must match the deployed package version. A browser release
does not deploy or upgrade a bridge.

The runtime is a Cloudflare Worker in this monorepo. It uses Wrangler's Worker
bundle rather than a container image, process manager, or sibling repository.

The checked-in Worker profile is intentionally unready. Databricks and
Snowflake factories are packaged, but they remain gated on separate live
matrices. Do not change `BRIDGE_ADAPTER` or advertise a vendor capability until
the corresponding adapter gate passes.

## Install a release candidate

1. Select the exact approved repository commit or release tag. Record that ref
   beside the deployment change.
2. Enter `packages/compute-bridge` and run `npm ci`. Do not regenerate the
   lockfile during installation.
3. Run every command under [Validate without deploying](#validate-without-deploying).
4. Create a deployment-specific Wrangler configuration in an ignored location
   or the customer's deployment pipeline. Do not edit the fail-closed checked-in
   environments into live profiles.
5. Set `BRIDGE_VERSION` to the exact package release version. Set the adapter,
   origin, limits, and sanitized vendor JSON as non-secret variables.
6. Add `BRIDGE_AUTH_TOKEN` and the selected warehouse token through interactive
   secret input or the customer's secret manager.

Installation prepares a candidate only. Worker creation, staging deployment,
production deployment, and billable infrastructure retain separate approval.

## Configuration and secrets

1. Set an exact HTTPS browser origin in `ALLOWED_ORIGINS`.
2. Set `BRIDGE_AUTH_TOKEN` through `wrangler secret put`; never place it in
   `wrangler.jsonc`, `.dev.vars.example`, a command argument, source, or logs.
3. Create the warehouse credentials as Worker secrets when a reviewed adapter
   defines their exact binding names.
4. Use a dedicated warehouse identity with no write, DDL, session-management,
   stage, file, extension, or external-access privilege.
5. Restrict that identity and the bridge inventory to the same approved object
   allowlist.

Create a deployment-specific Wrangler configuration from the checked-in file.
Set `BRIDGE_VENDOR_CONFIG_JSON` from the matching sanitized
`config/*.example.json` shape. Keep credentials out of that JSON.

- Databricks: use `BRIDGE_ADAPTER=databricks-sql-warehouse` and set the
  `DATABRICKS_TOKEN` Worker secret.
- Snowflake: use `BRIDGE_ADAPTER=snowflake-virtual-warehouse` and set the
  `SNOWFLAKE_TOKEN` Worker secret.

The opaque `id` is returned to browsers. The `sql_name` remains server-side and
must use a two- or three-part unquoted identifier accepted by the packaged
parser subset. Start `read_only_identity_verified` as false. Change it only
after the live privilege-negative matrix proves the dedicated identity cannot
write.

Production and staging have empty origin allowlists and the `unconfigured`
adapter in source control. This prevents an accidental default deployment from
accepting data requests.

Before configuration review, compare every vendor JSON key with the matching
checked-in example. Runtime parsing rejects undeclared top-level, inventory,
and column keys. Keep a redacted configuration hash with the release evidence;
do not retain an unredacted secret-binding export.

## Validate without deploying

From this package directory:

```bash
npm ci
npm run audit
npm run sbom:check
npm run check
npm test
npm run build
npm run startup
```

`npm run build` invokes `wrangler deploy --dry-run`. It creates a local bundle
only. It does not create a Worker or contact a warehouse.

## Probes

- `GET /v1/health` authenticates the caller and reports protocol identity.
- `GET /v1/ready` returns HTTP 503 until the backend reports ready and declares
  read-only identity, object allowlist, and downstream cancellation controls.
- Data routes repeat the same readiness gate before inventory or query work.

Probe responses never include origin secrets, warehouse credentials, SQL,
object identifiers, signed links, rows, or vendor error bodies.

## Vendor live matrix

Run `npm run live:matrix` only after documenting the exact provider profile,
read-only identity, allowlisted objects, trial or cost ceiling, and teardown
owner. Provide `BRIDGE_LIVE_*` settings through a mode-600 environment file.
The command emits counts, byte totals, classifications, and privacy flags only.

Capture these independent evidence units before enabling a branded adapter:

1. health, readiness, inventory, table read, and direct read;
2. Arrow row/header agreement and a provider-confirmed multi-chunk result;
3. local and provider-side write denial;
4. client abort, bounded recovery, and provider terminal state;
5. result, request, row, and deadline boundaries;
6. expired credential and provider throttling classifications;
7. credential removal, identity deactivation, and stopped compute.

The runtime `MAX_RESULT_BYTES` and `MAX_QUERY_MILLISECONDS` values also bound
vendor adapter fetches. A smaller server ceiling must not wait for a larger
adapter default before rejecting a response.

## Release smoke

After an authorized staging or production deployment, inject these values from
a mode-600 environment file or secret manager:

- `BRIDGE_LIVE_URL`, `BRIDGE_LIVE_ORIGIN`, and `BRIDGE_LIVE_AUTH_TOKEN`;
- `BRIDGE_LIVE_ADAPTER` and the exact `BRIDGE_LIVE_EXPECTED_VERSION`;
- `BRIDGE_LIVE_TABLE_ID` and one allowlisted `BRIDGE_LIVE_DIRECT_SQL` read;
- an optional bounded `BRIDGE_LIVE_ROW_LIMIT`.

Run:

```bash
npm run release:smoke
```

The command requires baseline mode. It rejects a version mismatch before
accepting the candidate. It verifies authenticated health, readiness, limits,
opaque inventory, one structured table read, one parsed direct read, Arrow
media type, byte bounds, and row/header agreement. Its JSON output contains
counts and classifications only. It does not test or perform writes.

Release evidence must also record the vendor privilege-negative result,
credential teardown result, and Cloudflare observability state. The release
smoke does not infer those controls from a successful read.

## Upgrade

1. Record the currently deployed Worker version, repository ref, non-secret
   configuration hash, adapter, allowlist, origin, and limits.
2. Prepare the next exact ref through the installation and credential-free
   validation sequence above.
3. Review configuration differences. A browser-app release does not authorize
   a bridge upgrade or a vendor-profile change.
4. Deploy staging after authorization. Run the release smoke against staging.
5. Promote the same source ref and reviewed configuration shape after separate
   production authorization. Run the release smoke again.
6. Keep the prior source ref and redacted configuration available until the
   observation window closes.

## Deployment and rollback

No deployment is authorized by this package. After separate authorization,
deploy staging first, run the vendor-specific live matrix, then promote the
same version and configuration shape to production. Pin the previous package
version and configuration before promotion.

Rollback means deploying the prior pinned Worker version, restoring its
non-secret variables, and rotating both bridge and warehouse credentials.
Disabling the Worker route or restoring `BRIDGE_ADAPTER=unconfigured` provides
the fail-closed emergency path.

Trigger rollback on a version mismatch, readiness failure, unexpected adapter,
authorization regression, result corruption, limit bypass, secret exposure, or
unbounded provider statement. After rollback, run health and readiness first.
Run the full release smoke only after the prior profile is ready. If the prior
profile cannot be restored without weakening a control, keep the adapter
`unconfigured` and leave the branded card unavailable.

## Runtime lifecycle

The unconfigured Worker opens no database pool, socket, timer, or background
job. Each request owns its deadline controller. Client disconnect and deadline
signals reach the backend contract. A configured adapter must cancel the
downstream statement, poll it to a terminal state, close response bodies, and
release per-request resources before its promise settles.

Cloudflare may terminate an isolate without a process shutdown hook. Adapters
must therefore avoid relying on shutdown callbacks for correctness or secret
cleanup. Keep credentials in Worker bindings and request-local memory.

## Logging and incident handling

Persisted Cloudflare observability, invocation logs, and traces remain disabled
in every checked-in environment. Local audit output contains request ID,
route, method, status, duration, and adapter ID only.

For a suspected credential exposure, disable the Worker route, revoke the
warehouse identity, rotate `BRIDGE_AUTH_TOKEN`, and preserve only metadata-only
request IDs for investigation. Report security issues through the repository's
private vulnerability-reporting channel when enabled; otherwise contact the
repository owner without posting credentials in a public issue.
