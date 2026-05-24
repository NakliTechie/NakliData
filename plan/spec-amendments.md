# Spec amendments

Tracked divergences from the canonical spec (`02-SPEC.md` as uploaded with the original handoff). Each amendment names the section being amended, gives the new wording, and the reasoning.

The original spec stays authoritative for everything not listed here.

---

## A1 — Persistent workspace state (amends spec §2.3)

**Original wording (paraphrased from §2.3):**
> IndexedDB holds FSA handles, session state, query result cache. sessionStorage holds BYOK keys.

The implicit reading was "no persistence beyond `.naklidata` files + ephemeral session state." That reading was wrong.

**Amended:**
> Workspace state — sources, column assignments, notebook cells, settings, FSA folder handles — **persists across tabs via IndexedDB**, plus the FSA permission the user has already granted. On tab open, the previous workspace is auto-restored. FSA-folder permission is re-verified silently when granted by user activation, and a "Reconnect" banner is shown otherwise. `.naklidata` files remain the explicit, portable export.

**Why:** Asking the user to restart from zero each session is a non-starter UX-wise. The privacy posture ("data never leaves the tab") is unchanged — persistence is local-only, same origin.

**Status:** Theme 3 in `pending.md`. The scaffolding (`src/core/idb.ts`, `src/core/settings.ts`, `src/core/handles.ts`) already exists; the boot-time auto-restore is the unwired piece.

---

## A2 — BYOK key persistence (amends spec §4 Hard NOT #2)

**Original wording (§4 item 2):**
> No persistent storage of BYOK keys.

This was the right *default* but the wrong *absolute*. Re-entering an API key every tab is friction users won't tolerate.

**Amended:**
> **No silent persistent storage of BYOK keys.** Keys live in `sessionStorage` by default (cleared on tab close). Persistent storage to IndexedDB requires explicit user opt-in per key, with the UI labelling the storage state honestly:
> - **v1.1 default (option A):** "Remember on this device" checkbox at entry time, defaults OFF. When checked, the key is stored plaintext in IndexedDB on the current origin. The UI tells the user clearly: "Stored on this device. Anyone with access to this browser profile can read it. [Forget]"
> - **v1.2 enhancement (option B):** opt-in passphrase-encrypted persistence. Key encrypted with a PBKDF2-derived AES-GCM key. Each new session: user enters the passphrase (not the long API key) to unlock.
> - A "Forget all stored keys" action lives in settings, available at any time.

