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
  requestId: string;
  userTypes: UserType[];
}

interface ClassifyResultMsg {
  type: 'classify_result';
  requestId: string;
  result: ClassificationResult;
}

interface UserTypesAppliedMsg {
  type: 'user_types_applied';
  requestId: string;
  count: number;
}

interface ErrorMsg {
  type: 'error';
  requestId?: string;
  message: string;
}

type FromWorker = ClassifyResultMsg | UserTypesAppliedMsg | { type: 'init_ok' } | ErrorMsg;

const DEFAULT_INIT_TIMEOUT_MS = 15_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export interface TaxonomyClientOptions {
  loadBundle?: () => Promise<TaxonomyBundle>;
  createWorker?: (url: string) => Worker;
  baseUri?: string;
  initTimeoutMs?: number;
  requestTimeoutMs?: number;
}

export class TaxonomyClient {
  private worker: Worker | null = null;
  private bundle: TaxonomyBundle | null = null;
  private readyPromise: Promise<void> | null = null;
  /** Latest user types pushed to the worker. Tracked so we can re-send on worker re-init. */
  private userTypes: UserType[] = [];
  private pending = new Map<
    string,
    {
      resolve: (r: ClassificationResult) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private userTypeRequests = new Map<
    string,
    {
      resolve: () => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private nextId = 1;

  constructor(private readonly options: TaxonomyClientOptions = {}) {}

  async ensureReady(): Promise<void> {
    if (this.worker && this.bundle) return;
    if (!this.readyPromise) {
      this.readyPromise = this.boot().finally(() => {
        this.readyPromise = null;
      });
    }
    await this.readyPromise;
  }

  private async boot(): Promise<void> {
    const loadBundle = this.options.loadBundle ?? loadTaxonomy;
    this.bundle ??= await loadBundle();
    // Resolve the worker URL against the document's base URI so the
    // path holds under any deploy prefix (e.g., GitHub Pages serves us
    // at `/NakliData/` — a leading-slash URL would 404 there).
    const baseUri =
      this.options.baseUri ??
      (typeof document !== 'undefined' ? document.baseURI : 'http://localhost/');
    const workerUrl = new URL('./taxonomy.worker.js', baseUri).href;
    const createWorker =
      this.options.createWorker ?? ((url: string) => new Worker(url, { type: 'module' }));
    const worker = createWorker(workerUrl);
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
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (err: Error | null) => {
        if (settled) return;
        settled = true;
        worker.removeEventListener('message', onInit);
        worker.removeEventListener('error', onError);
        worker.removeEventListener('messageerror', onMessageError);
        if (timer !== null) clearTimeout(timer);
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
      const initTimeoutMs = this.options.initTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS;
      timer = setTimeout(() => {
        finish(
          new Error(
            `taxonomy worker init timed out after ${initTimeoutMs}ms — check that taxonomy.worker.js loads at the deploy prefix`,
          ),
        );
      }, initTimeoutMs);
      worker.postMessage({ type: 'init', bundle: this.bundle });
    });
    this.worker = worker;
    worker.addEventListener('message', (ev: MessageEvent<FromWorker>) =>
      this.handleMessage(worker, ev.data),
    );
    worker.addEventListener('error', (ev: ErrorEvent) => {
      this.failWorker(worker, new Error(`taxonomy worker error: ${ev.message || 'unknown'}`));
    });
    worker.addEventListener('messageerror', () => {
      this.failWorker(worker, new Error('taxonomy worker messageerror — unparseable postMessage'));
    });
    // Re-apply any user types we knew about (e.g., after a worker restart).
    if (this.userTypes.length > 0) {
      await this.sendUserTypes(worker, this.userTypes);
    }
  }

  private handleMessage(worker: Worker, msg: FromWorker): void {
    if (worker !== this.worker) return;
    if (msg.type === 'classify_result') {
      const entry = this.pending.get(msg.requestId);
      if (entry) {
        this.pending.delete(msg.requestId);
        clearTimeout(entry.timer);
        entry.resolve(msg.result);
      }
      return;
    }
    if (msg.type === 'user_types_applied') {
      const entry = this.userTypeRequests.get(msg.requestId);
      if (entry) {
        this.userTypeRequests.delete(msg.requestId);
        clearTimeout(entry.timer);
        entry.resolve();
      }
      return;
    }
    if (msg.type === 'error') {
      if (msg.requestId) {
        const entry = this.pending.get(msg.requestId);
        if (entry) {
          this.pending.delete(msg.requestId);
          clearTimeout(entry.timer);
          entry.reject(new Error(msg.message));
          return;
        }
        const userTypeEntry = this.userTypeRequests.get(msg.requestId);
        if (userTypeEntry) {
          this.userTypeRequests.delete(msg.requestId);
          clearTimeout(userTypeEntry.timer);
          userTypeEntry.reject(new Error(msg.message));
          return;
        }
      }
      this.failWorker(worker, new Error(msg.message));
    }
  }

  classify(sample: ColumnSample): Promise<ClassificationResult> {
    const worker = this.worker;
    if (!worker) throw new Error('TaxonomyClient not initialized; call ensureReady first');
    const requestId = `c${this.nextId++}`;
    return new Promise<ClassificationResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.failWorker(
          worker,
          new Error(`taxonomy classification timed out after ${this.requestTimeoutMs()}ms`),
        );
      }, this.requestTimeoutMs());
      this.pending.set(requestId, { resolve, reject, timer });
      const req: ClassifyRequest = { type: 'classify', requestId, sample };
      try {
        worker.postMessage(req);
      } catch (err) {
        this.failWorker(worker, toError(err, 'taxonomy worker postMessage failed'));
      }
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
    const worker = this.worker;
    if (!worker) return; // worker not yet booted; ensureReady will re-apply
    await this.sendUserTypes(worker, userTypes);
  }

  private async sendUserTypes(worker: Worker, userTypes: UserType[]): Promise<void> {
    const requestId = `u${this.nextId++}`;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.failWorker(
          worker,
          new Error(`taxonomy user-type update timed out after ${this.requestTimeoutMs()}ms`),
        );
      }, this.requestTimeoutMs());
      this.userTypeRequests.set(requestId, { resolve, reject, timer });
      const req: SetUserTypesRequest = { type: 'set_user_types', requestId, userTypes };
      try {
        worker.postMessage(req);
      } catch (err) {
        this.failWorker(worker, toError(err, 'taxonomy worker postMessage failed'));
      }
    });
  }

  private requestTimeoutMs(): number {
    return this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  private failWorker(worker: Worker, error: Error): void {
    if (this.worker !== worker) return;
    this.worker = null;
    try {
      worker.terminate();
    } catch {
      // Worker may already have stopped.
    }
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
    for (const entry of this.userTypeRequests.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.userTypeRequests.clear();
  }

  getBundle(): TaxonomyBundle | null {
    return this.bundle;
  }

  getUserTypes(): UserType[] {
    return this.userTypes;
  }
}

function toError(value: unknown, prefix: string): Error {
  return new Error(`${prefix}: ${value instanceof Error ? value.message : String(value)}`);
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
