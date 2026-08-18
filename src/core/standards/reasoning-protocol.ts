import type { ReasoningInput, ReasoningLimits, ReasoningResult } from './reasoning.ts';

export const MAX_REASONING_MESSAGE_BYTES = 2_000_000;

export type ReasoningWorkerRequest =
  | { type: 'reason'; requestId: string; input: ReasoningInput; limits?: Partial<ReasoningLimits> }
  | { type: 'cancel'; requestId: string };

export type ReasoningWorkerResponse =
  | { type: 'ready' }
  | { type: 'result'; requestId: string; result: ReasoningResult }
  | { type: 'cancelled'; requestId: string }
  | { type: 'error'; requestId: string; message: string };

export function assertReasoningMessageBound(value: unknown): void {
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (bytes > MAX_REASONING_MESSAGE_BYTES) {
    throw new RangeError(`Reasoning message exceeds ${MAX_REASONING_MESSAGE_BYTES} bytes.`);
  }
}
