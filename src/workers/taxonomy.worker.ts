// Taxonomy classification worker. Runs detector dispatch off the main
// thread so a large table doesn't block UI work. Spec §2.2 + §3.4.
//
// Holds two pieces of state:
//   - `bundle`: the immutable taxonomy bundle loaded at init.
//   - `effectiveBundle`: bundle merged with any user-defined types
//     pushed via `set_user_types`. Classification reads from this.

import type { UserType } from '../core/workbook.ts';
import { classifyColumn } from '../taxonomy/classify.ts';
import type { ClassificationResult, ColumnSample, TaxonomyBundle } from '../taxonomy/types.ts';
import { mergeUserTypesIntoBundle } from '../taxonomy/user-types.ts';

interface InitMessage {
  type: 'init';
  bundle: TaxonomyBundle;
}

interface SetUserTypesMessage {
  type: 'set_user_types';
  userTypes: UserType[];
}

interface ClassifyMessage {
  type: 'classify';
  requestId: string;
  sample: ColumnSample;
}

interface InitResponse {
  type: 'init_ok';
}

interface UserTypesAppliedResponse {
  type: 'user_types_applied';
  count: number;
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

type Incoming = InitMessage | SetUserTypesMessage | ClassifyMessage;
type Outgoing = InitResponse | UserTypesAppliedResponse | ClassifyResponse | ErrorResponse;

let bundle: TaxonomyBundle | null = null;
let userTypes: UserType[] = [];
let effectiveBundle: TaxonomyBundle | null = null;

function recomputeEffectiveBundle(): void {
  if (!bundle) {
    effectiveBundle = null;
    return;
  }
  effectiveBundle = mergeUserTypesIntoBundle(bundle, userTypes);
}

const w = self as unknown as Worker;

w.onmessage = (ev: MessageEvent<Incoming>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      bundle = msg.bundle;
      recomputeEffectiveBundle();
      post({ type: 'init_ok' });
      return;
    }
    if (msg.type === 'set_user_types') {
      userTypes = msg.userTypes;
      recomputeEffectiveBundle();
      post({ type: 'user_types_applied', count: userTypes.length });
      return;
    }
    if (msg.type === 'classify') {
      if (!effectiveBundle) {
        post({ type: 'error', requestId: msg.requestId, message: 'Worker not initialized' });
        return;
      }
      const result = classifyColumn(effectiveBundle, msg.sample);
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
