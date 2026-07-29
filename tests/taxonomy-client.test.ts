import { describe, expect, it, vi } from 'vitest';
import type { UserType } from '../src/core/workbook.ts';
import { TaxonomyClient } from '../src/taxonomy/client.ts';
import type { ColumnSample, TaxonomyBundle } from '../src/taxonomy/types.ts';

type WorkerListener = EventListenerOrEventListenerObject;

class FakeWorker {
  readonly messages: unknown[] = [];
  terminated = false;
  onPost: ((message: Record<string, unknown>) => void) | null = null;
  private listeners = new Map<string, Set<WorkerListener>>();

  addEventListener(type: string, listener: WorkerListener | null): void {
    if (!listener) return;
    const listeners = this.listeners.get(type) ?? new Set<WorkerListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: WorkerListener | null): void {
    if (listener) this.listeners.get(type)?.delete(listener);
  }

  postMessage(message: Record<string, unknown>): void {
    this.messages.push(message);
    this.onPost?.(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emitMessage(data: unknown): void {
    this.emit('message', { data } as MessageEvent);
  }

  emitError(message: string): void {
    this.emit('error', { message } as ErrorEvent);
  }

  asWorker(): Worker {
    return this as unknown as Worker;
  }

  private emit(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === 'function') listener(event);
      else listener.handleEvent(event);
    }
  }
}

const BUNDLE: TaxonomyBundle = {
  version: '0.1',
  released: '2026-05-15',
  domains: [],
  types: [],
};

const SAMPLE: ColumnSample = {
  tableName: 't',
  columnName: 'employee_id',
  sqlType: 'VARCHAR',
  values: ['EMP-0001'],
  totalSampled: 1,
  nullCount: 0,
  distinctCount: 1,
};

const USER_TYPE: UserType = {
  id: 'employee_id',
  display_name: 'Employee ID',
  category: 'Identifier',
  regex: '^EMP-[0-9]{4}$',
  sensitivity: 'pii',
  created: '2026-07-29T00:00:00.000Z',
};

function respondToInit(worker: FakeWorker): void {
  worker.onPost = (message) => {
    if (message.type === 'init') {
      queueMicrotask(() => worker.emitMessage({ type: 'init_ok' }));
    }
  };
}

describe('TaxonomyClient worker lifecycle', () => {
  it('shares one in-flight boot and reapplies cached user types with an acknowledgement', async () => {
    const worker = new FakeWorker();
    worker.onPost = (message) => {
      if (message.type === 'init') {
        queueMicrotask(() => worker.emitMessage({ type: 'init_ok' }));
      } else if (message.type === 'set_user_types') {
        queueMicrotask(() =>
          worker.emitMessage({
            type: 'user_types_applied',
            requestId: message.requestId,
            count: 1,
          }),
        );
      }
    };
    const loadBundle = vi.fn(async () => BUNDLE);
    const createWorker = vi.fn(() => worker.asWorker());
    const client = new TaxonomyClient({
      loadBundle,
      createWorker,
      baseUri: 'https://example.test/app/',
      requestTimeoutMs: 50,
    });

    await client.setUserTypes([USER_TYPE]);
    await Promise.all([client.ensureReady(), client.ensureReady(), client.ensureReady()]);

    expect(loadBundle).toHaveBeenCalledTimes(1);
    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(worker.messages.map((message) => (message as { type: string }).type)).toEqual([
      'init',
      'set_user_types',
    ]);
  });

  it('times out init, terminates the orphan, and can boot a replacement', async () => {
    const first = new FakeWorker();
    const second = new FakeWorker();
    respondToInit(second);
    const workers = [first, second];
    const client = new TaxonomyClient({
      loadBundle: async () => BUNDLE,
      createWorker: () => {
        const worker = workers.shift();
        if (!worker) throw new Error('unexpected extra worker');
        return worker.asWorker();
      },
      baseUri: 'https://example.test/app/',
      initTimeoutMs: 5,
    });

    await expect(client.ensureReady()).rejects.toThrow(/timed out after 5ms/);
    expect(first.terminated).toBe(true);
    await expect(client.ensureReady()).resolves.toBeUndefined();
    expect(second.terminated).toBe(false);
  });

  it('rejects every pending request on timeout and recreates the worker', async () => {
    const first = new FakeWorker();
    const second = new FakeWorker();
    respondToInit(first);
    respondToInit(second);
    const workers = [first, second];
    const client = new TaxonomyClient({
      loadBundle: async () => BUNDLE,
      createWorker: () => {
        const worker = workers.shift();
        if (!worker) throw new Error('unexpected extra worker');
        return worker.asWorker();
      },
      baseUri: 'https://example.test/app/',
      requestTimeoutMs: 5,
    });
    await client.ensureReady();

    const outcomes = await Promise.allSettled([client.classify(SAMPLE), client.classify(SAMPLE)]);
    expect(outcomes).toHaveLength(2);
    for (const outcome of outcomes) {
      expect(outcome.status).toBe('rejected');
      if (outcome.status === 'rejected') {
        expect(outcome.reason).toMatchObject({ message: expect.stringMatching(/timed out/) });
      }
    }
    expect(first.terminated).toBe(true);
    await expect(client.ensureReady()).resolves.toBeUndefined();
  });

  it('rejects pending work when the worker emits a fatal error', async () => {
    const worker = new FakeWorker();
    respondToInit(worker);
    const client = new TaxonomyClient({
      loadBundle: async () => BUNDLE,
      createWorker: () => worker.asWorker(),
      baseUri: 'https://example.test/app/',
      requestTimeoutMs: 50,
    });
    await client.ensureReady();

    const pending = client.classify(SAMPLE);
    worker.emitError('module crashed');

    await expect(pending).rejects.toThrow(/module crashed/);
    expect(worker.terminated).toBe(true);
  });

  it('requires a timely acknowledgement for user-type updates', async () => {
    const worker = new FakeWorker();
    respondToInit(worker);
    const client = new TaxonomyClient({
      loadBundle: async () => BUNDLE,
      createWorker: () => worker.asWorker(),
      baseUri: 'https://example.test/app/',
      requestTimeoutMs: 5,
    });
    await client.ensureReady();

    await expect(client.setUserTypes([USER_TYPE])).rejects.toThrow(/user-type update timed out/);
    expect(worker.terminated).toBe(true);
  });
});
