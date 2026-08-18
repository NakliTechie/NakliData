import { describe, expect, it } from 'vitest';
import { createParsedReadAuthorizer } from '../src/sql-authorizer.ts';

describe('parsed warehouse SQL authorizer', () => {
  it('accepts one allowlisted Snowflake SELECT or WITH query', () => {
    const authorizer = createParsedReadAuthorizer({
      dialect: 'snowflake',
      allowedTables: ['analytics.public.orders'],
    });
    expect(
      authorizer.authorize('SELECT order_id FROM analytics.public.orders WHERE order_id > 0'),
    ).toEqual({ allowed: true });
    expect(
      authorizer.authorize(
        'WITH recent AS (SELECT order_id FROM analytics.public.orders) SELECT * FROM recent',
      ),
    ).toEqual({ allowed: true });
  });

  it('accepts only the conservative parsed Databricks subset', () => {
    const authorizer = createParsedReadAuthorizer({
      dialect: 'databricks',
      allowedTables: ['analytics.orders'],
    });
    expect(authorizer.authorize('SELECT order_id FROM analytics.orders')).toEqual({
      allowed: true,
    });
    expect(authorizer.authorize('SELECT order_id FROM main.analytics.orders').allowed).toBe(false);
  });

  it('accepts a Databricks self cross join when every reference is allowlisted', () => {
    const authorizer = createParsedReadAuthorizer({
      dialect: 'databricks',
      allowedTables: ['bakehouse.sales_transactions'],
    });

    expect(
      authorizer.authorize(
        'SELECT left_side.* FROM bakehouse.sales_transactions left_side CROSS JOIN bakehouse.sales_transactions middle_side CROSS JOIN bakehouse.sales_transactions right_side ORDER BY 1',
      ),
    ).toEqual({ allowed: true });
  });

  it('rejects writes, multiple statements, SELECT INTO, external reads, stages, and unknown tables', () => {
    const authorizer = createParsedReadAuthorizer({
      dialect: 'snowflake',
      allowedTables: ['analytics.public.orders'],
    });
    const rejected = [
      'DELETE FROM analytics.public.orders',
      'SELECT * FROM analytics.public.orders; DROP TABLE analytics.public.orders',
      'SELECT * INTO copied FROM analytics.public.orders',
      "SELECT * FROM read_parquet('s3://private/data.parquet')",
      'SELECT * FROM @private_stage/file.csv',
      'SELECT * FROM analytics.public.customers',
    ];
    for (const sql of rejected) expect(authorizer.authorize(sql).allowed, sql).toBe(false);
  });

  it('rejects quoted allowlist entries instead of weakening identifier semantics', () => {
    expect(() =>
      createParsedReadAuthorizer({
        dialect: 'snowflake',
        allowedTables: ['"ANALYTICS"."PUBLIC"."ORDERS"'],
      }),
    ).toThrow('unquoted dot-qualified');
  });
});
