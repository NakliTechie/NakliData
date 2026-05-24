# Decisions log

Append-only. Format per AGENTHANDOFF §5.

## 2026-05-24 17:00 — Wave 2 W2.3: custom-endpoint sidecar provider (OpenAI-compatible)
**Context:** pending.md W2.3 calls for a custom-endpoint sidecar to unlock local models (llamafile, vLLM, Ollama, LM Studio) and BYO inference gateways. The CSP rework in slice 1 already cleared the runway — what's left is the provider plumbing + settings UI.

**Decisions:**

- **(a) New `'custom'` value in the `SidecarProvider` union.** Sibling to `'anthropic'` and `'openai'`. BYOK key storage works as-is (provider-keyed). Settings persists provider + model + new `sidecarCustomEndpoint` URL field.
- **(b) New thin call function `callCustomOpenAI` in `src/core/sidecar/providers/custom-openai.ts`.** Mirrors `callOpenAI` but takes the endpoint URL at call time. URL auto-resolution handles three input shapes (bare base / `…/v1` / fully-qualified `…/v1/chat/completions`) so users can paste whatever their server documents.
- **(c) `SidecarTransportRequest` gains an optional `endpointUrl` field.** `SidecarDispatchOpts` gains an optional `customEndpoint`. Existing call sites in main.ts + define-type-modal.ts thread the value when the active provider is `'custom'`. No changes to the prompt-builder / response-parser layer — the custom provider returns the same OpenAI-compatible Chat Completions shape that `callOpenAI` consumes.
- **(d) Settings modal exposes the endpoint URL field only when `'custom'` is active.** A radio for the three providers, a hidden URL row that reveals on `'custom'`. Persists on every keystroke (same pattern as the model field). No "test connection" button — surfacing the actual HTTP error from the next sidecar call is more informative than a synthetic ping.
- **(e) Local `http://` endpoints stay blocked.** CSP is `'self' https:` (A5). Users running plaintext local model servers must front them with TLS (self-signed is fine; localhost cert exceptions don't apply to CSP). Documented in the modal hint + spec amendment A9.

**Tests:**
- 10 new vitest specs in `tests/sidecar-custom-endpoint.test.ts`: URL auto-resolution (3 input shapes), POST shape (headers, body, model passed through), empty-URL / empty-model `no-provider` errors, HTTP 429 → `rate-limit`, HTTP 500 → `http` with status in message, empty-content → `parse`.
- 228 vitest across 18 files (was 218 / 17 at slice 3b, +10).
- 31 Playwright e2e unchanged.
- Bundle 440 KB (was 436 at slice 3b; +4 KB for the new provider + settings additions).
- Smoke + tsc + biome green.

**Reversibility:** Easy. Drop `src/core/sidecar/providers/custom-openai.ts` + the `'custom'` branch in `defaultTransport` + the `customEndpoint` field on `SidecarDispatchOpts` + the radio option + URL field in settings-modal + the union expansion. Settings normalization gracefully ignores leftover `sidecarCustomEndpoint` / `sidecarProvider === 'custom'` values from saved settings.

---

## 2026-05-24 16:30 — Wave 2 slice 3b: Iceberg REST Catalog navigation (Bearer only)
**Context:** Slice 3a shipped table-by-URL. The natural completion is REST Catalog discovery (PondPilot parity, the actual UX users expect: "connect to my catalog, pick a table"). OAuth2 device flow + AWS SigV4 are the remaining auth modes; OAuth alone is 200+ lines of UX surface (device code prompt + polling).

**Decisions:**

- **(a) New `'iceberg-catalog'` SourceKind, sibling to `'iceberg-table'`.** The two flows differ enough that combining them would muddle the mount surface. Persistence shape differs (catalog tracks `(catalogUrl, namespace, table)`; table tracks `metadataUrl`). On reload the catalog source re-resolves via REST — fresh snapshots pick up automatically without the user knowing.
- **(b) New REST client module `src/core/iceberg/rest-client.ts`.** Self-contained, ~150 lines, takes an injected `fetchImpl` so tests can supply a fake. Implements the four endpoints we use (config, list namespaces, list tables, load table). Other Iceberg endpoints (commit table, drop table, etc.) are out of scope — NakliData is read-only against remote sources.
- **(c) Bearer-only for slice 3b.** OAuth2 device flow and AWS SigV4 are queued for v1.3. The OAuth UX needs a polling modal + token refresh; the SigV4 path needs AWS credentials chain handling (env vars + ~/.aws/credentials parsing — impossible in the browser without user intervention; would need the user to paste IAM keys, which is the same UX as the S3-endpoint flow's existing access-key/secret pair).
- **(d) Engine reuse.** `mountIcebergCatalog` calls `configureIceberg` + `registerIcebergTable` — the exact same engine path slice 3a uses. The catalog's only job is to resolve `metadata-location`; once we have that URL, the rest is identical.
- **(e) Nested namespaces via U+001F joiner.** Per the REST OpenAPI spec, nested namespaces collapse into a single URL path segment using the unit-separator character. We split on `.` for the user-facing input (so a user types `lakehouse.public.subschema` to address a 3-level namespace) and join with `%1F` in the URL. Single-level namespaces work identically to a plain path segment.
- **(f) Tolerant of catalog quirks.** `loadTable()` accepts both `metadata-location` (kebab-case, per spec) and `metadataLocation` (camelCase, used by some catalogs). REST errors surface as `IcebergCatalogError` with the HTTP status code attached.

**Tests:**
- 11 new vitest specs in `tests/iceberg-rest-client.test.ts` (auth header presence/absence, URL normalisation, nested-namespace encoding, kebab vs camelCase metadata-location, error wrapping with status).
- 4 new vitest specs in `tests/mount.test.ts` for `mountIcebergCatalog` (REST round-trip with mocked fetch, Bearer propagation to both catalog + engine, error wrapping, required-field validation).
- 218 vitest across 17 files (was 203 / 16 at slice 3a).
- 31 Playwright e2e unchanged (no new e2e — slice 3a's iceberg modal pattern + the REST client's unit coverage is sufficient).
- Bundle 436 KB (was 428 at slice 3a; +8 KB for REST client + modal).
- Smoke + tsc + biome green.

**Reversibility:** Easy. Drop `src/ui/mount-iceberg-catalog-modal.ts` + `src/core/iceberg/rest-client.ts` + the `'iceberg-catalog'` branch in `applyLoadedFile` + the `mountIcebergCatalog` function + the SourceKind union entry + the `IcebergCatalogConfig` interface. Existing `.naklidata` files with iceberg-catalog sources surface as reconnect-needed.

**Limitations:**
- Bearer auth only (see (c)).
- One Bearer per session (the engine's `extra_http_headers` is connection-wide; mounting a second iceberg-catalog with a different token clobbers the first).
- No UI for namespace + table discovery — user types both as text fields. A two-stage picker (load namespaces → pick → load tables → pick) is a slice-3c polish item.
- No table-action surface (rename, drop, etc.) — NakliData stays read-only.

---

## 2026-05-24 16:00 — Wave 2 slice 3a: Iceberg table-by-URL with optional Bearer auth; REST catalog + OAuth + SigV4 deferred to 3b
**Context:** PondPilot ships Iceberg via DuckDB; W2.1 in pending.md called for "Apache Iceberg REST + OAuth2 / Bearer / SigV4". The full surface — REST catalog navigation, OAuth2 device flow, AWS SigV4 — is several days of work. We ship the most common case first.

**Decisions:**

- **(a) Split W2.1 into 3a (this slice) + 3b (queued).** 3a = table-by-URL with optional Bearer. 3b = REST catalog browser + OAuth2 + SigV4. The split delivers the common case (private S3-backed Iceberg with simple auth, public CORS-friendly Iceberg tables) without the OAuth UX burden. Slice 3b stays in `wave-2-design.md` and `pending.md`.
- **(b) Two SourceKinds.** This slice adds `'iceberg-table'`. Slice 3b will add `'iceberg-catalog'`. Splitting the kinds lets the modals stay focused — table-by-URL is a 3-field form; catalog-browsing needs a tree picker. Different SourceKind = different persistence shape, different mount flow, different secret names.
- **(c) `extra_http_headers` over per-call signing.** DuckDB's `SET extra_http_headers = MAP { ... }` is connection-wide, like the S3 SET pattern. Bearer is applied to *every* httpfs request that session; this is fine for tables backed by a single host. For S3-backed Iceberg, the user mounts the bucket first (slice 2) so the S3 credentials are already set; the Iceberg slice just adds the Bearer for the catalog/REST surface, not the data files.
- **(d) Smart table-name derivation.** Iceberg's canonical layout is `<table>/metadata/v<N>.metadata.json`. The name-from-URL logic handles three shapes: a bare directory URL (use the last segment), `<table>/metadata.json` (parent dir), and the canonical `<table>/metadata/v<N>.metadata.json` (grandparent — detected by the literal `metadata` parent). Defaults to `iceberg_table` if all heuristics fail.
- **(e) Empty Bearer = public table; not saved.** Whitespace-only tokens are treated as no token. The persisted `iceberg.requires_bearer` flag tracks whether the user supplied one; on reload, we only look up a secret if the flag is true.

**Reasoning:** The full W2.1 spec is the kind of work that, attempted in one go, ships gold-plated foundation + broken UI. Splitting at the REST catalog boundary lets the foundation (engine + mount + secrets) prove itself in slice 3a before the auth-chain UX work in 3b builds on top.

**Tests:**
- 8 new vitest specs in `tests/mount.test.ts` for mountIcebergTable (configure call, Bearer pass-through, whitespace handling, table-name derivation across all three layouts, http(s)+s3 URL acceptance, file:// rejection, empty-URL rejection).
- 1 new e2e spec in `tests/e2e/mount-iceberg.spec.ts` (modal opens / focuses URL input / required-URL error / file:// validation / Cancel returns focus).
- Smoke green; full e2e 31/31; bundle 428 KB (was 420 at slice 2; +8 KB for the modal + engine methods).
- 203 vitest across 16 files (was 195 at slice 2, +8).

**Reversibility:** Easy. Drop `src/ui/mount-iceberg-modal.ts` + the `'iceberg-table'` branch in `applyLoadedFile` + the engine methods (`configureIceberg`, `registerIcebergTable`) + the SourceKind union entry + the `IcebergTableConfig` interface. Existing `.naklidata` files with iceberg-table sources surface as reconnect-needed.

**Limitations:**
- One Bearer token per session (`extra_http_headers` is connection-wide; mounting a second iceberg-table with a different token clobbers the first).
- For S3-backed Iceberg, user must mount the bucket via "Mount bucket" first.
- No catalog discovery — user must know the table's metadata URL.
- All deferred to slice 3b.

---

## 2026-05-24 15:30 — Wave 2 slice 2: S3-compatible endpoint mounting + per-source BYOK secrets
**Context:** Slice 1 wired public-URL mounts; this slice adds the auth + credential storage on top so users can point at S3 / R2 / MinIO / B2 / Wasabi. Three sub-decisions: (a) credential storage shape; (b) DuckDB config plumbing; (c) what `.naklidata` round-trips.

**Decisions:**

- **(a) Per-source BYOK in `src/core/secrets/source-secrets.ts`.** Mirrors the sidecar BYOK pattern (spec amendment A2). Identifiers are `(sourceId, secretName)` — a single source can hold multiple named secrets. `sessionStorage` default, opt-in IDB plaintext with honest labelling ("Anyone with access to this browser profile can read them."), `forgetSource(sourceId, names)` cleanup when a source is removed. Same honesty-over-theatre posture as sidecar BYOK; encrypting in-origin IDB with an origin-derived key is largely placebo since the JS that decrypts is also same-origin.
- **(b) `SET s3_*` over `CREATE SECRET`.** DuckDB's `CREATE SECRET` (introduced in v0.10) supports per-secret scoping, but the wasm 1.1.1 build doesn't ship it in a useful form yet. `SET s3_endpoint / s3_region / s3_access_key_id / s3_secret_access_key / s3_url_style` is connection-wide — one set of credentials per session. Documented limitation; a future enhancement can move to `CREATE SECRET` once the wasm build catches up.
- **(c) `.naklidata` carries endpoint config but never secrets.** New optional `s3` field on `PersistedSource` (`endpoint`, `region`, `bucket`, `path_prefix`, `url_style`). Secrets stay in `source-secrets`. On load, `applyLoadedFile` looks up the secrets — present → mount; missing → `reconnectNeeded`. Additive field, no format-version bump (per [DECISIONS 14:00](#2026-05-24-1400)).
- **(d) Endpoint normalisation.** `mountS3Endpoint` strips `http(s)://` and trailing slashes before passing to `s3_endpoint` (DuckDB wants the host-only form, e.g. `s3.amazonaws.com`). Path prefix has leading slashes stripped. Region defaults to `us-east-1` when blank.
- **(e) URL style is the user's pick, defaults to vhost.** AWS-native S3 uses virtual-host style (`bucket.endpoint`); MinIO / R2 / older S3 deployments need path style (`endpoint/bucket/...`). Slice 2's modal exposes a dropdown rather than auto-detecting — auto-detection has too many edge cases (region-specific AWS endpoints, custom subdomain configs).

**Reasoning:** Three things had to land together. Without the secrets module, mounting and persistence don't compose cleanly. Without `configureS3` + `registerS3Url`, DuckDB can't read the bucket. Without the `s3` field in `PersistedSource`, save/load doesn't round-trip. Splitting into more slices would force premature partial commits without working end-to-end value.

**Tests:**
- 8 new vitest specs in `tests/source-secrets.test.ts` (sessionStorage + IDB tiering, rotation, forget semantics, masked previews).
- 8 new vitest specs in `tests/mount.test.ts` for `mountS3Endpoint` (scheme stripping, path normalisation, format inference, required-field validation, unsupported-extension rejection).
- 2 new e2e specs in `tests/e2e/mount-s3.spec.ts` (modal opens / focuses endpoint / validates required fields / Cancel returns focus to trigger; URL-style picker exposes both options).
- Smoke green (no console errors, no regressions from the new modal CSS / wiring).
- Bundle: `dist/index.html` 420 KB (slice 1 was 412 KB; +8 KB for the modal + engine methods).
- Full gate: tsc + biome clean; 195 vitest (was 173 at v1.1.0, +22 across slices 1 + 2); 30 Playwright e2e across 19 spec files (was 26 / 17 at v1.1.0).

**Reversibility:** Easy. Drop `src/ui/mount-s3-modal.ts` + `src/core/secrets/source-secrets.ts` + the `'s3-endpoint'` branch in `applyLoadedFile` + the engine methods + the SourceKind union entry. Existing `.naklidata` files with `s3-endpoint` sources would surface as reconnect-needed.

**Limitations / follow-ups noted:**
- One set of S3 credentials per session (see (b)). Multi-bucket mounts with different credentials need `CREATE SECRET` work.
- The empty-state UI has two link-icon buttons (Paste URL + Mount bucket) — visually similar; consider distinct iconography in a future polish pass.
- "Forget keys for this source" is exposed only via source removal (cascades through `forgetSource`); a per-source UI affordance can come if users ask.

---

## 2026-05-24 15:00 — Wave 2 slice 1: public URL mount + CSP `connect-src` broadens to `'self' https:`
**Context:** Wave 2's value proposition is "point at your S3 endpoint, your Iceberg catalog, your public data URL." All of those are user-configured at runtime, unknown at build time. The explicit-host `connect-src` whitelist (jsdelivr / extensions.duckdb.org / naklitechie / anthropic / openai) shipped in v1.0 + v1.1 is incompatible with that. This slice does two things: (1) wires the latent `'http'` `SourceKind` end-to-end (engine, mount, UI, persistence, tests), and (2) broadens the CSP to make user-configured network egress possible at all.

**Decisions:**

- **(a) `connect-src` widens to `'self' https:` (only).** A meta-CSP-refresh pattern (multiple `<meta>` tags) only tightens CSP, never relaxes — it can't help. Per-user / per-deployment CSP would require a build-time configurator, which doesn't fit the static-HTML deployment model. `https:` is broader than the prior whitelist but still tighter than `*` (blocks plaintext HTTP, blocks `data:` / `blob:` fetches). `script-src` stays at `'self' 'wasm-unsafe-eval' 'sha256-<inline>'` — that's the actual primary XSS defence.
- **(b) Trade-off acknowledged.** A future XSS that bypassed the SHA-pinned `script-src` could exfiltrate to any HTTPS host. The mitigations: (i) the script-src protection is the primary defence, (ii) the user has explicitly authorized URLs they pasted in, (iii) NakliData has no escalation path from "see your data" to "see worse data" — the threat model is exfiltration, and broad `connect-src` does open that vector. We accept it because the alternative (building a per-deployment CSP) defeats the static-shell model.
- **(c) New `Engine.registerUrl({ tableName, url, format })` over a new `mountUrl(engine, { url, label?, tableName? })`.** The engine call is a thin `CREATE OR REPLACE VIEW ... AS SELECT * FROM read_<format>('<url>')`. No `registerFile` — DuckDB-wasm fetches the bytes directly via the browser's fetch (HTTP range requests on Parquet etc.). Slice 1 supports `csv`, `tsv`, `jsonl`, `parquet` only — those four ship in core DuckDB without an extension. Other formats (`xlsx`, `sqlite`, `geojson`, etc.) throw a `MountError` with a helpful pointer to the file-mount path.
- **(d) Persistence is the existing `PersistedSource.ref` field** — already typed as `string | null`. URL sources store the full URL there. `applyLoadedFile` adds a new branch: `ps.kind === 'http'` calls `mountUrl(engine, { url: ps.ref, label: ps.label })`. Failure surfaces via the existing `reconnectNeeded` path. No format-version bump (per [DECISIONS 14:00](#2026-05-24-1400)).
- **(e) UI: small focused modal (`src/ui/mount-url-modal.ts`) following the schema-graph + settings-modal pattern.** Reuses `.schema-graph-overlay` + `.schema-graph-modal` base styles with `.mount-url-*` modifiers. Focus management mirrors W1.11 fixes (focus to URL input on open; restore to trigger on close; Escape listener properly torn down). Slices 2 + 3 will add their own modals for S3 / Iceberg auth fields.

**Reasoning:** Two orthogonal concerns, one ship: (i) URL mount is itself a meaningful user-facing capability — public data dumps, government datasets, anything Parquet-on-CDN — and was always in the spec but never wired. (ii) Without the CSP rework, slices 2 + 3 can't ship either. Doing them together lets us amortise the trade-off discussion.

**Tests:**
- 8 new vitest specs in `tests/mount.test.ts` (mock-engine routing for `csv` / `tsv` / `jsonl` / `parquet`; default and custom label; query-string stripping; non-http(s) URL rejection; unsupported-extension error; extension-needing format hint).
- 2 new Playwright e2e specs in `tests/e2e/mount-url.spec.ts` (full UI flow with same-origin CSV; inline error rendering for empty + unsupported URLs).
- Smoke green (CSP rework didn't regress the existing CDN + extensions paths).
- Bundle: `dist/index.html` 412 KB — well under 600 KB.
- Full gate: tsc + biome clean; 173 vitest (was 165, +8); 28 Playwright e2e across 18 spec files (was 26 across 17, +2).

**Reversibility:** Easy. Revert the CSP back to explicit-host whitelist + remove `mount-url-modal.ts` + drop the `'http'` branch in `applyLoadedFile` + drop `Engine.registerUrl` and `mountUrl`. Existing `.naklidata` files with `'http'` sources would fail on load (silent reconnect-needed path).

---

## 2026-05-24 14:00 — `.naklidata` format-version bump policy: additive optional fields don't bump; required-field changes do
**Context:** v1.1 shipped two additive fields on the `.naklidata` schema (`user_types` at `b08d679`, `override_rules` at `0b14ff7`) without bumping `NAKLIDATA_VERSION` (still `'1.0'`). Both fields round-trip cleanly through v1.0 readers — missing-field defaults are `[]`, so old code doesn't choke. Future-us reading the code might be tempted to bump the version when adding any new field; this entry locks the policy in.
**Decisions:**

- **(a) Bump the version only on breaking changes to required-field shape.** The reader's gate is `if (compareVersion(obj.version, NAKLIDATA_VERSION) > 0) throw` — newer-than-known versions are rejected outright. A bump is a hard signal: "older readers must refuse this file." Reserve it for actual breaks: removing a required field, renaming one, changing a field's semantic meaning (same key, different shape), or promoting an optional field to required. Additive optional fields go in without a bump.
- **(b) Adding a new enum value to a non-required field is additive.** If an older reader sees an unknown `kind` it doesn't recognise, it should fall back gracefully (skip, log, or treat as 'unknown') rather than the format bumping. Already-shipped pattern: `MountedSource['kind']` grew from `'example-bundle' | 'fsa-folder'` to include `'fsa-file'` without a bump — older readers handle the unknown via the existing `reconnectNeeded` path.
- **(c) When a bump IS required, write a migration in `parse()`.** Today's `parse()` has a comment "Trivial migration path for v1.0 — just trust the shape." A real `1.0 → 1.1` migration lives next to that comment — translate the old shape to the new before returning. The version check in line 128 stays as the upper bound; the migration handles the lower bound.
- **(d) Document additive fields in the release notes' "Persistence / format" section** (the v1.1.0 notes do this; keep the pattern). Future readers checking "did this version add anything I need?" should find it there, not have to diff `persistence.ts`.

**Reasoning:** A bump is a one-way door for older readers. Sharing `.naklidata` files (via the file format itself or `?lens=` share links) means a careful reader posture: be liberal in what we accept, strict in what we emit. Additive optional fields keep the door open both ways.

**Tests:** Existing `tests/url-state.test.ts` round-trip covers additive-field forward-compat by virtue of the share-link path going through `parse()`. No new tests; this is a policy entry.

---

## 2026-05-24 13:00 — applyLoadedFile gets a promise-chain mutex; e2e save-load reverts its IDB-clear workaround and now exercises the race directly
**Context:** v1.1.0 review carryover. `applyLoadedFile` in `src/main.ts` is not safe to invoke concurrently — it calls `workbook.clear()`, awaits `mountExampleBundle(engine)`, then calls `workbook.addSources(...)`. Two interleaved invocations (boot-time `restoreFromActiveSession` racing an explicit `[data-action="load"]` click) both clear the empty workbook, both await the mount, then both append, producing 4 source cards instead of 2. The v1.1.0 e2e fix (commit 04feedc) papered over this in the test by `indexedDB.deleteDatabase('naklidata')` between save + reload — race avoided in the test, production bug intact. This entry resolves the underlying re-entrancy.
**Decisions:**

- **(a) Module-level promise chain, not a counted semaphore or Lock API.** Plain pattern: snapshot the chain's tail, build a new promise that `await prev` (swallowing the prior rejection — independent work) then runs the actual body, and publish that new promise as the new tail. JS single-threaded execution makes the snapshot/publish atomic without a real lock. Web Locks API would also work but pulls in a `navigator.locks` dependency for a one-call-site need; the promise chain is ~12 lines and self-contained in `main.ts` next to its sole consumer.
- **(b) Refactor body into `doApplyLoadedFile`, keep `applyLoadedFile` as the public name.** All three call sites (boot lens decode, boot snapshot restore, user Load click) stay unchanged; the serialisation is invisible to callers, who still `await applyLoadedFile(...)` and get the same rejection semantics.
- **(c) Errors from a prior invocation do not block the next.** `applyLoadedFile` calls are independent work — typically a different file or a different intent (auto-restore vs explicit Load). The original caller still receives its own rejection; the chain just guarantees ordering, not error coupling.
- **(d) Revert the e2e IDB-clear hack and let the test exercise the race.** `tests/e2e/save-load.spec.ts` no longer clears IDB between save and reload, so auto-restore actually fires concurrently with the explicit Load click — the test now asserts the contract the mutex provides (final state = 2 source cards, not 4). The empty-state assertion between reload and Load is gone (it wouldn't hold once auto-restore runs). Test still passes at ~8s (was ~2s; the extra time is the redundant auto-restore + Load both running, which is the point).
- **(e) Why not "have the load handler await any pending restore" instead?** That sketch covers the boot-restore-vs-Load case, but not Load-vs-Load (two quick Load clicks), Load-vs-lens-decode, or session-switch-vs-Load. A general mutex over the function covers every pairing without per-caller bookkeeping.

**Tests:** `tests/e2e/save-load.spec.ts` is the regression guard (reverting the mutex causes 4 cards instead of 2 → `expect(after.sources).toEqual(before.sources)` fails). Full smoke + 165 vitest + auto-restore + sessions e2e all green. No bundle delta (logic-only change in `main.ts`; 413 KB).

---

## 2026-05-23 23:00 — Theme 1 wave 3: vendor DuckDB extensions for offline smoke; pin to v1.1.1/wasm_eh; ship json + sqlite_scanner only (excel + read_stat deferred); SQLite mount stays browser-experimental until VFS bridge work upstream
**Context:** The smoke runner has long "tolerated" the JSONL access-log mount silently failing because the runtime tried to fetch `https://extensions.duckdb.org/${REVISION}/wasm_eh/json.duckdb_extension.wasm` which the sandbox blocks. The path forward is to vendor these extensions locally (same pattern as the duckdb-fallback wasm + worker) and point DuckDB at the vendored copy via `custom_extension_repository`. Three sub-decisions: (a) which extensions to vendor; (b) which DuckDB revision to pin; (c) how to wire the URL override.
**Decisions:**

- **(a) Vendor json + sqlite_scanner; defer excel + read_stat.** Empirical probe showed that for our pinned DuckDB-wasm 1.29.0 the bundled DuckDB-core revision is **v1.1.1** and only some extensions are actually published for wasm_eh at that version. `json` (680 KB) + `sqlite_scanner` (1.6 MB) are available; `excel` and the community `read_stat` are NOT present for that revision/platform. Vendoring what doesn't exist remotely is impossible without a different DuckDB-wasm pin. So this wave ships the two that work and logs the gap. Total vendored payload: ~2.3 MB at `public/duckdb-extensions/v1.1.1/wasm_eh/`. Not in the PWA precache (already explicitly excluded — see DECISIONS 2026-05-17 11:50 for the lite-cache decision), so it doesn't bloat shell load.
- **(b) Pin to v1.1.1/wasm_eh.** Read empirically from the DuckDB-wasm 1.29.0 binary (`strings duckdb-eh.wasm | grep v1.`). The fetcher's `REVISION` constant is documented to be kept in sync with the wasm package's PINNED if the wasm package bumps. This is a single point of truth — if duckdb-wasm bumps and the revision changes, the fetcher detects the missing files and re-downloads.
- **(c) URL override via `SET custom_extension_repository` at engine boot.** When `engine.boot({ offline: true })`, after the connection opens we run `SET custom_extension_repository = '${location.origin}/duckdb-extensions'` (and `SET autoinstall_extension_repository` for symmetry). DuckDB appends `/${REVISION}/${PLATFORM}/${NAME}.duckdb_extension.wasm` to that base. The SET is non-fatal on failure — extensions surface a clearer ExtensionLoadError later if the URL doesn't resolve. Online boots leave the default repo untouched so end-users still get fresh extensions on demand.
- **(d) SQLite mount stays not-wired-to-bundle.** Probed the actual SQLite ATTACH path on duckdb-wasm with the vendored sqlite_scanner. The extension loads cleanly, but `ATTACH 'finance.sqlite' (TYPE sqlite, READ_ONLY)` fails with `Unable to open database file` even when the bytes were registered via `db.registerFileBuffer`. Root cause: the SQLite extension uses its own VFS abstraction which doesn't bridge to DuckDB-wasm's in-memory VFS. The `.sqlite` mount path is part of the spec's 15-format list but on wasm it doesn't work today. **Scope:** the generated `tests/e2e/fixtures/sample-data/finance.sqlite` fixture stays — it's useful for whenever the VFS bridge work lands — but it doesn't ship in the example bundle's manifest and doesn't run in smoke. Tracked as a future Tier-1 item.
- **(e) Alias copies for INSTALL aliasing.** DuckDB resolves `INSTALL sqlite` to the `sqlite_scanner` extension internally. To avoid surprises if a future DuckDB version constructs the URL from either name, the fetcher writes the bytes under both `sqlite_scanner.duckdb_extension.wasm` and `sqlite.duckdb_extension.wasm`. Small ~1.6 MB cost; bullet-proofs the URL resolution.

**Side effect — sidecar e2e race exposed.** Adding the new offline-extensions e2e changed Playwright's workers=2 scheduling, which paired sidecar-flow's 2nd test with a different concurrent test and surfaced a latent race: a late-arriving classification update fires the workbook subscriber which re-renders the notebook mid-dispatch, replacing the sidecar-result mount node and losing the error message before the catch can write to it. Fix in test: wait for classification to stabilise before triggering Explain. Helper inlined (cloned from auto-restore.spec) rather than promoted to a shared module — a one-file dup is cheaper than the import cascade.

**Tests:** `tests/e2e/offline-extensions.spec.ts` asserts (i) ≥4 tables mount under `?offline=1` (the JSONL load uses the json extension); (ii) at least one fetch went to `/duckdb-extensions/...`; (iii) zero fetches went to `extensions.duckdb.org`. Smoke now asserts ≥4 tables (was a tolerant ≥3). 156 vitest unchanged + 25 e2e (was 24 → +1 offline-extensions) + smoke green at workers=2.

---

## 2026-05-21 17:00 — Theme 4 wave 2: side-by-side compare (B2), type-override learns (B3), demo / censor mode (B4) — one combined entry covering three small features that share a pattern
**Context:** Theme 4 wave 2 picks up the remaining schema-polish items from `plan/pending.md`. All three are small surface-area additions that don't change the core data model — but each has UX-shape choices worth recording. Combining into one decision entry because the reasoning rhymes (forward-acting, opt-in, derived-state-where-possible).
**Decisions:**

- **B2 — Compare-tables modal (not a cell kind).** A cell kind would require a state shape, a persistence story (`.naklidata` would have to carry comparison snapshots), and serialisation rules. The pitch is "inspect quickly, then move on" — perfect for an ephemeral modal. SQL the user wants to keep can be copied into a regular SQL cell (the modal doesn't yet expose the underlying SQL but the engine method is exported and a future "copy as SQL" button is cheap). Auto join-key detection uses workbook assignments (typeIds both tables have at least one assigned column for) — when zero candidates, the modal shows a helpful hint ("Accept types on both sides first"); when multiple, user picks. `IS DISTINCT FROM` for the diff predicate so NULL/NULL doesn't count as a diff (matches user mental model).
- **B3 — Override rules are opt-in via post-Override toast, not automatic.** Automatic "remember every override forever" would surprise users and create silent rule-creep. The "Remember" affordance on the toast keeps the gesture explicit. Removing a rule does NOT rewind previously-applied assignments — rules are forward-acting; the user can manually re-override the affected columns if they want to roll back. Rules are persisted to `.naklidata` (new `override_rules` field, missing field defaults to `[]` so legacy v1.0 files load cleanly), so they survive reload + share-link round-trips. Applied during `classifyMountedSources` + `reclassifyAllSources` for any column whose existing assignment is `origin: 'detector'` or `'unknown'` (user-curated origins on a SPECIFIC column always win over the rule on that specific column).
- **B4 — Demo mode is JS-side label replacement, not CSS-blur.** CSS `filter: blur` is screenshot-OCR-recoverable. Replacing the text node content gives true redaction. Implementation: a small `maskLabel(kind, original)` helper with per-kind in-memory maps that allocate stable `<prefix>_<n>` tokens (`src_1`, `tbl_1`, `col_1`, `path_1`). The same `original` always returns the same token within a session so screenshots stay coherent. Off-mode is a pass-through. Surfaces threaded through: sources-panel source label + table name + origin tooltip; schema-panel table header + column row name; SQL result-table column headers. SQL cell text + result row values are NOT masked — those are the user's call (we can't mask the SQL without breaking the cell). The Settings modal exposes a checkbox; toggling dispatches `naklidata-demo-mode-changed` on `document`, which main.ts listens for to re-render the affected surfaces. Data-* attributes that drive handlers (`data-column`, `data-source-id`) keep the REAL identifier so interaction still works after masking.

**Tests:** 3 new vitest files (`override-rules.test.ts` 11 specs, `compare-tables.test.ts` 5 specs, `demo-mode.test.ts` 8 specs) + 4 new e2e files. Smoke + full sweep green. Bundle 408 KB / 600 KB budget.

---

## 2026-05-21 15:30 — Column-profile panel (Theme 4 wave 1): full-table aggregate, on-demand only, derived state
**Context:** Theme 4's lead item is a column statistics panel — cardinality, null %, length distribution, top-k. Three sub-decisions: (a) sampled vs full-scan; (b) where the data lives (workbook state vs ephemeral cache); (c) UI shape (modal vs inline pane).
**Decisions:**
- **(a) Full-table aggregate, not sampled.** `Engine.sampleColumn` exists for the classifier — head + random tail of ~200 values, cheap, approximate. The profile panel is user-facing and the user expects "Rows: 80" to literally mean 80, not "~80". We pay one extra agg query per click; that's fine because the panel is on-demand (Profile button must be clicked) and big tables will simply pay big-table costs the user explicitly invited. New method `Engine.profileColumn(tableName, columnName)` runs two queries: a single-row aggregate (`COUNT(*)`, `null_count`, `distinct_count`, `MIN/MAX/AVG LENGTH(::VARCHAR)`) and a top-5 `GROUP BY ... ORDER BY cnt DESC LIMIT 5`. The `::VARCHAR` cast on `LENGTH` lets the same query work across all DuckDB types (numeric columns get digit-count length — a useful proxy without per-type branching).
- **(b) Derived state — module-scope `Map` in `main.ts`, not workbook state.** Profile is derivable from the engine + the column key; persisting it into `.naklidata` would bloat save files and risk stale numbers across reopens. Map keyed by `assignmentKey(sourceId, tableId, columnName)`; per-tab; cleared on workbook reset. The schema-panel renderer reads `profiles: Object.fromEntries(_columnProfiles)` as part of `SchemaPanelState`.
- **(c) Inline pane under the column row, not a modal.** The schema panel is a tall scrollable list — inserting a 5-row grid under the clicked column row stays in spatial context (you can compare neighbouring columns without re-opening). A modal would hide the surrounding columns and force re-clicks. The Profile button gets `aria-pressed` reflecting expanded/collapsed so it announces correctly to assistive tech. Top-k list is hidden when empty (no all-null columns get a phantom "Top values" header).
- **(d) Toggle behaviour: click expands and fetches, click again collapses + drops from cache.** Re-opening re-fetches. Stats are stable per-mount so we could cache forever, but a fresh fetch is cheap and avoids stale-data risk if we ever support live-editable sources. Simpler model.
**Tests:** `tests/e2e/column-profile.spec.ts` — clicks Profile on the first column, waits for `.schema-profile-grid`, asserts label set + top-k container, then clicks again and asserts the pane collapses. Also drops `tests/e2e/fixtures/sample-data/places.geojson` (5-feature FeatureCollection of Indian metros) as a future fixture for spatial e2e specs. No vitest needed: `profileColumn` is a thin SQL wrapper; the renderer is plain HTML.

---

## 2026-05-19 14:00 — Classifier integration of user types: merge into the worker's bundle, preserve user choices on re-classify
**Context:** Sidecar wave 3 (2026-05-18) made user-defined types persistent + applicable via the Override menu, but they didn't fire during classification — they were application targets only. Closing this loop has three sub-decisions: (a) how user types reach the classifier worker; (b) what detector shape each user type takes; (c) what happens to already-classified columns when user types change.
**Decisions:**
- **(a) Merge in the worker, not the main thread.** The worker tracks an `effectiveBundle = mergeUserTypesIntoBundle(bundle, userTypes)` and reads from it on every classify call. A new `set_user_types` message rebuilds the effective bundle. The main-thread `TaxonomyClient.setUserTypes(userTypes)` posts the message and waits for a `user_types_applied` ack. Caching the user-type list on the client lets us re-apply after a worker restart (no state lost).
- **(b) Two detectors per user type — regex + header_match.** The `regex` detector uses the user-supplied pattern. The `header_match` detector synthesises patterns from the type's id + display_name + the snake/space variants (`employee_id`, `employee id`, `employeeid` for "Employee ID"). Weights 0.6 + 0.4, confidence floor 0.5, sql_compat = `['VARCHAR']`. So a column named `employee_id` with values matching the regex hits confidence ≥ 0.9 (auto-accept); a regex-only or header-only match still clears the floor.
- **(c) Re-classification is opt-in, preserves user choices.** Adding a user type doesn't silently re-classify everything (could undo user accepts/overrides). A new "Re-classify with user types" button appears in the schema-panel toolbar when user types exist. Clicking it re-runs classification across all sources but skips columns where `origin === 'user_accept'` or `'user_override'` — those keep their assignment; only their candidate list refreshes so the new user types appear in the Override dropdown. Background re-classification on type-add would conflict with the "no auto-changes to user-curated state" implicit rule.
- **(d) User-type origin remains `'detector'`.** When a user-type fires during classification, the resulting assignment carries `origin: 'detector'` just like a bundled-type classification. The schema-panel display label falls back to userTypes when the bundle lookup fails (so `'employee_id'` typeId renders as "Employee ID"). The Override menu's existing "User types" group already distinguishes them in the UI.
**Reasoning:**
- Worker-side merge keeps the main thread thin and avoids re-sending the user-types list on every classify call. The `user_types_applied` ack confirms the worker accepted the new list; the client's local cache lets us survive worker restarts (e.g., if we ever add an explicit restart path).
- The regex + header_match pair mirrors how bundled types compose detectors — no new detector kind is needed. Synthesising header variants (snake/space/concat) covers the common ways a user might name a column for the type.
- Opt-in re-classify respects user agency: the user did the work of accepting/overriding existing columns; a new user type they just defined shouldn't auto-undo that. The button is discoverable when relevant + invisible otherwise.
- Keeping `origin: 'detector'` for user-type matches means there's no third "did the sidecar pick this?" origin — the audit trail stays binary (auto-detected vs user-curated). Future work could add a `'sidecar_override'` origin if usage tracking becomes important.
**Reversibility:** Easy. Delete `src/taxonomy/user-types.ts`, the `set_user_types` message in the worker + client, the `installUserTypesSync` in main.ts, the `onReclassify` handler + the Re-classify button in the schema panel, the user-types fallback in the assignedLabel computation. Existing `.naklidata` files with `user_types` would still load (workbook restores them); they'd just go back to being application-only via Override.
**Verification:** 9 new vitest specs in `tests/user-types.test.ts` covering `userTypeToTypeSpec` (regex + header_match detectors + variants); `mergeUserTypesIntoBundle` (non-mutating, empty-input shortcut, collision override); end-to-end `classifyColumn` against a merged bundle (user type fires on matching header+values; doesn't fire when neither matches; regex-only match still clears the floor; bundled types unaffected). Smoke green; e2e green (19 specs); `dist/index.html` 372 KB unchanged (no new dependencies; user-types.ts is small, the worker bundle is a separate output). tsc clean. biome 0 errors / 14 warnings (pre-existing). **132 vitest** (was 123; +9) + 19 Playwright e2e + smoke green.

## 2026-05-18 19:00 — AI sidecar wave 3: define-new-type with per-workbook user types
**Context:** Wave 3 = spec §4.3 job 3 ("define-new type assist"). Three layered design choices: (a) where do user-defined types live in state, (b) where does the trigger live in the UI, (c) what's the editing flow.
**Decision:**
- **State scope: per-workbook (not global)**. `userTypes: UserType[]` lives on the workbook (`src/core/workbook.ts`); serialised into `.naklidata` files via the existing `user_types` field (was a `unknown[]` placeholder). Persisted across sessions via the IDB workbook snapshot; portable across machines via `.naklidata`.
- **Trigger: Override menu entry, not standalone button**. "+ Define new type from this column…" appears at the bottom of the existing Override dropdown in the schema panel, after the User Types group (if any) + the Compatible/Other types groups. Discoverable in the natural override workflow; doesn't add yet-another button per column row.
- **Surfacing user types in the override menu**: User types render at the TOP of the dropdown (after "unknown") in their own labelled group, with the accent color in the header. So when the user defines a type and then overrides another column, the new type is one click away.
- **Editing flow: dialog modal with both "ask sidecar to suggest" + "edit by hand"**. The user can fill the form manually OR click "Suggest with sidecar" which calls the new `define-type` job; the suggestion populates the form. User then reviews + Save. Both paths go through the same save → `workbook.addUserType` → `overrideAssignment` chain.
- **Job output: JSON `{id, display_name, category, regex}`**. The parser validates: id is snake_case (`/^[a-z][a-z0-9_]*$/`), all four fields are non-empty strings, regex compiles (`new RegExp(regex)`). Failures throw `SidecarError` with `kind: 'parse'` so the modal can surface the failure without saving a broken type.
- **Workbook ↔ schema-panel propagation**: `SchemaPanelState` gains `userTypes`; `main.ts` passes `wb.userTypes` on every render. The Override menu reads from state — no callback for user types since they're read-only at render time.
- **Classifier integration deferred**: user types don't yet feed back into the classifier. Future work — the classifier worker would need to re-load when a user type is added/removed. For wave 3 MVP, user types are application targets (via Override) but not auto-detection targets.
**Reasoning:**
- Per-workbook scope matches the rest of NakliData's model — workbooks are self-contained. A global "my custom types" library is a possible v1.2+ feature but adds new state surface (separate IDB store, "promote to library" UI). Defer.
- The Override-menu trigger is the most discoverable spot. Standalone buttons per column would clutter; a header-level "Define new type" surface would be hard to wire to a specific column's context (sample values, header).
- Synced suggest+edit is the right model. Pure-suggestion would lock users out when the sidecar isn't configured; pure-edit would miss the AI assist that's the point of wave 3. Either-or-both = covers both cases.
- The id-regex + RegExp compilation checks are non-negotiable — a saved user type with a broken regex would break override application + (eventually) classification.
**Reversibility:** Moderate. Delete `src/ui/define-type-modal.ts`, the `UserType` interface + `addUserType / removeUserType / setUserTypes` on workbook, the `user_types` propagation in `serialize` / `applyLoadedFile`, the `userTypes` field in `SchemaPanelState`, the Override-menu User Types section + "Define new type" button, the `DefineTypeJob` / `DefineTypeResponse` in `types.ts`, `buildDefineTypePrompt` / `parseDefineTypeResponse` + the dispatch case in `client.ts`, and the `define-new-type` action handler in `main.ts`. Existing `.naklidata` files with non-empty `user_types` would need a migration (currently they'd just load with `userTypes: []` since the field would be unread).
**Verification:** 9 new vitest specs across `tests/sidecar-client.test.ts` (`buildDefineTypePrompt`, `parseDefineTypeResponse` — clean parse, fence stripping, malformed JSON, missing fields, non-snake_case id rejection, invalid regex rejection, `dispatchJob` happy path). No new e2e — the modal opens via a real menu click, sample re-fetch via `engine.sampleColumn`, sidecar dispatch via the same machinery as waves 1+2 already cover. Smoke green; `dist/index.html` 372 KB (was 360; +12 KB for modal + persistence + types). `tsc` clean. `biome` 0 errors / 14 warnings (pre-existing). 123 vitest (+9) + 19 Playwright e2e + smoke green.

## 2026-05-18 18:00 — AI sidecar wave 2: type-disambiguation as a one-token job; apply via existing override path
**Context:** Wave 1 shipped explain-query-error + the full BYOK / settings / dispatch plumbing. Wave 2 adds spec §4.3 job 1: column with multiple candidate types in [0.5, 0.9) confidence → sidecar picks one or returns `unknown`. Two integration choices: (a) wire the trigger into the schema panel (the spec's most-important surface), or somewhere else; (b) handle the result as a fresh write to the assignment, or reuse the existing `overrideAssignment` path; (c) what should the prompt + parser tolerate.
**Decision:**
- **UI**: "Ask sidecar" button rendered in the schema-column row when `isAmbiguous(a)` returns true (≥2 candidates + assigned confidence ∈ [0.5, 0.9) + origin = 'detector'). Hidden by default; CSS `.app-sidecar-enabled .schema-sidecar-ask { display: inline-flex }` reveals it. No re-render of the schema panel is needed when sidecar is enabled/disabled — the toggle is purely visual.
- **Result handling**: reuse `overrideAssignment(sourceId, tableId, columnName, typeId)`. That sets `origin: 'user_override'` + the candidate's confidence, exactly what the user would have gotten via the manual Override menu. `typeId: null` → toast "Sidecar wasn't confident" and don't touch the assignment.
- **Prompt**: one-token output, no JSON. The system prompt forbids prose / code fences / quotes. The parser strips wrapping quotes + backticks + fences defensively + matches case-insensitively against the candidate ids. Off-candidate strings (model hallucinates a typeId that isn't in the list) coerce to `null` rather than throwing — the user-friendly fallback. Empty string also → null.
**Reasoning:**
- Reusing `overrideAssignment` keeps the audit-trail single (`origin = 'user_override'` regardless of whether the user picked manually or the sidecar did). Future work could differentiate `'user_override'` from a new `'sidecar_override'` origin to track sidecar usage, but spec §4 doesn't require that for v1.1 and the workbook schema would need to evolve.
- The one-token format (not JSON) is per the spec — "Strict one-token answer, temperature 0." It's also cheaper on every model since the response is bounded to ~10 tokens.
- The CSS-gated visibility (no schema-panel re-render on toggle) means turning sidecar on/off mid-session is instant, no perceptible flicker. The button only renders when `isAmbiguous` says so, so disabled-sidecar users never see it even if CSS were missing.
- Defensive parsing: small models occasionally return `"pan"` or `` `pan` `` or `pan.` despite the no-quotes/no-period rule. Strip those rather than treating them as unknown — strict matching is fragile.
**Reversibility:** Easy. Delete `isAmbiguous` + `renderAskSidecarButton` + the CSS rule from `schema-panel.ts`; the `DisambiguateTypeJob` from `types.ts`; `buildDisambiguateTypePrompt` + `parseDisambiguateTypeResponse` + the dispatch case from `client.ts`; the `ask-sidecar-disambiguate` action handler + `runDisambiguateType` from `main.ts`.
**Verification:** 10 new vitest specs across `tests/sidecar-client.test.ts` covering the new prompt shape, sample cap (20), case-insensitive matching, off-candidate fallback to null, defensive stripping (quotes, backticks, periods, fences), unknown handling, full dispatch happy path. No new e2e — the dispatch + UI path is the same machinery as wave 1's `explain-error`, already covered by `tests/e2e/sidecar-flow.spec.ts`; the wave 2 deltas (prompt + parser + override application) are isolated and unit-tested. Smoke green; `dist/index.html` 360 KB (+4 KB; well under 600 KB budget). 114 vitest (+10) + 19 Playwright e2e + smoke green.

## 2026-05-18 17:00 — AI sidecar wave 1: BYOK + explain-query-error, two providers, no local model yet
**Context:** Spec §4.3 defines three sidecar jobs (type disambiguation, explain query error, define-new type assist) and a "Transformers.js + small model" default with BYOK Claude/OpenAI fallback. `plan/sidecar-architecture.md` argues the local-model path is a v1.2+ move because it depends on an eval harness we don't have. v1.1 should ship the BYOK path first to prove out the IPC + UI surface. Spec amendment A2 governs BYOK storage: sessionStorage by default + opt-in plaintext IDB with explicit user labelling.
**Options considered for the first shipping wave:**
- A) **BYOK-only sidecar, explain-query-error first** (chosen). One job, two providers (Anthropic + OpenAI), full BYOK storage + settings modal. Lays down all the plumbing; the other two jobs come in follow-up waves.
- B) Ship all three jobs at once. Larger first PR; harder to review; prompts for each job are independent so there's no leverage in bundling.
- C) Start with the local Transformers.js path. Drags in the eval-harness question that's explicitly v1.2+; doesn't ship a working sidecar today.
**Decision:** A. **explain-query-error** is the first job because (1) trigger is unambiguous (errored SQL cell), (2) input is bounded (SQL + error + optional schema hint), and (3) output is short (1-3 sentences + optional suggested SQL) so it's cheap on every model.
**Reasoning:**
- **Two providers from the start**, not one. Portfolio mandate is "BYOK is non-negotiable"; locking users to Anthropic on day one would be hostile. Anthropic + OpenAI cover the obvious cases; OpenAI-compatible custom-endpoint support can land in a later wave.
- **Browser-origin direct calls**, not via a relay. Anthropic supports the `anthropic-dangerous-direct-browser-access` header; OpenAI's CORS is open. Adding a relay would solve nothing today (the key is exposed to the user's tab either way) and would introduce a server piece v1.1 deliberately doesn't have.
- **CSP changes**: `connect-src` extended with `https://api.anthropic.com` + `https://api.openai.com`. Hard-coded for v1.1; custom-endpoint support means revisiting this.
- **Structured outputs**: system prompt forces JSON `{explanation, suggested_fix}`. Markdown code-fence stripping is defensive — some models add fences despite the rule. `suggested_fix` is null when the model isn't confident; the UI never auto-applies it (Hard NOT #4) — the user clicks "Copy SQL" which writes to clipboard.
- **Storage**: `src/core/sidecar/byok.ts` exposes `saveKey / loadKey / locateKey / forgetKey / forgetAllKeys`. sessionStorage path uses `naklidata.byok.<provider>`; IDB path uses `sidecar/byok/<provider>` in the shared kv store. `saveKey` clears the other store first so a key is never in both places.
- **Visibility**: sidecar disabled by default. Settings → Enable adds `.app-sidecar-enabled` to the app root; CSS gates the "Explain this error" button on errored SQL cells via that class.
**Reversibility:** Easy. Delete `src/core/sidecar/`, `src/ui/settings-modal.ts`, the Settings header button, the per-cell Explain button, the CSP additions, the sidecar settings fields, the two sidecar test files. No dependencies were added.
**Verification:** 17 new vitest specs across `tests/sidecar-byok.test.ts` (7) and `tests/sidecar-client.test.ts` (10). 2 new Playwright e2e specs in `tests/e2e/sidecar-flow.spec.ts`. `dist/index.html` 356 KB (was 340; +16 KB; well under 600 KB shell budget). `tsc` clean. `biome` 0 errors / 14 warnings (pre-existing). 104 vitest + 19 Playwright e2e + smoke green.

## 2026-05-17 18:30 — Map cell + GeoJSON mount: MapLibre lazy chunk, no basemap, DuckDB spatial extension
**Context:** Theme 2's last item is a map cell + a way to mount geographic files. Three layered choices: (a) what map renderer (MapLibre vs Leaflet vs custom SVG); (b) whether to include deck.gl for >10k-point performance; (c) tile basemap source (or no basemap); (d) how to mount `.geojson` files (DuckDB spatial extension's `ST_Read` vs `read_json_auto` with manual unpacking).
**Options considered:**
- **Renderer**: MapLibre GL (chosen, declarative GeoJSON layers, mature, BSD-3 ~1 MB lazy) vs Leaflet (smaller but raster-only, less expressive) vs custom SVG (smallest but a different rebuild of the wheel).
- **deck.gl pairing**: ship now (much bigger chunk; pays off only at >10k points) vs ship later when we have real workloads that need it (chosen).
- **Basemap**: vendor tiles vs MapLibre demotiles vs OSM tiles vs **no basemap** (chosen). Tiles need a CSP `connect-src` exception and pull external resources — orthogonal to v1.1's offline-friendly posture. Defer to a "configurable basemap" pass.
- **Mount path**: DuckDB `spatial` core extension via `ST_Read` (chosen) vs `read_json_auto` with manual `UNNEST` of `features[]` and struct unpack. Spatial is a core extension (no community-trust posture needed), gives users access to the full `ST_*` function library (downstream value), and produces a clean view with the geometry as a GeoJSON string column.
**Decision:** MapLibre lazy chunk + no basemap (transparent on the project background color) + DuckDB `spatial` for `.geojson` / `.kml` mounts. `ST_AsGeoJSON(geom) AS geometry, * EXCLUDE (geom)` so the JS side gets a GeoJSON-string column and never has to handle the GEOMETRY logical type.
**Reasoning:** MapLibre is the canonical browser GIS renderer; deck.gl can be added later as a paired chunk when point-density work shows up. No basemap keeps the v1.1 CSP unchanged and the privacy story clean ("your data never leaves the tab" — adding OSM tile fetches breaks that). MapLibre CSS isn't imported either — only matters for popups + zoom/attribution controls, none of which we use, and avoiding it skips an esbuild type-declaration shim. New cell kind (`MapCellState`) follows the chart/pivot pattern: input cell + geometry-column + optional color-by picker. Mount via `spatial` because `read_json_auto`-then-UNNEST gives users uglier downstream SQL.
**Reversibility:** Easy. Map cell: delete `src/lazy/maplibre-map.ts`, `src/ui/cells/map-cell.ts`, the `MapCellState` union member, the addCell branch, the "+ Map" button, the dispatch in renderNotebook, the LazyChunkRegistry entry; drop `maplibre-gl`. Mount: delete `registerSpatial` from engine.ts, the `'geojson' | 'kml'` union members from FileFormat, the `detectFormat` cases, the `registerFileByFormat` cases, the file-picker accept entries.
**Verification:** 3 new vitest specs in `tests/mount.test.ts` (`.geojson` / `.geo.json` / `.kml` format detection). 2 new Playwright e2e specs in `tests/e2e/map-cell.spec.ts`: literal-GeoJSON SQL → add map cell → pick input + geometry column → assert MapLibre canvas renders + chunk fetched; non-GeoJSON geometry column shows a friendly "no valid geometries" message and doesn't throw. `dist/index.html` 340 KB (+4 KB). `dist/chunks/maplibre-map.js` 1.0 MB lazy. 87 vitest + 17 e2e + smoke green.

## 2026-05-17 18:00 — Schema-graph view: modal + Cytoscape lazy chunk (taxonomy relationships)
**Context:** `plan/pending.md` Theme 2 specifies a "Schema-relationship-diagram view via Cytoscape.js, fed by `taxonomy/v0.1/relationships.json`." Two structural choices: (a) modal-on-demand, or (b) inline in a layout panel; what's the dependency model — Cytoscape inlined (~440 KB minified) vs lazy chunk; what's the data — workbook-level table-to-table edges (would require deriving ER relationships from mounted sources) vs taxonomy-level type-to-type edges (already encoded in `relationships.json`).
**Options considered:** A) Modal + lazy chunk + taxonomy-type graph (chosen); B) Inline panel in the schema-panel column; C) Workbook-level ER diagram derived from column-name + taxonomy-type matches.
**Decision:** A.
**Reasoning:** Modal is the right affordance density for a low-frequency, exploratory view — keeps the 3-panel layout focused on the active workflow and gives the graph the full viewport when needed. Cytoscape as a lazy chunk (436 KB) reuses the proven pattern (Plot, CodeMirror) and keeps the shell at 336 KB. The taxonomy-type graph is the smaller, immediately-shippable scope; the `relationships.json` file already exists with curated semantic links ('identifies', 'embeds', 'pairs_with', etc.). Workbook-level ER discovery (option C) is interesting but speculative — defer until we have a clear "what's the spec for an auto-discovered edge?" answer. The relationships fetch is now part of the taxonomy bundle load (load.ts), with the relationships field added optionally to `TaxonomyBundle` — non-breaking for the classifier, which doesn't read it.
**Reversibility:** Easy. Delete `src/lazy/cytoscape-graph.ts`, `src/ui/schema-graph.ts`, the LazyChunkRegistry entry, the `open-schema-graph` action handler, the panel-header button, and the modal CSS block; drop the `cytoscape` + `@types/cytoscape` deps. The `relationships` field on `TaxonomyBundle` would stay (it's optional and harmless) or get removed in the same edit.
**Verification:** 2 Playwright e2e specs in `tests/e2e/schema-graph.spec.ts`: clicking the schema-panel graph button fetches `/chunks/cytoscape-graph.js` (asserted via `page.on('request')` + `performance.getEntriesByType('resource')`), a `<canvas>` renders inside the graph region, the status line reports `N types, M relationships`, and Escape/backdrop/close-icon all dismiss the modal cleanly. `dist/index.html` 336 KB (+4 KB for the modal + button wiring; well under the 600 KB budget). `dist/chunks/cytoscape-graph.js` 436 KB (lazy). 84 vitest + 15 Playwright e2e + smoke green.

## 2026-05-17 17:30 — Pivot-table cell: new cell kind, in-memory pivot over upstream rows
**Context:** `plan/pending.md` Theme 2 calls for a "Pivot-table cell type (custom over DuckDB CUBE/ROLLUP)." Pivot tables cross-tabulate rows × columns × value; visually they're 2D tables, not charts. Two structural choices: (a) add as a new cell kind alongside SQL/chart/markdown, or (b) extend the chart cell with a `chartType: 'pivot'` variant. Compute choice: (i) run a separate `GROUP BY CUBE` query against the engine, or (ii) compute the pivot in JS over the upstream SQL cell's already-fetched `lastResult.rows`.
**Options considered:** New cell kind + in-memory compute (chosen); chart-type extension + in-memory; chart-type extension + extra DuckDB query; new cell kind + extra DuckDB query.
**Decision:** New cell kind (`PivotCellState`), in-memory pivot.
**Reasoning:** A pivot's output is a 2D table with row labels left, col labels top, value cells inside, plus row/column totals — that's structurally different from any chart type (which renders a single SVG via the chart-canvas region). Forcing it through the chart cell's picker UX would mean the existing chart-cell renderer becomes a "pivot OR chart" dispatcher with no shared rendering, which is the wrong abstraction. In-memory compute reuses upstream `.lastResult.rows` — already in memory, no engine round-trip, instant re-render when the user changes pickers. The "user might want to pivot more rows than the SQL cell returned" objection is handled by the user editing the SQL to return more rows (the natural NakliData workflow), not by the pivot cell silently issuing a different query. The pivot cell exposes the same shape as chart cell: input picker + row/col/value/agg pickers + delete button.
**Specifics:**
- Aggregations: sum / avg / min / max / count. Count works without a value column.
- Row + column totals shown only for sum and count (other aggs have no meaningful "total of averages" semantics); the `hasMeaningfulTotals` flag in `computePivot` gates the `<tfoot>` render.
- Display cap: 200 rows × 50 columns. Beyond that, render a "N more rows / M more columns hidden" footnote.
- BIGINT-from-DuckDB and numeric strings coerced via the same helper used elsewhere; non-numeric values silently dropped for sum/avg/min/max.
**Reversibility:** Easy. Delete `src/ui/cells/pivot-cell.ts` + the `PivotCellState` union member + the addCell branch + the "+ Pivot" button + the dispatch in `renderNotebook`. No engine changes to roll back.
**Verification:** 7 vitest specs in `tests/pivot.test.ts` (sum / count / avg / min / max / numeric coercion / null-picker / empty input). 1 Playwright e2e spec in `tests/e2e/pivot-cell.spec.ts` (full UI flow: SQL query → run → add pivot → pick row/col/value/agg → assert numeric cells + `<tfoot>` total). Bundle: 332 KB (+8 KB; pivot cell + types + notebook plumbing). 84 vitest + 13 e2e + smoke green.

## 2026-05-17 13:00 — Observable Plot as a lazy chunk for new chart types
**Context:** Theme 2 wave 1 calls for more chart types (pending.md: "From 7 chart types to 14, plus a map cell."). The v1.0 chart renderer is hand-rolled canvas+SVG with the Rangrez palette — fine for the 7 ship-with types (bar / line / area / scatter / histogram / stat / table) but expensive to extend type-by-type. Observable Plot gives us 30+ marks declaratively in one library.
**Options considered:** A) **Lazy chunk** — Plot bundled into `dist/chunks/observable-plot.js` via the existing lazy infrastructure; main bundle stays small; chart cell dispatches to the chunk only for Plot-rendered types. B) **Inline Plot** — pull Plot into the main bundle. Simpler dispatch, but blows the 600 KB shell budget (Plot + d3 is ~270 KB minified). C) **Migrate all 7 types to Plot** — uniform implementation. Larger refactor; risks losing the tight Rangrez-palette integration; extends the new-bundle-on-every-page penalty to the existing types.
**Decision:** A. New types only: **stacked-bar**, **area-stacked**, **heatmap**. Skipping pie (Plot doesn't ship a pie mark — philosophical choice; we'd need a custom arc adapter, defer) and faceted small-multiples (needs a third "facet-by" column picker on the chart cell, defer to the same UI pass as the map cell).
**Reasoning:** A reuses the lazy-loading infra from Theme 1 wave 2 (`src/lazy/<name>.ts` → `dist/chunks/<name>.js`). Plot dispatch in `src/charts/render.ts` is a one-liner: PLOT_TYPES set + fire-and-forget loadChunk + Plot rendering. Existing 7 types stay on the custom path (no behavior change). Plot's auto-pick-categorical-column heuristic (`pickCategory` in the lazy chunk) covers the common 2-column-aggregate case; users can refine via the existing x/y dropdowns. BIGINT-from-DuckDB coercion handled at the chunk boundary so Plot doesn't choke on `bigint` math.
**Reversibility:** Easy. Remove the PLOT_TYPES dispatch + the new chartType union members + the `src/lazy/observable-plot.ts` file; drop the `@observablehq/plot` dependency.
**Verification:** 2 Playwright e2e specs in `tests/e2e/plot-chart-types.spec.ts`: switching a chart cell to stacked-bar fetches `/chunks/observable-plot.js` and renders an SVG with mark elements; heatmap on inappropriate data falls back without throwing. `dist/index.html` 324 KB unchanged (Plot stays out of the shell). `dist/chunks/observable-plot.js` 273 KB (Plot + d3 internals; lazy). All 77 vitest + 12 Playwright e2e + smoke green.

## 2026-05-17 12:10 — Multi-session sidebar → header dropdown (not a 4th panel column)
**Context:** `plan/pending.md` Theme 3 wave 2 calls for a "Multi-session sidebar (à la OpenPlanter's `.openplanter/sessions/<id>/`)." OpenPlanter renders sessions in a left-rail sidebar. NakliData's shell is already a three-column layout (Sources 240px / Notebook fluid / Schema 320px); adding a fourth column would crowd the 1280–1440 viewport size most users have.
**Options considered:** A) Header dropdown — chip in the header (next to Search/Open/Save/Share) showing the active session name + a popup with new/switch/rename/delete. Zero impact on the panel layout. B) Literal left sidebar — add a 4th column. Most faithful to the pending.md wording, but expensive in horizontal real estate. C) Collapsible activity-bar rail (à la VS Code) — narrow icon strip on the far left that expands. Cleanest long-term but more upfront work; pulls in a navigation paradigm we don't have anywhere else.
**Decision:** A.
**Reasoning:** A keeps the canonical 3-panel layout intact (sources/notebook/schema is the product's mental model — Schema panel is *the most important surface* per handoff §9; the layout should reinforce that, not compete with it). Switching sessions is a low-frequency action; a dropdown next to Save/Share is the right affordance density. C is the right answer if/when we add multiple navigation contexts (templates browser, history view, etc.); revisit then. The pending.md wording was "sidebar" generically — switcher placement is implementation detail.
**Reversibility:** Easy. Promoting the dropdown to a full sidebar/rail is straightforward — the `renderSessionSwitcher` rendering function already lays out a vertical list; lift it into a panel container.
**Verification:** 13 vitest specs in `tests/sessions.test.ts` cover the CRUD + migration paths against an in-memory IDB shim (vi.mock). 2 Playwright specs in `tests/e2e/sessions.spec.ts` cover the full user flow: mount data → create new session (workbook clears) → switch back (state restored) + the can't-delete-the-last-session guard. Auto-restore tests still pass because they use `browser.newContext()` (fresh IDB) and the new boot path ensures a seed session before any restore attempt.

## 2026-05-17 11:50 — PWA: lite cache (shell + chunks), not full (incl. DuckDB-fallback)
**Context:** Theme 3 wave 2 calls for PWA installability — `manifest.webmanifest` + a service worker. The DuckDB-wasm vendored fallback at `public/duckdb-fallback/` is 74 MB (38 MB MVP wasm + 33 MB EH wasm + ~1.5 MB workers). Precaching that lets a PWA install boot fully offline; not precaching keeps the install lean.
**Options considered:** A) **Lite** — precache the shell (index.html), chunks (`codemirror.js`), `taxonomy.worker.js`, manifest, icon. ~680 KB total. DuckDB-wasm still fetches from CDN on first run (or from `public/duckdb-fallback/` if `?offline=1`, getting cached opportunistically by the SW). B) **Full** — additionally precache the DuckDB-fallback bytes. ~75 MB cache footprint on install. C) **Tiered** — precache the EH wasm + worker (~34 MB), skip MVP. ~35 MB.
**Decision:** A.
**Reasoning:** A 75 MB cache install is hostile to users' device storage and bandwidth, especially for users who try the install and bounce. Most users never need true-offline DuckDB; they have network when they open the app. The opportunistic-caching path (SWR for same-origin GETs) means a user who *does* boot with `?offline=1` once gets the wasm cached for next time, free. C is a middle ground but adds complexity for marginal benefit. A keeps the install proposition simple: "installs as an app, offline shell, automatic updates." Users wanting hard offline can use `?offline=1` once to seed the wasm cache.
**Reversibility:** Trivial. The PRECACHE_PATHS array in `public/sw.js` can be expanded with the duckdb-fallback paths in one edit; bump CACHE_VERSION to force re-install. No code architecture change needed.
**Verification:** `tests/e2e/pwa.spec.ts` — 2 specs: manifest is linked + parseable + declares maskable icon; SW registers + precaches the shell + chunks + manifest, and serves the cached shell when `context.setOffline(true)` + reload. SW skipped in DEV (`process.env.NODE_ENV !== 'production'`) to avoid stale-asset surprises during esbuild watch.

