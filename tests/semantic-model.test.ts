import { describe, expect, it } from 'vitest';
import type { MountedSource } from '../src/core/mount.ts';
import type { PortableSemanticModel } from '../src/core/semantic-model-types.ts';
import {
  buildPortableSemanticModel,
  exportDatabricksMetricView,
  exportPortableSemanticModelJson,
  exportSnowflakeSemanticView,
  importDatabricksMetricView,
  importSnowflakeSemanticView,
  toYaml,
  validatePortableSemanticModel,
} from '../src/lazy/semantic-model.ts';
import type { TaxonomyBundle } from '../src/taxonomy/types.ts';
import type { ColumnAssignment } from '../src/ui/schema-panel.ts';

const taxonomy: TaxonomyBundle = {
  version: 'test',
  released: '2026-01-01',
  domains: [],
  relationships: [],
  types: [
    {
      id: 'order_id',
      display_name: 'Order ID',
      domain: 'commerce',
      sql_compat: ['VARCHAR'],
      detectors: [],
      confidence_floor: 0,
    },
    {
      id: 'amount',
      display_name: 'Amount',
      domain: 'finance',
      sql_compat: ['DOUBLE'],
      detectors: [],
      confidence_floor: 0,
    },
    {
      id: 'iso_date',
      display_name: 'ISO date',
      domain: 'temporal',
      sql_compat: ['DATE'],
      detectors: [],
      confidence_floor: 0,
    },
  ],
  universal: {
    terms: [
      {
        id: 'ut:identifier',
        prefLabel: 'Identifier',
        roleFamily: 'entity',
        sensitivity: 'public',
      },
      {
        id: 'ut:amount',
        prefLabel: 'Monetary amount',
        roleFamily: 'measure',
        sensitivity: 'financial',
      },
      {
        id: 'ut:time',
        prefLabel: 'Temporal',
        roleFamily: 'dimension',
        sensitivity: 'public',
      },
    ],
    crosswalk: [
      { role: 'order_id', universalTerm: 'ut:identifier' },
      { role: 'amount', universalTerm: 'ut:amount' },
      { role: 'iso_date', universalTerm: 'ut:time' },
    ],
  },
};

function assignment(columnName: string, sqlType: string, typeId: string): ColumnAssignment {
  return {
    columnName,
    sqlType,
    candidates: [],
    resolution: { kind: 'auto_accept' },
    assigned: { typeId, origin: 'detector', confidence: 0.99 },
    status: 'classified',
  };
}

const sources: MountedSource[] = [
  {
    id: 'src_orders',
    kind: 'compute-bridge-catalog',
    label: 'Warehouse',
    ref: 'https://bridge.example',
    bridgeCatalog: {
      bridgeUrl: 'https://bridge.example',
      requiresBearer: true,
      tables: [
        {
          name: 'prod.sales.orders',
          localName: 'orders',
          rowCap: 1000,
        },
      ],
    },
    tables: [
      {
        id: 'table_orders',
        sourceId: 'src_orders',
        name: 'orders',
        format: 'arrow',
        origin: 'prod.sales.orders',
        rowCount: 10,
        registered: true,
      },
    ],
  },
  {
    id: 'src_customers',
    kind: 'compute-bridge-catalog',
    label: 'Warehouse',
    ref: 'https://bridge.example',
    bridgeCatalog: {
      bridgeUrl: 'https://bridge.example',
      requiresBearer: true,
      tables: [
        {
          name: 'prod.sales.customers',
          localName: 'customers',
          rowCap: 1000,
        },
      ],
    },
    tables: [
      {
        id: 'table_customers',
        sourceId: 'src_customers',
        name: 'customers',
        format: 'arrow',
        origin: 'prod.sales.customers',
        rowCount: 5,
        registered: true,
      },
    ],
  },
];

