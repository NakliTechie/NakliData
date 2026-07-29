# Warehouse conformance harness

Run:

```sh
npm run warehouse:conformance
```

The harness drives the production lazy Iceberg REST client against two
in-process fixture profiles:

- Databricks Unity Catalog-shaped base URI, catalog-as-warehouse
  configuration, prefixed catalog routes, and inline S3 temporary credentials.
- Snowflake Open Catalog/Polaris-shaped base URI, catalog-as-warehouse
  configuration, nested namespaces, prefix override, and scoped Azure
  credentials.

It verifies configuration negotiation, route construction, namespace/table
browsing, load-table access delegation, non-secret credential summaries,
provider-shaped credential application to an in-memory mock target,
required-endpoint enforcement, secret-free public serialization, and the
invariant that the product's Iceberg source entry points remain unavailable.

The fixtures use synthetic URLs and obvious sentinel values. They make no
network requests and consume no user or CI secrets. Passing this harness means
the generic client accepts the documented protocol shapes; it does not verify
authentication, authorization, an actual DuckDB/storage read, a vendor refresh
endpoint, vendor-specific errors, rate limits, or cancellation against a live
service.

Live compatibility requires the platform matrices in
[`docs/warehouse-readiness.md`](warehouse-readiness.md). Do not enable or
market a Databricks or Snowflake connector based on this fixture suite alone.
