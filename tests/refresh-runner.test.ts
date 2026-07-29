import { describe, expect, it, vi } from 'vitest';
import type { Engine } from '../src/core/engine.ts';
import { mountUrl } from '../src/core/mount.ts';
import { commitStagedRefresh, stageSourceRefreshes } from '../src/core/refresh-remount.ts';
import { applyDetectedRefresh, orderAffectedCellIds } from '../src/core/refresh-runner.ts';
import { fingerprintsEqual } from '../src/core/refresh.ts';

describe('refresh transaction', () => {
  it('baseline → changed bytes → staged remount → dependency rerun → new result', async () => {
    let remoteValue = 1;
    const relations = new Map<string, number>();
    const engine = {
      registerUrl: vi.fn(async ({ tableName }: { tableName: string }) => {
        relations.set(tableName, remoteValue);
      }),
      query: vi.fn(async () => [{ n: 1 }]),
      replaceRelationsAtomically: vi.fn(
        async (
          replacements: ReadonlyArray<{ stagedName: string; targetName: string }>,
          removals: ReadonlyArray<string>,
        ) => {
          for (const replacement of replacements) {
            relations.set(replacement.targetName, relations.get(replacement.stagedName) ?? -1);
          }
          for (const removal of removals) relations.delete(removal);
        },
      ),
      drop: vi.fn(async (name: string) => {
        relations.delete(name);
      }),
    } as unknown as Engine;
    const source = await mountUrl(engine, {
      url: 'https://example.com/orders.csv',
      tableName: 'orders',
    });
    let baseline = {
      kind: 'http' as const,
      etag: '"v1"',
      lastModifiedHeader: null,
      contentLength: 10,
      computedAt: 'before',
    };
    const observed = {
      ...baseline,
      etag: '"v2"',
      contentLength: 11,
      computedAt: 'after',
    };
    expect(fingerprintsEqual(baseline, observed)).toBe(false);

    remoteValue = 2;
    let publishedValue = 1;
    let upstreamResult = 1;
    let downstreamResult = 2;
    const order = orderAffectedCellIds(['downstream', 'upstream'], ['upstream', 'downstream']);
    const result = await applyDetectedRefresh({
      stage: async () => await stageSourceRefreshes(engine, [source]),
      commit: async (staged) => await commitStagedRefresh(engine, staged),
      publish: (staged) => {
        publishedValue = relations.get(staged.sources[0]?.tables[0]?.name ?? '') ?? -1;
      },
      cellIds: order,
      runCell: async (id) => {
        if (id === 'upstream') upstreamResult = publishedValue;
        if (id === 'downstream') downstreamResult = upstreamResult * 2;
        return { status: 'success' as const, id };
      },
      persistBaseline: async () => {
        baseline = observed;
      },
    });

    expect(result).toEqual({ status: 'success', refreshedCells: 2 });
    expect(order).toEqual(['upstream', 'downstream']);
    expect(relations.get('orders')).toBe(2);
    expect(upstreamResult).toBe(2);
    expect(downstreamResult).toBe(4);
    expect(baseline.etag).toBe('"v2"');
  });

  it('retains the old baseline when any dependent cell fails', async () => {
    let baseline = '"v1"';
    const persist = vi.fn(async () => {
      baseline = '"v2"';
    });
    const result = await applyDetectedRefresh({
      stage: async () => ({ bytes: 2 }),
      commit: async () => {},
      publish: () => {},
      cellIds: ['upstream', 'downstream'],
      runCell: async (id) =>
        id === 'upstream'
          ? { status: 'success' as const, id }
          : { status: 'failure' as const, id, error: 'query failed' },
      persistBaseline: persist,
    });

    expect(result).toMatchObject({
      status: 'cell-failure',
      refreshedCells: 1,
      outcome: { id: 'downstream', error: 'query failed' },
    });
    expect(persist).not.toHaveBeenCalled();
    expect(baseline).toBe('"v1"');
  });

  it('appends affected ids absent from the notebook order so they fail closed', () => {
    expect(orderAffectedCellIds(['known', 'missing'], ['known', 'unrelated'])).toEqual([
      'known',
      'missing',
    ]);
  });
});
