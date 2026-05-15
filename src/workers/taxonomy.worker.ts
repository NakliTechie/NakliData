// Taxonomy classification worker. Runs detector dispatch off the main
// thread so a large table doesn't block UI work. Spec §2.2 + §3.4.

import { classifyColumn } from '../taxonomy/classify.ts';
import type { ClassificationResult, ColumnSample, TaxonomyBundle } from '../taxonomy/types.ts';

interface InitMessage {
  type: 'init';
  bundle: TaxonomyBundle;
}

interface ClassifyMessage {
  type: 'classify';
  requestId: string;
  sample: ColumnSample;
}

interface InitResponse {
  type: 'init_ok';
}

interface ClassifyResponse {
  type: 'classify_result';
  requestId: string;
  result: ClassificationResult;
}

interface ErrorResponse {
  type: 'error';
  requestId?: string;
  message: string;
}

type Incoming = InitMessage | ClassifyMessage;
type Outgoing = InitResponse | ClassifyResponse | ErrorResponse;

let bundle: TaxonomyBundle | null = null;

const w = self as unknown as Worker;

w.onmessage = (ev: MessageEvent<Incoming>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      bundle = msg.bundle;
      post({ type: 'init_ok' });
      return;
    }
    if (msg.type === 'classify') {
      if (!bundle) {
        post({ type: 'error', requestId: msg.requestId, message: 'Worker not initialized' });
        return;
      }
      const result = classifyColumn(bundle, msg.sample);
      post({ type: 'classify_result', requestId: msg.requestId, result });
      return;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errResp: ErrorResponse =
      'requestId' in msg
        ? { type: 'error', requestId: msg.requestId, message }
        : { type: 'error', message };
    post(errResp);
  }
};

function post(msg: Outgoing): void {
  w.postMessage(msg);
}