function build(): ReturnType<typeof buildPortableSemanticModel> {
  return buildPortableSemanticModel({
    name: 'Revenue model',
    description: 'Orders and customers',
    sources,
    assignments: {
      'src_orders::table_orders::order_id': assignment('order_id', 'VARCHAR', 'order_id'),
      'src_orders::table_orders::order_date': assignment('order_date', 'DATE', 'iso_date'),
      'src_orders::table_orders::amount': assignment('amount', 'DOUBLE', 'amount'),
      'src_orders::table_orders::customer_id': assignment('customer_id', 'VARCHAR', 'order_id'),
      'src_customers::table_customers::customer_id': assignment(
        'customer_id',
        'VARCHAR',
        'order_id',
      ),
    },
    measures: [
      {
        name: 'revenue',
        expression: 'SUM(amount)',
        format: 'currency_usd',
        description: 'Gross revenue',
        version: 1,
      },
    ],
    dimensions: [
      {
        name: 'order_month',
        expression: "date_trunc('month', order_date)",
        description: 'Order month',
        version: 1,
      },
    ],
    segments: [
      {
        name: 'completed',
        expression: "status = 'completed'",
        description: 'Completed orders',
        version: 1,
      },
    ],
    associations: [
      {
        a: { table: 'orders', column: 'customer_id' },
        b: { table: 'customers', column: 'customer_id' },
      },
    ],
    taxonomyBundle: taxonomy,
  });
}

