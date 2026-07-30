import { beforeEach, describe, expect, it, vi } from 'vitest';

const idb = vi.hoisted(() => ({
  raw: null as Record<string, unknown> | null,
  writes: [] as Array<{ key: string; value: unknown }>,
}));

vi.mock('../src/core/idb.ts', () => ({
  kvGet: async () => idb.raw,
  kvPut: async (key: string, value: unknown) => {
    idb.writes.push({ key, value });
  },
}));

import { loadSettings } from '../src/core/settings.ts';

describe('legacy agent authority migration', () => {
  beforeEach(() => {
    idb.raw = null;
    idb.writes = [];
  });

  it('scrubs agentWritesEnabled without granting or retaining it', async () => {
    idb.raw = {
      autoAcceptThreshold: 0.8,
      agentWritesEnabled: true,
    };
    const settings = await loadSettings();
    expect(settings).not.toHaveProperty('agentWritesEnabled');
    expect(settings.autoAcceptThreshold).toBe(0.8);
    expect(idb.writes).toEqual([
      {
        key: 'settings/v1',
        value: { autoAcceptThreshold: 0.8 },
      },
    ]);
  });
});
