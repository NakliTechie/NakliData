// Scoped crossfilter re-run (2026-07-25). `applyCrossfilter` used to fire a
// whole-notebook runAll() on every brush; it now runs only the affected
// subgraph. That's a behaviour change on a load-bearing path, so the closure
// rules get pinned here: seeds, downstream propagation, exclusion of unrelated
// cells, un-run-ancestor inclusion, and topological ordering.

import { describe, expect, it } from 'vitest';
import type { CellState, SqlCellState } from '../src/ui/cells/types.ts';
import { crossfilterRunOrder } from '../src/ui/notebook-graph.ts';

let seq = 0;
const sql = (over: Partial<SqlCellState> & { code: string }): SqlCellState => ({
  id: `c${++seq}`,
  kind: 'sql',
  order: seq,
  name: null,
  status: 'success',
  lastError: null,
  // Default: this cell HAS run (so it's never pulled in as an un-run ancestor).
  lastResult: {
    columns: ['x'],
    rows: [{ x: 1 }],
    rowCount: 1,
    elapsedMs: 1,
  } as SqlCellState['lastResult'],
  ...over,
});

describe('crossfilterRunOrder', () => {
  it('returns nothing when no cell references the crossfilter', () => {
    const cells: CellState[] = [sql({ name: 'a', code: 'SELECT 1' })];
    expect(crossfilterRunOrder(cells, 'twin')).toEqual([]);
  });

  it('returns nothing for an empty/blank name', () => {
    const cells: CellState[] = [sql({ code: 'SELECT * WHERE CROSSFILTER(twin)' })];
    expect(crossfilterRunOrder(cells, '   ')).toEqual([]);
  });

  it('includes the seed that references CROSSFILTER(name)', () => {
    const seed = sql({ name: 'seed', code: 'SELECT * FROM t WHERE CROSSFILTER(twin)' });
    const other = sql({ name: 'other', code: 'SELECT 1' });
    expect(crossfilterRunOrder([seed, other], 'twin')).toEqual([seed.id]);
  });

  it('does not match a different crossfilter name', () => {
    const seed = sql({ code: 'SELECT * WHERE CROSSFILTER(other)' });
    expect(crossfilterRunOrder([seed], 'twin')).toEqual([]);
  });

  it('propagates downstream through @refs, transitively', () => {
    const seed = sql({ name: 'seed', code: 'SELECT * FROM t WHERE CROSSFILTER(twin)' });
    const mid = sql({ name: 'mid', code: 'SELECT * FROM @seed' });
    const leaf = sql({ name: 'leaf', code: 'SELECT count(*) FROM @mid' });
    const unrelated = sql({ name: 'unrelated', code: 'SELECT * FROM elsewhere' });
    const order = crossfilterRunOrder([seed, mid, leaf, unrelated], 'twin');
    expect(order).toEqual([seed.id, mid.id, leaf.id]);
    expect(order).not.toContain(unrelated.id);
  });

  it('EXCLUDES an upstream ancestor that has already run (its result cannot change)', () => {
    const upstream = sql({ name: 'up', code: 'SELECT * FROM base' });
    const seed = sql({ name: 'seed', code: 'SELECT * FROM @up WHERE CROSSFILTER(twin)' });
    const order = crossfilterRunOrder([upstream, seed], 'twin');
    expect(order).toEqual([seed.id]);
    expect(order).not.toContain(upstream.id);
  });

  it('INCLUDES an un-run ancestor (its cell_<id> view does not exist yet)', () => {
    const neverRan = sql({ name: 'up', code: 'SELECT * FROM base', lastResult: null });
    const seed = sql({ name: 'seed', code: 'SELECT * FROM @up WHERE CROSSFILTER(twin)' });
    const order = crossfilterRunOrder([neverRan, seed], 'twin');
    // Ancestor first — dependencies before dependents.
    expect(order).toEqual([neverRan.id, seed.id]);
  });

  it('pulls un-run ancestors transitively', () => {
    const a = sql({ name: 'a', code: 'SELECT 1', lastResult: null });
    const b = sql({ name: 'b', code: 'SELECT * FROM @a', lastResult: null });
    const seed = sql({ name: 'seed', code: 'SELECT * FROM @b WHERE CROSSFILTER(twin)' });
    expect(crossfilterRunOrder([a, b, seed], 'twin')).toEqual([a.id, b.id, seed.id]);
  });

  it('returns dependencies before dependents even when document order is reversed', () => {
    const leaf = sql({ name: 'leaf', code: 'SELECT * FROM @seed' });
    const seed = sql({ name: 'seed', code: 'SELECT * FROM t WHERE CROSSFILTER(twin)' });
    // leaf appears FIRST in the document but must run AFTER seed.
    const order = crossfilterRunOrder([leaf, seed], 'twin');
    expect(order).toEqual([seed.id, leaf.id]);
  });

  it('handles two seeds sharing a downstream cell without duplicating it', () => {
    const s1 = sql({ name: 's1', code: 'SELECT 1 WHERE CROSSFILTER(twin)' });
    const s2 = sql({ name: 's2', code: 'SELECT 2 WHERE CROSSFILTER(twin)' });
    const joined = sql({ name: 'j', code: 'SELECT * FROM @s1 JOIN @s2 USING (id)' });
    const order = crossfilterRunOrder([s1, s2, joined], 'twin');
    expect(order).toEqual([s1.id, s2.id, joined.id]);
    expect(new Set(order).size).toBe(order.length);
  });

  it('covers cohort + assertion cells, not just sql', () => {
    const seed = { ...sql({ name: 'seed', code: 'SELECT 1 WHERE CROSSFILTER(twin)' }) };
    const cohort = { ...sql({ name: 'co', code: 'SELECT * FROM @seed' }), kind: 'cohort' as const };
    const assertion = {
      ...sql({ name: 'as', code: 'SELECT * FROM @co' }),
      kind: 'assertion' as const,
    };
    const order = crossfilterRunOrder([seed, cohort, assertion] as unknown as CellState[], 'twin');
    expect(order).toEqual([seed.id, cohort.id, assertion.id]);
  });

  it('ignores non-runnable cells (a chart cannot be re-run as SQL)', () => {
    const seed = sql({ name: 'seed', code: 'SELECT 1 WHERE CROSSFILTER(twin)' });
    const chart = { id: 'chart1', kind: 'chart', order: 9, name: 'ch', inputCell: seed.id };
    const order = crossfilterRunOrder([seed, chart] as unknown as CellState[], 'twin');
    expect(order).toEqual([seed.id]);
  });

  it('is cycle-safe (a self-referencing cell does not hang or duplicate)', () => {
    const seed = sql({ name: 'seed', code: 'SELECT * FROM @seed WHERE CROSSFILTER(twin)' });
    const order = crossfilterRunOrder([seed], 'twin');
    expect(order).toEqual([seed.id]);
  });
});
