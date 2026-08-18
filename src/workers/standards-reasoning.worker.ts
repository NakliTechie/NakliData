import {
  type ReasoningWorkerRequest,
  type ReasoningWorkerResponse,
  assertReasoningMessageBound,
} from '../core/standards/reasoning-protocol.ts';
import { runBoundedReasoning } from '../core/standards/reasoning.ts';

const worker = self as unknown as Worker;
const active = new Map<string, AbortController>();

function post(message: ReasoningWorkerResponse): void {
  worker.postMessage(message);
}

worker.onmessage = (event: MessageEvent<ReasoningWorkerRequest>) => {
  const message = event.data;
  try {
    assertReasoningMessageBound(message);
  } catch (error) {
    const requestId = typeof message?.requestId === 'string' ? message.requestId : 'unknown';
    post({ type: 'error', requestId, message: errorMessage(error) });
    return;
  }
  if (message.type === 'cancel') {
    active.get(message.requestId)?.abort();
    return;
  }
  const prior = active.get(message.requestId);
  prior?.abort();
  const controller = new AbortController();
  active.set(message.requestId, controller);
  void runBoundedReasoning(message.input, {
    signal: controller.signal,
    yieldControl: () => new Promise((resolve) => setTimeout(resolve, 0)),
    ...(message.limits ? { limits: message.limits } : {}),
  })
    .then((result) => {
      if (active.get(message.requestId) !== controller) return;
      active.delete(message.requestId);
      post({ type: 'result', requestId: message.requestId, result });
    })
    .catch((error: unknown) => {
      if (active.get(message.requestId) !== controller) return;
      active.delete(message.requestId);
      if (error instanceof DOMException && error.name === 'AbortError') {
        post({ type: 'cancelled', requestId: message.requestId });
      } else {
        post({ type: 'error', requestId: message.requestId, message: errorMessage(error) });
      }
    });
};

post({ type: 'ready' });

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
