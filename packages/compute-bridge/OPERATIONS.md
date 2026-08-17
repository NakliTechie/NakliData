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

Batch 6 ships an unconfigured Worker foundation. It is intentionally unready.
Databricks and Snowflake factories remain gated on their separate live
matrices. Do not change `BRIDGE_ADAPTER` or advertise a vendor capability until
the corresponding adapter gate passes.

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

Production and staging have empty origin allowlists and the `unconfigured`
adapter in source control. This prevents an accidental default deployment from
accepting data requests.

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

## Deployment and rollback

No deployment is authorized by this package. After separate authorization,
deploy staging first, run the vendor-specific live matrix, then promote the
same version and configuration shape to production. Pin the previous package
version and configuration before promotion.

Rollback means deploying the prior pinned Worker version, restoring its
non-secret variables, and rotating both bridge and warehouse credentials.
Disabling the Worker route or restoring `BRIDGE_ADAPTER=unconfigured` provides
the fail-closed emergency path.

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
