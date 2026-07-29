import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Engine } from '../src/core/engine.ts';
import { executeSink } from '../src/lazy/sink-execution.ts';
import type { TaxonomyBundle } from '../src/taxonomy/types.ts';
import { openAnonymizeModal } from '../src/ui/sinks/anonymize-modal.ts';
import type { SinkContext } from '../src/ui/sinks/catalog.ts';

vi.mock('../src/ui/sinks/anonymize-modal.ts', () => ({
  openAnonymizeModal: vi.fn(async ({ initialPlan }) => ({
    plan: initialPlan,
    salt: '0123456789abcdef0123456789abcdef',
    saltOrigin: 'generated',
  })),
}));

const bundle: TaxonomyBundle = {
  version: 'test',
  released: '2026-07-29',
  domains: [],
  types: [],
  universal: { terms: [], crosswalk: [] },
};

function context(engine: Engine): SinkContext {
  return {
    engine,
    cellId: 'cell-1',
    cellName: 'safe',
    result: {
      columns: ['mystery'],
      rows: [{ mystery: '=payload' }],
      rowCount: 1,
      elapsedMs: 1,
    },
    columnAssignments: [
      {
        columnName: 'mystery',
        sqlType: 'VARCHAR',
        candidates: [],
        resolution: { kind: 'unknown' },
        assigned: { typeId: null, origin: 'unknown', confidence: 0 },
        status: 'classified',
      },
    ],
    resultProvenance: [
      {
        outputColumn: 'mystery',
        status: 'unproven',
        sourceId: null,
        tableId: null,
        tableName: null,
        sourceColumn: null,
        assignmentKey: null,
        assignment: null,
      },
    ],
    userTypes: [],
    taxonomyBundle: bundle,
  };
}

function engine(): Engine {
  return {
    exec: vi.fn().mockResolvedValue(undefined),
    exportFileBytes: vi.fn().mockResolvedValue(new TextEncoder().encode('data')),
    removeFile: vi.fn().mockResolvedValue(undefined),
  } as unknown as Engine;
}

afterEach(() => {
  vi.clearAllMocks();
  Reflect.deleteProperty(globalThis, 'window');
});

describe('anonymized sink artifact contract', () => {
  it('defaults unproven columns to redact and writes nothing when manifest selection is cancelled', async () => {
    const e = engine();
    const dataWrite = vi.fn();
    let calls = 0;
    Object.assign(globalThis, {
      window: {
        showSaveFilePicker: vi.fn(async () => {
          calls++;
          if (calls === 2) throw new DOMException('cancelled', 'AbortError');
          return {
            name: 'safe.csv',
            createWritable: async () => ({ write: dataWrite, close: vi.fn() }),
          };
        }),
      },
    });

    await expect(executeSink('anonymize', context(e))).rejects.toThrow(
      'Manifest save cancelled. Nothing was written.',
    );
    expect(vi.mocked(openAnonymizeModal).mock.calls[0]?.[0].initialPlan[0]?.strategy).toBe(
      'redact',
    );
    expect(dataWrite).not.toHaveBeenCalled();
    expect(e.exec).not.toHaveBeenCalled();
  });

  it('reports a partial export with retry guidance when manifest writing fails', async () => {
    const e = engine();
    const dataWrite = vi.fn().mockResolvedValue(undefined);
    const manifestWrite = vi.fn().mockRejectedValue(new Error('disk full'));
    const handles = [
      {
        name: 'safe.csv',
        createWritable: async () => ({ write: dataWrite, close: vi.fn() }),
      },
      {
        name: 'safe.manifest.json',
        createWritable: async () => ({ write: manifestWrite, close: vi.fn() }),
      },
    ];
    Object.assign(globalThis, {
      window: {
        showSaveFilePicker: vi.fn(async () => handles.shift()),
      },
    });

    await expect(executeSink('anonymize', context(e))).rejects.toThrow(
      /Data was written to safe\.csv, but the manifest failed\. Retry before sharing\. disk full/,
    );
    expect(dataWrite).toHaveBeenCalledOnce();
    expect(manifestWrite).toHaveBeenCalledOnce();
  });
});
