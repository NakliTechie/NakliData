// Main-thread client for the taxonomy worker. Boots the worker, ships the
// bundle once, and exposes `classifyAllColumns` that walks a table's
// columns and resolves a ClassificationResult per column.
//
// User-defined types from the workbook are pushed to the worker via
// `setUserTypes` after init + every time they change. The worker
// merges them into its effective bundle so subsequent `classify` calls
// see them as first-class candidate types.

import type { Engine } from '../core/engine.ts';
import type { UserType } from '../core/workbook.ts';
import { loadTaxonomy } from './load.ts';
import type { ClassificationResult, ColumnSample, TaxonomyBundle } from './types.ts';

interface ClassifyRequest {
  type: 'classify';
  requestId: string;
  sample: ColumnSample;
}

interface SetUserTypesRequest {
  type: 'set_user_types';
  userTypes: UserType[];
}

interface ClassifyResultMsg {
  type: 'classify_result';
  requestId: string;
  result: ClassificationResult;
}

interface UserTypesAppliedMsg {
  type: 'user_types_applied';
  count: number;
}

interface ErrorMsg {
  type: 'error';
  requestId?: string;
  message: string;
}

type FromWorker = ClassifyResultMsg | UserTypesAppliedMsg | { type: 'init_ok' } | ErrorMsg;

export class TaxonomyClient {
  private worker: Worker | null = null;
  private bundle: TaxonomyBundle | null = null;
  /** Latest user types pushed to the worker. Tracked so we can re-send on worker re-init. */
  private userTypes: UserType[] = [];
  private pending = new Map<
    string,
    { resolve: (r: ClassificationResult) => void; reject: (e: Error) => void }
  >();
  /** Resolvers waiting on `user_types_applied`. Only one in flight at a time is normal. */
  private setUserTypesWaiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
  private nextId = 1;

