import { describe, expect, it, vi } from 'vitest';
import { Engine } from '../src/core/engine.ts';

function engineWithSqlHarness(opts: { failOnCreate?: boolean } = {}): {
  engine: Engine;
  statements: string[];
} {
  const engine = Object.create(Engine.prototype) as Engine;
  const statements: string[] = [];
  Object.assign(engine as unknown as Record<string, unknown>, {
    filesByRelation: new Map(),
    relationsByFile: new Map(),
    query: vi.fn(async () => [
      { table_name: 'orders', table_type: 'VIEW' },
      { table_name: 'removed', table_type: 'BASE TABLE' },
    ]),
    exec: vi.fn(async (sql: string) => {
      statements.push(sql);
      if (opts.failOnCreate && sql.startsWith('CREATE TABLE')) {
        throw new Error('copy failed');
      }
    }),
  });
  return { engine, statements };
}

describe('Engine.replaceRelationsAtomically', () => {
  it('swaps replacements and removals inside one transaction', async () => {
    const { engine, statements } = engineWithSqlHarness();

    await engine.replaceRelationsAtomically(
      [{ stagedName: 'orders_2', targetName: 'orders' }],
      ['removed'],
    );

    expect(statements).toEqual([
      'BEGIN TRANSACTION',
      'DROP VIEW "orders"',
      'CREATE TABLE "orders" AS SELECT * FROM "orders_2"',
      'DROP TABLE "removed"',
      'COMMIT',
    ]);
  });

  it('rolls back and preserves the original relation when materialization fails', async () => {
    const { engine, statements } = engineWithSqlHarness({ failOnCreate: true });

    await expect(
      engine.replaceRelationsAtomically([{ stagedName: 'orders_2', targetName: 'orders' }]),
    ).rejects.toThrow('copy failed');

    expect(statements).toEqual([
      'BEGIN TRANSACTION',
      'DROP VIEW "orders"',
      'CREATE TABLE "orders" AS SELECT * FROM "orders_2"',
      'ROLLBACK',
    ]);
  });
});
