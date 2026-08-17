import {
  type CanonicalInterchangeV1,
  type LossRecord,
  type ValidationIssue,
  migrateCanonicalInterchange,
  serializeCanonicalInterchange,
  validateCanonicalInterchange,
} from '../core/standards/interchange.ts';

export const MAX_STANDARDS_MESSAGE_BYTES = 2_000_000;

export type StandardsWorkerRequest =
  | { id: string; operation: 'validate'; document: unknown }
  | { id: string; operation: 'migrate'; document: unknown }
  | { id: string; operation: 'serialize'; document: unknown };

export type StandardsWorkerResponse =
  | {
      id: string;
      ok: true;
      operation: StandardsWorkerRequest['operation'];
      document: CanonicalInterchangeV1 | null;
      json: string | null;
      issues: ValidationIssue[];
      losses: LossRecord[];
    }
  | { id: string; ok: false; error: string };

/** Pure request handler so the worker boundary has deterministic unit coverage. */
export function handleStandardsWorkerRequest(
  request: StandardsWorkerRequest,
): StandardsWorkerResponse {
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(request.document)).byteLength;
    if (bytes > MAX_STANDARDS_MESSAGE_BYTES) {
      throw new RangeError(`Standards artifact exceeds ${MAX_STANDARDS_MESSAGE_BYTES} bytes.`);
    }
    if (request.operation === 'validate') {
      const document = request.document as CanonicalInterchangeV1;
      return {
        id: request.id,
        ok: true,
        operation: request.operation,
        document: null,
        json: null,
        issues: validateCanonicalInterchange(document),
        losses: [],
      };
    }
    const migration = migrateCanonicalInterchange(request.document);
    return {
      id: request.id,
      ok: true,
      operation: request.operation,
      document: migration.document,
      json:
        request.operation === 'serialize'
          ? serializeCanonicalInterchange(migration.document)
          : null,
      issues: [],
      losses: migration.losses,
    };
  } catch (error) {
    return {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

declare const self: DedicatedWorkerGlobalScope;

if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.addEventListener('message', (event: MessageEvent<StandardsWorkerRequest>) => {
    self.postMessage(handleStandardsWorkerRequest(event.data));
  });
}
