import { describe, expect, it } from 'vitest';
import {
  type DataQualityCheck,
  compileDataQualityCheck,
  encodeDataQualityAssertion,
  exportDataQualityContract,
  parseDataQualityAssertion,
  suggestDataQualityChecks,
} from '../src/core/data-quality.ts';
import type { MountedSource } from '../src/core/mount.ts';
import type { TaxonomyBundle } from '../src/taxonomy/types.ts';

const taxonomy: TaxonomyBundle = {
  version: 'quality-test',
  released: '2026-07-29',
  domains: [],
  relationships: [],
  types: [
    {
      id: 'order_id',
      display_name: 'Order ID',
      domain: 'commerce',
      sql_compat: ['VARCHAR'],
      detectors: [{ kind: 'regex', pattern: '^ORD-[0-9]+$', weight: 1 }],
      confidence_floor: 0,
    },
    {
      id: 'payment_status',
      display_name: 'Payment status',
      domain: 'finance',
      sql_compat: ['VARCHAR'],
      detectors: [{ kind: 'value_set', values: ['paid', 'pending', "owner's review"], weight: 1 }],
      confidence_floor: 0,
    },
    {
      id: 'percentage',
      display_name: 'Percentage',
      domain: 'generic',
      sql_compat: ['DOUBLE'],
      detectors: [{ kind: 'range_numeric', min: 0, max: 100, weight: 1 }],
      confidence_floor: 0,
    },
    {
      id: 'customer_id',
      display_name: 'Customer ID',
      domain: 'commerce',
      sql_compat: ['VARCHAR'],
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
        id: 'ut:dimension',
        prefLabel: 'Dimension',
        roleFamily: 'dimension',
        sensitivity: 'public',
      },
      {
        id: 'ut:metric',
        prefLabel: 'Metric',
        roleFamily: 'metric',
        sensitivity: 'public',
      },
    ],
    crosswalk: [
      { role: 'order_id', universalTerm: 'ut:identifier' },
      { role: 'customer_id', universalTerm: 'ut:identifier' },
      { role: 'payment_status', universalTerm: 'ut:dimension' },
      { role: 'percentage', universalTerm: 'ut:metric' },
    ],
  },
};

const sources: MountedSource[] = [
  {
    id: 'source_orders',
    kind: 'example-bundle',
    label: 'Orders',
    tables: [
      {
        id: 'table_orders',
        sourceId: 'source_orders',
        name: 'orders',
        format: 'csv',
        origin: 'orders.csv',
        rowCount: 10,
        registered: true,
      },
    ],
  },
  {
    id: 'source_customers',
    kind: 'example-bundle',
    label: 'Customers',
    tables: [
      {
        id: 'table_customers',
        sourceId: 'source_customers',
        name: 'customers',
        format: 'csv',
        origin: 'customers.csv',
        rowCount: 5,
        registered: true,
      },
    ],
  },
];

function assigned(columnName: string, sqlType: string, typeId: string) {
  return { columnName, sqlType, assigned: { typeId } };
}