## 2026-05-17 11:30 — URL-state sharing: gzip + base64url in `?lens=`
**Context:** `plan/pending.md` Theme 3 wave 2 calls for `?lens=<base64>` round-tripping the `.naklidata` description (no data) so a user can share a workbook layout via URL. `.naklidata` JSON for a realistic workbook (e.g., the 4-source example bundle + 20 classified columns + 50 cells) is 5–50 KB. Naive base64 of that easily blows past common URL limits (~8 KB).
**Options considered:** A) Plain base64 of the JSON — simple, but realistic workbooks won't fit in URL. B) Gzip-compress, then base64url-encode — same browser-floor APIs we already require (`CompressionStream`/`DecompressionStream` since Chrome/Edge/Opera 122+), no new deps, 3–5× smaller payloads on JSON. C) Bring in a JSON minifier + dictionary compression library — heavier, more code, marginal gain over gzip on JSON.
**Decision:** B.
**Reasoning:** `CompressionStream('gzip')` is exactly what the spec's browser floor already mandates, so no new capability requirement. Base64url (rather than plain base64) means the encoded string is URL-safe out of the box — no `encodeURIComponent` wrapping needed. New `src/core/url-state.ts` is ~85 lines; no dependencies. Reused `persistence.ts` `parse()` for decode-side validation so version checks + format check are honored exactly the same as a `.naklidata` file load. Soft warning at ~7.8 KB URL length (still copies; user gets a hint). On bad lens, fall back to the IDB snapshot rather than empty state — less surprising than wiping the user's work because someone sent them a malformed link.
**Reversibility:** Easy. Remove `?lens=` handling in `main.ts` boot block + the `share-link` action + the Share button in `shell.ts`; `url-state.ts` becomes dead code that can be deleted.
**Verification:** New `tests/url-state.test.ts` (4 vitest specs — round-trip, compression ratio, malformed-base64 rejection, non-`.naklidata`-payload rejection). New `tests/e2e/url-state-share.spec.ts` (2 Playwright specs — Share button → opening the link in a fresh context restores the workbook + URL is cleaned via replaceState; corrupted lens falls back to empty state without throwing). Bundle: 316 KB → 316 KB (url-state.ts adds ~2 KB code, no new dependencies). All 64 vitest + 6 e2e + smoke green.

