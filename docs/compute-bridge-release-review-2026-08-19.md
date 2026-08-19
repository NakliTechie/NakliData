# Compute Bridge release review — 2026-08-19

## Scope

This review covers the packaged Cloudflare Worker, generated bindings,
Wrangler configuration, vendor factories, authentication, request and result
bounds, audit output, release-smoke runner, and operating guidance. It does not
authorize deployment, vendor credentials, a branded source card, tagging, or
publication.

## Current references

- Cloudflare Workers best practices retrieved 2026-08-19:
  <https://developers.cloudflare.com/workers/best-practices/workers-best-practices/>
- Wrangler documentation retrieved 2026-08-19:
  <https://developers.cloudflare.com/workers/wrangler/>
- Latest reviewed Worker types: `@cloudflare/workers-types@5.20260818.1`.
- Local configuration schema and CLI: Wrangler `4.123.0`.

## Review results

### Configuration and identity

- `wrangler.jsonc` uses JSONC, a 2026-08-17 compatibility date,
  `nodejs_compat`, separate staging and production environments, generated
  `Env` types, and an `unconfigured` default adapter.
- Checked-in environments contain no secret binding values. Runtime factories
  load warehouse credentials only from `DATABRICKS_TOKEN` or
  `SNOWFLAKE_TOKEN`.
- Strict vendor configuration now rejects undeclared adapter, inventory, and
  column keys.
- Runtime origin validation now accepts HTTPS origins and loopback HTTP only.
  A non-loopback HTTP origin, a path-bearing URL, or embedded URL credentials
  fails configuration.
- `BRIDGE_AUTH_TOKEN` comparison hashes both inputs to a fixed size and uses
  `crypto.subtle.timingSafeEqual`.

### Request, result, and lifecycle controls

- Request JSON is streamed into a bounded buffer with both declared-length and
  observed-byte checks.
- Direct SQL is parsed for one read statement and every physical table must be
  allowlisted. Structured table reads resolve opaque IDs server-side.
- Row, result-byte, request-byte, and deadline limits are enforced before a
  successful response.
- Client abort and deadline signals reach vendor adapters. Adapter cores own
  provider cancellation and terminal polling.
- The handler keeps no mutable request state at module scope. Async provider
  work is awaited. `passThroughOnException` is absent.
- Audit events contain request metadata only. Persisted Cloudflare logs and
  traces remain disabled by product policy, despite Cloudflare's general
  recommendation to enable observability.

### Supply chain and package

- The npm high-severity advisory gate reports zero vulnerabilities.
- The CycloneDX check identifies 26 production components.
- Generated Worker types match the current configuration.
- The fail-closed dry-run bundle is 1,344.35 KiB and 225.09 KiB gzip.
- The local startup profile sampled 12.1 ms active time.
- The version-pinned release-smoke fixture covers matching and stale Worker
  versions without emitting SQL, secrets, or row values.
- The package check now runs the production Arrow implementations against an
  8 MiB synthetic memory envelope. It validates retained ArrayBuffer headroom
  while reporting Node RSS, heap, external, and ArrayBuffer deltas.
- Snowflake UTF-8 construction writes directly into final column buffers. The
  same 8,986,872-byte Arrow fixture reduced retained RSS delta from 128,729,088
  bytes to 41,959,424 bytes. Repeated runs remained below 42 MiB.

## Open release conditions

1. **Deployed memory envelope.** Cloudflare documents a 128 MiB Worker memory
   limit. Databricks chunk assembly still parses all Arrow chunks before
   concatenation and serialization. Snowflake still retains JSON rows while
   constructing final Arrow buffers, although per-cell UTF-8 buffers are gone.
   A 32 MiB local diagnostic recorded retained RSS deltas of 101,875,712 bytes
   for Databricks and 114,343,936 bytes for Snowflake. A result-byte limit does
   not prove peak heap usage. Measure a deployed staging Worker at the intended
   `MAX_RESULT_BYTES` before enabling a branded card. Keep the checked-in 32 MiB
   default until that evidence exists.
2. **Databricks live gap.** Record live HTTP 429 without unsafe pressure. The
   post-budget-wiring 1 MiB result-limit rerun passed after a live-discovered
   byte-truncation repair. The expired-bearer matrix returned Databricks'
   observed HTTP 403 `authorization_denied` after a bodyless-error repair.
   Databricks remains setup-only and may consume existing trial credits only.
   Principal activation and credential creation require action-time approval.
3. **Snowflake live gap.** Record a real HTTP 429 without unsafe request
   pressure. A provider-cancelled disconnect remains optional unless release
   copy promises it.
4. **Deployed release smoke.** After an authorized staging deployment, run
   `npm run release:smoke` with the exact bridge version and one approved object.
5. **Release authority.** Obtain separate authorization for staging deploy,
   production deploy, card enablement, tag, and publication.

## Commands executed

- `npx wrangler --version` — `4.123.0`.
- `npm run audit` — exit 0, zero vulnerabilities.
- `npm run sbom:check` — exit 0, 26 named components.
- `npm test` — exit 0, 30 Workers-runtime tests and 6 runner fixtures.
- `npm run check` — generated types, TypeScript, Biome, configuration, and
  8 MiB retained-ArrayBuffer memory gate.
- `BRIDGE_MEMORY_PROBE_BYTES=33554432 npm run memory:probe` — exit 0; local
  diagnostic only.
- `npm run build` — dry run only; no deployment.
- `npm run startup` — local profile only.
