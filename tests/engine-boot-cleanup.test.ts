import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const duckdbMock = vi.hoisted(() => {
  interface Behavior {
    instantiateError?: Error;
    connectError?: Error;
    connection?: {
      query: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    };
  }
  const state = {
    behaviors: [] as Behavior[],
    instances: [] as FakeAsyncDuckDB[],
  };

  class FakeAsyncDuckDB {
    readonly behavior: Behavior;
    readonly instantiate = vi.fn(async () => {
      if (this.behavior.instantiateError) throw this.behavior.instantiateError;
      return null;
    });
    readonly connect = vi.fn(async () => {
      if (this.behavior.connectError) throw this.behavior.connectError;
      return (
        this.behavior.connection ?? {
          query: vi.fn(async () => []),
          close: vi.fn(async () => {}),
        }
      );
    });
    readonly terminate = vi.fn(async () => {});

    constructor() {
      this.behavior = state.behaviors.shift() ?? {};
      state.instances.push(this);
    }
  }

  return {
    state,
    AsyncDuckDB: FakeAsyncDuckDB,
    VoidLogger: class {},
    selectBundle: vi.fn(),
  };
});

vi.mock('@duckdb/duckdb-wasm', () => ({
  AsyncDuckDB: duckdbMock.AsyncDuckDB,
  VoidLogger: duckdbMock.VoidLogger,
  selectBundle: duckdbMock.selectBundle,
}));

import { Engine } from '../src/core/engine.ts';

class FakeWorker {
  readonly terminate = vi.fn();

  constructor(readonly url: string) {
    workers.push(this);
    if (workerConstructionError) throw workerConstructionError;
  }
}

let workers: FakeWorker[] = [];
let workerConstructionError: Error | null = null;

describe('Engine boot cleanup', () => {
  beforeEach(() => {
    duckdbMock.state.behaviors.length = 0;
    duckdbMock.state.instances.length = 0;
    duckdbMock.selectBundle.mockReset();
    duckdbMock.selectBundle.mockResolvedValue({
      mainModule: 'https://cdn.example.test/duckdb.wasm',
      mainWorker: 'https://cdn.example.test/duckdb.worker.js',
      pthreadWorker: null,
    });
    workers = [];
    workerConstructionError = null;
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('location', {
      href: 'https://app.example.test/index.html',
      origin: 'https://app.example.test',
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:duckdb-bootstrap');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('releases the database, worker, and bootstrap URL when connect fails', async () => {
    duckdbMock.state.behaviors.push({ connectError: new Error('connect failed') });
    const engine = new Engine();

    await expect(engine.boot()).rejects.toThrow(/connect failed/);

    expect(duckdbMock.state.instances[0]?.terminate).toHaveBeenCalledOnce();
    expect(workers[0]?.terminate).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:duckdb-bootstrap');
    expect(engine.getStatus()).toBe('error');
  });

  it('releases partial instantiate state and can retry with a clean engine', async () => {
    const connection = {
      query: vi.fn(async () => ({
        toArray: () => [{ toJSON: () => ({ ok: true }) }],
      })),
      close: vi.fn(async () => {}),
    };
    duckdbMock.state.behaviors.push({ instantiateError: new Error('wasm failed') }, { connection });
    const engine = new Engine();

    await expect(engine.boot()).rejects.toThrow(/wasm failed/);
    await expect(engine.boot()).resolves.toBeUndefined();
    expect(engine.getStatus()).toBe('ready');
    expect(duckdbMock.state.instances).toHaveLength(2);
    expect(workers).toHaveLength(2);

    await expect(engine.query('SELECT 1')).resolves.toEqual([{ ok: true }]);
    await engine.close();
    expect(connection.close).toHaveBeenCalledOnce();
    expect(duckdbMock.state.instances[1]?.terminate).toHaveBeenCalledOnce();
    expect(workers[1]?.terminate).toHaveBeenCalledOnce();
    expect(engine.getStatus()).toBe('idle');
  });

  it('revokes a bootstrap URL when Worker construction throws', async () => {
    workerConstructionError = new Error('worker blocked');
    const engine = new Engine();

    await expect(engine.boot()).rejects.toThrow(/worker blocked/);
    expect(duckdbMock.state.instances).toHaveLength(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:duckdb-bootstrap');
    expect(engine.getStatus()).toBe('error');
  });
});
