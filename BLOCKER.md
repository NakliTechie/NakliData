# Blocker — bounded Iceberg reads require a DuckDB-WASM runtime migration

- Status: **authorization and dependency spike required**
- Recorded: 2026-07-29
- Scope: Databricks Unity Catalog and Snowflake Open Catalog/Polaris data plane

## Why work stops here

The generic catalog client now negotiates configuration, browses objects,
loads table metadata, and owns short-lived S3/GCS/ADLS credentials through an
opaque in-memory lease. The missing component is a real target that can use the
metadata and credentials to perform a bounded Iceberg read.

NakliData pins `@duckdb/duckdb-wasm` 1.29.0, which embeds DuckDB 1.1.1. The
Iceberg `wasm_eh` extension is not published for that core revision, so
`src/core/mount.ts` correctly fails before any catalog or storage network
request. A real target therefore requires changing a runtime dependency,
worker/WASM assets, extension vendoring and hashes, and potentially engine
behavior across every existing source kind. The project rules classify that as
a stop line rather than an implicit upgrade.

Current DuckDB documentation says the WebAssembly client supports dynamically
loaded signed extensions, but its generally available WASM extension list does
not currently name Iceberg. The dependency spike must prove the exact package
and extension pair empirically; selecting a version number is not enough.

References:

- [DuckDB-WASM overview](https://duckdb.org/docs/stable/clients/wasm/overview)
- [DuckDB-WASM extension loading](https://duckdb.org/docs/current/clients/wasm/extensions)
- [DuckDB Iceberg extension](https://duckdb.org/docs/current/core_extensions/iceberg/overview)
- [DuckDB-WASM repository](https://github.com/duckdb/duckdb-wasm)

## Authorization needed

Approve a dedicated DuckDB-WASM migration spike. It may update the pinned npm
runtime, vendored workers/WASM files, extension artifacts, integrity hashes,
engine adapters, and affected regressions. It does not authorize a deployment,
live vendor credentials, remote writes, or enabling branded source cards.

## Acceptance gate for the spike

1. Select and pin a reviewed, non-compromised DuckDB-WASM release; record its
   embedded DuckDB revision and exact artifact hashes.
2. Prove a signed Iceberg extension exists for every shipped WASM variant and
   can be served from the approved same-origin/mirrored path under the current
   CSP.
3. Run a public, read-only Iceberg metadata and bounded-row scan in Chromium;
   fail closed when extension, CORS, metadata, or data files are unavailable.
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