describe('portable semantic model', () => {
  it('builds logical tables, governed fields, candidate grain, measures, filters, and joins', () => {
    const result = build();
    expect(result.model.format).toBe('naklidata-semantic-model');
    expect(result.model.tables).toHaveLength(2);
    expect(result.model.tables[0]?.binding).toMatchObject({
      catalog: 'prod',
      database: 'prod',
      schema: 'sales',
      table: 'orders',
    });
    expect(result.model.tables[0]?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'amount',
          kind: 'fact',
          sensitivity: 'financial',
          semanticTypeId: 'amount',
        }),
        expect.objectContaining({ name: 'order_date', kind: 'time_dimension' }),
      ]),
    );
    expect(result.model.tables[0]?.grain).toEqual({
      columns: ['order_id'],
      verified: false,
    });
    expect(result.model.relationships[0]).toMatchObject({
      fromTableId: 'table_orders',
      toTableId: 'table_customers',
      cardinality: 'unknown',
      columnPairs: [{ from: 'customer_id', to: 'customer_id' }],
    });
    expect(result.model.dimensions[0]).toMatchObject({
      name: 'order_month',
      tableId: null,
      expression: "date_trunc('month', order_date)",
      kind: 'time_dimension',
    });
    expect(result.model.measures[0]?.tableId).toBeNull();
    expect(result.model.filters[0]?.tableId).toBeNull();
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['unbound_dimension', 'unbound_measure']),
    );
    expect(validatePortableSemanticModel(result.model)).toEqual([]);
    expect(JSON.parse(exportPortableSemanticModelJson(result.model))).toEqual(result.model);
  });

  it('exports Databricks Metric View YAML 1.1 with explicit loss diagnostics', () => {
    const { model } = build();
    const result = exportDatabricksMetricView(model, 'table_orders');
    expect(result.platform).toBe('databricks-metric-view');
    expect(result.document).toMatchObject({
      version: '1.1',
      source: 'prod.sales.orders',
      filter: "(status = 'completed')",
    });
    expect(result.document.joins).toEqual([
      expect.objectContaining({
        name: 'customers',
        source: 'prod.sales.customers',
        on: 'source.customer_id = customers.customer_id',
      }),
    ]);
    expect(result.document.measures).toEqual([
      expect.objectContaining({
        name: 'revenue',
        format: {
          type: 'currency',
          currency_code: 'USD',
          decimal_places: { type: 'exact', places: 2 },
        },
      }),
    ]);
    expect(result.yaml).toContain('version: "1.1"');
    expect(result.yaml).toContain('measures:');
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'unknown_cardinality',
        'dimension_bound_to_root',
        'measure_bound_to_root',
      ]),
    );
    expect(result.deployable).toBe(true);
  });

  it('exports Snowflake multi-table Semantic View YAML without asserting unverified keys', () => {
    const { model } = build();
    const result = exportSnowflakeSemanticView(model);
    expect(result.platform).toBe('snowflake-semantic-view');
    expect(result.deployable).toBe(true);
    const tables = result.document.tables as Array<Record<string, unknown>>;
    expect(tables).toHaveLength(2);
    expect(tables[0]).not.toHaveProperty('primary_key');
    expect(tables[0]?.base_table).toEqual({
      database: 'prod',
      schema: 'sales',
      table: 'orders',
    });
    expect(result.document.relationships).toEqual([
      expect.objectContaining({
        left_table: 'orders',
        right_table: 'customers',
      }),
    ]);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['unverified_grain', 'unbound_filter', 'unbound_dimension']),
    );
  });

  it('marks local-only bindings non-deployable instead of inventing vendor coordinates', () => {
    const { model } = build();
    for (const table of model.tables) {
      table.binding.catalog = null;
      table.binding.database = null;
      table.binding.schema = null;
      table.binding.qualifiedName = null;
    }
    expect(exportDatabricksMetricView(model, 'table_orders')).toMatchObject({
      deployable: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'missing_databricks_binding', severity: 'error' }),
      ]),
    });
    expect(exportSnowflakeSemanticView(model)).toMatchObject({
      deployable: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'missing_snowflake_binding', severity: 'error' }),
      ]),
    });
  });

  it('imports supported vendor concepts and reports omitted vendor-only features', () => {
    const databricks = importDatabricksMetricView({
      version: '1.1',
      comment: 'Revenue',
      source: 'prod.sales.orders',
      joins: [
        {
          name: 'customer_nation',
          source: 'prod.sales.customer_nations',
          using: ['nation_id'],
        },
        {
          name: 'customer',
          source: 'prod.sales.customers',
          on: 'source.customer_id = customer.customer_id',
          rely: { at_most_one_match: true },
          joins: [
            {
              name: 'nation',
              source: 'prod.sales.nations',
              using: ['nation_id'],
            },
          ],
        },
      ],
      fields: [
        {
          name: 'order_date',
          expr: 'order_date',
          display_name: 'Order Date',
        },
        { expr: 'customer.*' },
      ],
      measures: [
        {
          name: 'revenue',
          expr: 'SUM(amount)',
          format: {
            type: 'currency',
            currency_code: 'USD',
            decimal_places: { type: 'exact', places: 2 },
            abbreviation: 'compact',
          },
          window: [{ order: 'order_date' }],
        },
      ],
      filter: "status = 'complete'",
      parameters: [{ name: 'threshold' }],
      materialization: { schedule: 'EVERY 1 HOUR' },
    });
    expect(databricks.model.tables[0]?.binding.catalog).toBe('prod');
    expect(databricks.model.tables.map((table) => table.name)).toEqual([
      'source',
      'customer_nation',
      'customer',
      'customer_nation_2',
    ]);
    expect(databricks.model.tables[0]?.fields.map((field) => field.name)).toEqual(['order_date']);
    expect(databricks.model.measures[0]).toMatchObject({
      name: 'revenue',
      tableId: 'root',
      format: 'currency_usd',
    });
    expect(databricks.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'join_expression_unparsed',
        'join_metadata_omitted',
        'join_alias_renamed',
        'wildcard_import_omitted',
        'vendor_metadata_omitted',
        'vendor_feature_omitted',
      ]),
    );
    expect(databricks.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'vendor_metadata_omitted',
          path: 'measures[0].format',
        }),
      ]),
    );

    const snowflake = importSnowflakeSemanticView({
      name: 'revenue_analysis',
      tables: [
        {
          name: 'orders',
          synonyms: ['purchases'],
          base_table: { database: 'PROD', schema: 'SALES', table: 'ORDERS' },
          primary_key: { columns: ['order_id'] },
          unique_keys: [{ columns: ['external_id'] }],
          dimensions: [
            { name: 'order_id', expr: 'order_id', data_type: 'NUMBER' },
            {
              name: 'status',
              expr: 'status',
              data_type: 'VARCHAR',
              is_enum: true,
            },
            {
              name: 'high_value',
              expr: 'amount > 1000',
              data_type: 'BOOLEAN',
              labels: ['filter'],
            },
          ],
          facts: [
            {
              name: 'amount',
              expr: 'amount',
              data_type: 'NUMBER',
              access_modifier: 'private_access',
            },
          ],
          metrics: [
            {
              name: 'revenue',
              expr: 'SUM(amount)',
              access_modifier: 'private_access',
              non_additive_dimensions: [{ table: 'orders', dimension: 'order_id' }],
            },
          ],
          filters: [{ name: 'completed', expr: "status = 'complete'" }],
        },
        {
          name: 'customers',
          base_table: { database: 'PROD', schema: 'SALES', table: 'CUSTOMERS' },
          dimensions: [{ name: 'customer_id', expr: 'customer_id', data_type: 'NUMBER' }],
        },
      ],
      relationships: [
        {
          name: 'orders_to_customers',
          left_table: 'orders',
          right_table: 'customers',
          relationship_columns: [
            {
              left_column: 'order_id',
              right_column: 'customer_id',
              type: 'asof',
            },
          ],
        },
      ],
      metrics: [{ name: 'revenue_per_customer', expr: 'orders.revenue / 2' }],
      verified_queries: [
        {
          name: 'top_revenue',
          question: 'What is revenue?',
          sql: 'SELECT 1',
          verified_at: 1720000000,
          verified_by: 'Analyst',
          use_as_onboarding_question: true,
        },
      ],
      variables: [{ name: 'threshold', data_type: 'NUMBER' }],
      tags: [{ name: 'department', value: 'sales' }],
      max_staleness: 3600,
    });
    expect(snowflake.model.tables[0]).toMatchObject({
      synonyms: ['purchases'],
      grain: { columns: ['order_id'], verified: true },
    });
    expect(snowflake.model.tables[0]?.fields.map((field) => field.kind)).toEqual([
      'dimension',
      'dimension',
      'dimension',
      'fact',
    ]);
    expect(snowflake.model.measures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'revenue', tableId: 'table_1' }),
        expect.objectContaining({ name: 'revenue_per_customer', tableId: null }),
      ]),
    );
    expect(snowflake.model.filters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'high_value', tableId: 'table_1' }),
        expect.objectContaining({ name: 'completed', tableId: 'table_1' }),
      ]),
    );
    expect(snowflake.model.verifiedQueries[0]).toMatchObject({
      name: 'top_revenue',
      verifiedBy: 'Analyst',
      verifiedAt: '2024-07-03T09:46:40.000Z',
    });
    expect(snowflake.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'unique_keys_omitted',
        'vendor_metadata_omitted',
        'relationship_type_omitted',
        'vendor_feature_omitted',
      ]),
    );
    expect(validatePortableSemanticModel(snowflake.model)).toEqual([]);
  });

  it('does not reinterpret portable deprecation as Snowflake private access', () => {
    const { model } = build();
    const measure = model.measures[0];
    if (!measure) throw new Error('missing measure fixture');
    measure.governance.deprecated = true;
    const result = exportSnowflakeSemanticView(model);
    const metrics = result.document.metrics as Array<Record<string, unknown>>;
    expect(metrics[0]).not.toHaveProperty('access_modifier');
    expect(result.issues.map((issue) => issue.code)).toContain('governance_not_mapped');
  });

  it('reserves suffix space when Databricks join aliases collide after truncation', () => {
    const prefix = 'a'.repeat(64);
    const result = importDatabricksMetricView({
      version: '1.1',
      source: 'prod.sales.orders',
      joins: [
        { name: `${prefix}x`, source: 'prod.sales.first' },
        { name: `${prefix}y`, source: 'prod.sales.second' },
      ],
      fields: [{ name: 'id', expr: 'id' }],
    });
    expect(result.model.tables.map((table) => table.name)).toEqual([
      'source',
      prefix,
      `${'a'.repeat(62)}_2`,
    ]);
    expect(result.issues.map((issue) => issue.code)).toContain('join_alias_renamed');
    expect(validatePortableSemanticModel(result.model)).toEqual([]);
  });

  it('serializes YAML deterministically and safely quotes punctuation', () => {
    const yaml = toYaml({
      name: 'Revenue: model',
      enabled: true,
      fields: [{ name: 'order date', synonyms: ['date', 'placed: at'] }],
    });
    expect(yaml).toBe(
      'name: "Revenue: model"\nenabled: true\nfields:\n  - name: "order date"\n    synonyms:\n      - "date"\n      - "placed: at"\n',
    );
  });

  it('validates duplicate logical-table names and broken relationship references', () => {
    const { model } = build();
    const broken: PortableSemanticModel = structuredClone(model);
    const second = broken.tables[1];
    if (!second) throw new Error('missing fixture table');
    second.name = 'orders';
    const relationship = broken.relationships[0];
    if (!relationship) throw new Error('missing fixture relationship');
    relationship.toTableId = 'missing';
    expect(validatePortableSemanticModel(broken)).toEqual(
      expect.arrayContaining([
        'Duplicate logical table name: orders.',
        'orders_to_customers: relationship references an unknown table.',
      ]),
    );
  });
});
