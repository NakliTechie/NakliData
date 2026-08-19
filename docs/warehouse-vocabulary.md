# Warehouse vocabulary

NakliData targets Databricks and Snowflake users through portable data concepts
first. These terms should be recognized in documentation, search aliases,
semantic imports, and future connector copy. Mentioning a term is not a claim
that its live product path has been verified.

## Portable foundation

- **Catalog hierarchy:** catalog, database, schema/namespace, table, view,
  materialized view, external table, managed table, volume/stage.
- **Storage and table formats:** object storage, Parquet, Apache Iceberg, Delta
  Lake, metadata manifest, snapshot, partition, clustering, compaction, schema
  evolution, time travel.
- **Ingestion:** batch, streaming, CDC, incremental load, file discovery,
  delimiter, encoding, quote/escape, schema inference, schema drift, type
  coercion, malformed/rejected row, rescue/quarantine, checkpoint, watermark.
- **Modeling and quality:** fact, dimension, measure/metric, grain, relationship,
  join path, cardinality, slowly changing dimension (SCD), data contract,
  freshness, completeness, uniqueness, accepted values, referential integrity,
  semantic drift, lineage.
- **Governance and access:** RBAC, ABAC, ownership, tags, certification,
  masking, row access, storage credential, external location, credential
  vending, least privilege, read-only.
- **Operations:** ELT, orchestration, task/job, notebook, query history, result
  cache, compute isolation, serverless, cost attribution, observability.

## Databricks language

- Lakehouse, Unity Catalog, catalog/schema, metastore, external location,
  storage credential, managed/external table, volume.
- SQL Warehouse / Databricks SQL, serverless SQL, Photon, cluster, notebook,
  workflow/job.
- Delta Lake, Delta Sharing, change data feed, `OPTIMIZE`, `VACUUM`, liquid
  clustering.
- Auto Loader, rescued data column, bad-record path, schema location.
- Lakeflow Connect and Lakeflow Declarative Pipelines; bronze/silver/gold
  medallion layers.
- Metric View, measure, dimension, join, semantic metadata.

## Snowflake language

- Account, database/schema, Virtual Warehouse, role, stage, file format,
  storage integration.
- Micro-partition, clustering key, pruning, query profile, result cache,
  multi-cluster warehouse, auto-suspend/resume.
- `COPY INTO`, validation mode, rejected records, Snowpipe, Snowpipe Streaming.
- Streams, Tasks, Dynamic Tables, change tracking.
- Secure Data Sharing, reader account, Marketplace, zero-copy clone, Time
  Travel, Fail-safe.
- Semantic View, logical table, fact, dimension, metric, verified query.
- Horizon Iceberg REST Catalog API, Snowflake-managed Iceberg table, external
  query engine, Open Catalog / Apache Polaris, catalog integration, external
  volume, credential vending.

## Business vocabulary exercised by the real-data corpus

- **Commerce:** order lifecycle/status; purchase, approval, carrier handoff,
  actual delivery, and promised delivery timestamps; payment method and
  installments; freight; seller; product category; item sequence; gross
  merchandise value (GMV); average order value (AOV).
- **People analytics:** hire/termination date, employment status, termination
  reason, manager, recruitment source, performance rating, engagement,
  satisfaction, absence, lateness, tenure, diversity source.
- **Country indicators:** country, region, calendar/reporting year, economic
  tier, rank, index, score, percentile, panel data, time series.
- **Geospatial:** latitude, longitude, geometry, point, WKT/WKB, geocoding,
  coordinate reference system (CRS/SRID), geohash, H3.
- **Physical products:** weight, length, width, height, unit of measure,
  dimensional weight.

## Copy rule

Use portable labels in the core product and place vendor aliases beside them
only where they aid discovery. Keep these claims distinct:

1. **Vocabulary recognized** — documentation or semantic alias exists.
2. **Fixture-conformant** — synthetic protocol/profile tests pass.
3. **Live verified** — a real endpoint, authentication flow, browse, bounded
   read, cancellation, refresh, and disclosure matrix has passed.

NakliData is currently at levels 1–2 for the warehouse work above. Branded live
connector entry points remain disabled until level 3.