## 2026-05-17 11:30 — Playwright config: align env-var convention + cap workers at 2
**Context:** `tests/e2e/playwright.config.ts` had the same web-sandbox hardcoded chromium path as `scripts/smoke.mjs` (under a `CHROMIUM_PATH` env var) and let Playwright fan out to N-CPU workers. On desktop with a fresh `npx playwright install chromium`, the hardcoded path doesn't exist; on a 4+ core machine, 4 parallel chromium processes booting DuckDB-wasm in parallel triggered "Engine: ready" timeouts on the slower workers.
**Options considered:** A) Same env-var fallback pattern smoke.mjs uses (`PLAYWRIGHT_CHROMIUM_PATH`); B) Auto-detect via Playwright's default `executablePath` heuristic only; C) Set workers=1 to fully serialize.
**Decision:** A + cap workers at 2.
**Reasoning:** A keeps the sandbox harness working (it can export `PLAYWRIGHT_CHROMIUM_PATH` to override) without breaking on a vanilla desktop install. Falls through to the existing `CHROMIUM_PATH` env var for back-compat with anything already setting it. `workers: 2` is a middle ground — full speed-up over serial, but doesn't fight DuckDB-wasm boot for CPU/memory on typical dev laptops. Override at the command line with `--workers=N` on beefier boxes.
**Reversibility:** Trivial — one file.
**Verification:** All 6 e2e tests green with `--workers=2` (was 4 failing intermittently on `--workers=4` due to engine-boot timeouts).

