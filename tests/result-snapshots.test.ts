import { describe, expect, it } from 'vitest';
import {
  SNAPSHOT_ROW_CAP,
  buildResultSnapshot,
  hashSql,
  isSnapshotStale,
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
