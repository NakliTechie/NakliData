// Main-thread client for the taxonomy worker. Boots the worker, ships the
// bundle once, and exposes `classifyAllColumns` that walks a table's
// columns and resolves a ClassificationResult per column.

import type { Engine } from '../core/engine.ts';
import { loadTaxonomy } from './load.ts';
import type { ClassificationResult, ColumnSample, TaxonomyBundle } from './types.ts';

interface ClassifyRequest {
  type: 'classify';
  requestId: string;
  sample: ColumnSample;
}

interface ClassifyResultMsg {
  type: 'classify_result';
  requestId: string;
  result: ClassificationResult;
}

interface ErrorMsg {
  type: 'error';
  requestId?: string;
  message: string;
}

type FromWorker = ClassifyResultMsg | { type: 'init_ok' } | ErrorMsg;

export class TaxonomyClient {
  private worker: Worker | null = null;
  private bundle: TaxonomyBundle | null = null;
  private pending = new Map<
    string,
    { resolve: (r: ClassificationResult) => void; reject: (e: Error) => void }
  >();
  private nextId = 1;

  async ensureReady(): Promise<void> {
    if (this.worker && this.bundle) return;
    this.bundle = await loadTaxonomy();
    const worker = new Worker('/taxonomy.worker.js', { type: 'module' });
    await new Promise<void>((resolve, reject) => {
      const onInit = (ev: MessageEvent<FromWorker>) => {
        if (ev.data.type === 'init_ok') {
          worker.removeEventListener('message', onInit);
          resolve();
        } else if (ev.data.type === 'error') {
          worker.removeEventListener('message', onInit);
          reject(new Error(ev.data.message));
        }
      };
      worker.addEventListener('message', onInit);
      worker.postMessage({ type: 'init', bundle: this.bundle });
    });
    worker.addEventListener('message', (ev: MessageEvent<FromWorker>) =>
      this.handleMessage(ev.data),
    );
    this.worker = worker;
  }

  private handleMessage(msg: FromWorker): void {
    if (msg.type === 'classify_result') {
      const entry = this.pending.get(msg.requestId);
      if (entry) {
        this.pending.delete(msg.requestId);
        entry.resolve(msg.result);
      }
    } else if (msg.type === 'error' && msg.requestId) {
      const entry = this.pending.get(msg.requestId);
      if (entry) {
        this.pending.delete(msg.requestId);
        entry.reject(new Error(msg.message));
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

  getBundle(): TaxonomyBundle | null {
    return this.bundle;
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
