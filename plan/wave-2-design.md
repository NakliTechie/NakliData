# Wave 2 — Iceberg + S3 endpoints — design

Companion to [`remote-sources.md`](./remote-sources.md) (the strategic
context) and [`pending.md`](./pending.md) §"Wave 2". This doc covers
the actual implementation shape and slicing decisions.

---

## Slicing

Three shippable slices, each its own commit + gate pass:

1. **Slice 1 — Public URL mount + CSP broadening.** Wire the latent
   `'http'` SourceKind that the type union already declares. Enable
   the disabled `data-action="mount-url"` button in the shell. CSP
   `connect-src` broadens from explicit-host whitelist to `https:`
   (with reasoning logged). Foundation for slices 2 + 3.
2. **Slice 2 — S3-compatible endpoints (W2.2).** New `'s3-endpoint'`
   SourceKind. BYOK secrets module mirroring `src/core/sidecar/byok.ts`
   (sessionStorage default + opt-in IDB plaintext + Forget). Mount
   form with endpoint URL, region, bucket, path prefix, access key,
   secret. Engine wiring: `SET s3_endpoint / s3_region / s3_access_key_id /
   s3_secret_access_key`; `INSTALL httpfs`.
3. **Slice 3 — Iceberg REST catalogs (W2.1).** New `'iceberg-catalog'`
   SourceKind. Three auth modes: Bearer (simplest, ship first),
   OAuth2 device flow, AWS SigV4 (for Glue). REST API client for
   catalog navigation (list namespaces → list tables → get table
   location). Engine wiring: `INSTALL iceberg`; `SELECT * FROM
   iceberg_scan('<table-uri>')`.

Slice 1 is the prerequisite for both Slice 2 and Slice 3 — they all
need the CSP rework and the URL-mount plumbing.

---

## CSP rework (decision, slice 1)

**Current:** `connect-src 'self' https://cdn.jsdelivr.net https://extensions.duckdb.org https://*.naklitechie.com https://api.anthropic.com https://api.openai.com`

**New (proposed):** `connect-src 'self' https:`

Reasoning:

- The product's value prop in Wave 2 is "point at your S3 endpoint,
  your Iceberg catalog, your data warehouse." Those URLs are user-
  configured and unknown at build time. Explicit-host whitelisting
  is incompatible.
- A meta-CSP-refresh pattern (multiple `<meta>` tags) **only tightens**
  CSP, never relaxes. Build-time CSP is the one we ship.
- `https:` in `connect-src` is broader than the current whitelist but
  still tighter than `*` — it blocks plaintext HTTP exfiltration and
  doesn't allow `data:` / `blob:` URLs for fetch.
- The remaining protections are unchanged:
  - `script-src 'self' 'wasm-unsafe-eval' 'sha256-<inline>'` — locks
    out unauthorised JS execution, the primary XSS vector.
  - `default-src 'self'` — blocks all other request types unless
    explicitly listed.
  - `style-src 'self' 'unsafe-inline'` — same as before.
  - `img-src 'self' data: blob:` — same as before.

**Trade-off acknowledged:** if a successful XSS gets past the
script-src lockdown (e.g. via a future dependency vulnerability),
data exfiltration to arbitrary HTTPS endpoints is possible. We accept
this for Wave 2 because:

1. The script-src protection is the actual primary defence.
2. NakliData runs entirely on data the user has already mounted —
   there's no escalation from "see your data" to "see worse data."
3. The alternative (explicit per-user CSP build) doesn't fit a
   static-HTML deployment.

A future hardening path: a server-side configurator that emits a
per-user CSP. Out of scope for v1.2.

**Logged decision:** new entry in [DECISIONS.md](../DECISIONS.md) at
slice-1 ship time.

---

## Source-kind shape

Common envelope (existing — no change):

```typescript
interface MountedSource {
  id: string;
  kind: SourceKind;
  label: string;
  ref?: string;   // free-form, per-kind interpretation
  tables: MountedTable[];
}
```

Per-kind `ref` semantics:

