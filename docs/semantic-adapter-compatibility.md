# Semantic adapter compatibility

Checked against the current vendor documentation on 2026-07-29:

- [Databricks Metric View YAML reference](https://docs.databricks.com/aws/en/uc-semantics/metric-views/yaml-reference)
- [Snowflake Semantic View YAML reference](https://docs.snowflake.com/en/user-guide/views-semantic/semantic-view-yaml-spec)

NakliData portable JSON remains the source of truth. Vendor YAML export/import
is a loss-aware projection, not deployment or live-platform verification.

## Databricks Metric View YAML 1.1

Represented:

- one root source and recursively discovered join source bindings;
- explicit fields, measures, synonyms, comments, and the global filter;
- portable number, percentage, INR, USD, and EUR measure formats;
- nested aliases with collision-safe portable names.

Diagnosed rather than silently changed:

- wildcard field/measure expansion, which requires the live source schema;
- join `on`/`using` relationship keys, nested cardinality, and `rely`;
- field/measure display names and format details outside the portable subset;
- window measures, parameters, and materialization;
- SQL query-source projection and lineage.

## Snowflake Semantic View YAML

Represented:

- multi-table physical bindings, table synonyms, dimensions, time dimensions,
  and facts;
- table-scoped metrics, derived metrics, and standalone table filters;
- entity-level `labels: [filter]` as a bound portable filter;
- primary keys only when their columns are present in the imported semantic
  fields;
- equality relationship column pairs;
- verified query name, question, SQL, verifier, and Unix-seconds timestamp.

Diagnosed rather than silently changed:

- unique keys and unbound primary keys;
- private access modifiers, tags, enum/search/sample metadata;
- non-additive dimensions and preferred relationship paths;
- ASOF/range relationship semantics;
- variables, onboarding flags, custom instructions, and materialization
  staleness;
- SQL base-table definitions as opaque bindings.

Portable deprecation is governance state, not Snowflake access control, and is
therefore never exported as `private_access`.
