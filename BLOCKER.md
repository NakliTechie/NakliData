# Resolved blocker — checked-in Iceberg runtime migration authorized

- Status: **authorization granted 2026-07-30; implementation ready**
- Recorded: 2026-07-29
- Resolved: 2026-07-30 (DECISIONS FB-1)
- Scope: Databricks Unity Catalog and Snowflake Open Catalog/Polaris data plane

## Resolution

Chirag approved the exact checked-in DuckDB-WASM migration described below:
`@duckdb/duckdb-wasm` 1.29.0 → 1.32.0 and embedded DuckDB 1.1.1 → 1.4.3,
including the pinned runtime assets, same-origin extension closure, integrity
inputs, engine adapters, and required regressions.

The approved initial browser data plane is AWS-backed Databricks plus
S3/GCS-backed Snowflake Open Catalog/Polaris. Azure/ADLS stays unavailable.
The approval does not authorize deployment, vendor credentials, remote writes,
card enablement, tagging, publishing, or broader connector claims.

## Original stop-line rationale

The generic catalog client now negotiates configuration, browses objects,
loads table metadata, and owns short-lived S3/GCS/ADLS credentials through an
opaque in-memory lease. A no-install spike has also proven a viable runtime and
extension pair in Chromium. A checked-in DuckDB target now maps browser-proven
S3 session credentials and GCS OAuth bearer tokens to temporary scoped secrets,
but it cannot run on the pinned engine and is not wired into the product. The
missing checked-in component is therefore the authorized runtime/vendoring
migration and bounded-read integration.

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
ranges, denied CORS, missing metadata, and missing data. It additionally proves
actual credential-bearing ranged Parquet reads, transactional rotation,
rollback, and clear for local S3/GCS endpoints without exposing fixture
credentials in its result.

The same review found a provider-specific limit: the official v1.4.3 registry
returns 404 for both EH and MVP Azure extension artifacts. The target therefore
fails Azure/ADLS credentials before executor access. An authorized migration
can advance AWS-backed Databricks and S3/GCS-backed Polaris/Open Catalog paths;
it cannot honestly enable Azure-backed Databricks or ADLS-backed catalogs.

That proof did not change the dependency or vendored runtime. The project still
requires explicit authorization because upgrading the shared engine can affect
every existing source kind, worker bootstrap, CSP hash, integrity manifest,
and persisted relation path.

References:

- [DuckDB-WASM overview](https://duckdb.org/docs/stable/clients/wasm/overview)
- [DuckDB-WASM extension loading](https://duckdb.org/docs/current/clients/wasm/extensions)
- [DuckDB Iceberg extension](https://duckdb.org/docs/current/core_extensions/iceberg/overview)
- [DuckDB-WASM repository](https://github.com/duckdb/duckdb-wasm)

## Authorization granted

The checked-in DuckDB-WASM migration using the proven 1.32.0/v1.4.3 candidate
is approved under DECISIONS FB-1. It may update the pinned npm runtime,
vendored workers/WASM files, extension artifacts, integrity hashes, engine
adapters, and affected regressions. All release and external-access stop lines
remain in force.

## Acceptance gate for the spike

1. Pin the proven, reviewed 1.32.0 package and record its embedded v1.4.3 core
   plus checked-in artifact hashes.
2. Vendor the dependency-complete `httpfs` + `iceberg` + `parquet` + `avro`
   mirror for both shipped EH and MVP variants under the approved same-origin
   path.
3. Retain the candidate gate and promote its successful public Chromium scan,
   synthetic S3/GCS credential lifecycle, and
   range/CORS/extension/metadata/data failures to the migrated runtime's
   production regression surface.
4. Wire the checked-in `VendedCredentialTarget` for S3 and GCS; prove that
   refresh failure and workspace teardown remove engine credentials. Keep
   Azure/ADLS unavailable until a separately reviewed browser-capable data
   plane exists.
5. Preserve cancellation, response ceilings, redacted diagnostics, no remote
   writes, and no auto-execution of generated SQL.
6. Re-run CSV, TSV, JSONL, Parquet, SQLite, S3, notebook, persistence, and
   lineage regressions because the engine version changes their shared
   substrate.
7. Re-vendor and hash every changed runtime artifact; pass smoke, the complete
   unit suite, manual schema override, final static checks, and the 768 KiB
   inlined-shell gate.
8. Keep Databricks and Snowflake entry points disabled. Their live matrices
   remain separate, cloud-provider-specific, and require safe user-supplied
   endpoints and credentials.