  async ensureReady(): Promise<void> {
    if (this.worker && this.bundle) return;
    this.bundle = await loadTaxonomy();
    // Resolve the worker URL against the document's base URI so the
    // path holds under any deploy prefix (e.g., GitHub Pages serves us
    // at `/NakliData/` — a leading-slash URL would 404 there).
    const workerUrl = new URL('./taxonomy.worker.js', document.baseURI).href;
    const worker = new Worker(workerUrl, { type: 'module' });
    // Forward-pass M7 (2026-06-02): the original init promise only
    // resolved on `init_ok` and a structured `error` message; it had
    // no listener for the Worker's own `error` / `messageerror` events
    // and no timeout. If `taxonomy.worker.js` 404'd under a
    // misconfigured deploy prefix or threw on module import, the
    // schema panel would hang at "Classifying columns…" forever.
    // Listen for error events + apply a 15s timeout (worker init is
    // typically <100 ms; 15s is the slowest-cold-start budget).
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (err: Error | null) => {
        if (settled) return;
        settled = true;
        worker.removeEventListener('message', onInit);
        worker.removeEventListener('error', onError);
        worker.removeEventListener('messageerror', onMessageError);
        clearTimeout(timer);
        if (err) {
          // Code-review of v1.2.1..HEAD: terminate the orphaned Worker
          // on any error path (timeout, init error, messageerror). The
          // original M7 fix removed listeners but left the Worker alive,
          // pinning its module context + memory and letting repeated
          // retries pile up workers.
          try {
            worker.terminate();
          } catch {
            /* ignore — worker may already be in an error state */
          }
          reject(err);
        } else resolve();
      };
      const onInit = (ev: MessageEvent<FromWorker>) => {
        if (ev.data.type === 'init_ok') finish(null);
        else if (ev.data.type === 'error') finish(new Error(ev.data.message));
      };
      const onError = (ev: ErrorEvent) => {
        finish(new Error(`taxonomy worker error: ${ev.message ?? 'unknown'}`));
      };
      const onMessageError = () => {
        finish(new Error('taxonomy worker messageerror — unparseable postMessage'));
      };
      worker.addEventListener('message', onInit);
      worker.addEventListener('error', onError);
      worker.addEventListener('messageerror', onMessageError);
      const timer = setTimeout(() => {
        finish(
          new Error(
            'taxonomy worker init timed out after 15s — check that taxonomy.worker.js loads at the deploy prefix',
          ),
        );
      }, 15_000);
      worker.postMessage({ type: 'init', bundle: this.bundle });
    });
    worker.addEventListener('message', (ev: MessageEvent<FromWorker>) =>
      this.handleMessage(ev.data),
    );
    this.worker = worker;
    // Re-apply any user types we knew about (e.g., after a worker restart).
    if (this.userTypes.length > 0) {
      await this.setUserTypes(this.userTypes);
    }
  }

  private handleMessage(msg: FromWorker): void {
    if (msg.type === 'classify_result') {
      const entry = this.pending.get(msg.requestId);
      if (entry) {
        this.pending.delete(msg.requestId);
        entry.resolve(msg.result);
      }
      return;
    }
    if (msg.type === 'user_types_applied') {
      const waiter = this.setUserTypesWaiters.shift();
      waiter?.resolve();
      return;
    }
    if (msg.type === 'error') {
      if (msg.requestId) {
        const entry = this.pending.get(msg.requestId);
        if (entry) {
          this.pending.delete(msg.requestId);
          entry.reject(new Error(msg.message));
        }
      } else {
        // No request id → assume the error belongs to the oldest set-user-types waiter.
        const waiter = this.setUserTypesWaiters.shift();
        waiter?.reject(new Error(msg.message));
      }
    }
  }

  classify(sample: ColumnSample): Promise<ClassificationResult> {
    if (!this.worker) throw new Error('TaxonomyClient not initialized; call ensureReady first');
    const requestId = `c${this.nextId++}`;
    return new Promise<ClassificationResult>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      const req: ClassifyRequest = { type: 'classify', requestId, sample };
      this.worker?.postMessage(req);
    });
  }

  /**
   * Push the current set of user-defined types to the worker. The
   * worker merges them into its effective bundle for subsequent
   * `classify` calls. Resolves when the worker confirms.
   *
   * Caller should hold the latest list (the workbook does) and call
   * this on every change. We also cache the list locally so
   * `ensureReady` can re-apply it after a worker restart.
   */
  async setUserTypes(userTypes: UserType[]): Promise<void> {
    this.userTypes = [...userTypes];
    if (!this.worker) return; // worker not yet booted; ensureReady will re-apply
    await new Promise<void>((resolve, reject) => {
      this.setUserTypesWaiters.push({ resolve, reject });
      const req: SetUserTypesRequest = { type: 'set_user_types', userTypes };
      this.worker?.postMessage(req);
    });
  }

  getBundle(): TaxonomyBundle | null {
    return this.bundle;
  }

  getUserTypes(): UserType[] {
    return this.userTypes;
  }
}

let _client: TaxonomyClient | null = null;
export function getTaxonomyClient(): TaxonomyClient {
  if (!_client) _client = new TaxonomyClient();
  return _client;
}

export async function classifyTableColumns(
  engine: Engine,
  client: TaxonomyClient,
  tableName: string,
): Promise<ClassificationResult[]> {
  await client.ensureReady();
  const cols = await engine.describeColumns(tableName);
  const out: ClassificationResult[] = [];
  for (const c of cols) {
    const stats = await engine.sampleColumn(tableName, c.name);
    const sample: ColumnSample = {
      tableName,
      columnName: c.name,
      sqlType: c.type,
      values: stats.values,
      totalSampled: stats.totalSampled,
      nullCount: stats.nullCount,
      distinctCount: stats.distinctCount,
    };
    const result = await client.classify(sample);
    out.push(result);
  }
  return out;
}