| Kind | ref | Notes |
| --- | --- | --- |
| `'http'` (slice 1) | the URL or URL prefix | Public, no auth |
| `'s3-endpoint'` (slice 2) | `<endpoint>/<bucket>/<pathPrefix>` | Secrets stored separately |
| `'iceberg-catalog'` (slice 3) | `<catalogUrl>::<namespace>::<table>` | Auth stored separately |

`PersistedSource` already has `ref: string | null` — no schema
change needed at the format layer.

**Persistence of new kinds in `.naklidata`:** per the
[format-version policy](../DECISIONS.md#2026-05-24-1400) (additive
optional fields don't bump), the `'s3-endpoint'` and
`'iceberg-catalog'` kinds add new optional sibling fields on
`PersistedSource` (`endpoint`, `region`, `bucket`, `path_prefix`,
`auth_kind`, etc.) — none required, all default to omitted on older
sources. Format version stays at `1.0`.

---

## BYOK secrets (slice 2 — and reused by slice 3)

Mirror `src/core/sidecar/byok.ts`:

- New module `src/core/secrets/source-secrets.ts`.
- Keys identified by `(sourceId, secretKey)` — e.g.
  `(src_abc123, 'access_key_id')`, `(src_abc123, 'secret_access_key')`.
- Default storage: `sessionStorage`. Cleared on tab close.
- Opt-in IDB plaintext: per-source "Remember on this device"
  checkbox with the same honest labelling as sidecar BYOK ("Anyone
  with access to this browser profile can read it. [Forget]").
- "Forget" action per-source from the source-card UI.
- Per spec amendment [A2](./spec-amendments.md#a2--byok-key-persistence-amends-spec-4-hard-not-2).

Secrets are NOT persisted in `.naklidata` files. Loading a
`.naklidata` with an `'s3-endpoint'` source prompts the user to
re-enter credentials (or restores from IDB if they had opted in).

---

## UI placement

Slice 1: the existing disabled `data-action="mount-url"` button in
`src/ui/shell.ts:166-170` activates. Click opens a small modal:

- Label (user-supplied)
- URL or URL prefix
- "Mount" button → calls `mountUrl(engine, { label, url })`.

Slice 2: a new "Mount remote bucket" button next to "Paste URL".
Same modal pattern with the S3-specific fields.

Slice 3: a new "Mount Iceberg catalog" button. Same modal pattern
with catalog URL + auth-kind picker.

These three live as siblings in the empty-state action grid (and in
the sources-panel's "+ Add source" affordance when sources already
mounted). All four entries: Add folder, Add file, Paste URL, Mount
bucket, Mount Iceberg.

---

## Test posture

Each slice ships with:

- Vitest unit tests for the mount-layer function (`mountUrl`,
  `mountS3Endpoint`, `mountIcebergCatalog`) — pure logic where
  possible; mock the engine for the rest.
- Playwright e2e test covering the mount flow with a fixture (a
  fake httpfs endpoint hosted by the existing test server is
  fine — DuckDB's httpfs path-style is straightforward to mock).

Iceberg's e2e is the trickiest — a real REST catalog response needs
a fixture. Plan: ship a static `tests/e2e/fixtures/iceberg-catalog/`
tree with the minimum REST responses (list namespaces, list tables,
get table metadata) plus a tiny Parquet data file under the same
fixture server.

---

## What's out of scope for Wave 2

- Multi-credential keychain (a user with multiple S3 endpoints sees
  separate per-source credentials, not a shared keychain).
- OAuth2 PKCE flow (only device-flow is in slice 3 — PKCE is a v1.3
  story when we have a proper auth UI).
- IAM role assumption / STS (slice 2 ships with static access keys
  only).
- Custom CA / self-signed certificates (browser TLS only).
- Snowflake / Postgres / BigQuery — that's v2.0 DB Relay territory.

---

## Sequencing today

This sitting starts with Slice 1 (URL mount + CSP). Realistic to
ship slice 1 in a single sitting; slices 2 and 3 are each their own
sitting.
