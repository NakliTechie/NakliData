export {
  DEFAULT_REASONING_DEADLINE_MS,
  MAX_REASONING_APPLICATIONS,
  MAX_REASONING_DEADLINE_MS,
  MAX_REASONING_FACTS,
  MAX_REASONING_NODES,
  MAX_REASONING_PROPOSALS,
  REASONING_PROFILE,
  ReasoningLimitError,
  buildReasoningFacts,
} from '../core/standards/reasoning.ts';

export {
  MAX_REASONING_MESSAGE_BYTES,
  assertReasoningMessageBound,
} from '../core/standards/reasoning-protocol.ts';

export type {
  ReasoningConflict,
  ReasoningFact,
  ReasoningFactKind,
  ReasoningInput,
  ReasoningLimits,
  ReasoningOptions,
  ReasoningProposal,
  ReasoningResult,
  ReasoningRule,
} from '../core/standards/reasoning.ts';

export type {
  ReasoningWorkerRequest,
  ReasoningWorkerResponse,
} from '../core/standards/reasoning-protocol.ts';

import {
  type ReasoningWorkerRequest,
  type ReasoningWorkerResponse,
  assertReasoningMessageBound,
} from '../core/standards/reasoning-protocol.ts';
import type {
  ReasoningInput,
  ReasoningLimits,
  ReasoningResult,
} from '../core/standards/reasoning.ts';

interface PendingReasoning {
  resolve: (result: ReasoningResult) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
}

export class StandardsReasoningClient {
  private worker: Worker | null = null;
  private boot: Promise<Worker> | null = null;
  private pending = new Map<string, PendingReasoning>();
  private sequence = 0;

  async reason(
    input: ReasoningInput,
    options: { signal?: AbortSignal; limits?: Partial<ReasoningLimits> } = {},
  ): Promise<ReasoningResult> {
    if (options.signal?.aborted) throw abortError();
    const worker = await this.ensureWorker();
    this.sequence += 1;
    const requestId = `standards-reasoning-${this.sequence}`;
    const message: ReasoningWorkerRequest = {
      type: 'reason',
      requestId,
      input,
      ...(options.limits ? { limits: options.limits } : {}),
    };
    assertReasoningMessageBound(message);
    return new Promise<ReasoningResult>((resolve, reject) => {
      const onAbort = (): void => {
        worker.postMessage({ type: 'cancel', requestId } satisfies ReasoningWorkerRequest);
      };
      const timeout = window.setTimeout(() => {
        worker.postMessage({ type: 'cancel', requestId } satisfies ReasoningWorkerRequest);
        this.pending.delete(requestId);
        options.signal?.removeEventListener('abort', onAbort);
        reject(new Error('Standards reasoning worker timed out.'));
      }, 10_000);
      const cleanup = (): void => {
        window.clearTimeout(timeout);
        options.signal?.removeEventListener('abort', onAbort);
      };
      this.pending.set(requestId, { resolve, reject, cleanup });
      options.signal?.addEventListener('abort', onAbort, { once: true });
      worker.postMessage(message);
    });
  }

  terminate(): void {
    this.failAll(new Error('Standards reasoning worker terminated.'));
  }

  private ensureWorker(): Promise<Worker> {
    if (this.worker) return Promise.resolve(this.worker);
    if (this.boot) return this.boot;
    this.boot = new Promise<Worker>((resolve, reject) => {
      const url = new URL('./standards-reasoning.worker.js', document.baseURI).href;
      const worker = new Worker(url, { type: 'module' });
      const timeout = window.setTimeout(() => {
        worker.terminate();
        this.boot = null;
        reject(new Error('Standards reasoning worker boot timed out.'));
      }, 10_000);
      const onMessage = (event: MessageEvent<ReasoningWorkerResponse>): void => {
        if (event.data.type === 'ready') {
          window.clearTimeout(timeout);
          this.worker = worker;
          this.boot = null;
          worker.removeEventListener('message', onMessage);
          worker.addEventListener('message', (next: MessageEvent<ReasoningWorkerResponse>) => {
            this.handleMessage(next.data);
          });
          resolve(worker);
        }
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener(
        'error',
        () => {
          window.clearTimeout(timeout);
          this.boot = null;
          reject(new Error('Standards reasoning worker failed to boot.'));
        },
        { once: true },
      );
    });
    return this.boot;
  }

  private handleMessage(message: ReasoningWorkerResponse): void {
    if (message.type === 'ready') return;
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    this.pending.delete(message.requestId);
    pending.cleanup();
    if (message.type === 'result') pending.resolve(message.result);
    else if (message.type === 'cancelled') pending.reject(abortError());
    else pending.reject(new Error(message.message));
  }

  private failAll(error: Error): void {
    this.worker?.terminate();
    this.worker = null;
    this.boot = null;
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function abortError(): Error {
  return new DOMException('Reasoning cancelled.', 'AbortError');
}
