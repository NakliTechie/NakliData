# Blocker — checked-in Iceberg reads require an authorized DuckDB-WASM migration

- Status: **candidate proven; runtime migration authorization required**
- Recorded: 2026-07-29
- Scope: Databricks Unity Catalog and Snowflake Open Catalog/Polaris data plane

## Why work stops here

The generic catalog client now negotiates configuration, browses objects,
loads table metadata, and owns short-lived S3/GCS/ADLS credentials through an
opaque in-memory lease. A no-install spike has also proven a viable runtime and
extension pair in Chromium. The missing checked-in component is a real target
that can use the metadata and credentials to perform a bounded Iceberg read.

NakliData pins `@duckdb/duckdb-wasm` 1.29.0, which embeds DuckDB 1.1.1. The
Iceberg `wasm_eh` extension is not published for that core revision, so
`src/core/mount.ts` correctly fails before any catalog or storage network
request. A real target therefore requires changing a runtime dependency,
worker/WASM assets, extension vendoring and hashes, and potentially engine
behavior across every existing source kind. The project rules classify that as
a stop line rather than an implicit upgrade.

The spike selected stable `@duckdb/duckdb-wasm` 1.32.0, embedding DuckDB
v1.4.3. Both `wasm_eh` and `wasm_mvp` loaded same-origin `httpfs`, `iceberg`,
`parquet`, and `avro` artifacts and returned the same five ordered rows from
DuckDB's official Iceberg fixture in real headless Chromium with zero console
errors. Exact candidate and artifact hashes, dependency closure, issues, and
migration steps are recorded in
[`docs/duckdb-wasm-iceberg-spike-2026-07-29.md`](docs/duckdb-wasm-iceberg-spike-2026-07-29.md).
`npm run warehouse:iceberg-candidate` now reproduces that proof from pinned
upstream bytes and also requires fail-closed behavior for extension 404, ignored
ranges, denied CORS, missing metadata, and missing data.

That proof did not change the dependency or vendored runtime. The project still
requires explicit authorization because upgrading the shared engine can affect
every existing source kind, worker bootstrap, CSP hash, integrity manifest,
and persisted relation path.

References:

- [DuckDB-WASM overview](https://duckdb.org/docs/stable/clients/wasm/overview)
- [DuckDB-WASM extension loading](https://duckdb.org/docs/current/clients/wasm/extensions)
- [DuckDB Iceberg extension](https://duckdb.org/docs/current/core_extensions/iceberg/overview)
- [DuckDB-WASM repository](https://github.com/duckdb/duckdb-wasm)

## Authorization needed

Approve the checked-in DuckDB-WASM migration using the proven 1.32.0/v1.4.3
candidate. It may update the pinned npm runtime, vendored workers/WASM files,
extension artifacts, integrity hashes, engine adapters, and affected
regressions. It does not authorize a deployment, live vendor credentials,
remote writes, or enabling generic or branded Iceberg source cards.

## Acceptance gate for the spike

1. Pin the proven, reviewed 1.32.0 package and record its embedded v1.4.3 core
   plus checked-in artifact hashes.
2. Vendor the dependency-complete `httpfs` + `iceberg` + `parquet` + `avro`
   mirror for both shipped EH and MVP variants under the approved same-origin
   path.
3. Retain the credential-free candidate gate and promote its successful public
   Chromium scan plus range/CORS/extension/metadata/data failures to the
   migrated runtime's production regression surface.
4. Implement the `VendedCredentialTarget` adapter with atomic replacement and
   clearing for S3, GCS, and ADLS; prove that refresh failure and workspace
   teardown remove engine credentials.
5. Preserve cancellation, response ceilings, redacted diagnostics, no remote
   writes, and no auto-execution of generated SQL.
6. Re-run CSV, TSV, JSONL, Parquet, SQLite, S3, notebook, persistence, and
   lineage regressions because the engine version changes their shared
   substrate.
7. Re-vendor and hash every changed runtime artifact; pass smoke, the complete
   unit suite, manual schema override, final static checks, and the 768 KiB
   inlined-shell gate.
8. Keep Databricks and Snowflake entry points disabled. Their live matrices
   remain separate and require safe user-supplied endpoints and credentials.
