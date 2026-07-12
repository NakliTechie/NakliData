import { describe, expect, it } from 'vitest';
import {
  SNAPSHOT_ROW_CAP,
  buildResultSnapshot,
  hashSql,
  isSnapshotStale,
  toCloneSafeRows,
} from '../src/core/result-snapshots.ts';

describe('hashSql', () => {
  it('is stable and whitespace-insensitive at the edges', () => {
    expect(hashSql('SELECT 1')).toBe(hashSql('  SELECT 1  '));
  });
  it('differs when the query body changes', () => {
    expect(hashSql('SELECT 1')).not.toBe(hashSql('SELECT 2'));
  });
  it('returns 8 hex chars', () => {
    expect(hashSql('SELECT * FROM t')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('buildResultSnapshot', () => {
  const bigRows = Array.from({ length: 250 }, (_, i) => ({ i }));
  const result = { columns: ['i'], rows: bigRows, rowCount: 250, elapsedMs: 12 };

  it('caps rows to SNAPSHOT_ROW_CAP but preserves the full rowCount', () => {
    const s = buildResultSnapshot('SELECT i FROM t', result, 1_000);
    expect(s.rows.length).toBe(SNAPSHOT_ROW_CAP);
    expect(s.rowCount).toBe(250);
    expect(s.columns).toEqual(['i']);
    expect(s.ranAt).toBe(1_000);
    expect(s.sqlHash).toBe(hashSql('SELECT i FROM t'));
  });

  it('keeps small results whole', () => {
    const small = { columns: ['x'], rows: [{ x: 1 }, { x: 2 }], rowCount: 2, elapsedMs: 3 };
    const s = buildResultSnapshot('SELECT x', small, 5);
    expect(s.rows.length).toBe(2);
    expect(s.rowCount).toBe(2);
  });
});

describe('toCloneSafeRows (IDB DataCloneError guard)', () => {
  it('drops function-valued fields and stringifies bigints so rows structured-clone', () => {
    const rows = [{ a: 1, fn: () => 42, big: 10n, s: 'x', nested: { m() {}, v: 2 } }] as Array<
      Record<string, unknown>
    >;
    const safe = toCloneSafeRows(rows);
    expect(safe[0]).toEqual({ a: 1, big: '10', s: 'x', nested: { v: 2 } });
    // The output must survive structuredClone (what IDB put uses).
    expect(() => structuredClone(safe)).not.toThrow();
  });
  it('is a no-op for plain rows', () => {
    const rows = [{ region: 'West', total: 550 }];
    expect(toCloneSafeRows(rows)).toEqual(rows);
  });
});

describe('isSnapshotStale', () => {
  it('is false while the query is unchanged', () => {
    const h = hashSql('SELECT 1');
    expect(isSnapshotStale(h, 'SELECT 1')).toBe(false);
    expect(isSnapshotStale(h, '  SELECT 1 ')).toBe(false);
  });
  it('is true once the query is edited', () => {
    const h = hashSql('SELECT 1');
    expect(isSnapshotStale(h, 'SELECT 1 WHERE x > 0')).toBe(true);
  });
});
