import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory IDB shim + sessionStorage are stubbed before the module under test loads.
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

// vitest's default 'node' environment has no DOM. Provide a tiny
// sessionStorage shim so the BYOK module's calls don't blow up.
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

const { forgetAllKeys, forgetKey, loadKey, locateKey, saveKey } = await import(
  '../src/core/sidecar/byok.ts'
);

beforeEach(() => {
  _idb.clear();
  _session.clear();
});

describe('BYOK key storage', () => {
  it('defaults to sessionStorage when remember=false', async () => {
    await saveKey('anthropic', 'sk-ant-test-1234', false);
    const entry = await locateKey('anthropic');
    expect(entry.location).toBe('session');
    expect(entry.preview).toBe('••••1234');
    expect(await loadKey('anthropic')).toBe('sk-ant-test-1234');
  });

  it('persists to IDB when remember=true', async () => {
    await saveKey('openai', 'sk-openai-abcd', true);
    const entry = await locateKey('openai');
    expect(entry.location).toBe('idb');
    expect(entry.preview).toBe('••••abcd');
    // sessionStorage should be empty for this provider.
    expect(_session.getItem('naklidata.byok.openai')).toBeNull();
    // Load returns the IDB value.
    expect(await loadKey('openai')).toBe('sk-openai-abcd');
  });

  it('saveKey clears the other store first (no double-storage)', async () => {
    await saveKey('anthropic', 'first', false); // session
    await saveKey('anthropic', 'second', true); // idb (should clear session)
    const entry = await locateKey('anthropic');
    expect(entry.location).toBe('idb');
    expect(_session.getItem('naklidata.byok.anthropic')).toBeNull();
    expect(await loadKey('anthropic')).toBe('second');
  });

  it('locateKey reports "not configured" when neither store has the key', async () => {
    const entry = await locateKey('anthropic');
    expect(entry.location).toBeNull();
    expect(entry.preview).toBeNull();
  });

  it('forgetKey drops from both stores', async () => {
    // Put one in session, one in IDB; forget should clear both stores for that provider.
    _session.setItem('naklidata.byok.anthropic', 'leftover-from-session');
    _idb.set('sidecar/byok/anthropic', 'leftover-from-idb');
    await forgetKey('anthropic');
    expect(_session.getItem('naklidata.byok.anthropic')).toBeNull();
    expect(_idb.has('sidecar/byok/anthropic')).toBe(false);
  });

  it('forgetAllKeys clears every provider', async () => {
    await saveKey('anthropic', 'a', false);
    await saveKey('openai', 'b', true);
    await forgetAllKeys(['anthropic', 'openai']);
    expect(await loadKey('anthropic')).toBeNull();
    expect(await loadKey('openai')).toBeNull();
  });

  it('rejects empty keys', async () => {
    await expect(saveKey('anthropic', '   ', false)).rejects.toThrow();
  });
});
