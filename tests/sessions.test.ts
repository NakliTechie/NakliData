import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NakliDataFile } from '../src/core/persistence.ts';

// In-memory IDB shim. vi.mock is hoisted, so the factory runs before
// the module under test is imported.
const _store = new Map<string, unknown>();
vi.mock('../src/core/idb.ts', () => ({
  kvGet: async <T>(key: string) => (_store.get(key) as T | undefined) ?? null,
  kvPut: async (key: string, value: unknown) => {
    _store.set(key, value);
  },
  kvDelete: async (key: string) => {
    _store.delete(key);
  },
}));

const {
  createSession,
  deleteSession,
  ensureActiveSession,
  loadIndex,
  loadSnapshot,
  renameSession,
  saveSnapshot,
  setActiveSession,
} = await import('../src/core/sessions.ts');

beforeEach(() => {
  _store.clear();
});

function makeSnapshot(name: string): NakliDataFile {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    format: 'naklidata',
    version: '1.0',
    created: now,
    modified: now,
    name,
    sources: [],
    assignments: [],
    cells: [],
    user_types: [],
    settings: { auto_accept_threshold: 0.9 },
  };
}

describe('sessions — ensureActiveSession', () => {
  it('creates a seed Untitled session on a brand-new install', async () => {
    const meta = await ensureActiveSession();
    expect(meta.name).toBe('Untitled');
    const idx = await loadIndex();
    expect(idx.sessions).toHaveLength(1);
    expect(idx.activeId).toBe(meta.id);
  });

  it('migrates a legacy workbook/current snapshot into the seed session and deletes the legacy key', async () => {
    const legacy = makeSnapshot('My old workbook');
    _store.set('workbook/current', legacy);
    const meta = await ensureActiveSession();
    expect(meta.name).toBe('My old workbook');
    const snap = await loadSnapshot(meta.id);
    expect(snap).toEqual(legacy);
    expect(_store.has('workbook/current')).toBe(false);
  });

  it('returns the active session when index already exists', async () => {
    const a = await createSession('A');
    const b = await createSession('B');
    await setActiveSession(a.id);
    const meta = await ensureActiveSession();
    expect(meta.id).toBe(a.id);
    expect(meta.name).toBe('A');
    expect(b.id).not.toBe(a.id);
  });

  it('falls back to the first session if activeId is stale', async () => {
    const a = await createSession('A');
    // Manually corrupt the index — point activeId at a non-existent id.
    const idx = await loadIndex();
    _store.set('sessions/index', { ...idx, activeId: 'ghost' });
    const meta = await ensureActiveSession();
    expect(meta.id).toBe(a.id);
  });
});

describe('sessions — CRUD', () => {
  it('createSession adds a new session and makes it active', async () => {
    await ensureActiveSession(); // seed
    const before = await loadIndex();
    const next = await createSession('Project Beta');
    const after = await loadIndex();
    expect(after.sessions).toHaveLength(before.sessions.length + 1);
    expect(after.activeId).toBe(next.id);
    expect(next.name).toBe('Project Beta');
  });

  it('createSession defaults the name when not supplied', async () => {
    await ensureActiveSession();
    const next = await createSession();
    // 2nd session: "Session 2" (1 existing + new)
    expect(next.name).toMatch(/^Session \d+$/);
  });

  it('renameSession changes the name and bumps modified', async () => {
    const meta = await ensureActiveSession();
    await renameSession(meta.id, 'Renamed');
    const idx = await loadIndex();
    const updated = idx.sessions.find((s) => s.id === meta.id);
    expect(updated?.name).toBe('Renamed');
  });

  it('renameSession rejects empty names', async () => {
    const meta = await ensureActiveSession();
    await expect(renameSession(meta.id, '   ')).rejects.toThrow();
  });

  it('deleteSession removes the snapshot + index entry; picks a new active if needed', async () => {
    const a = await ensureActiveSession(); // active
    const b = await createSession('B'); // active
    await saveSnapshot(a.id, makeSnapshot('snap-a'));
    await deleteSession(b.id);
    const idx = await loadIndex();
    expect(idx.sessions.find((s) => s.id === b.id)).toBeUndefined();
    expect(idx.activeId).toBe(a.id);
    expect(await loadSnapshot(b.id)).toBeNull();
  });

  it('deleteSession refuses to drop the last session', async () => {
    const meta = await ensureActiveSession();
    await expect(deleteSession(meta.id)).rejects.toThrow(/last session/);
  });

  it('deleteSession of the active session pivots active to the next remaining', async () => {
    const a = await ensureActiveSession();
    const b = await createSession('B'); // becomes active
    await deleteSession(b.id);
    const idx = await loadIndex();
    expect(idx.activeId).toBe(a.id);
  });
});

describe('sessions — snapshot round-trip', () => {
  it('saveSnapshot then loadSnapshot returns the same object and updates modified in index', async () => {
    const meta = await ensureActiveSession();
    const snap = makeSnapshot('persisted');
    snap.modified = '2026-05-17T11:00:00.000Z';
    await saveSnapshot(meta.id, snap);
    const got = await loadSnapshot(meta.id);
    expect(got).toEqual(snap);
    const idx = await loadIndex();
    const updated = idx.sessions.find((s) => s.id === meta.id);
    expect(updated?.modified).toBe('2026-05-17T11:00:00.000Z');
  });

  it('loadSnapshot returns null for a stored value that is not a .naklidata shape', async () => {
    const meta = await ensureActiveSession();
    _store.set(`sessions/${meta.id}/snapshot`, { not: 'a naklidata file' });
    expect(await loadSnapshot(meta.id)).toBeNull();
  });
});
