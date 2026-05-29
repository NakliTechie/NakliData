import { afterEach, describe, expect, it, vi } from 'vitest';

// dispatchJob imports byok → idb; mock idb so no real IndexedDB is touched.
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

// sessionStorage shim — byok.loadKey reads it on the cloud-provider path.
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
}
// biome-ignore lint/suspicious/noExplicitAny: shim for tests
(globalThis as any).sessionStorage = new MemoryStorage();

const { dispatchJob } = await import('../src/core/sidecar/client.ts');
const { registerLocalGenerator, unregisterLocalGenerator, isLocalModelReady } = await import(
  '../src/core/sidecar/local-runtime.ts'
);

afterEach(() => {
  unregisterLocalGenerator();
  _idb.clear();
});

describe('local-model seam (W3.2 slice A)', () => {
  it('isLocalModelReady reflects registration state', () => {
    expect(isLocalModelReady()).toBe(false);
    registerLocalGenerator(async () => 'x');
    expect(isLocalModelReady()).toBe(true);
    unregisterLocalGenerator();
    expect(isLocalModelReady()).toBe(false);
  });

  it("dispatchJob provider='local' routes to the registered generator (no API key needed)", async () => {
    let sawModel = '';
    let sawSystem = '';
    registerLocalGenerator(async (req) => {
      sawModel = req.model;
      sawSystem = req.system;
      return 'gstin';
    });
    const result = await dispatchJob(
      {
        kind: 'disambiguate-type',
        columnName: 'tax_id',
        sqlType: 'VARCHAR',
        samples: ['27AAPFU0939F1ZV'],
        candidates: [
          { typeId: 'gstin', displayName: 'GSTIN' },
          { typeId: 'pan', displayName: 'PAN' },
        ],
      },
      { provider: 'local', model: 'some-onnx-repo' },
    );
    expect(result.kind).toBe('disambiguate-type');
    if (result.kind !== 'disambiguate-type') return;
    expect(result.typeId).toBe('gstin');
    expect(sawModel).toBe('some-onnx-repo');
    expect(sawSystem).toMatch(/disambiguation/i);
  });

  it("dispatchJob provider='local' with no generator throws 'no-provider' (no silent cloud fallback)", async () => {
    // No registration → not ready.
    await expect(
      dispatchJob(
        { kind: 'explain-error', sql: 'SELECT 1', errorMessage: 'oops' },
        { provider: 'local', model: 'whatever' },
      ),
    ).rejects.toMatchObject({ kind: 'no-provider' });
  });

  it("provider='local' never demands an API key (unlike cloud providers)", async () => {
    // A cloud provider with no key throws no-key…
    await expect(
      dispatchJob(
        { kind: 'explain-error', sql: 'SELECT 1', errorMessage: 'x' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ),
    ).rejects.toMatchObject({ kind: 'no-key' });
    // …but local with a generator registered succeeds with no key present.
    registerLocalGenerator(async () =>
      JSON.stringify({ explanation: 'It is fine.', suggested_fix: null }),
    );
    const result = await dispatchJob(
      { kind: 'explain-error', sql: 'SELECT 1', errorMessage: 'x' },
      { provider: 'local', model: 'm' },
    );
    expect(result.kind).toBe('explain-error');
  });

  it('routes recommend-reports through the local generator too', async () => {
    registerLocalGenerator(async () =>
      JSON.stringify({ recommendations: [{ template_id: 'ar_aging', score: 0.8 }] }),
    );
    const result = await dispatchJob(
      {
        kind: 'recommend-reports',
        candidates: [{ templateId: 'ar_aging', name: 'AR aging', description: 'x' }],
        typeSummary: 'invoices: amount',
      },
      { provider: 'local', model: 'm' },
    );
    expect(result.kind).toBe('recommend-reports');
    if (result.kind !== 'recommend-reports') return;
    expect(result.recommendations[0]?.templateId).toBe('ar_aging');
  });
});
