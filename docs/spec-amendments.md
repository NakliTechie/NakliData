# Spec amendments

Tracked divergences from the canonical spec (`02-SPEC.md` as uploaded with the original handoff). Each amendment names the section being amended, gives the new wording, and the reasoning.

The original spec stays authoritative for everything not listed here.

## Index

| ID | What it amends | One-line summary |
| --- | --- | --- |
| [A1](#a1--persistent-workspace-state-amends-spec-23) | §2.3 | IndexedDB persists workspace state (sources, assignments, cells, sessions) — not just FSA handles + cache. |
| [A2](#a2--byok-key-persistence-amends-spec-4-hard-not-2) | §4 Hard NOT #2 | BYOK keys are sessionStorage default + opt-in plaintext IDB with a Forget affordance; v1.2 passphrase-encrypted variant planned. |
| [A3](#a3--project-name-and-file-extension) | Project name | "NakliData" + `.naklidata` save-file extension (was unspecified). |
| [A4](#a4--data-plane--control-plane-distinction-amends-spec-41) | §4.1 | Five data-plane modes (local, signed-URL, S3 endpoint, Iceberg, Compute Bridge); a NakliData server is not part of the data plane. |
| [A5](#a5--public-url-mount-wave-2-slice-1--csp-broadening-amends-spec-41-71) | §4.1, §7.1 | Public URL mount; CSP broadened to `connect-src 'self' https:` (was an explicit-host whitelist). |
| [A6](#a6--s3-compatible-custom-endpoints-wave-2-slice-2-amends-spec-41) | §4.1 | S3-compatible endpoints (AWS, R2, MinIO) with anon or signed access; httpfs extension does the I/O. |
| [A7](#a7--iceberg-table-by-url-with-bearer-auth-wave-2-slice-3a-amends-spec-31-41) | §3.1, §4.1 | Apache Iceberg by URL (catalog-less) with optional Bearer auth. |
| [A8](#a8--iceberg-rest-catalog-navigation-wave-2-slice-3b-amends-spec-41) | §4.1 | Iceberg REST catalog navigation (Bearer auth supported). |
| [A9](#a9--custom-endpoint-sidecar-provider-wave-2-w23-amends-spec-43) | §4.3 | Custom OpenAI-compatible sidecar endpoint (llamafile, vLLM, Ollama). |
| [A10](#a10--job-4-report-template-recommendation-wave-3--w31-amends-spec-43) | §4.3 | Sidecar Job 4: rank candidate report templates against current schema. Hallucination guard in parser, not just prompt. |
| [A11](#a11--local-model-sidecar-provider-wave-3--w32-amends-spec-43--43a) | §4.3 + §4.3a | `local` runtime seam wired through dispatch; runtime not bundled in v1.1; fails fast rather than silent fallback because picking local is a privacy choice. |
| [A12](#a12--compute-bridge-source-kind-client-side-wave-3--w34a-amends-spec-41) | §4.1 | Compute Bridge source kind, client side. Browser↔bridge wire is HTTP + Arrow IPC (not Flight); health-check before SQL. W3.4b follow-up: catalog picker SourceKind that materialises N tables via SELECT * LIMIT cap. |
| [A13](#a13--optional-map-cell-basemap-wave-1-stretch--w16-amends-spec-31--6) | §3.1, §6 | Optional OpenStreetMap raster basemap on map cells. Default off — tile-less canvas preserves the no-third-party-fetch posture. Explicit opt-in via Settings; CSP `img-src` carves out `tile.openstreetmap.org` only. |
| [A14](#a14--three-tier-duckdb-wasm-bundle-source-w182--cloudflare-deploy-amends-spec-71) | §7.1 | DuckDB-wasm bundle sourcing: three-tier (same-origin → GH Pages canonical → jsDelivr). Pre-fetch SRI dropped because the blob-pre-wrap it required broke cross-blob worker access in current Chrome. Trust = version pin + build-time SHA-384 verify against `integrity.json`. |
| [A15](#a15--sensitivity-field-on-typespec-w54-amends-spec-32) | §3.2 | Each `TypeSpec` carries a `sensitivity: 'public' \| 'pii' \| 'financial' \| 'secret'` field. Schema panel renders a badge on non-public types. Substrate for future demo-mode + sidecar prompt redaction. |
| [A16](#a16--four-new-cell-kinds-cohort-assertion-input-dashboard-amends-spec-33) | §3.3 | Spec §3.3 originally listed five cell kinds (SQL / chart / markdown / pivot / map). Now nine: + cohort (W4.4, dbt-tests adjacent) + assertion (W5.5, invariant check) + input (W6.1, Observable viewof) + dashboard (W6.4, Superset grid). |
| [A17](#a17--presentation-mode-w62-amends-spec-38) | §3.8 | `?present=1` URL param flips the app into a read-only "deck" view via the `app-present-mode` class. Hides editor chrome (sidebars, toolbar, cell-add row, SQL/cohort/assertion cells, per-cell heads). Hex app-publish pattern. |
| [A18](#a18--static-html-export-w63-amends-spec-34) | §3.4 | New notebook-level export sink: "Save HTML" header button serialises the live notebook DOM into a single self-contained `.html` file (~3 KB embedded CSS, no JS, no engine). Evidence Dev pattern. |
| [A19](#a19--lens-auto-mount-confirmation-v122-amends-spec-38) | §3.8 | `?lens=` share links containing remote-source kinds (http / s3 / iceberg / bridge) now gate auto-mount behind a confirmation modal listing every host the link would fetch from. Closes the SSRF channel (forward-pass H1). |
| [A20](#a20--postinstall-hash-pin-protocol-v122-amends-spec-71) | §7.1 | Postinstall vendoring (DuckDB-wasm + extensions) sha384-verifies downloaded bytes against the checked-in `integrity.json` on every run. Mismatch → exit 1 with "supply-chain alert". Closes the install-time tamper window (forward-pass H6). |
| [A21](#a21--bearer-token-charset-v122-amends-spec-41) | §4.1 | Bearer tokens passed to iceberg + bridge endpoints must match RFC 7235 token68 charset (`[A-Za-z0-9._~+/=-]+`). CR/LF / whitespace / quotes rejected with `InvalidBearerTokenError`. Closes the header-injection channel (forward-pass M1). |
| [A22](#a22--csp-defence-in-depth-v122-amends-spec-71) | §7.1 | CSP gains `base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'`. base-uri closes the `<base href>` exfil channel script-src doesn't cover; the others harden against post-XSS escape vectors (forward-pass H7). |
| [A23](#a23--nl-to-sql-parser-safety-contract-v122-amends-spec-43) | §4.3 | NL→SQL Job 5 parser now guarantees: (1) only `SELECT` / `WITH … SELECT` accepted; (2) write/DDL/session-mutating keywords rejected (INSTALL/LOAD/SET/RESET/USE added); (3) multi-statement responses rejected; (4) single-quoted FROM (replacement-scan) rejected; (5) every FROM/JOIN identifier must be in the table allowlist, with comma-join + alias support and LATERAL/UNNEST/TABLE/VALUES/PIVOT correctly treated as keywords. Closes forward-pass H2 + H3 + code-review follow-ups. |
| [A24](#a24--local-runtime-shipped-w32-slice-b-amends-spec-43--43a) | §4.3 + §4.3a | W3.2 slice B ships the local runtime (deferred since v1.1). Transformers.js + ONNX in-browser inference against a curated 3-model list (Qwen2.5-1.5B / Phi-3.5-mini / Llama-3.2-1B). Weights cache in OPFS via a custom adapter (chunk 1) replacing the spec's "~50 MB OPFS cache" aspiration with the real 0.7–2.3 GB per model. Auto-loads on boot when cached; explicit "Download & load" otherwise. |
| [A25](#a25--anonymized-export-sink-v12-m1-amends-spec-34) | §3.4 | New sink "Export anonymized" applies per-column anonymisation strategies (keep / hash / redact / bucket / drop) via DuckDB SQL projection rewrite, with defaults driven by the §3.2 sensitivity badge. Writes a JSON manifest alongside the data file. Salt is per-export, generated by `crypto.getRandomValues`, displayed once, never persisted. |
| [A26](#a26--cell-lineage-tracker-v12-m2-amends-spec-33--38) | §3.3 + §3.8 | Every SQL/cohort/assertion cell remembers its upstream inputs (mounted tables, upstream cells, inline file paths) via DuckDB `EXPLAIN (FORMAT JSON)` plan walking, with a regex fallback for cells that didn't parse. Graph persists into `.naklidata`. New "Lineage" header button opens a panel with both an accessible list view + a hand-rolled SVG (no D3 / no React-Flow). |
| [A27](#a27--incremental-refresh-v12-m3-amends-spec-41--38) | §4.1 + §3.8 | Per-source fingerprint (FSA: size+lastModified; HTTP: ETag+Last-Modified+Content-Length; others: unsupported sentinel). New "Refresh" header button: HEAD all sources, diff vs persisted fingerprints, cascade stale set via M2 lineage, re-run affected cells. User-initiated only — no background polling. |
| [A28](#a28--sidecar-job-7-propose-chart-v12-m4-amends-spec-43) | §4.3 | 7th sidecar job `propose-chart` — input: SQL + result columns + 10 sample rows; output: strict JSON `ChartProposal` (chartType from an 8-value allowlist + xColumn/yColumn/groupColumn from the input columns + title ≤ 80 chars). No prose narration. New "Suggest chart" chip on SQL cell results materialises the proposal as a chart cell. |
| [A29](#a29--visual-query-builder-v12-m5-amends-spec-33--38) | §3.3 + §3.8 | New "Build query" header button opens a form-based query builder: source table + optional single JOIN + AND-joined filters + LIMIT + GROUP BY + aggregates. Pure SQL emitter routes every identifier through `quoteIdent` + every literal through a TYPE-VALIDATED emitter (numeric / string / date / boolean). NO multi-join, NO nested subqueries, NO window functions. Output → new SQL cell (user clicks Run). |
| [A30](#a30--shell-bundle-budget-raised-to-750-kb-v13-prior-art-amends-spec-71) | §7.1 | Shell bundle budget raised 600 KB → 750 KB for v1.3's six notebook-native surfaces (M1–M6). Lazy-load stays the default for heavy libraries; the raised cap covers accumulated shared-shell surface, not a license to dump deps. No trust boundary moves. |

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

## A9 — Custom-endpoint sidecar provider (Wave 2 W2.3) (amends spec §4.3)

**Original §4.3 (paraphrased):**
> Sidecar providers: Anthropic and OpenAI, BYOK keys (per A2).

**Amended:**

> **A third sidecar provider — `'custom'` — accepts any OpenAI-compatible Chat Completions endpoint.** Intended for locally-hosted models (llamafile, vLLM, Ollama, LM Studio, oobabooga) and bring-your-own model gateways. The user supplies the base URL + model name under Settings → "Custom (OpenAI-compatible)"; BYOK API key uses the same posture as Anthropic / OpenAI (A2). URL auto-completion: bare host → `<host>/v1/chat/completions`; `…/v1` → `…/v1/chat/completions`; full URL → unchanged.
>
> The CSP `connect-src 'self' https:` adjustment (A5) is what made this possible — runtime-configured URLs were impossible under the explicit-host whitelist. Local-only `http://` endpoints remain blocked by CSP; users running a plaintext local model server must front it with TLS (self-signed is fine for personal use) or use a tunnel.

**Why:** The spec already supports "Anthropic vs OpenAI"; once the CSP relaxation in A5 cleared the runway, adding a third generic-OpenAI provider is mostly settings UI + a thin call function. The BYOK pattern stays intact (each provider has its own key namespace). No new dependency, no new auth model.

**Status:** Shipped 2026-05-24 (commit on `main`). Closes the v1.2
"custom-endpoint sidecar" item in [`pending.md`](./pending.md). Wave 2
proper now complete except W2.4 (eval harness, deferred to a focused
session).

---

## A10 — Job 4: report-template recommendation (Wave 3 / W3.1) (amends spec §4.3)

**Original §4.3 (paraphrased):**
> The v1.1 sidecar does three narrow jobs: explain query error, disambiguate type, define new type.

**Amended:**

> **A fourth sidecar job — `recommend-reports` — ranks the report
> templates that are ALREADY applicable to the workbook by fit.** Input:
> the candidate templates (id + name + description) + a compact,
> row-data-free summary of the workbook's assigned column types. Output:
> strictly `{ recommendations: [{ template_id, score }] }` — template-ids
> + confidence scores, ranked highest-first. The parser drops any id not
> in the candidate set (hallucination guard), clamps scores to [0, 1],
> de-dupes, and sorts.
>
> Surfaced in the "Suggested reports" panel as an opt-in "Ask sidecar to
> rank" affordance, shown only when the sidecar is enabled and ≥2
> templates are applicable. Ranking reorders the existing cards and adds
> a fit-score badge. It never surfaces a template that wasn't already
> applicable, and templates still instantiate as un-run cells (the user
> clicks Run — Hard NOT #4 unchanged).

**Why this is inside the vision's anti-narration boundary:** the output
is a structured action (ranked template-ids), not prose. A recommendation
with prose justification ("you should run this because…") would be on
the wrong side of the line; this job's schema makes that impossible —
the system prompt forbids prose and the parser would discard it.
(See [sidecar-architecture.md](./sidecar-architecture.md) §"Vision —
narration boundary".)

**Foundation note:** this is the Job 4 that
[sidecar-architecture.md](./sidecar-architecture.md) §"v1.4" earmarked
for LoRA specialization. Shipping it now (prompted base model) gives the
eval harness (W2.4) a fourth job to score, so the v1.3 base-vs-LoRA
comparison covers it from day one.

**Status:** Shipped 2026-05-29 (commit on `main`). Job runs against any
configured provider (anthropic / openai / custom). DECISIONS 2026-05-29
22:00.

---

## A11 — Local-model sidecar provider (Wave 3 / W3.2) (amends spec §4.3 + §4.3a)

**Original §4.3a (paraphrased, from sidecar-architecture.md):**
> A v1.2+ enhancement may ship a local model (Transformers.js + Phi-3-mini-class, OPFS-cached). Opt-in via Settings; fallback to BYOK when not downloaded.

**Amended:**

> **A `'local'` sidecar provider runs an in-browser model — no API key, no network egress for inference.** It joins `anthropic` / `openai` / `custom` in the provider union. `dispatchJob` skips the API-key requirement for `'local'` and routes to a generator the local-model lazy chunk registers at runtime (`src/core/sidecar/local-runtime.ts`). The chunk (Transformers.js + a Phi-3-mini-class 4-bit ONNX model) ships only as a lazy chunk and is cached after first download.
>
> **"Fallback to BYOK when not downloaded" is reframed as EXPLICIT, not silent.** When the local model isn't loaded, a sidecar job surfaces an actionable error ("Download it under Settings, or switch to a cloud provider") rather than silently sending the user's schema to a cloud provider. Picking `'local'` is a privacy choice ("my data stays in the tab"); honoring it means never quietly overriding it. The one-click provider switch is the fallback.

**Why the divergence:** silent fallback to a paid cloud API the moment a local model isn't ready would surprise a privacy-motivated user and leak schema context they expected to keep local. Explicit-and-actionable beats silent-and-surprising. A future opt-in "auto-fallback" toggle could be added if users ask, but off-by-default.

**Status:** Slice A (the seam: provider union + dispatch routing + registry + settings persistence + tests) shipped 2026-05-29. The Settings toggle + the actual Transformers.js chunk + model inference are **slice B, deferred** — they need a real browser + WebGPU to verify (the headless smoke test can't exercise them). See DECISIONS 2026-05-29 22:30.

---

## A12 — Compute Bridge source kind, client side (Wave 3 / W3.4a) (amends spec §4.1)

**Original §4.1 (paraphrased):**
> Remote sources are signed-URL reads (Relay) only.

The Compute Bridge architecture (see
[`enterprise-strategy.md`](./enterprise-strategy.md)) introduces a third
data-plane mode: a user-deployed binary that runs DuckDB inside the
customer's VPC. The wire protocol is spec'd separately in
[`compute-bridge-protocol.md`](./compute-bridge-protocol.md).

**Amended:**

> **A `'compute-bridge'` `SourceKind` mounts the result of a SQL query
> run against a Compute Bridge as a local DuckDB table.** The bridge
> exposes an HTTP API (per `compute-bridge-protocol.md`):
> `GET /v1/health` (discovery + capability handshake),
> `GET /v1/tables` (catalog), `POST /v1/query` body `{ sql }` →
> `Content-Type: application/vnd.apache.arrow.stream` body. NakliData's
> browser client (`src/core/bridge/bridge-client.ts`) speaks only this
> HTTP + Arrow IPC surface — **not Arrow Flight** (browsers can't do
> native gRPC; gRPC-web needs a proxy and doesn't stream cleanly).
> Flight stays the canonical API for non-browser clients.
>
> **Result ingestion reuses `Engine.registerArrowBuffer`** (a thin
> sibling of `registerArrow` that takes a `Uint8Array` directly) —
> which in turn uses DuckDB-wasm's existing
> `insertArrowFromIPCStream`. The Arrow bytes from `POST /v1/query`
> drop straight into a local table: the heavy scan/join runs in-VPC
> next to the data, and only the (bounded) result set crosses to the
> browser.
>
> **Reachability handshake before SQL.** `mountComputeBridge` calls
> `/v1/health` first; failure (network, 401, non-2xx) surfaces a clear
> error before any SQL is sent, and routes reload-time failures to the
> existing `reconnectNeeded` graceful-fallback path (same as FSA
> handles + Iceberg). A bridge dependency never takes down the tab.
>
> **`'compute-bridge'` Bearer secret** uses the W2.2 `source-secrets`
> module (sessionStorage default + opt-in IDB). Secret name:
> `bearer_token`. Secrets are NEVER persisted in `.naklidata`;
> reload looks them up from `source-secrets` and routes to reconnect
> if missing.
>
> **Persistence:** new optional `bridge` field on `PersistedSource`
> (`bridge_url`, `sql`, `table_name`, `requires_bearer`). Additive
> only; no format-version bump (per DECISIONS 2026-05-24 14:00). On
> reload the SQL re-runs against the bridge → fresh data.
>
> **CSP:** the bridge URL is a user-configured `https:` endpoint —
> already allowed by `connect-src 'self' https:` (A5). Plain
> `http://` is blocked; the bridge should serve TLS (self-signed is
> fine over a VPN).

**Status of the binary:** Wave 3 W3.4a ships the **client side** in
NakliData (this repo, mockable against canned responses). The bridge
**binary** is a separate OSS project (target name to be confirmed at
repo creation given the independent-product positioning; Rust single
binary + Docker; Bearer auth v1.3 MVP; OAuth2 / mTLS v1.4+). The
client and the binary share this wire contract. See DECISIONS
2026-05-29 (W3.4a entry).

**Slice scope this commit:**
- Single-table mount per source (paste URL + bearer + table name +
  SQL). A multi-table picker that uses `/v1/tables` is a follow-up
  W3.4b slice — the client already exposes `listTables()` for it.
- e2e for the full Arrow-IPC round-trip is deferred; generating valid
  Arrow IPC stub bytes for Playwright is fragile (no `apache-arrow`
  JS dep). The bridge-client + mountComputeBridge are unit-tested
  thoroughly against mocked fetch.

**Follow-up (W3.4b, 2026-05-30):** the multi-table picker. A second
SourceKind — `'compute-bridge-catalog'` — lists `/v1/tables`, lets the
user pick N tables with per-table row caps, and runs
`SELECT * FROM "<name>" LIMIT <cap>` against the bridge for each pick.
All picks land under one MountedSource with N MountedTables. The
persistence shape differs from `'compute-bridge'`: the catalog tracks
`{ name, local_name, row_cap }[]` rather than a raw SQL string, so
reload re-fetches the same selection at the (then-)current bridge
state.

> **Per-table failures are non-fatal** — `mountComputeBridgeCatalog`
> mounts every table that succeeded and warns about the rest, so a
> single broken table doesn't take down the whole mount. If every
> picked table fails the function throws `MountError` with the failure
> list, matching the W3.4a single-SQL behavior.
>
> **Table-name escaping** — picks come back verbatim from `/v1/tables`
> and are quoted via `"<name>"` with internal `"` doubled (DuckDB /
> Postgres convention) before being interpolated into the SELECT. The
> row cap is integer-clamped to `[100, 1_000_000]`.
>
> **Persistence:** new optional `bridge_catalog` field on
> `PersistedSource` — `{ bridge_url, tables, requires_bearer }`.
> Additive, no format-version bump.

---

## A13 — Optional map cell basemap (Wave 1 stretch — W1.6) (amends spec §3.1 + §6)

**Original §3.1 (paraphrased):**
> Map cell: tile-less MapLibre canvas; no third-party tiles.

**Original §6 (Hard NOT):**
> No third-party scripts at runtime beyond the SRI-pinned DuckDB CDN load.

The "no tile basemap" rule kept the map cell privacy-clean by default
but came with a real ergonomics cost: a points-only or polygons-only
map with no geographic reference is hard to read. W1.6 adds the OSM
basemap as an opt-in, preserving the default posture while letting
users cross the line when they want context.

**Amended:**

> **The default map cell still renders tile-less.** No bytes leave the
> tab unless the user explicitly opts in via Settings → "Map basemap"
> ("Show OpenStreetMap tiles behind map cells"). Default `settings.mapBasemap === 'none'`.
>
> **When the user opts in (`'osm'`)**, MapLibre fetches raster tiles
> from `https://tile.openstreetmap.org/{z}/{x}/{y}.png` for the extent
> each map cell renders. Subdomains a/b/c are deprecated as of ~2022;
> the single-host URL is the modern path. No glyph / sprite / vector
> tile fetches — labels are baked into the raster tile.
>
> **CSP carve-out is explicit-host, not blanket `https:`.**
> `img-src 'self' data: blob: https://tile.openstreetmap.org`. The
> rationale: img requests don't execute scripts, but they still reveal
> area-of-interest to whichever host serves them; explicit-host
> preserves the intent that *only* the user-opted-in OSM host is
> reachable. (Compare to `connect-src 'self' https:` from A5, which is
> a blanket carve-out for data-plane mounts — connect-src is
> fundamentally a data-flow channel where the user picks the URL each
> time.)
>
> **§6 Hard NOT clarification.** "No third-party scripts at runtime"
> still holds — tiles are images, not scripts. A user opting into OSM
> basemap does not enable any third-party script execution. The
> SRI-pinned DuckDB CDN load remains the only script that can come from
> off-origin (and only when the user is online + the SRI hash matches).
>
> **OSM tile usage policy compliance.** Per
> https://operations.osmfoundation.org/policies/tiles/ tiles require
> attribution. MapLibre's built-in attribution control renders the
> "© OpenStreetMap contributors" link automatically when the basemap
> style is active. Heavy users should host their own tile server; the
> NakliData app is a casual-use client and stays inside policy bounds.

**Implementation surface:**
- `settings.mapBasemap: 'none' | 'osm'` with `'none'` default; persisted in IDB alongside other settings; normalize() rejects other values.
- Settings modal: a new section "Map basemap" with a single checkbox + a verbose hint explaining the privacy trade-off.
- `src/lazy/maplibre-map.ts`: new `OSM_STYLE` preset and a `basemap` option on `mountMap()`; default `'none'` (unchanged behavior).
- `src/ui/cells/map-cell.ts`: reads `mapBasemap` from settings before mounting; live setting changes take effect on the next map cell render (no live event).
- CSP: `img-src` extended with the OSM host in both `src/index.html` (dev) and `esbuild.config.mjs` (build).

**Status:** Wave 1 stretch (W1.6). Landed 2026-05-30.

**Future-us:**
- If a user wants a different tile source (Stamen, MapTiler, Carto, an enterprise tile server), the design supports it — but each new host needs a deliberate CSP carve-out + a Settings option + the OSM-policy-equivalent attribution. Don't quietly add hosts.
- The previous "no third-party scripts" framing is preserved; if a future basemap option DOES need scripts (e.g., a vector-tile renderer with off-origin glyphs), that's a bigger spec amendment and should be rejected by default.

---

## A14 — Three-tier DuckDB-wasm bundle source (W1.8.2 + Cloudflare deploy) (amends spec §7.1)

**Original §7.1 (paraphrased):**
> DuckDB-wasm boots from CDN with SRI; vendored fallback verified offline.

The original gate baked in two assumptions that today don't hold:

1. **"Boot from CDN with SRI"** — the way to do SRI on a worker was to pre-fetch the bytes with `fetch(url, { integrity })`, blob the bytes, and pass the blob URL to `db.instantiate`. Current Chrome (≥ ~125, ~Jan 2026) tightened blob URL scoping: a Worker spawned from one blob can't fetch sibling blobs from the parent's blob registry. The pre-fetch SRI path therefore HANGS at `db.instantiate` because the worker's `fetch(<wasm-blob>)` never resolves. The smoke / e2e tests never hit this because they boot with `?offline=1` (vendored, page-relative URLs, no blob chain).
2. **"Vendored fallback"** — the assumption was "if CDN fails, vendored kicks in." But the vendored bytes (~75 MB total; `duckdb-eh.wasm` alone is 34 MB) exceed Cloudflare Workers Static Assets' 25 MiB per-file limit, so the Cloudflare deploy can't ship them.

**Amended:**

> **The runtime picks a DuckDB-wasm bundle source in three tiers, in order:**
>
> 1. **Same-origin** — `./duckdb-fallback/`. HEAD-probed at boot via
>    `./duckdb-fallback/integrity.json`. When the probe returns 200
>    (GitHub Pages deploys, local dev, any deploy with the vendored
>    bytes shipped), the engine loads from there and spawns the Worker
>    directly with `new Worker(<url>)`.
> 2. **GitHub Pages canonical mirror** — `https://naklitechie.github.io/NakliData/duckdb-fallback/`.
>    Used when the same-origin probe 404s (Cloudflare deploys that
>    skipped duckdb-fallback/ via `.assetsignore`). The Worker URL is
>    cross-origin, so the engine uses the official duckdb-wasm
>    blob-bootstrap pattern: a same-origin blob containing
>    `importScripts("<cross-origin-url>");`. GitHub Pages serves CORS
>    open (`access-control-allow-origin: *`) so the import resolves
>    and the worker boots.
> 3. **jsDelivr CDN** — `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/dist/`.
>    Escape hatch behind `?cdn=1`. Same blob-bootstrap pattern as tier
>    2.
>
> **SRI is dropped on the cross-origin paths (tiers 2 and 3).** The
> pre-fetch SRI verification that originally guarded §7.1 required
> blob-pre-wrapping the bytes, and the resulting blob chain doesn't
> work in current Chrome. The trust boundary moves to:
>
> - **Version pin in the URL.** The URL includes a fixed version
>   (`@1.29.0` for jsDelivr; deployed at a build-pinned path for the
>   GitHub Pages mirror) — anyone serving different bytes at that URL
>   would be in active breach of HTTPS origin trust.
> - **Build-time SHA-384 verification of the vendored copy** by
>   `scripts/fetch-duckdb-fallback.mjs` against
>   `public/duckdb-fallback/integrity.json`. The vendored bytes that
>   ship to GitHub Pages (tier 1 + tier 2) are SHA-384-verified at
>   `npm install` time before the build. So when a Cloudflare deploy
>   cross-fetches tier 2, it's fetching bytes that NakliData itself
>   vendored and verified at build time, served from naklitechie's
>   GitHub Pages — not third-party trust.
>
> The first-party-build-then-cross-fetch story is materially stronger
> than the original CDN-then-SRI story, even without runtime SRI:
> the original story trusted whatever jsDelivr served as long as the
> hash matched; the new story trusts what NakliData built + uploaded.

**Cloudflare Workers Static Assets compatibility:** `public/.assetsignore` skips `duckdb-fallback/` so the deploy clears CF's 25 MiB per-file limit. The runtime probe 404s on Cloudflare, tier 2 kicks in. GitHub Pages keeps shipping the vendored bytes so it's both the canonical mirror AND a stand-alone working deploy.

**CSP:** `connect-src 'self' https:` (A5) already allows the cross-origin fetch. No CSP change.

**Status:** Landed 2026-05-30 alongside W1.8.2.

**Reversibility:** Easy. Revert `EngineBootOptions.fallbackBase` + the probe in `main.ts`; the engine still supports `offline=true` (page-relative) and `offline=false` (jsDelivr) as standalone paths.

**Known limitations / follow-ups:**
- **GH Pages is a single point of failure for the cross-fetch tier.** If naklitechie.github.io goes down, Cloudflare deploys break (until they redeploy with `?cdn=1` or their own vendored copy). Mitigation: the engine still supports the jsDelivr tier; users can flip the URL to `?cdn=1` to escape.
- **Repo rename / move would break the canonical URL.** If `naklitechie/NakliData` moves, every deploy depending on tier 2 breaks until they redeploy. Treat the canonical URL as a versioned API surface.

---

## A15 — `sensitivity` field on TypeSpec (W5.4) (amends spec §3.2)

**Original wording (spec §3.2):** `TypeSpec` carried `id`, `display_name`, `domain`, `sql_compat`, `detectors`, `confidence_floor`. No notion of sensitivity / governance / PII labelling.

**Amended wording:**
- Each `TypeSpec` MAY carry a `sensitivity: 'public' | 'pii' | 'financial' | 'secret'` field. Defaults to `'public'` when omitted.
- The schema panel renders a small badge next to the type pill on any column whose assigned type has sensitivity ≠ `'public'`.
- Sensitivity is descriptive, not enforcing. It does NOT (yet) gate which columns can be shipped to the sidecar, masked in demo mode, or redacted from `.naklidata` exports — those are future follow-ups that will reference this field.

**Reasoning:** Unity Catalog / Snowflake Tag-based governance / Databricks PII-marker patterns. Lights up a class of future protections (sidecar prompt redaction, demo mode auto-mask, "Forget all PII columns" affordance) with one line per type. The PII / financial split matters because they're released differently (PII can be shared with the user's own org but not third parties; financial may have regulatory holds even within the org).

**Today's assignments** (48 types in `taxonomy/v0.1/types.jsonl`): 9 PII (email, phone_e164, ip_v4, ip_v6, user_id, session_id, event_properties_json, vendor_name, pan), 18 financial (gstin, amount, hsn_code, …), 21 public (event_name, log_level, http_status, iso_date, percentage, …).

**Status:** Shipped. Ratified.

---

## A16 — Four new cell kinds: cohort, assertion, input, dashboard (amends spec §3.3)

**Original wording (spec §3.3):** Five cell kinds — SQL, chart, markdown, pivot, map. A notebook is an ordered list of these.

**Amended wording:** Nine cell kinds. The four additions:

- **Cohort cell** (W4.4 — `kind: 'cohort'`). Structurally a SQL cell whose result is a single `user_id` column. Downstream cells reference via `@<cohort_name>` using the same `cell_<id>` view machinery as SQL cells. Separate kind exists only to render distinct chrome (header label, user-count badge) — runs the same DuckDB query path.
- **Assertion cell** (W5.5 — `kind: 'assertion'`). SQL that should return 0 rows when an invariant holds. Cell shows a PASS pill on green; FAIL pill + counter-example count + red border on red. dbt's `tests:` block analog. Same execution path as SQL.
- **Input cell** (W6.1 — `kind: 'input'`). Interactive parameter widget (text / number / date / select). Cell's current `value` is inlined into downstream SQL via `@<name>` reference resolution: text → quoted with quote-doubling for SQL injection safety, number → bare, date → `DATE 'YYYY-MM-DD'`, empty → `NULL`. Observable `viewof` + Briefer pattern. Doesn't materialise a view; doesn't show in `runAll`.
- **Dashboard cell** (W6.4 — `kind: 'dashboard'`). CSS grid (1–4 columns) of named markdown / chart / pivot / map cells. Items are listed by `@name`; the dashboard re-invokes the relevant renderer for each referenced cell with no-op handlers + strips `.cell-head` / `.cell-actions` chrome. SQL / cohort / assertion / input cells are NOT valid items (queries + parameters, not presentation surfaces). Superset / Power BI pattern.

**Reasoning:** Each closes a workflow gap surfaced by the Databricks-class comparison ([plan/data-platform-comparison.md](./data-platform-comparison.md)). Cohort is the same-shape-different-intent pattern (W4.4's gain was UX clarity, not new capability). Assertion is a major data-quality wedge with negligible runtime cost (it reuses the SQL path). Input is the parameterised-notebook gap. Dashboard closes the linear-notebook gap.

**Persistence:** All four kinds round-trip through `.naklidata`. Pinned by `tests/persistence-cells.test.ts` (added in commit `f5a7715`) — serialize → JSON → parse must field-equal the source, with cohort/assertion runtime state (status / lastError / lastResult) correctly stripped by `cellWithoutResults`.

**Status:** Shipped. Ratified.

---

## A17 — Presentation mode (W6.2) (amends spec §3.8)

**Original wording (spec §3.8):** The notebook UI is a stateful workbench — sources panel left, notebook centre, schema panel right, cell-add row below.

**Amended wording:** An additional read-only "deck" view is available via the `?present=1` URL parameter. On boot, the `app-present-mode` class is added to the root `#app` element BEFORE the shell mounts. CSS gated on that class hides:
- Both sidebars (sources + schema)
- Notebook toolbar (Run all)
- Cell-add row (+ SQL / + Markdown / + Chart / + … buttons)
- Per-cell `.cell-head` (name input, type select, delete button, …)
- SQL / cohort / assertion cells entirely (they're queries, not presentation)
- Cell borders + result-meta + send-to bars

Visible: markdown previews, chart SVGs, pivot tables, map canvases, dashboard grids.

An "Exit presentation" pill in the header (only visible when `app-present-mode` is set) strips `?present=1` from the URL and reloads to return to the workbench.

**Reasoning:** Hex's "publish as app" pattern. Sharing a workbook as a URL and having the recipient land in a clean deck view (rather than the editor) is the single most-asked-for affordance from analyst-style users. URL-based toggle (not a settings flag) keeps shared links self-contained: paste `naklidata.naklitechie.com/?lens=…&present=1` to send a recipient straight into deck mode.

**Status:** Shipped. Ratified. E2e-tested by `tests/e2e/presentation-mode.spec.ts` (8 cases).

---

## A18 — Static-HTML export (W6.3) (amends spec §3.4)

**Original wording (spec §3.4):** Per-result "send to" sinks (CSV, Parquet, KanZen, Bahi, NakliPoster). Five sinks total.

**Amended wording:** Adds a NOTEBOOK-LEVEL export (not a per-cell sink): a new "Export HTML" button in the header serializes the live notebook DOM into a single self-contained HTML file. `~3 KB` of embedded CSS; no `<script>` tags; no engine dependency. SQL / cohort / assertion cells fold into collapsed `<details>` blocks (SQL + result table preview); markdown previews + chart SVGs + pivot tables embed inline; map cells render a placeholder ("Interactive map omitted in static export"). Uses FSA `showSaveFilePicker` where available, falls back to anchor download.

**Reasoning:** Evidence Dev's "publish to static site" pattern, minus the static site. One file the user can email, drop into a Google Doc, pin in a wiki, attach to a Jira ticket. Differs from the existing per-cell sinks (CSV / Parquet / KanZen / Bahi / NakliPoster) in two ways: (1) it operates on the WHOLE notebook, (2) the output is a presentation artifact, not data that's piped into another system.

**Status:** Shipped. Ratified. E2e-tested by `tests/e2e/export-html.spec.ts` (3 cases). Audit follow-up (`fa37310`) fixed two regressions: textarea-fallback SQL reading stale text via `.textContent`, and the "Summarise" button label leaking into the exported `<details>` summary.

---

## A19 — Lens auto-mount confirmation (v1.2.2) (amends spec §3.8)

**Original wording (spec §3.8 + A15 implicit):** Share links carry a `?lens=<base64gzip>` param that decodes to a `NakliDataFile` snapshot of workspace state. On page load, the lens is decoded and applied via `applyLoadedFile(engine, file)` — every persisted source re-mounts.

**Amended wording:** Before auto-mounting, the boot path walks `file.sources` through `extractLensRemoteHosts(file)`. For every source whose kind is `http`, `s3-endpoint`, `iceberg-table`, `iceberg-catalog`, `compute-bridge`, or `compute-bridge-catalog`, the host is extracted (via `new URL(...).host`, with `'(unparseable URL)'` as the loud fallback). If any remote source is found, the boot path opens a confirmation modal (`src/ui/lens-confirm-modal.ts`) that:

- Lists every unique host (deduplicated) the link will fetch from, with the source label(s) and kind(s).
- Defaults focus to the **Cancel** button (so Enter-dismiss is the safe default, not the dangerous one).
- Cancels on backdrop click, Escape, or Cancel-click — `clearLensFromLocation()` strips the param and the saved session is restored.
- Continues on Continue-click — proceeds with the original `applyLoadedFile` + `clearLensFromLocation` flow.

Local sources (`example-bundle`, `fsa-folder`) auto-restore silently as before — they have no network footprint and aren't part of the SSRF threat model.

**Reasoning:** Before A19, a malicious sender could craft a `?lens=` link that mounts attacker-controlled URLs (probing the victim's internal network, replaying persisted bearer tokens against attacker-controlled hosts, mapping intranet topology). CSP `connect-src 'self' https:` is wide-open by design (per A5), so the browser couldn't block the fetches. Defence had to be in the app. Confirmation modal chosen over alternatives ("reconnect-needed tiles" / "same-origin auto-mount only") because it preserves the "share a workbook and they see it" promise of share links while making the network footprint explicit. See DECISIONS 2026-06-02 Decision A for the trade-off discussion.

**Status:** Shipped in v1.2.2 (`8f50b87`). Vitest + e2e cover the example-bundle path (no prompt fires). Remote-source modal path is owed runtime verification (workplan chunk 2).

---

## A20 — Postinstall hash-pin protocol (v1.2.2) (amends spec §7.1)

**Original wording (spec §7.1 + A14):** DuckDB-wasm + DuckDB extensions are vendored under `public/duckdb-fallback/` and `public/duckdb-extensions/<rev>/<plat>/` for the offline-first user. Each directory carries an `integrity.json` with sha384 hashes used at runtime for SRI verification.

**Amended wording:** The two postinstall scripts (`scripts/fetch-duckdb-fallback.mjs`, `scripts/fetch-duckdb-extensions.mjs`) treat the existing checked-in `integrity.json` as the **pinned hash table** the postinstall verifies AGAINST, not the file the postinstall RECORDS to. The flow:

1. **Bootstrap** (no `integrity.json` present, e.g., new revision/platform): record-then-warn. Print "no pinned hashes for X — bootstrapping; commit integrity.json to lock these bytes." Write the new file.
2. **Validate** (`integrity.json` present, normal case): for each expected file, sha384 the downloaded bytes; compare against the pinned hash. Mismatch → throw "supply-chain alert" + exit 1.
3. **Re-verify on shortcut** (files already present from a prior install): also sha384 each on-disk file against the pin BEFORE the `alreadyVendored()` shortcut returns. Closes the in-place tamper window.

Failures (network down, hash mismatch, disk full) exit 1 (was `exit(0)`), so silent install-state corruption no longer reaches the build.

**Reasoning:** Before A20, the postinstall script wrote `integrity.json` from whatever bytes it just downloaded, so a MITM / DNS hijack / compromised CDN during `npm install` substituted attacker bytes and the recorded hash "ratified" the swap. The resulting `dist/` then shipped those bytes to all deployed users. After A20, `integrity.json` is the authoritative pin (committed once, byte-for-byte enforced thereafter); the postinstall script is a verifier, not a recorder. See DECISIONS 2026-06-02 Decision E.

**Status:** Shipped in v1.2.2 (`3313917` + adversarial fix in `832f091`). Probe of the hash-mismatch path is owed runtime verification (workplan chunk 2).

---

## A21 — Bearer-token charset (v1.2.2) (amends spec §4.1)

**Original wording (spec §4.1 + A7/A8/A12):** Iceberg table / catalog mounts and Compute Bridge mounts accept an optional Bearer token, which travels as `Authorization: Bearer <token>` to the remote endpoint. The token is captured via the corresponding modal and stored per source-secrets posture.

**Amended wording:** Bearer tokens MUST match RFC 7235 token68 charset: `[A-Za-z0-9._~+/=-]+`. Tokens are validated by `assertSafeBearerToken(token)` (in `src/core/bearer-token.ts`) at every use site:

- `engine.configureIceberg` — before interpolating into the `SET extra_http_headers = MAP { 'Authorization': 'Bearer …' }` SQL literal.
- `BridgeClient` constructor — before building the outbound `Authorization` header.

Invalid tokens throw `InvalidBearerTokenError` with a specific reason ("CR or LF", "whitespace", "characters outside token68 charset"). Empty strings are permitted (the no-auth path; callers separately enforce non-emptiness when required).

**Reasoning:** Before A21, `engine.configureIceberg` interpolated the token into a SQL literal via `escapeLiteral`, which only doubles single quotes. A CR/LF survived SQL escaping and reached DuckDB-wasm's httpfs HTTP-header construction, enabling classic CRLF injection (HTTP response splitting / additional header smuggling) against any backend that doesn't validate header bytes. The token68 charset is the RFC-blessed alphabet for OAuth2 Bearer tokens — JWTs, opaque keys, and base64-padded tokens all fit; quotes, parens, whitespace, and control characters don't. Failing closed at the API boundary is cheap and avoids relying on every downstream component to do its own validation.

**Status:** Shipped in v1.2.2 (`8f50b87`). 9 vitest cases lock the contract.

---

## A22 — CSP defence-in-depth (v1.2.2) (amends spec §7.1)

**Original wording (spec §7.1 + A5/A14):** CSP delivered via `<meta http-equiv>` covers `default-src`, `script-src` (with the inline-bundle SHA-256 hash + `'wasm-unsafe-eval'` + blob: + two cross-origin hosts), `worker-src`, `connect-src 'self' https:` (broadened in A5), `img-src` (with the OSM tile carve-out from A13), and `style-src 'self' 'unsafe-inline'`.

**Amended wording:** CSP gains four additional directives:

- `base-uri 'self'` — pins the `<base>` element's `href` to the document origin. Without this, an injected `<base href="https://attacker">` would redirect every relative URL on the page (chunk loads, service worker registration, duckdb-fallback fetches, taxonomy worker URL) to an attacker origin. `script-src` does NOT cover `<base>` resolution.
- `object-src 'none'` — blocks `<object>` / `<embed>` / Flash-style plugin vectors. NakliData never uses them.
- `form-action 'self'` — restricts form submission to the document origin. Closes the post-XSS exfil channel where an attacker injects a hidden `<form action="https://attacker">.submit()` to ship sessionStorage out.
- `frame-ancestors 'none'` — clickjacking guard. **Note:** per CSP Level 3, `frame-ancestors` is IGNORED when delivered via `<meta>` (only enforced from real HTTP headers). Ships anyway for documentation + any future header-capable deploy. GitHub Pages can't enforce it; the browser logs a console warning. See DECISIONS 2026-06-02 Decision D.

The other three (`base-uri`, `object-src`, `form-action`) ARE enforced from `<meta>` and actively close real exfil channels.

**Reasoning:** Defence in depth. Even with the C1 XSS fix shipped (templates panel column-name escaping), any FUTURE XSS that slips through still needs to escape the DOM to do damage — these four directives close the most common escape vectors. `base-uri` is the highest-value addition because the `<base>` element is a script-src blind-spot.

**Status:** Shipped in v1.2.2 (`4b33393`). Smoke green; documented browser warning about `frame-ancestors` is the expected no-op signal on GitHub Pages.

---

## A23 — NL→SQL parser safety contract (v1.2.2) (amends spec §4.3)

**Original wording (spec §4.3 + A10/A11):** Sidecar Job 5 (NL→SQL) accepts a natural-language question + the workbook's table/column schema and returns a DuckDB SELECT statement. The result lands as the body of a new SQL cell — never auto-executed (Hard NOT #4). A parser layers SELECT-prefix check, write-keyword rejection, and a hallucination guard that scans `FROM` / `JOIN` for tables not in the allowlist.

**Amended wording:** The NL→SQL parser (`parseNlToSqlResponse` in `src/core/sidecar/client.ts`) now provides FIVE guarantees, in order:

1. **SELECT-only.** The response must start with `SELECT` or `WITH ... SELECT` (optionally inside a leading paren). Anything else → drop response.
2. **No write/DDL/session-mutating keywords.** `WRITE_KEYWORDS` rejects any occurrence of `INSERT | UPDATE | DELETE | CREATE | DROP | ALTER | TRUNCATE | MERGE | CALL | ATTACH | DETACH | GRANT | REVOKE | COPY | EXPORT | VACUUM | PRAGMA | INSTALL | LOAD | SET | RESET | USE`. The last 5 in that list (forward-pass H3) catch session-state mutations a confused model might emit (e.g., `SET enable_external_access = true`).
3. **Single statement.** A `;` followed by non-whitespace in the body → drop. The check runs on a string-literal-stripped copy (`'(?:[^']|'')*'` → `''`) so a `;` inside a column value (`SELECT 'foo;bar' FROM t`) doesn't false-trip.
4. **No DuckDB replacement-scan via single-quoted FROM.** `\b(?:FROM|JOIN)\s+'/i` matches the `SELECT * FROM 'https://attacker/x.csv'` shortcut (which DuckDB interprets as `read_csv_auto(...)`). Drop response. The identifier-only allowlist below would otherwise iterate an empty list and pass the SQL.
5. **Every FROM/JOIN identifier must be in the table allowlist.** A positional `extractFromTables` walker handles SQL-89 comma-join (`FROM a, b, c`), quoted identifiers (`FROM "weird name"`), and alias forms (`FROM a t1, b AS t2`). DuckDB FROM-clause modifiers (`LATERAL`, `UNNEST`, `TABLE`, `VALUES`, `PIVOT`, `UNPIVOT`) are treated as terminators, not table names, so legitimate queries using them pass. CTE names (from `WITH name AS (...)`) are auto-allowlisted; `cell_<id>` shorthand for notebook view-mounts is allowlisted too.

Any guarantee failing → the parser returns `{ kind: 'nl-to-sql', sql: '' }` (empty SQL). The UI then surfaces the model's response wholesale with a note that the parser rejected it — the user sees the rejection, can read the offending SQL, and chooses whether to manually edit + retry.

**Reasoning:** Before A23, three of the five guarantees had bypasses (forward-pass + adversarial review found them):

- Comma-join bypass (H2): the original regex `\b(?:FROM|JOIN)\s+ident` captured only the FIRST identifier after FROM, so `FROM allowed, secret_table` slipped through.
- Missing session-state keywords (H3): SET / INSTALL / LOAD / RESET / USE all valid SQL that mutates session state.
- Single-quoted replacement-scan (code-review): the identifier-only allowlist had no path for string-literal FROM.

The adversarial review also caught false-rejections: LATERAL/UNNEST treated as found-table names (HIGH:Regression — dropped legitimate queries), `;` in string literals tripping the multi-statement gate (MEDIUM). Both fixed.

The parser is the load-bearing safety net for the "model returns SQL, user might click Run" pattern. Belt-and-braces here is the right level of paranoia.

**Status:** Shipped in v1.2.2 (`2ed675f` + adversarial fix in `832f091`). 29 vitest cases lock the five guarantees (`tests/sidecar-parser-hardening.test.ts`).

---

## A24 — Local runtime shipped (W3.2 slice B) (amends spec §4.3 + §4.3a)

**Original wording (spec §4.3 v1.1, also see A11 for the seam):**
> Default runtime: Transformers.js with "a small model suitable for classification + short generation (Phi-3-mini-4k-instruct quantized, or successor at build time)." ~50 MB cached in OPFS.

**Amended wording:** The local runtime ships in v1.3 as W3.2 slice B
across four coordinated chunks:

- **Chunk 1 — OPFS cache primitive** (`src/core/sidecar/local-cache.ts`).
  Custom cache layer rather than Transformers.js's built-in Cache
  API caching, for inspectability (size shown in Settings),
  O(1) per-model delete, and BYOK-posture matching. Module surface:
  `isOpfsAvailable / getModelCacheInfo / listCachedModels /
  getTotalCacheSize / hasModelFile / readModelFile / writeModelFile /
  clearCachedModel / clearAllCachedModels / formatCacheSize`.

- **Chunk 2 — Transformers.js lazy chunk**
  (`src/lazy/transformers.ts` → `dist/chunks/transformers.js`).
  Bundles `@huggingface/transformers@^4.2.0` (525 KB after esbuild
  tree-shake). Wires `env.customCache` to a `createOpfsCache()`
  adapter that parses HF resolve URLs and routes through the
  chunk-1 cache. Pipeline is lazy + per-model-id cached.

- **Chunk 3 — Settings UI** (`src/ui/settings-modal.ts`). Adds
  `local` as the fourth provider radio + a section that surfaces
  when picked, with a curated 3-model list, Download & load button,
  live download progress, cached-models list with size + per-row
  delete, and a Forget-all-cached affordance.

- **Chunk 4 — Boot-path auto-load** (`src/main.ts`). When `provider
  === 'local'`, a model id is configured, AND the weights are
  already in OPFS, auto-load on boot. Otherwise no-op (user must
  explicitly click in Settings — matches BYOK posture of
  no-silent-multi-GB-downloads). Auto-load is fire-and-forget; the
  L3 "no-provider" UI handles sidecar jobs that fire before load
  completes.

**The 50-MB-OPFS figure in the original spec was aspirational.**
Realistic 4-bit quantized chat models in this class are:

| Model | Quantized size | License | Notes |
|-------|---------------:|---------|-------|
| Qwen2.5-1.5B-Instruct | ~0.9 GB | Apache 2.0 | Default + recommended. |
| Phi-3.5-mini-instruct | ~2.3 GB | MIT | Bigger quality, bigger download. |
| Llama-3.2-1B-Instruct | ~0.7 GB | Llama license | Smallest credible chat model. |

These three are the curated list. Adding more requires a /decide.

**Validation owed**: per-job manual probes (the 6 sidecar jobs against
the loaded model) — captured in `plan/w32-slice-b-validation.md`.
v1.3.0 tag is gated on 6/6 PASS.

**Reasoning:** Closes the v1.1-era spec promise of a local-first
sidecar runtime. Local provider is now indistinguishable from cloud
providers at the dispatch layer — `provider: 'local'` in settings,
sidecar jobs route through the same parsers + safety guards (A23
applies regardless of which provider produced the SQL). Privacy
posture: with `provider: 'local'` selected and the model cached, the
sidecar makes zero outbound network calls. Picking `local` is the
"keep my data in this tab" choice; the runtime now honors that
end-to-end.

**Status:** Code shipped (chunks 1-4 across commits `87b56a1` →
`6e8fed4`). Per-job validation owed before v1.3.0 tag.

---

## A25 — Anonymized export sink (v1.2 M1) (amends spec §3.4)

**Original wording (spec §3.4):** Export sinks are CSV, Parquet,
Kanzen (the local cache), Static HTML (A18), JSON-NDJSON. No
anonymization step.

**Amended wording:** A sixth sink, **"Export anonymized"**, sits
between Parquet and Kanzen in the sink picker. It opens a modal
where the user reviews and overrides per-column anonymisation
strategy, then runs the export as a SQL projection rewrite (NOT
JS post-processing).

**Strategies** (per column, defaults driven by §3.2 sensitivity
badge from A15):

| Strategy | SQL projection | Default for |
|----------|----------------|-------------|
| `keep` | `"col"` (verbatim) | `public` + unbadged |
| `hash` | `md5(COALESCE(CAST("col" AS VARCHAR), '') || '<salt>')` | `pii` |
| `redact` | `'[REDACTED]'` (literal) | `secret` |
| `bucket` | numeric: `(FLOOR(CAST("col" AS DOUBLE) / 100) * 100)` ; date: `DATE_TRUNC('month', CAST("col" AS DATE))` ; other: falls back to redact | `financial` |
| `drop` | column omitted from projection | (user-only) |

**Salt:** generated per export via `crypto.getRandomValues` (16
bytes hex-encoded → 32 chars). Shown in the dialog with a "Copy"
affordance + "Regenerate" button. Never persisted. Same-salt
re-export = user pastes the original salt back into the dialog
manually.

**Manifest:** written as a separate JSON file alongside the data
file (separate save-file picker; cancelling skips the manifest
write but the data file still ships). Format:

```json
{
  "format": "naklidata-anonymize-manifest",
  "version": "1",
  "exportedAt": "<iso8601>",
  "taxonomyVersion": "v0.1",
  "columns": [{"name", "strategy", "sensitivity", "typeId"}, ...],
  "saltUsed": true,
  "notes": "..."
}
```

Salt value is NEVER in the manifest. `saltUsed: true` documents
whether hashing was used; the recipient must obtain the salt
separately if they need same-hash re-export.

**Reasoning.** A whole-codebase forward-pass found CSV exports
shipping PII verbatim with no in-app anonymisation gate. The
sensitivity badges (A15) had been a substrate without a consumer;
this sink consumes them. Handoff §M1 picks the projection-rewrite
shape; the SQL surface is airtight against hostile column names
via `quoteIdent` + `quoteLiteral` (see DECISIONS 2026-06-10
Decision A). Adversarial review (16 vitest cases in
`tests/anonymize.test.ts`) proves the SQL holds under hostile
input.

**Hard NOTs preserved:**

- No persistence of salt or query results (handoff §10).
- No third-party crypto dependency — `md5()` is DuckDB built-in.
- No JS post-processing of millions of rows.
- No string-concat SQL injection — every identifier and literal
  routes through the dedicated quoter.

**Status:** Shipped in v1.2 M1 (`391c19c`). 482 vitest (+34 new) /
55 e2e / smoke / check green. Bundle 551.0 KB / 600 KB (91.8%,
49 KB headroom).

---

## A26 — Cell Lineage Tracker (v1.2 M2) (amends spec §3.3 + §3.8)

**Original wording (spec §3.3 + §3.8):** Cells form a DAG by
`@cellName` references; on run we replace `@name` with the saved
view `cell_<id>`. There is no notion of mounted-source ↔ cell ↔
sink lineage at the workbook level; the user reasons about
provenance via the SQL text itself.

**Amended wording:** Every SQL/cohort/assertion cell now records
its upstream inputs into a workbook-level lineage graph after
each successful run. The extraction is **EXPLAIN-based, not
regex** (handoff §M2):

1. After `CREATE OR REPLACE VIEW cell_<id> AS <rewritten>` runs
   successfully, the notebook calls
   `Engine.explainPlan('SELECT * FROM (<rewritten>)')` →
   parsed JSON plan tree.
2. `extractInputsFromPlan(plan)` walks the tree recursively,
   pulling:
   - **Table names** from `SEQ_SCAN`/`INDEX_SCAN`/`TABLE_SCAN`/
     `COLUMN_DATA_SCAN` nodes' `extra_info.Table` (or
     `Table: <name>` in string-form extra_info).
   - **File paths** from `READ_PARQUET`/`READ_CSV[_AUTO]`/
     `READ_JSON[_AUTO]`/`READ_NDJSON`/`READ_ARROW` nodes'
     `extra_info.File` / `Files` / `Function`.
   - Operators on the IGNORE list (`CTE_REF`/`CHUNK_SCAN`/
     `DELIM_SCAN`/`EMPTY_RESULT`/`EXPRESSION_SCAN`/`DUMMY_SCAN`)
     contribute no lineage — the CTE-shadow gate case from the
     handoff.
3. Fall-back: if `explainPlan` returns null (the SQL didn't
   parse), `extractInputsFromSqlRegex(sql, knownTables)` runs a
   permissive `FROM/JOIN <ident>` sniff, filters against the
   live table allowlist, and tags every emitted input as
   `confidence: 'low'`.

**Graph state (`LineageGraph` v1):**

```ts
type LineageNode = {
  id: string,
  kind: 'source' | 'cell' | 'sink',
  label: string,
  ref?: string,
};
type LineageEdge = {
  from: string,
  to: string,
  confidence: 'high' | 'low',
};
type LineageGraph = {
  version: 1,
  nodes: LineageNode[],
  edges: LineageEdge[],
};
```

Per-cell `setCellInputs` REPLACES the cell's inbound edges
(incremental update — handoff §M2 "delete stale edges for the
edited cell only"). Downstream edges (cells that read from this
cell) are owned by THOSE cells and stay intact until those cells
re-run.

**Persistence:** new optional `lineage` field on `NakliDataFile`.
Pre-M2 files round-trip cleanly (no version bump). Save + load
wired through `getLineageStore().toJSON()` / `loadFromJson()`.

**UI (handoff §6 — list is the accessible truth, SVG is enhancement):**

- New "Lineage" button in the header opens a panel.
- **List view (load-bearing):** nodes grouped by kind (Sources /
  Cells / Sinks). Each cell row shows inbound + outbound edges
  as nested rows. Keyboard-traversable; Escape closes.
- **SVG view (enhancement, hand-rolled per handoff §10):**
  three-lane layout — sources column 0, cells in columns 1..N by
  topological depth (longest-path Kahn-style relaxation), sinks
  in the last column. Edges drawn as quadratic Bezier curves
  with arrowheads; low-confidence edges are dashed. **No D3 / No
  React-Flow.**

**Hard NOTs preserved (handoff §10):**

- The handoff's review code (`compileVisualQuery`, `extractLineage`
  with regex) is NOT used. The implementation is EXPLAIN-walker
  primary + regex fallback only when EXPLAIN itself failed.
- No D3 / React-Flow / charting-graph dependency. The SVG
  renderer is ~200 lines of hand-rolled topological layout +
  path emission.
- No persistence of data — the graph describes WHAT was used to
  produce each cell, not the data itself (Hard NOT #3).

**Status:** Shipped in v1.2 M2 (`0bb279e`). 511 vitest (+29 new
in `tests/lineage.test.ts`, including the two gate cases from
handoff §M2 — CTE shadow + `FROM read_parquet`) / 55 e2e / smoke
/ check green. Bundle 566.4 KB / 600 KB (94.4%, 33.6 KB
headroom).

---

## A27 — Incremental Refresh (v1.2 M3) (amends spec §4.1 + §3.8)

**Original wording (spec §4.1 + §3.8):** Sources are mounted once
per session; the user re-mounts them manually if files change. No
"check for updates" affordance; no notion of "stale cells"
relative to source state.

**Amended wording:** A user-initiated "Check for updates"
mechanism (new header button between "Lineage" and "Settings").
On click:

1. **Per source, compute current fingerprint:**
   - **FSA folder**: aggregate `file.size` SUM + `file.lastModified`
     MAX across all files via the existing directory handle.
     Permission check is opportunistic (queryPermission only — no
     prompt); revoked permission marks the source "uncheckable."
   - **HTTP URL**: HEAD request → ETag + Last-Modified +
     Content-Length headers.
   - **S3-endpoint / Iceberg / Bridge**: `unsupported` sentinel
     (records in fingerprint map but never produces stale signal).
     Real fingerprinting deferred — see DECISIONS 2026-06-10
     Decision M.
2. **Diff against persisted fingerprint map** (IDB; key
   `refresh:<sessionId>:fingerprints` in the existing KV store).
3. **Cascade stale source IDs** via the M2 lineage graph: BFS
   forward from each stale source → cell IDs whose result is
   potentially out-of-date. Cycle-safe via `visited` set;
   complexity O(V+E).
4. **Surface the diff** in a result modal showing:
   - Sources that changed (yellow badge per source).
   - Affected cells (blue badge per cell — cascaded set).
   - Couldn't check (gray badge — permission revoked / HEAD
     failed).
   - "All sources up to date" message if clean.
5. **On user confirm**: persist the fresh fingerprint map FIRST
   (so the next check has a new baseline), then re-run the
   stale cells via `Notebook.runCell` (which triggers the M2
   lineage recompute as a side effect).

**Hard NOTs preserved (handoff §10):**

- **NO background polling.** The check runs only on the user
  button click. The bundle has no `setInterval` or `setTimeout`
  loop wrapping `computeRefreshDiff`.
- **NO persistence of file contents** — only fingerprint tokens
  (size, lastModified, ETag, etc.).
- **NO auto-refresh on boot.** The boot path does NOT trigger
  the check; that's a future opt-in for the user.

**Storage shape (IDB):**

```
key:   "refresh:<sessionId>:fingerprints"
value: Record<sourceId, SourceFingerprint>
```

Stored in the existing `kv` object store; no schema bump needed.
Per-session keying avoids fingerprint collision across the
multi-session sidebar.

**Reasoning.** Mounted sources are typically files the user is
ACTIVELY EDITING in another application (Excel, a SQL dump, an
HTTP-hosted Parquet generated by an upstream pipeline). Without
"check for updates," the user has no signal that their workbook
is operating on stale data. The M2 lineage graph gives a precise
"which cells need to re-run if I refresh THIS source" — no
guesswork.

**Status:** Shipped in v1.2 M3 (`42be469`). 536 vitest (+25 new
in `tests/refresh.test.ts` — 13 fingerprint-equality cases + 9
cascade cases + 3 constructor-helper cases) / 55 e2e / smoke /
check green. Bundle 574.1 KB / 600 KB (95.7%, 25.9 KB headroom).

---

## A28 — Sidecar Job 7: propose-chart (v1.2 M4) (amends spec §4.3)

**Original wording (spec §4.3 + A10/A11/A23):** Six sidecar jobs:
explain-error, disambiguate-type, define-type, recommend-reports,
summarise-result, nl-to-sql.

**Amended wording:** A seventh sidecar job — `propose-chart` —
sits alongside the existing six.

**Input** (`ProposeChartJob`):

```ts
{
  kind: 'propose-chart',
  sql: string,                                       // cell's SQL (≤ 400 chars in prompt)
  columns: Array<{ name: string, sqlType: string }>, // result columns
  sampleRows: Array<Record<string, string>>,         // up to 10 rows
  rowCount: number,                                  // total result row count
}
```

**Output** (`ProposeChartResponse`):

```ts
{
  kind: 'propose-chart',
  proposal: {
    chartType: 'bar' | 'line' | 'area' | 'scatter' | 'pie' | 'histogram' | 'stat' | 'table',
    xColumn: string | null,
    yColumn: string | null,
    groupColumn: string | null,
    title: string,  // 1–80 chars
  } | null  // null = parser rejected the model response
}
```

**Parser guarantees:**

1. **Strict JSON only.** Markdown-fence-wrapped JSON is tolerated;
   anything else (prose preface, half-JSON) → `proposal: null`.
2. **`chartType` allowlist.** Only the 8 values listed above
   survive. Anything else → `proposal: null`.
3. **Column hallucination guard.** Every column reference
   (`xColumn`, `yColumn`, `groupColumn`) must be in the input
   `columns` list, or be exactly `null`. Any unknown reference →
   `proposal: null` (all-or-nothing — see DECISIONS 2026-06-10
   Decision Q).
4. **Title length cap.** 1 ≤ length ≤ 80 chars.

**UI flow:**

- New "Suggest chart" chip next to the existing "Summarise" chip
  on every SQL/cohort/assertion cell with a successful result.
- Click → toast "Asking the sidecar to propose a chart…" → ship
  the columns + 10 sample rows + row count → on a valid proposal,
  insert a chart cell wired to the SQL cell's view (`inputCell:
  <cellId>`) with the proposed `chartType` / `x` / `y` / `facet`
  (groupColumn → facet) / `name` (title truncated to 40 chars).
- On `proposal: null`: toast "Couldn't propose a chart — try
  inserting one manually via the cell-add row."

**Hard NOTs preserved (handoff §10):**

- **#6 — the sidecar does not narrate data.** The structured
  config has no prose field. The system prompt explicitly bans
  narration; the parser rejects anything that isn't strict JSON.
- **#4 — never auto-execute.** A chart cell IS created, but no
  query runs on the user's behalf. Chart cells re-render
  automatically when the SQL cell's result changes (this is the
  existing chart-cell lifecycle, not "auto-execute" of SQL).

**Reasoning.** Schema-panel quick-charts (W5.3) already covered
"propose a chart from a single column" — but only for taxonomy-
classified single columns. A SQL cell that joins / filters / pivots
produces a result that doesn't fit the single-column model. The
propose-chart job fills that gap by reasoning over the full result
schema + cardinality signal from 10 sample rows.

**Status:** Shipped in v1.2 M4 (`4be16c6`). 554 vitest (+18 new
in `tests/propose-chart.test.ts` — 4 happy-path + 11 rejection +
3 prompt-shape) / 55 e2e / smoke / check green. Bundle 578.7 KB /
600 KB (96.5%, 21.3 KB headroom). M5 must come in under that 21 KB
or trim elsewhere — captured as a constraint.

---

## A29 — Visual Query Builder (v1.2 M5) (amends spec §3.3 + §3.8)

**Original wording (spec §3.3 + §3.8):** SQL cells are the only
way to write a query. Cells form a DAG by `@cellName` references.

**Amended wording:** A new "Build query" header button (between
"Refresh" and "Settings") opens a form-based query builder modal.
The form has:

- **Source table picker** — dropdown of mounted tables.
- **Filters** — AND-joined rows, each: column dropdown + operator
  dropdown (=, !=, >, <, >=, <=, LIKE, IS NULL, IS NOT NULL) +
  value input.
- **Aggregates** — rows, each: function dropdown (SUM, AVG, COUNT,
  MIN, MAX) + column dropdown → alias.
- **LIMIT** — number input (defaults to 100, capped at 1M).
- **Live SQL preview** — pre block re-renders as the user edits.
- **Insert as SQL cell** — drops the emitted SQL into a new SQL
  cell at the end of the notebook. User clicks Run themselves
  (Hard NOT #4).

**Source table change carries over filters** with column
re-validation (handoff §M5 explicit gate case). Filters whose
column doesn't exist in the new table are dropped; the rest are
re-tabled.

**Hard NOTs preserved (handoff §10 + §M5):**

- **NOT porting the review's `compileVisualQuery`.** That was a
  string-concat injection factory. The emitter (`src/core/query-
  builder.ts`) flows every identifier through `quoteIdent` (wrap
  in `"`, double internal `"`) and every literal value through a
  TYPE-VALIDATED emitter:
  - numeric: must parse as a finite number; emitted bare;
    hostile `1; DROP` becomes NaN → filter dropped.
  - string: emitted via `quoteLiteral`; hostile `' OR 1=1; --` →
    `''' OR 1=1; --'`  — one quoted literal, never a free SQL
    fragment.
  - date: validated against ISO-8601 regex; non-matching values
    drop the filter.
  - boolean: validated as `'true' | 'false'`; anything else drops
    the filter.
- **NO multi-join, NO nested subqueries, NO window functions.**
  Enforced at the spec type level + the emitter has no code path
  for these shapes.
- **NO auto-execute.** Emitted SQL goes into a new SQL cell; user
  clicks Run.

**Reasoning.** SQL is the lingua franca of the workbench, but the
sidecar (NL→SQL, Job 5) is the only no-keyboard path today. The
visual builder fills the middle of the spectrum: power-users skip
it, beginners get a guardrail-enforced subset of SQL. The strict
no-string-concat emitter is the load-bearing safety guarantee —
27 vitest cases lock the injection-resistance contract.

**Status:** Shipped in v1.2 M5 (`5871b53`). 581 vitest (+27 new
in `tests/query-builder.test.ts`) / 55 e2e / smoke / check green.
Bundle 590.6 KB / 600 KB (98.4%, 9.4 KB headroom). v1.2 Lakehouse
Parity track complete — M1 → M5 closed in a single autonomous
session (handoff at `4be16c6` → `5871b53` over ~6 hours).

---

## A30 — Shell bundle budget raised to 750 KB (v1.3 Prior Art) (amends spec §7.1)

**Original §7.1 (paraphrased):**
> The single-file shell (`dist/index.html`) must stay ≤ 600 KB.
> Heavy functionality ships as lazy chunks fetched on demand; the
> gate is enforced by `scripts/check-bundle-size.mjs`.

The 600 KB figure was set at v1.0, when the shell carried the mount
layer, taxonomy classifier, schema panel, the seven hand-rolled
chart types, and the sink picker — and nothing else. Every heavy
capability added since (CodeMirror, Observable Plot, MapLibre,
Cytoscape, deck.gl, Transformers.js) shipped as a lazy chunk, so the
shell crept up only from the *shared* surface those features need
(cell kinds, modals, store wiring), never from the libraries
themselves.

v1.3 (Prior Art) adds six notebook-native surfaces — Associative
Cross-Filter (M1), Measures Layer (M2), Report layout (M3), Stats
cell (M4), shelf-based chart authoring (M5), lineage edit mode (M6).
Their pure logic plus the cell/panel wiring that can't be
lazy-loaded pushed the shell to 599.9 KB / 600 KB at M1 — one
good-sized panel away from the gate failing on every commit.

**Amended:**

> **The shell budget is 750 KB.** `scripts/check-bundle-size.mjs`
> caps `dist/index.html` at `750 * 1024` bytes. **Lazy-loading
> remains the default** for any new heavy capability — the cap raise
> is NOT a license to dump dependencies into the shell. The rule is
> unchanged in spirit: a feature that pulls a multi-hundred-KB
> library still ships as a `src/lazy/<name>.ts` chunk fetched on
> first use. The raised number covers the accumulated *shared shell*
> (cell kinds, modals, the store, the schema panel) that every
> session pays on first paint regardless of which feature it uses.

**Why raise rather than lazy-load everything new:**

- The v1.3 surfaces are notebook-native cell kinds and panels, not
  opt-in heavy viewers. A stats cell or measures panel that pays a
  ~100 ms chunk-fetch tax on first click felt worse than a higher,
  honestly-documented shell budget. (We *did* lazy-chunk the
  measures panel — `src/lazy/measures-panel.ts` — when it tipped the
  shell over 600 KB at M2; the pattern stays available for future
  panels. The cap raise covers the surfaces where lazy-loading hurts
  UX more than it helps.)
- 600 KB was a v1.0-era number for a v1.0-era surface. The product
  is materially larger now — 9 cell kinds, 7 sidecar jobs, 5
  remote-source data planes. The budget should track the product,
  not a frozen snapshot.
- The lazy-load posture — the thing that actually keeps the shell
  from ballooning — is unchanged. CodeMirror (370 KB), Observable
  Plot (276 KB), MapLibre (1.0 MB), Cytoscape (443 KB), deck.gl
  (620 KB), Transformers.js (525 KB) all still load on demand. None
  are in the shell, and the cap raise does not move them in.

**Threat-model note (no new attack surface):** the bundle gate is a
*budget* control, not a *security* control. The byte-integrity gates
— SRI verification (A14), the postinstall hash-pin (A20), and the
CSP defence-in-depth set (A22) — are what protect the bytes, and
none of them change here. Raising the budget ceiling does not widen
any trust boundary: the shell is still build-time-produced from this
repo, the inline `<script>` is still SHA-256-pinned into
`script-src`, and lazy chunks are still same-origin. The only thing
750 KB changes is how much first-paint JavaScript the user
downloads.

**Status:** Raised at v1.3 M1 (`a0fa5cf`) — `BUDGET_BYTES = 750 *
1024` in `scripts/check-bundle-size.mjs`. Current shell 607 KB /
750 KB (142 KB headroom) after v1.3 M0–M6. This amendment is the doc
the script's user-facing error message ("Spec §7.1 (A30) caps the
shell at 750 KB") points at — written here to close forward-pass
finding C2.

---

## A31 — Resolve track M1: clustering / fuzzy-merge (new surface; amends spec §3.3 + §4.3)

**Amends:** §3.3 (notebook result + schema-panel affordances) and §4.3 (sidecar jobs).

**New surface — value clustering / fuzzy-merge.** A "Cluster" chip on every SQL
result and a per-column "Cluster values" action in the schema panel detect
variant spellings of a column's values (`Sharma Trading Co` =
`Sharma Trading Co.` = `SHARMA TRADING CO`) and emit an **additive** CASE-rewrite
SQL cell (`<col>__merged`) the user runs. Two OpenRefine-standard methods: key
collision (fingerprint) and nearest neighbour (Levenshtein, blocked + capped at
5,000 distinct values). Reuses the v1.2 M5 injection-safe emitter
(`quoteIdent` / `quoteLiteral`) — no new emitter, no string-concat path.

**§4.3 — sidecar Job 8 `propose-merge`.** Adds one job to the declared sidecar
scope ("narrow disambiguation, never prose"): given borderline value pairs it
returns a structured merge/keep decision + a canonical drawn from the inputs —
no narration, all-or-nothing per-pair reject on hallucination, per-pair
allowlist, three-layer guard like propose-chart (A28). Rides the existing BYOK +
local provider ladder; no new egress. Removable: delete the job and the
deterministic methods still cluster fully.

**Persistence:** none. M1 adds no `.naklidata` field — clusters are ephemeral UI
state; the durable output is an ordinary SQL cell that already round-trips.
Pre-M1 files are unaffected.

**Dependency:** `fastest-levenshtein` (~2 KB, MIT) — the one new runtime dep,
within the §7.1 750 KB shell budget (bundle 696 KB after M1).

**Hard NOTs preserved (§6):** no auto-apply (emit-then-run, Hard NOT #4), no
prose from the sidecar, no background processing, injection-safe by
construction, no remote writes.

**Status:** ratified + shipped (Resolve M1). See STATUS 2026-06-23, DECISIONS
AV–AZ. Companion design: `plan/resolve-track-vision.md`, `plan/resolve-m1-handoff.md`.

---

## A32 — Resolve track M2: segment primitive (`SEGMENT(name)`) (amends spec §3.3 + §3.8)

**Amends:** §3.3 / §3.8 (the semantic layer + the macro-expansion surface).

**New surface — segments.** A named, reusable boolean predicate over a table,
referenced via the **`SEGMENT(name)`** macro and managed in the Semantic layer
panel alongside measures (`MEASURE(name)`, A-prior) and dimensions
(`DIM(name)`, F1). `SELECT * FROM t WHERE SEGMENT(high_value_lapsed)` expands —
at the SAME single audited point as the other two macros (`expandMeasures`) — to
`WHERE (total_amount > 100000 AND last_seen < '2026-01-01')`. Pure client-side
macro expansion; no new SQL dialect. An unknown segment substitutes `FALSE` and
is surfaced as `Unknown SEGMENT(x)` before the cell runs. Validation reuses the
measure keyword/semicolon guard.

**Persistence:** a new optional `segments` field on `.naklidata` (mirrors how
`dimensions` shipped in v1.4). Pre-M2 files round-trip cleanly; no format-version
bump.

**Hard NOTs preserved (§6):** pure macro expansion; no server; emits a cell the
user runs (Hard NOT #4), never auto-runs; the definition lives in the workbook
description, never the data.

**Status:** ratified + shipped (Resolve M2, tag `v1.5.1`). See STATUS
2026-06-23, DECISIONS BB–BC. Companion design: `plan/resolve-track-vision.md`.

---

## A33 — Resolve track M3: golden-table sink (amends spec §3.4)

**Amends:** §3.4 (action sinks).

**New sink — Export golden table.** A seventh sink (alongside CSV / Parquet /
Export-anonymized / KanZen / Bahi / NakliPoster) that collapses a result to ONE
row per canonical entity (typically M1's `<col>__merged` column) and writes the
deduped table to a user-chosen folder as CSV or Parquet. Each non-entity column
collapses via a survivorship rule — keep-first / max / min / latest — mapped to
a fixed DuckDB aggregate (`first` / `max` / `min` / `arg_max(col, orderCol)`); a
'latest' rule needs an order column. Injection-safe: every identifier through
`quoteIdent`, the aggregate fn from an allowlist. Customer 360, inverted to
ownership — a file you hold, no profile-as-a-service.

**Persistence:** none — a new sink, no `.naklidata` change.

**Hard NOTs preserved (§6):** writes only to the folder the user explicitly
chose via the file picker; nothing leaves the tab except into the user's own
disk; no remote writes.

**Status:** ratified + shipped (Resolve M3, tag `v1.5.2`) — completing the
Resolve track (M1 → M2 → M3). See STATUS 2026-06-23, DECISIONS BD.

---

## A34 — Facet view-type track: a lazy-loaded, budget-exempt view-renderer layer (new surface; amends spec §3.1 + §3.3 + §7.1)

**Amends:** §3.1 (cell/view kinds), §3.3 (surfaces), §7.1 (shell bundle budget).

**New surface — the view-type layer (the "Facet track").** NakliData absorbs
Facet's sovereign tier (DECISIONS BE) as a new family of **view renderers over
the existing DuckDB substrate** — "one data shape (points + links + attributes),
many views." The columns present in a result decide the view it unlocks:

| Column(s) present | View |
|---|---|
| links (source, target) | Network (force) |
| + node/link type | Knowledge graph (typed filter + legend) |
| x, y (precomputed) | Embedding / semantic map |
| a time column | Temporal (scrubber, animate) |
| numeric on nodes/links | Weighted / attributed (color·size·width) |
| numeric column | Distribution (histogram, crossfiltered) |
| categorical column | Categorical (bars) |
| parent col / DAG edges | Hierarchy / tree |
| lat, lon | Geospatial (basemap + points) |

Views are **new renderers over the same result shape**, bound by a crossfilter
coordinator — not new apps. Each rides the same removable BYOK sidecar as every
other surface: every AI action lands as an **editable, staged** artifact in the
tool's own language (DuckDB SQL / view config), run through the deterministic
core so a wrong generation fails **loud** (empty result / engine error), never a
silently-applied plausible-but-wrong result. Nothing runs until accepted
(preserves Hard NOT #4: no auto-execution of LLM-generated SQL).

**Budget carve-out.** The GPU graph engine + view renderers will not fit the
§7.1 single-file core budget (750 KB, A30). The view-type layer therefore loads
**on demand** (via the existing `src/lazy/` split) and is **exempt from the
single-file core budget** — the core shell stays ≤ 750 KB; each view chunk is
gated by its own separate budget once the engine is pinned. This is the first
sanctioned exception to "one file"; it is a deliberate, bounded escalation
(a lazy chunk fetched only when a view opens), not a move off the sovereign
posture — data still never leaves the tab, no server, no telemetry on the free
tier.

**Commercial tier explicitly out of scope (Hard NOTs preserved, §6).** Team
rooms / relay-served AI / cloud sync / share-via-link / SSO / any server-side
backend are **not** part of this amendment or this repo — they remain a separate
future company (DECISIONS BE). The free tier never touches our infra.

**Gate before any view ships — M0.** The view shell is not built until the M0
free-AI gate passes: schema-grounded, loud-failing, safe NL→SQL + useful
low-latency local embedding search on a free rung (L1 Ollama-bridge / L2 WebGPU),
not only BYOK. This is folded into the owed Layer-3 local-inference item; the
eval runs against the existing sidecar. If free-tier AI clears only on BYOK, the
pitch restructures (free-AI → BYOK-AI) before shell work — a named escalation.

**Persistence:** TBD at scaffold time — a graph/embedding result is a cell like
any other; whether it persists as a new `.naklidata` cell kind or a view-pref
projection over an existing SQL cell is an M0-exit decision. No `.naklidata`
change yet.

**Status:** ratified (merge decision). **Not yet built** — M0 eval-gate is the
next actionable step (WebGPU-gated; see `plan/workplan.md`). Companion design:
`plan/facet-track-vision.md` + `plan/facet-m0-handoff.md`. See DECISIONS BE.

---

## Future amendments live here

Every spec deviation lands in this file with the same shape: original wording → amended wording → reasoning → status. Future-us reading the original spec doc should be able to cross-reference here to see what's still authoritative and what's been refined.
