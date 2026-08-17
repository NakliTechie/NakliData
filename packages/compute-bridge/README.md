# NakliData Compute Bridge

Customer-deployed Cloudflare Worker package for the
`naklidata-compute-bridge` version 2 protocol.

Current release boundary: Batch 6 packages and tests the transport, auth,
origin, request/result bounds, readiness, disconnect cancellation, Arrow, and
parsed SQL-allowlist foundations. It deliberately configures no warehouse
adapter. Packaged Databricks Statement Execution and Snowflake SQL API factories
are present, but their live evidence and branded availability remain separate
gates.

## Security posture

- The bridge accepts one exact bearer secret through the
  `BRIDGE_AUTH_TOKEN` Worker secret binding. It never belongs in
  `wrangler.jsonc`, source, logs, or Git.
- CORS uses an exact comma-separated `ALLOWED_ORIGINS` allowlist.
- Direct and object queries carry row, byte, request-body, and deadline caps.
- Incoming request cancellation reaches the backend signal. Vendor adapters
  must cancel their downstream statement and poll it to a terminal state.
- Structured audit events contain only request ID, route, method, status,
  duration, and adapter ID. They contain no SQL, object identifier, token,
  result value, row data, or error text.
- Cloudflare-persisted logs and traces are disabled in every checked-in
  environment. Local `wrangler dev` still prints structured audit events to
  the terminal.
- The default adapter is `unconfigured`; health advertises no query capability
  and readiness returns HTTP 503.

## Vendor factories

`BRIDGE_ADAPTER` accepts `databricks-sql-warehouse` or
`snowflake-virtual-warehouse` only in a deployment-specific configuration.
The checked-in development, staging, and production values remain
`unconfigured`.

Both factories consume strict non-secret configuration through
`BRIDGE_VENDOR_CONFIG_JSON`. Sanitized templates live in `config/`. Each
allowlisted object has an opaque browser ID and a separate server-only two- or
three-part SQL name. Quoted or computed identifiers remain unavailable until a
live dialect matrix proves their treatment.

Databricks uses the `DATABRICKS_TOKEN` Worker secret. Snowflake uses the
`SNOWFLAKE_TOKEN` Worker secret. Placeholder values fail closed. A factory may
advertise data readiness only when `read_only_identity_verified` is true;
setting that assertion without privilege evidence violates the deployment
contract.

## Local checks

```bash
npm install
npm run types
npm run check
npm test
npm run build
npm run audit
npm run sbom > sbom.cdx.json
```

Copy `.dev.vars.example` to the ignored `.dev.vars`, then replace the
placeholder through a local secret-management workflow. Production secrets
must be set interactively with `wrangler secret put BRIDGE_AUTH_TOKEN --env
production` and the applicable vendor secret command; never pass a value as a
command argument.

`npm run build` performs a Wrangler dry run only. Deployment, custom-domain
configuration, Worker secret creation, and any billable resource require
separate authorization.

## Routes

- `GET /v1/health` — protocol negotiation and capability disclosure.
- `GET /v1/ready` — adapter readiness and enforced server ceilings.
- `GET /v1/tables` — bounded server-owned inventory.
- `POST /v1/query` — independently parsed and allowlisted direct read.
- `POST /v1/table-query` — opaque inventory identifier resolved server-side.

All routes except CORS preflight require bearer authentication. Successful
query responses use `application/vnd.apache.arrow.stream`.

The browser contract remains canonical in
[`../../docs/compute-bridge-protocol.md`](../../docs/compute-bridge-protocol.md).
