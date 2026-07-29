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
      fields: [{ name: 'order_date', expr: 'order_date' }],
      measures: [{ name: 'revenue', expr: 'SUM(amount)' }],
      filter: "status = 'complete'",
      parameters: [{ name: 'threshold' }],
    });
    expect(databricks.model.tables[0]?.binding.catalog).toBe('prod');
    expect(databricks.model.measures[0]?.name).toBe('revenue');
    expect(databricks.issues.map((issue) => issue.code)).toContain('vendor_feature_omitted');

    const snowflake = importSnowflakeSemanticView({
      name: 'revenue_analysis',
      tables: [
        {
          name: 'orders',
          base_table: { database: 'PROD', schema: 'SALES', table: 'ORDERS' },
          dimensions: [{ name: 'status', expr: 'status', data_type: 'VARCHAR' }],
          facts: [{ name: 'amount', expr: 'amount', data_type: 'NUMBER' }],
        },
      ],
      metrics: [{ name: 'revenue', expr: 'SUM(orders.amount)' }],
      max_staleness: 3600,
    });
    expect(snowflake.model.tables[0]?.fields.map((field) => field.kind)).toEqual([
      'dimension',
      'fact',
    ]);
    expect(snowflake.model.measures[0]?.name).toBe('revenue');
    expect(snowflake.issues.map((issue) => issue.code)).toContain('vendor_feature_omitted');
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
