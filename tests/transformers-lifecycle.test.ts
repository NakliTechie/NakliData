import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pipeline: vi.fn(),
}));

vi.mock('@huggingface/transformers', () => ({
  env: {},
  pipeline: mocks.pipeline,
}));

vi.mock('../src/core/sidecar/local-cache.ts', () => ({
  hasModelFile: vi.fn(async () => false),
  isOpfsAvailable: vi.fn(async () => true),
  readModelFile: vi.fn(async () => null),
  writeModelFile: vi.fn(async () => undefined),
}));

const runtime = await import('../src/lazy/transformers.ts');

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakePipeline(name: string): { name: string; dispose: ReturnType<typeof vi.fn> } {
  return { name, dispose: vi.fn(async () => undefined) };
}

describe('local text-generation pipeline lifecycle', () => {
  beforeEach(async () => {
    await runtime.disposePipeline();
    mocks.pipeline.mockReset();
  });

  it('shares one construction for concurrent requests for the same model', async () => {
    const pending = deferred<ReturnType<typeof fakePipeline>>();
    const pipe = fakePipeline('a');
    mocks.pipeline.mockReturnValueOnce(pending.promise);

    const first = runtime.loadPipeline('model-a');
    const second = runtime.loadPipeline('model-a');
    await vi.waitFor(() => expect(mocks.pipeline).toHaveBeenCalledTimes(1));

    pending.resolve(pipe);
    await expect(first).resolves.toBe(pipe);
    await expect(second).resolves.toBe(pipe);
    expect(runtime.getActiveLocalModelId()).toBe('model-a');
  });

  it('serializes different-model waiters and disposes each displaced owner once', async () => {
    const loadA = deferred<ReturnType<typeof fakePipeline>>();
    const loadB = deferred<ReturnType<typeof fakePipeline>>();
    const loadC = deferred<ReturnType<typeof fakePipeline>>();
    const pipeA = fakePipeline('a');
    const pipeB = fakePipeline('b');
    const pipeC = fakePipeline('c');
    for (const load of [loadA, loadB, loadC]) mocks.pipeline.mockReturnValueOnce(load.promise);

    const first = runtime.loadPipeline('model-a');
    const second = runtime.loadPipeline('model-b');
    const third = runtime.loadPipeline('model-c');
    await vi.waitFor(() => expect(mocks.pipeline).toHaveBeenCalledTimes(1));

    loadA.resolve(pipeA);
    await vi.waitFor(() => expect(mocks.pipeline).toHaveBeenCalledTimes(2));
    expect(pipeA.dispose).toHaveBeenCalledTimes(1);

    loadB.resolve(pipeB);
    await vi.waitFor(() => expect(mocks.pipeline).toHaveBeenCalledTimes(3));
    expect(pipeB.dispose).toHaveBeenCalledTimes(1);

    loadC.resolve(pipeC);
    await expect(first).resolves.toBe(pipeA);
    await expect(second).resolves.toBe(pipeB);
    await expect(third).resolves.toBe(pipeC);
    expect(pipeC.dispose).not.toHaveBeenCalled();
    expect(runtime.getActiveLocalModelId()).toBe('model-c');
  });

  it('invalidates and disposes a construction that resolves after disposal', async () => {
    const pending = deferred<ReturnType<typeof fakePipeline>>();
    const pipe = fakePipeline('late');
    mocks.pipeline.mockReturnValueOnce(pending.promise);

    const load = runtime.loadPipeline('model-late');
    const rejected = expect(load).rejects.toThrow('cancelled before it became active');
    await vi.waitFor(() => expect(mocks.pipeline).toHaveBeenCalledTimes(1));
    const disposal = runtime.disposePipeline();

    pending.resolve(pipe);
    await rejected;
    await disposal;
    expect(pipe.dispose).toHaveBeenCalledTimes(1);
    expect(runtime.getActiveLocalModelId()).toBeNull();
    expect(runtime.getActiveLocalDevice()).toBeNull();
  });
});