**Why:** Same-origin JS can always read same-origin storage; "encrypted in IDB" with an on-origin key (PondPilot's posture) is largely theatre. The honest position is:
- Default to no-persistence (sessionStorage).
- Allow opt-in plaintext with clear labelling.
- Offer passphrase-encryption later as an opt-in for users on shared machines or with stronger threat models.

**Status:** v1.1 sidecar work in `pending.md`. Option B is parked for v1.2.

---

## A4 — Data-plane / control-plane distinction (amends spec §4.1)

**Original wording (§4.1):**
> v1.1 adds remote-source mounting: Public URL mount, public data catalog, Private bucket via Relay (Cloudflare Worker URL signing).

This framed v1.1's remote-source story as a single capability ("private bucket reads"). It conflated *where the bytes live* with *where the queries execute*.

**Amended:**
> NakliData's architecture has two planes:
>
> - **Control plane** — the UI, SQL editor, schema panel, taxonomy, classification, and action sinks. Always runs in the browser tab. This is what NakliData *is*.
> - **Data plane** — where bytes live and where queries execute. NakliData supports three data-plane modes; a single session can mix them:
>   1. **Browser-DuckDB** (v1.0, shipped) — DuckDB-wasm in the same browser tab. Best for small data, local-mount workflows.
>   2. **Signed-URL Relay** (v1.1, spec §4.1 + §4.2) — Stateless Cloudflare Worker signs S3/GCS/Azure URLs; browser fetches directly. Best for personal-scale signed reads.
>   3. **Compute Bridge** (v1.3+, see [enterprise-strategy.md](./enterprise-strategy.md)) — User-deployed binary running inside the customer's VPC. Browser becomes thin client over Arrow Flight / HTTP. Bytes never leave the VPC. Best for enterprise compliance, TB-scale, multi-team taxonomy.
>
> The three data-plane modes interoperate. Source kinds are tagged with which mode they use; the schema panel and sinks see all of them uniformly.

**Why:** Without this distinction, enterprise conversations devolve into "but NakliData doesn't fit my compliance requirements" when in fact the v1.3 Compute Bridge mode is being designed precisely for that case. Making the planes explicit lets us add data-plane modes (DB Relay, edge compute, etc.) without retroactively reframing the product.

**Status:** Documented across [remote-sources.md](./remote-sources.md), [enterprise-strategy.md](./enterprise-strategy.md), and [sidecar-architecture.md](./sidecar-architecture.md) (for the matching split-sidecar architecture). v1.3 Compute Bridge MVP is the implementation milestone.

---

## A3 — Project name and file extension

**Original wording (vision):**
> Working codename. Final name deferred per standing rule. Leading candidates: Nazariya, Lens, Prism.

**Amended:**
> Product name is **NakliData**. File extension for saved notebooks is **`.naklidata`** (format ID `"format": "naklidata"`).

**Status:** Done. Sweep rename committed (DECISIONS.md 2026-05-16 03:30).

---

## A5 — Public URL mount (Wave 2 slice 1) + CSP broadening (amends spec §4.1, §7.1)

**Original §4.1 (paraphrased):**
> v1.1 adds remote-source mounting: Public URL mount, public data catalog, Private bucket via Relay.

The "Public URL mount" was declared but never wired in v1.1 — the `'http'` `SourceKind` is in the type union but no code path implements it. v1.1 shipped only `example-bundle`, `fsa-folder`, `fsa-file`. Wave 2 slice 1 closes the gap.

**Original §7.1 (paraphrased):**
> CSP: `default-src 'self'`; explicit-host `connect-src` whitelist (jsdelivr CDN, extensions.duckdb.org, *.naklitechie.com, anthropic, openai).

The explicit-host whitelist is incompatible with the Wave 2 product proposition ("point at your S3 endpoint, your Iceberg catalog, your data warehouse" — all user-configured at runtime).

**Amended:**

> **Public URL mount.** A new `mountUrl(engine, { url, label? })` entry point registers a remote HTTPS resource as a DuckDB view via the format-appropriate `read_*` function. Slice 1 supports `csv`, `tsv`, `jsonl`, `parquet` — the four readers that ship in DuckDB-wasm without an extension load. Authenticated S3 endpoints (slice 2) and Iceberg REST catalogs (slice 3) build on the same plumbing. The UI exposes this via the "Paste URL" empty-state action (no longer disabled) and a small modal that captures URL + optional label.
>
> Persistence: `'http'` sources round-trip in `.naklidata` files. `PersistedSource.ref` holds the URL; on re-mount, `applyLoadedFile` calls `mountUrl(engine, { url: ps.ref, label: ps.label })`. Failure (network, 404, format change) surfaces as a reconnect prompt rather than tanking the whole load.
>
> **CSP `connect-src` broadens from explicit-host whitelist to `'self' https:`.** The remaining CSP directives are unchanged:
>
> - `default-src 'self'` — blocks all other request types unless explicitly listed.
> - `script-src 'self' 'wasm-unsafe-eval' 'sha256-<inline>'` — primary XSS defence; unchanged.
> - `worker-src 'self' blob:` — unchanged.
> - `img-src 'self' data: blob:` — unchanged.
> - `style-src 'self' 'unsafe-inline'` — unchanged.

**Why:** A meta-CSP-refresh pattern (multiple `<meta>` tags) only tightens CSP, never relaxes — it can't help here. Per-user / per-deployment CSP would require a build-time configurator, which doesn't fit a static-HTML deployment. `https:` in `connect-src` is broader than the prior whitelist but still tighter than `*` (blocks plaintext HTTP, `data:` / `blob:` fetches). The trade-off is acknowledged: a future XSS that bypassed the SHA-pinned `script-src` could exfiltrate to any HTTPS host. The mitigations are (1) the script-src protection is the actual primary defence, (2) the user has explicitly authorized the URLs they point at, (3) the alternative — building per-user CSP — defeats the static-shell deployment model.

**Status:** Wave 2 slice 1 shipped (commit on 2026-05-24). Slice 2 (S3 endpoints) and Slice 3 (Iceberg REST catalogs) build on this foundation without further CSP changes. Full reasoning in [DECISIONS 2026-05-24 — Wave 2 slice 1](../DECISIONS.md).

---

## A6 — S3-compatible custom endpoints (Wave 2 slice 2) (amends spec §4.1)

**Original §4.1 (paraphrased):**
> Private bucket via Relay: stateless Cloudflare Worker that signs S3 / GCS / Azure URLs on behalf of the user. Credentials session-only.

The Relay was a v1.1 design for browser-incompatible auth (back when DuckDB-wasm couldn't sign S3 requests itself). DuckDB's httpfs extension now does SigV4 natively in the browser, so the Relay primitive is unnecessary for the common S3 case. The "credentials session-only" posture survives — see A2 for the BYOK shape.

**Amended:**

> **S3-compatible custom endpoints.** A new `'s3-endpoint'` `SourceKind` connects to AWS S3, MinIO, Cloudflare R2, Backblaze B2, Wasabi, or any other S3-API-compatible store. `Engine.configureS3({ endpoint, region, accessKeyId, secretAccessKey, urlStyle })` installs the DuckDB `httpfs` extension and applies the `SET s3_*` config; `Engine.registerS3Url({ tableName, s3Url, format })` creates the view via `read_<format>('s3://bucket/path')`. Browser fetches via DuckDB's SigV4 signing — Relay no longer needed for the common case.
>
> **Source-secrets BYOK** (`src/core/secrets/source-secrets.ts`). Per-source credential storage mirrors the sidecar BYOK pattern (A2): `sessionStorage` default, opt-in IndexedDB plaintext with honest labelling, `forgetSource(sourceId, names)` cleanup when a source is removed. Identifiers are `(sourceId, secretName)` so a single source can hold multiple named secrets (s3-endpoint uses `access_key_id` + `secret_access_key`).
>
> **`.naklidata` round-trip.** A new optional `s3` field on `PersistedSource` carries the endpoint config (`endpoint`, `region`, `bucket`, `path_prefix`, `url_style`). **Secrets are never persisted in the file.** On load, `applyLoadedFile` looks up the secrets via `source-secrets`; if missing (new session, no IDB opt-in, or "Forget" was clicked), the source moves to `reconnectNeeded` rather than mounting. Additive field — no `.naklidata` format-version bump per the policy in DECISIONS 14:00.
>
> **Slice 2 limitation: one set of S3 credentials per session.** DuckDB's `SET s3_*` is connection-wide; mounting a second `s3-endpoint` source with different credentials clobbers the first. Documented in the modal hint. A future enhancement can move to DuckDB's `CREATE SECRET` (which supports per-secret scoping) once the wasm build catches up.

**Why:** A real-world bucket mount needs three things — endpoint config, credential storage, and the engine plumbing. We had none of them shipped; the v1.1 Relay design was over-scoped (a Cloudflare Worker for what DuckDB-wasm can now do itself). Slice 2 ships the focused minimum: connect, authenticate, read. The Relay primitive (spec §4.2) is parked for the harder cases it was actually designed for (GCS / Azure SAS signing, or environments where the user can't share credentials with the browser).

**Status:** Wave 2 slice 2 shipped 2026-05-24 (commit on `main`). Slice 3 (Iceberg REST catalogs) reuses the source-secrets module + the CSP `https:` allowance from slice 1. Full reasoning in [DECISIONS 2026-05-24 15:30 — Wave 2 slice 2](../DECISIONS.md).

---

## A7 — Iceberg table-by-URL with Bearer auth (Wave 2 slice 3a) (amends spec §3.1, §4.1)

**Original §3.1 (paraphrased):**
> Supported formats: CSV, TSV, JSONL, Parquet, plus extension-loaded SQLite, DuckDB, Excel, SPSS/Stata/SAS.

**Original §4.1 (paraphrased):**
> Apache Iceberg is not in scope for v1.x. Remote sources are signed-URL only.

DuckDB-wasm gained working Iceberg support in Dec 2025 (`INSTALL iceberg; LOAD iceberg; SELECT * FROM iceberg_scan('<url>')` works in the browser). Closing the gap is now cheap.

**Amended:**

> **Apache Iceberg tables are a supported source kind.** A new
> `'iceberg-table'` `SourceKind` mounts a single Iceberg table identified
> by the URL of its `metadata.json` (or directory whose latest snapshot
> DuckDB resolves). `Engine.configureIceberg({ bearerToken })` installs
> the `iceberg` extension and, if a token is supplied, sets
> `extra_http_headers = MAP { 'Authorization': 'Bearer <token>' }` for
> the subsequent httpfs reads. `Engine.registerIcebergTable({ tableName,
> metadataUrl })` creates the view via `iceberg_scan('<url>')`.
>
> **Slice 3a — Bearer + URL only.** This first slice supports table-by-URL
> with an optional Bearer token. Use cases: public Iceberg tables on
> CORS-enabled buckets; private S3-backed Iceberg tables when the user
> has already mounted the bucket via "Mount bucket" (S3 credentials are
> connection-wide); REST-catalog-managed tables where the user knows
> the direct metadata URL.
>
> **Slice 3b (queued) — REST catalog navigation + OAuth2 + SigV4.** A
> companion `'iceberg-catalog'` `SourceKind` with a REST client for
> namespace + table picking and the three auth modes
> (Bearer / OAuth2 device flow / AWS SigV4 for Glue). Deferred to a
> separate sitting — the OAuth device flow alone is non-trivial UX.
>
> **BYOK Bearer token.** Same posture as A2 + A6: sessionStorage default
> + opt-in IDB plaintext with honest labelling. Secret name is
> `bearer_token` (singular). Empty/whitespace token = public table; no
> secret is saved.
>
> **`.naklidata` round-trip.** New optional `iceberg` field on
> `PersistedSource` (`metadata_url`, `requires_bearer`). Token stays in
> `source-secrets`. On load, if `requires_bearer` is true and no secret
> is found, the source moves to `reconnectNeeded`. Additive field —
> no format-version bump.

**Why now:** Wave 2's existing infrastructure (`source-secrets`, CSP
`https:`, modal pattern) covers the table-by-URL case at ~250 lines of
new code. The REST catalog + OAuth2 + SigV4 surface multiplies that by
several × — splitting into 3a + 3b lets us ship the common case
without the OAuth UX burden.

**Status:** Slice 3a shipped 2026-05-24 (commit on `main`). Slice 3b
queued in [`wave-2-design.md`](./wave-2-design.md). Full reasoning in
[DECISIONS 2026-05-24 — Wave 2 slice 3a](../DECISIONS.md).

---

## A8 — Iceberg REST Catalog navigation (Wave 2 slice 3b) (amends spec §4.1)

**Original §4.1 (paraphrased):**
> Remote sources are signed-URL only.

A7 added table-by-URL mounting; this amendment adds the REST Catalog
discovery path for the same backing extension.

**Amended:**

> **Iceberg REST Catalog source kind.** A companion `'iceberg-catalog'`
> `SourceKind` mounts an Iceberg table identified by `(catalogUrl,
> namespace, table)`. A REST client (`src/core/iceberg/rest-client.ts`)
> implements just enough of the OpenAPI surface for the picker flow:
> `GET /v1/config`, `GET /v1/namespaces`, `GET /v1/namespaces/{ns}/tables`,
> `GET /v1/namespaces/{ns}/tables/{table}` (resolves
> `metadata-location`). Nested namespaces collapse into a single path
> segment joined by U+001F per the REST spec.
>
> **Mount flow.** `mountIcebergCatalog(engine, opts)` calls the REST
> client to resolve `metadata-location`, then hands off to the same
> engine path slice 3a uses (`configureIceberg` + `registerIcebergTable`).
> Re-mount via `.naklidata` reload re-resolves through the catalog so
> fresh snapshots pick up automatically — the persisted state holds the
> catalog coordinates, not the URL of the metadata at save time.
>
> **Slice 3b ships Bearer auth only.** OAuth2 device flow + AWS SigV4
> (for Glue) are queued for v1.3 alongside the multi-tenant work in
> [enterprise-strategy.md](./enterprise-strategy.md). The OAuth UX
> (device code prompt + polling) needs its own modal flow + token
> refresh handling — separate sitting.

**Why now:** The table-by-URL flow (3a) covers private S3-backed
Iceberg tables, but it requires the user to know the exact
metadata.json URL. Catalog navigation is what users actually expect
("connect to my Iceberg catalog, pick a table"). The REST client is
~100 lines + the modal is ~150 — modest cost for the user-visible
delta.

**Status:** Slice 3b shipped 2026-05-24 (commit on `main`). The
OAuth2 + SigV4 surface stays in [`wave-2-design.md`](./wave-2-design.md)
under "Deferred."

---

## Future amendments live here

Every spec deviation lands in this file with the same shape: original wording → amended wording → reasoning → status. Future-us reading the original spec doc should be able to cross-reference here to see what's still authoritative and what's been refined.
