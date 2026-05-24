import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory IDB shim + sessionStorage shim — same pattern as
// tests/sidecar-byok.test.ts. vitest's default 'node' environment has
// no DOM, so we mock both before importing the module under test.
const _idb = new Map<string, unknown>();
vi.mock('../src/core/idb.ts', () => ({
  kvGet: async <T>(key: string) => (_idb.get(key) as T | undefined) ?? null,
  kvPut: async (key: string, value: unknown) => {
    _idb.set(key, value);
  },
  kvDelete: async (key: string) => {
    _idb.delete(key);
  },
}));

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string): string | null {
    return this.store.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, v);
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
  clear(): void {
    this.store.clear();
  }
}
const _session = new MemoryStorage();
// biome-ignore lint/suspicious/noExplicitAny: shim for tests
(globalThis as any).sessionStorage = _session;

const { forgetSecret, forgetSource, loadSecret, locateSecret, saveSecret } = await import(
  '../src/core/secrets/source-secrets.ts'
);

beforeEach(() => {
  _idb.clear();
  _session.clear();
});

describe('source-secrets (Wave 2 slice 2)', () => {
  it('saveSecret with remember=false uses sessionStorage; loadSecret reads it back', async () => {
    await saveSecret('src_1', 'access_key_id', 'AKIA-EXAMPLE', false);
    expect(_session.getItem('naklidata.source-secret.src_1.access_key_id')).toBe(
      'AKIA-EXAMPLE',
    );
    expect(_idb.has('source-secrets/src_1/access_key_id')).toBe(false);
    expect(await loadSecret('src_1', 'access_key_id')).toBe('AKIA-EXAMPLE');
  });

  it('saveSecret with remember=true uses IDB; sessionStorage is empty', async () => {
    await saveSecret('src_1', 'access_key_id', 'AKIA-EXAMPLE', true);
    expect(_session.getItem('naklidata.source-secret.src_1.access_key_id')).toBeNull();
    expect(_idb.get('source-secrets/src_1/access_key_id')).toBe('AKIA-EXAMPLE');
    expect(await loadSecret('src_1', 'access_key_id')).toBe('AKIA-EXAMPLE');
  });

  it('rotating storage location cleans up the previous location (never two copies)', async () => {
    await saveSecret('src_1', 'access_key_id', 'AKIA-FIRST', false);
    expect(_session.getItem('naklidata.source-secret.src_1.access_key_id')).toBe('AKIA-FIRST');
    // Re-save with remember=true → session entry should be cleared, IDB should hold.
    await saveSecret('src_1', 'access_key_id', 'AKIA-FIRST', true);
    expect(_session.getItem('naklidata.source-secret.src_1.access_key_id')).toBeNull();
    expect(_idb.get('source-secrets/src_1/access_key_id')).toBe('AKIA-FIRST');
  });

  it('loadSecret prefers sessionStorage over IDB (defence-in-depth for tab-life keys)', async () => {
    await saveSecret('src_1', 'access_key_id', 'IDB-VERSION', true);
    _session.setItem('naklidata.source-secret.src_1.access_key_id', 'SESSION-VERSION');
    expect(await loadSecret('src_1', 'access_key_id')).toBe('SESSION-VERSION');
  });

  it('saveSecret rejects empty values', async () => {
    await expect(saveSecret('src_1', 'access_key_id', '', false)).rejects.toThrow(/Empty/);
    await expect(saveSecret('src_1', 'access_key_id', '   ', false)).rejects.toThrow(/Empty/);
  });

  it('forgetSecret drops the value from both stores', async () => {
    await saveSecret('src_1', 'access_key_id', 'AKIA-EXAMPLE', false);
    await forgetSecret('src_1', 'access_key_id');
    expect(await loadSecret('src_1', 'access_key_id')).toBeNull();
  });

  it('forgetSource drops every named secret for that sourceId', async () => {
    await saveSecret('src_1', 'access_key_id', 'AK', false);
    await saveSecret('src_1', 'secret_access_key', 'SK', true);
    await saveSecret('src_2', 'access_key_id', 'OTHER', false);
    await forgetSource('src_1', ['access_key_id', 'secret_access_key']);
    expect(await loadSecret('src_1', 'access_key_id')).toBeNull();
    expect(await loadSecret('src_1', 'secret_access_key')).toBeNull();
    // Other sources are untouched.
    expect(await loadSecret('src_2', 'access_key_id')).toBe('OTHER');
  });

  it('locateSecret reports session / idb / null with a masked preview', async () => {
    expect(await locateSecret('src_1', 'access_key_id')).toEqual({
      location: null,
      preview: null,
    });
    await saveSecret('src_1', 'access_key_id', 'AKIA-FULL-KEY-EXAMPLE', false);
    const sessionMeta = await locateSecret('src_1', 'access_key_id');
    expect(sessionMeta.location).toBe('session');
    expect(sessionMeta.preview).toMatch(/••••MPLE$/);
    await saveSecret('src_1', 'access_key_id', 'AKIA-IDB-EXAMPLE', true);
    const idbMeta = await locateSecret('src_1', 'access_key_id');
    expect(idbMeta.location).toBe('idb');
    expect(idbMeta.preview).toMatch(/••••MPLE$/);
  });
});
