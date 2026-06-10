// W3.2 slice B chunk 1 — local-cache pure-logic tests.
//
// OPFS isn't available in vitest's Node environment, so the
// filesystem-touching helpers (writeModelFile / readModelFile / list
// / clear) get exercised via Playwright in
// tests/e2e/local-cache.spec.ts. This file covers the pure helpers
// (flattenModelId / unflattenModelId / formatCacheSize) plus the
// no-OPFS bail behaviour of every public function.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAllCachedModels,
  clearCachedModel,
  flattenModelId,
  formatCacheSize,
  getModelCacheInfo,
  getTotalCacheSize,
  hasModelFile,
  isOpfsAvailable,
  listCachedModels,
  readModelFile,
  unflattenModelId,
  writeModelFile,
} from '../src/core/sidecar/local-cache.ts';

describe('flattenModelId / unflattenModelId', () => {
  it('flattens slashes to double-underscore', () => {
    expect(flattenModelId('Qwen/Qwen2.5-1.5B-Instruct')).toBe('Qwen$$Qwen2.5-1.5B-Instruct');
  });

  it('handles model ids without slashes (already flat)', () => {
    expect(flattenModelId('phi-3.5-mini')).toBe('phi-3.5-mini');
  });

  it('handles nested-org model ids (multiple slashes)', () => {
    expect(flattenModelId('org/team/model-v1')).toBe('org$$team$$model-v1');
  });

  it('round-trips via unflattenModelId', () => {
    const cases = [
      'Qwen/Qwen2.5-1.5B-Instruct',
      'microsoft/Phi-3.5-mini-instruct',
      'meta-llama/Llama-3.2-1B-Instruct',
      'org/team/model-v1',
      'noslash-id',
    ];
    for (const id of cases) {
      expect(unflattenModelId(flattenModelId(id))).toBe(id);
    }
  });
});

describe('formatCacheSize', () => {
  it('formats bytes', () => {
    expect(formatCacheSize(0)).toBe('0 B');
    expect(formatCacheSize(512)).toBe('512 B');
    expect(formatCacheSize(1023)).toBe('1023 B');
  });

  it('formats KB at 1024 and above', () => {
    expect(formatCacheSize(1024)).toBe('1.0 KB');
    expect(formatCacheSize(1536)).toBe('1.5 KB');
    expect(formatCacheSize(1024 * 1024 - 1)).toMatch(/KB$/);
  });

  it('formats MB at 1024 KB and above', () => {
    expect(formatCacheSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatCacheSize(1024 * 1024 * 50)).toBe('50.0 MB');
  });

  it('formats GB at 1024 MB and above', () => {
    expect(formatCacheSize(1024 * 1024 * 1024)).toBe('1.00 GB');
    // Qwen2.5-1.5B-Instruct 4-bit ≈ 0.9 GB
    expect(formatCacheSize(900 * 1024 * 1024)).toMatch(/MB$/);
    // Phi-3.5-mini-instruct 4-bit ≈ 2.3 GB
    expect(formatCacheSize(2.3 * 1024 * 1024 * 1024)).toBe('2.30 GB');
  });
});

// Vitest's default node environment has no `navigator.storage`. Every
// public function should detect this and either return a safe default
// (null / false / 0 / []) or throw a clear error.
//
// Node 22 provides a built-in `navigator` global (a getter-only
// property), so we use vi.stubGlobal to replace it for the duration of
// each test — vi.unstubAllGlobals restores the original.
describe('OPFS-touching helpers: graceful no-OPFS behavior', () => {
  beforeEach(() => {
    // Stub `navigator` to an object with no `storage` member, mimicking
    // an old browser / Node-without-the-polyfill.
    vi.stubGlobal('navigator', {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('isOpfsAvailable returns false when navigator is missing', async () => {
    expect(await isOpfsAvailable()).toBe(false);
  });

  it('getModelCacheInfo returns null', async () => {
    expect(await getModelCacheInfo('any/id')).toBeNull();
  });

  it('listCachedModels returns empty array', async () => {
    expect(await listCachedModels()).toEqual([]);
  });

  it('getTotalCacheSize returns 0', async () => {
    expect(await getTotalCacheSize()).toBe(0);
  });

  it('hasModelFile returns false', async () => {
    expect(await hasModelFile('any/id', 'model.onnx')).toBe(false);
  });

  it('readModelFile returns null', async () => {
    expect(await readModelFile('any/id', 'model.onnx')).toBeNull();
  });

  it('clearCachedModel returns false', async () => {
    expect(await clearCachedModel('any/id')).toBe(false);
  });

  it('clearAllCachedModels returns false', async () => {
    expect(await clearAllCachedModels()).toBe(false);
  });

  it('writeModelFile throws (silent-fail would mask "model is downloading")', async () => {
    await expect(writeModelFile('any/id', 'model.onnx', new Uint8Array(0))).rejects.toThrow(
      /OPFS not available/i,
    );
  });
});

// Sanity check: when `navigator.storage.getDirectory` exists but throws,
// the helpers should ALSO bail safely (Firefox private browsing edge
// case).
describe('OPFS-touching helpers: bail when getDirectory throws', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', {
      storage: {
        getDirectory: () => Promise.reject(new Error('SecurityError')),
      },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('isOpfsAvailable returns false on getDirectory rejection', async () => {
    expect(await isOpfsAvailable()).toBe(false);
  });

  it('listCachedModels returns empty array', async () => {
    expect(await listCachedModels()).toEqual([]);
  });
});