describe('deterministic data-quality contracts', () => {
  it('suggests all seven portable check families from semantics and relationships', () => {
    const checks = suggestDataQualityChecks({
      sources,
      assignments: {
        'source_orders::table_orders::order_id': assigned('order_id', 'VARCHAR', 'order_id'),
        'source_orders::table_orders::customer_id': assigned(
          'customer_id',
          'VARCHAR',
          'customer_id',
        ),
        'source_orders::table_orders::status': assigned('status', 'VARCHAR', 'payment_status'),
        'source_orders::table_orders::discount_pct': assigned(
          'discount_pct',
          'DOUBLE',
          'percentage',
        ),
        'source_customers::table_customers::customer_id': assigned(
          'customer_id',
          'VARCHAR',
          'customer_id',
        ),
      },
      associations: [
        {
          a: { table: 'orders', column: 'customer_id' },
          b: { table: 'customers', column: 'customer_id' },
        },
      ],
      taxonomyBundle: taxonomy,
    });
    expect(new Set(checks.map((check) => check.kind))).toEqual(
      new Set([
        'completeness',
        'uniqueness',
        'accepted_values',
        'valid_range',
        'format',
        'referential_validity',
        'semantic_drift',
      ]),
    );
    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'uniqueness',
          table: 'orders',
          column: 'order_id',
        }),
      ]),
    );
    expect(checks.find((check) => check.kind === 'referential_validity')).toMatchObject({
      table: 'orders',
      column: 'customer_id',
      referenceTable: 'customers',
      referenceColumn: 'customer_id',
    });
  });

  it('compiles bounded, quoted counter-example SQL for every rule shape', () => {
    const checks: DataQualityCheck[] = [
      {
        version: 1,
        id: 'accepted',
        name: 'accepted',
        kind: 'accepted_values',
        description: 'Accepted values',
        table: 'order "facts"',
        column: 'status',
        values: ['paid', "owner's review"],
      },
      {
        version: 1,
        id: 'range',
        name: 'range',
        kind: 'valid_range',
        description: 'Valid range',
        table: 'facts',
        column: 'ratio',
        min: 0,
        max: 1,
      },
      {
        version: 1,
        id: 'referential',
        name: 'referential',
        kind: 'referential_validity',
        description: 'Reference',
        table: 'orders',
        column: 'customer_id',
        referenceTable: 'customers',
        referenceColumn: 'id',
      },
    ];
    const accepted = compileDataQualityCheck(checks[0] as DataQualityCheck);
    expect(accepted).toContain('FROM "order ""facts"""');
    expect(accepted).toContain("'owner''s review'");
    expect(accepted).toContain('LIMIT 100');
    expect(compileDataQualityCheck(checks[1] as DataQualityCheck)).toContain(
      'TRY_CAST("ratio" AS DOUBLE) < 0',
    );
    expect(compileDataQualityCheck(checks[2] as DataQualityCheck)).toContain(
      'LEFT JOIN "customers" AS right_table',
    );
  });

  it('rejects unsafe format expressions before they reach DuckDB', () => {
    const check: DataQualityCheck = {
      version: 1,
      id: 'unsafe_format',
      name: 'unsafe_format',
      kind: 'format',
      description: 'Unsafe regex',
      table: 'orders',
      column: 'code',
      pattern: '(a+)+$',
    };
    expect(() => compileDataQualityCheck(check)).toThrow(/unsafe/);
  });

  it('round-trips tagged assertion cells and exports only explicit quality checks', () => {
    const check: DataQualityCheck = {
      version: 1,
      id: 'orders_order_id_not_null',
      name: 'orders_order_id_not_null',
      kind: 'completeness',
      description: 'Order id must be present',
      table: 'orders',
      column: 'order_id',
    };
    const code = encodeDataQualityAssertion(check);
    expect(parseDataQualityAssertion(code)).toEqual({
      check,
      sql: 'SELECT *\nFROM "orders"\nWHERE "order_id" IS NULL\nLIMIT 100',
    });
    const contract = JSON.parse(
      exportDataQualityContract('Revenue checks', [
        { code },
        { code: 'SELECT * FROM orders WHERE amount < 0' },
      ]),
    );
    expect(contract).toMatchObject({
      format: 'naklidata-data-contract',
      version: 1,
      name: 'revenue_checks',
      execution: 'explicit',
      aliases: {
        databricks: 'Expectation',
        snowflake: 'DMF / expectation',
      },
    });
    expect(contract.checks).toHaveLength(1);
    expect(contract.checks[0].check.id).toBe(check.id);
  });

  it('preserves edited assertion SQL while keeping validated contract metadata', () => {
    const check: DataQualityCheck = {
      version: 1,
      id: 'unique_orders',
      name: 'unique_orders',
      kind: 'uniqueness',
      description: 'Unique orders',
      table: 'orders',
      column: 'order_id',
    };
    const code = `${encodeDataQualityAssertion(check).split('\n')[0]}\nSELECT 42 WHERE FALSE`;
    expect(parseDataQualityAssertion(code)?.sql).toBe('SELECT 42 WHERE FALSE');
  });
});