## 2026-05-17 11:10 — Smoke script: env-var override for chromium path
**Context:** `scripts/smoke.mjs` hardcoded `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (the web-sandbox path). Fresh clone on the user's desktop (macOS, Playwright installs to `~/Library/Caches/ms-playwright/`) fails immediately with "executable doesn't exist".
**Options considered:** A) Always use Playwright's default `chromium.launch()` — works on desktop but breaks on the sandbox; B) Env-var override (`PLAYWRIGHT_CHROMIUM_PATH`) with Playwright's default when unset — works on both; C) Detect OS and branch.
**Decision:** B.
**Reasoning:** Single env var keeps the script portable. Sandbox can export `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/...` in its harness setup; desktop runs `npm run smoke` and Playwright finds the bundled chromium itself. No OS-specific branching, no failure modes from auto-detect heuristics.
**Reversibility:** Trivial. Single conditional in `scripts/smoke.mjs`.
**Verification:** `npm run smoke` green on desktop with no env var set — all 12 assertions pass, including ≥15 typed columns + chart SVG render + override sticks + zero console errors.

## 2026-05-17 03:50 — CodeMirror 6 returns as a lazy chunk (closes the 14:10 spec tension)
**Context:** Spec §7.1 gate "shell ≤ 600 KB" vs spec §1 + handoff §1 calling CM6 a recommended stack dep. DECISIONS 2026-05-15 14:10 deferred CM6 to a textarea for v1.0 with intent to restore as a lazy chunk before tagging. Theme 1 wave 2 added the lazy-splitting infra (`src/lazy/<name>.ts` → `dist/chunks/<name>.js` via esbuild), making this fix mechanical.
**Options considered:** A) Mount CM6 directly on first SQL-cell render (simple but blocks UI on the chunk load); B) Render textarea first, swap to CM6 once the chunk lands (no perceived wait); C) Defer further and ship v1.0 with textarea.
**Decision:** B.
**Reasoning:** Path B keeps the cell interactive immediately while still delivering the rich editor moments later. The async-swap path is straightforward because the textarea's content is just `getDoc()`'s seed for CM6. Per-cell-id `cmInstances` map means notebook re-renders don't recreate editors (otherwise focus + selection would reset on every change to any cell). `disposeSqlCellEditor(cellId)` releases the instance on cell delete.
**Reversibility:** Easy. Reverting collapses to textarea-only (the codepath that runs before the chunk arrives is still in place).
**Verification:** Shell 320 KB (under gate); CM6 chunk 370 KB lazy-loaded only when a SQL cell mounts; smoke test updated to check both textarea and `.cm-content` for SQL text; e2e + smoke + vitest all green.

## 2026-05-17 03:50 — DuckDB-wasm SRI pinning via integrity.json
**Context:** Spec §7.1 gate "DuckDB-wasm boots from CDN with SRI." The postinstall vendoring hook already copied the bytes into `public/duckdb-fallback/`; the missing piece was an integrity manifest the runtime could use to verify CDN-fetched bytes match the vendored ones.
**Options considered:** A) Hardcode SHA-384 hashes in `src/core/engine.ts` (drifts every DuckDB-wasm bump); B) Generate `integrity.json` from the vendored bytes at postinstall time + import + use it; C) Use SubresourceIntegrity attribute on `<script>` / `<link>` (doesn't apply — we fetch via `fetch()` then create blob URLs).
**Decision:** B.
**Reasoning:** `integrity.json` is generated from the same bytes that ship in `public/duckdb-fallback/`, so it can never drift. The runtime imports it as a JSON module (typed as `Record<string, string | undefined>` for the per-file lookup). `fetchWithSri(url, integrity)` uses fetch's native `integrity` option — the browser verifies before resolving the promise. Offline path skips SRI since the vendored bytes are themselves trusted (came from the postinstall hook). Worker JS + wasm both go through the verification.
**Reversibility:** Easy. Removing `fetchWithSri` falls back to plain `fetch` on the CDN path.
**Verification:** Shell builds clean; smoke test runs with `?offline=1` (vendored path) on every CI run; manual CDN-path verification done locally.

## 2026-05-15 13:00 — Develop in the environment-provided repo, not a new `NakliTechie/naklios`
**Context:** Handoff §1 names target repo `NakliTechie/naklios` "create on first commit; not yet existing." The container is wired to `NakliTechie/NakliData` with branch `claude/agent-handoff-start-3c2Ib` and the GitHub MCP scope is restricted to that repo. I cannot create new repos from here.
**Options considered:** A) Block and ask the human to create `NakliTechie/naklios`; B) Develop in `NakliData` on the designated branch and let the human rename / move later; C) Bail entirely.
**Decision:** B.
**Reasoning:** The handoff itself says "default to proceeding" on reversible decisions. Repo names are reversible (rename repo / push branch / fork). Stopping for hours on a name when scaffold code is identical regardless wastes the long autonomous window the human granted. Internal naming inside `package.json`, `meta name`, etc. uses `naklios` so a rename costs nothing inside the code.
**Reversibility:** easy (GitHub repo rename keeps history; push the branch to a new repo with a `git remote set-url` once it exists).

## 2026-05-15 13:05 — DuckDB-wasm pinned to 1.29.0
**Context:** Spec §1.2 says "pinned" but does not specify a version. v1.29.0 is the most recent broadly-deployed line as of my training cutoff (Jan 2026).
**Options considered:** A) Latest at build time (unstable); B) Pin to a specific minor (1.29.0); C) Defer until I can run `npm view` against the registry.
**Decision:** B — 1.29.0 in `package.json` and the vendoring script.
**Reasoning:** Pin satisfies the spec; we can bump in a separate commit if 1.30+ is available and stable. SRI-pinning of CDN URL comes when we wire the runtime loader.
**Reversibility:** easy (single string in `scripts/fetch-duckdb-fallback.mjs` and `package.json`).

## 2026-05-15 13:08 — Bundler is esbuild; SQL editor is CodeMirror 6
**Context:** Spec §8 lists both as recommended.
**Options considered:** esbuild vs Rollup; CodeMirror 6 vs Monaco.
**Decision:** esbuild + CodeMirror 6.
**Reasoning:** Spec recommendation; Monaco is too heavy for a 600 KB shell target.
**Reversibility:** medium for bundler; easy for editor (it's swap-in-place).

## 2026-05-15 13:12 — Sheet.js loaded from official CDN-tarball URL pinned in `package.json`
**Context:** Spec §3.3 requires SheetJS for `.xlsx` pre-parse. SheetJS is not on npm; their official distribution is the tarball at `cdn.sheetjs.com`.
**Options considered:** A) Pin the tarball URL in `dependencies`; B) Vendor a copy in `vendor/`; C) Skip xlsx until later.
**Decision:** A initially; **superseded** by the 13:20 entry below.
**Reasoning:** Tarball URL is a deterministic dependency; npm supports it natively. Vendoring adds a maintenance step for a library we don't modify.
**Reversibility:** easy.

## 2026-05-15 13:20 — Defer xlsx support; sandbox cannot reach `cdn.sheetjs.com`
**Context:** `npm install` failed with HTTP 403 on `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`. The container's egress policy doesn't permit that origin.
**Options considered:** A) Use the older `xlsx` package from the npm registry; B) Vendor a copy (also blocked — can't fetch the source); C) Defer xlsx until network or vendoring is sorted; build-order step 12 is "Excel, SQLite, Parquet file format support."
**Decision:** C. Removed the dependency from `package.json` for now. Spec §3.3 limitation copy stays in the README.
**Reasoning:** Excel is step 12 of 16 — we have plenty of v1.0 build runway before it's on the critical path. Avoid blocking step 2 (engine boot) on a tooling issue; revisit when we have a workable path (e.g., the human enables the origin, or we vendor a build).
**Reversibility:** easy — add the dep back and the engine wiring is straightforward.

## 2026-05-16 05:50 — DuckDB community-extension trust posture: opt-in `read_stat` for SPSS/SAS/Stata; SET allow_unsigned_extensions
**Context:** Theme 1 wires SPSS / SAS / Stata mounts via the `read_stat` community extension (the PondPilot path). DuckDB community extensions aren't signed by DuckDB Labs; loading them requires `SET allow_unsigned_extensions = true`. That toggle has real security implications — any signed extension we LOAD afterwards is also exposed to the unsigned-allowance window for that DuckDB instance.
**Options considered:** A) Refuse community extensions entirely; statistical formats stay unsupported. B) Allow community extensions globally on engine boot. C) Allow per-extension on first use; isolate to the specific extension(s) we trust by name.
**Decision:** C. `engine.ensureExtension('read_stat', 'community')` flips the toggle and installs by name. Other community extensions aren't auto-loaded; future additions get their own `ensureExtension(name, 'community')` call after a documented review.
**Reasoning:**
  - PondPilot already trusts `read_stat` and it's used by other browser-DuckDB tools in production; the extension is well-vetted in the community.
  - Toggling `allow_unsigned_extensions` per extension we explicitly trust is tighter than a global "allow everything." Future community-extension additions become explicit decisions, not a default.
  - User opt-in is implicit: they have to mount a .sav / .dta / .sas7bdat file for the extension to load. We can add an explicit "Allow community extensions?" settings toggle in v1.2 if customer-side governance demands it.
**Reversibility:** Easy. If a community extension turns out to be problematic, remove the relevant `ensureExtension` call.

## 2026-05-16 05:55 — Theme 1 (Format-import expansion): SQLite + DuckDB + Excel + SPSS/SAS/Stata via DuckDB extensions
**Context:** First user-visible feature push post-v1.0-scaffold. Adds six new file format mounts (`.sqlite`, `.db`, `.duckdb`, `.xlsx`, `.sav`/`.zsav`/`.por`, `.dta`, `.sas7bdat`, `.xpt`) via DuckDB core + community extensions, replacing the previously deferred SheetJS path.
**Options considered:** A) JS-native readers for each format (SheetJS for xlsx, sql.js for sqlite, custom for statistical formats). B) DuckDB core + community extensions as the single mount mechanism.
**Decision:** B.
**Reasoning:**
  - DuckDB has wasm builds of `excel`, `sqlite`, and community `read_stat`. One mechanism covers four format families.
  - SheetJS was already deferred per DECISIONS 2026-05-15 13:20 (sandbox blocks `cdn.sheetjs.com`) — using DuckDB `excel` extension closes that gap with no new external dep.
  - Multi-table formats (SQLite, DuckDB ATTACH, multi-sheet xlsx) need the register-method-returns-string[] refactor; the refactor is the right shape even without the new formats (a Parquet file with multiple "tables" via partitioning could use it later).
**Reversibility:** Each format is a separate register method; rolling back one doesn't disturb the others.
**Notes:**
  - Extension loading via `INSTALL` requires `extensions.duckdb.org` reachable. The dev sandbox blocks it; user's browser will succeed.
  - In the sandbox smoke run, the existing failure-tolerant mount path skips files whose extensions can't load. v1.2 should vendor a small set of extensions (sqlite, excel, read_stat) into the duckdb-fallback/ bundle for offline-grade smoke testing.

## 2026-05-16 05:15 — Enterprise data strategy: Compute Bridge as a sibling OSS repo; AI co-located in browser + bridge (split)
**Context:** Enterprise scenario ("data doesn't leave my S3/R2") under-addressed by the v1.1 Relay (which signs URLs but doesn't move compute into the customer's VPC). User raised the question explicitly; needed a deliberate strategy.
**Options considered:** A) Integrated submodule inside NakliData; B) Sibling OSS repo (`NakliTechie/nakli-compute`); C) Start integrated, split later. For AI placement: i) browser only, ii) bridge only, iii) both, split by job. For hosting: I) self-hosted forever, II) self-hosted + revisit, III) self-hosted + paid deploy-for-me service.
**Decision:** B (sibling OSS repo) + iii (split AI: browser baseline, bridge enhancement) + III (self-hosted + paid deploy-for-me later). Final license, wire-protocol nuances, and Tailscale-style overlay deferred to v1.3 MVP scoping.
**Reasoning:**
  - Sibling repo gives clean separation; users without enterprise needs never see the bridge code. Cleaner OSS distribution path.
  - Split AI is the correct posture because most users will never run a bridge — browser sidecar must work standalone. Bridge-side AI is enhancement, not replacement. Bigger models become feasible on bridge hardware where OPFS budget doesn't apply.
  - "Deploy for me" professional services preserves the no-SaaS posture while creating a path for customers who can't deploy themselves. Not multi-tenant, not recurring.
**Reversibility:** Easy for B (can absorb back into NakliData if it doesn't fit). Easy for iii (collapse to browser-only if bridge usage stays low). Hard to walk back from "paid services" once advertised, but easy to never start.

## 2026-05-16 05:20 — AI sidecar + BYOK is a NakliTechie-portfolio hard requirement (not just NakliData)
**Context:** User directive: every NakliTechie project — one-page apps and enterprise tools alike — must include an AI sidecar with BYOK. Projects without a credible AI role aren't worth building; older projects must be retrofitted or deprecated.
**Options considered:** A) Project-by-project decision; B) Portfolio-wide hard rule with retrofit obligation.
**Decision:** B.
**Reasoning:** Three threads converge: (1) the portfolio's compounding thesis — tools that can recognize each other's outputs reduce per-tool config; (2) the curated-taxonomy moat (NakliData's non-copyable asset) needs cross-tool AI hooks to compound; (3) the interface trend — tools without AI surfaces feel dated within 12 months.
**Reversibility:** Easy to relax; harder to retroactively add for projects already shipped without it. Hence the "retrofit or deprecate" framing.
**Storage:** Locked in `~/.claude/CLAUDE.md` (user-level memory across all sessions) and referenced from this repo's `CLAUDE.md` "Portfolio rules" section. Future NakliTechie projects: when starting a new repo, the FIRST question to answer is "what's the AI sidecar role here?"

## 2026-05-16 04:30 — Planning artifacts moved to `plan/`; backlog split into pending / declined / spec-amendments / product-shape
**Context:** `BACKLOG.md` at the repo root was conflating forward-looking work, decided non-work, and spec deviations into one file. The agent rules + status + decision-log files at root were also growing crowded.
**Options considered:** A) Keep one BACKLOG.md, just bigger; B) Move planning artifacts into a `plan/` folder with named files per concern.
**Decision:** B. New layout: `plan/pending.md`, `plan/declined.md`, `plan/spec-amendments.md`, `plan/product-shape.md`, `plan/README.md`.
**Reasoning:** Forward-looking content has different read-cadence and audience from the live ledger (STATUS / DECISIONS / CLAUDE). A folder per concern scales better as items accumulate.
**Reversibility:** easy — git mv anything back at any time.

## 2026-05-16 04:35 — BYOK key persistence: opt-in plaintext in IDB (v1.1 default); passphrase-encrypted variant planned for v1.2
**Context:** Spec §4 Hard NOT #2 ("no persistent storage of BYOK keys") was too aggressive — re-typing the key every tab is friction users won't tolerate. PondPilot's "encrypted in IDB" is largely security theatre when the encryption key has to live on the same origin to decrypt without user interaction.
**Options considered:** A) Plaintext-in-IDB, opt-in per key, honest UI labelling. B) Passphrase-unlocked: AES-GCM with PBKDF2-derived key, user enters passphrase per session. C) "Encrypted-in-IDB with on-origin-derived key" (PondPilot's posture, security theatre).
**Decision:** Default to A for v1.1 (when BYOK enters the product). Plan B as an opt-in v1.2 enhancement. Reject C.
**Reasoning:** Same-origin JS can always read same-origin storage; encryption-at-rest with an on-origin key gives no meaningful additional safety against the realistic threats. Honest plaintext + a "Forget" button is the most defensible posture for the default. Passphrase-encryption (B) materially helps against the "shared machine" threat and is worth offering — but it adds UX friction (passphrase per session) that not every user wants.
**Reversibility:** Easy. The amended Hard NOT (see `plan/spec-amendments.md` A2) explicitly preserves sessionStorage as the no-persistence escape hatch.

## 2026-05-16 04:40 — Workspace state persists in IDB by default (amends spec §2.3)
**Context:** The original spec §2.3 implied workspace state lived only in-memory + in saved `.naklidata` files. Starting from zero each session is hostile UX.
**Options considered:** A) Continue with no auto-persistence; B) Auto-persist workspace state (sources, assignments, cells, settings, FSA handle refs) to IDB on every change; auto-restore on tab open.
**Decision:** B.
**Reasoning:** Privacy posture ("data never leaves the tab") is unchanged — persistence is local-only, same origin. The FSA-folder permission has to be re-verified silently when possible and via a "Reconnect" banner otherwise (which is what spec §3.5 already requires). Scaffolding (`src/core/idb.ts`, `src/core/settings.ts`) is already in place; the wire-up lands in pending.md Theme 3.
**Reversibility:** Easy — disable the auto-save subscriber.

## 2026-05-16 03:30 — Project name locked: NakliData; file extension is `.naklidata`
**Context:** Spec/vision used "naklios" as a working codename ("Final name deferred per standing rule"). The repo is `NakliTechie/NakliData` and the human now treats that as the locked product name — fits the data ingestion / processing posture and aligns with the rest of the NakliTechie portfolio's naming.
**Options considered:** A) Keep "naklios" internally and only rebrand visibly later; B) Sweep rename `naklios` → `NakliData` and `.naklilens` → `.naklidata` now while the surface area is small.
**Decision:** B.
**Reasoning:** Cost of renaming later grows linearly with each commit, screenshot, and external mention. Right now it's contained in 17 files; in a month it's 100+. The format ID inside saved files (`"format": "naklidata"`) is also reset before any external `.naklilens` files exist in the wild — no migration cost.
**Reversibility:** medium (a `git revert` of this sweep + the package rename, if we change names later).

## 2026-05-15 14:10 — Ship v1.0 SQL editor as a tab-aware textarea; CodeMirror 6 deferred to a lazy chunk
**Context:** Handoff §1 lists CodeMirror 6 as a stack dep. Spec §1 recommends CM6 (Monaco acceptable). Spec §7.1 gates the shell at ≤ 600 KB. Inlining all of CM6 (lineNumbers + sql + autocomplete + commands + state + view) into the single-HTML build pushed the shell to 642 KB — over the gate. This is a spec-vs-spec tension (handoff §5 case 1) without a single right answer.
**Options considered:** A) Keep CM6 inlined and accept 642 KB shell (fails §7.1 gate); B) Drop CM6 to textarea for v1.0, restore as a lazy chunk before tagging (defers §1 dep); C) Implement code splitting now so CM6 ships as a separate runtime bundle alongside DuckDB-wasm and the taxonomy.
**Decision:** B for now, intending C before v1.0 tag.
**Reasoning:** B is the smallest reversible step that respects the §7.1 gate today. Textarea is fully usable for a v1.0 first cut — SQL syntax highlighting and autocomplete are nice-to-haves, not gating. C is the right end state; postponed because it requires reshaping esbuild config + the inline-single-HTML build mode, which is a bigger commit best done with the human's approval since it changes the architectural promise. Before v1.0 tag I'll either land C (preferred) or stop and ask if "shell ≤ 600 KB" is negotiable.
**Reversibility:** easy (single file restore + dep re-add).

## 2026-05-15 13:55 — 11 agent-seeded taxonomy types in v0.1 bundle
**Context:** Building Phase-1 detectors requires a taxonomy. Spec lists ~50 types across 3 domains but doesn't enumerate them. Per handoff §5 "Taxonomy seed gaps — handle locally, don't block."
**Options considered:** A) Build only the explicitly-spec'd types (gstin/pan/hsn/ifsc/etc.) and stop; B) Seed 30-50 types using public references and mark each agent-seeded one for human review.
**Decision:** B.
**Reasoning:** Spec §3.2 + §9 require seed_origin tagging when the agent adds fields. The 11 agent-seeded types (sac_code, indian_bank_account, pin_code, cin, udyam_id, gl_account, tds_section, swift_bic, unix_timestamp_s, percentage, probability, ip_v6) have confidence_floor 0.6 (vs the human default 0.5) so detection ambiguity surfaces clearly. Source references: SAC from CBIC services list; PIN from India Post; CIN from MCA; Udyam from MSME ministry; SWIFT/BIC from SWIFT.com; range bounds from common practice.
**Reversibility:** easy — remove or amend `seed_origin` lines in `taxonomy/v0.1/types.jsonl`.

## 2026-05-15 13:58 — Schema panel re-renders the full tree on every assignment change
**Context:** When 30+ columns classify in sequence, each `workbook.setAssignment` triggers a full schema-panel re-render. Open `<details>` collapse on each rerender.
**Options considered:** A) Diff-and-patch render (manual DOM reconciliation); B) Tiny VDOM lib; C) Accept full re-render for v1.0 and revisit if smoke test flags it.
**Decision:** C.
**Reasoning:** With ~30 cols and DOM-only operations the full re-render is ~5ms — well within an interactive budget. Open-details preservation can be fixed in a follow-up using `<details open>` attribute persistence per `(sourceId, tableId, columnName)` key.
**Reversibility:** easy.

## 2026-05-15 13:25 — Drop the placeholder DuckDB worker entry; use the vendor's worker directly
**Context:** Handoff §2 lists `src/workers/duckdb.worker.ts` in the repo structure. After implementing engine.ts, we load DuckDB-wasm's own bundled worker via `URL.createObjectURL` + `importScripts(bundle.mainWorker)` (the official pattern).
**Options considered:** A) Keep the placeholder file (no functional purpose) and shim our worker to forward to DuckDB's; B) Delete it.
**Decision:** B.
**Reasoning:** DuckDB-wasm's worker is the actual engine worker; wrapping it gains nothing and the indirection would just confuse readers. The taxonomy worker entry stays because we will own that worker's code.
**Reversibility:** easy — file is 8 lines.

## 2026-05-15 13:15 — Vendored Phosphor icon subset of 18 glyphs
**Context:** Spec §2.4 says ~30 glyphs total. Handoff says "vendored as SVG sprite."
**Options considered:** A) Inline path data in `src/tokens/icons.ts` (current); B) SVG sprite file imported with `?text` loader.
**Decision:** A.
**Reasoning:** Inlined path strings = zero runtime fetch, smaller delta in the single-HTML bundle target, and trivially tree-shakable. Sprite file adds an asset for marginal authoring benefit.
**Reversibility:** easy (swap the export shape; consumers all call `iconSvg()`).
