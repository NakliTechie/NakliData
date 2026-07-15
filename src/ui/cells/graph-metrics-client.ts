// Main-thread client for the graph-metrics worker. Boots it on first use, keeps
// it warm for the tab, and resolves one `compute` per call.
//
// Shaped after taxonomy/client.ts, including the lesson it carries (forward-pass
// M7): a worker promise that only settles on the happy-path message hangs
// forever when the worker 404s under a deploy prefix. So the BOOT is guarded by
// a `ready` ping + a timeout; the COMPUTE deliberately is not — Brandes
// betweenness on a big graph legitimately takes tens of seconds, and a timeout
// there would abort correct work.
//
// Errors are the caller's to handle, not swallowed: network-cell falls back to
// degree with a visible note if the worker can't boot.

import {
  type ComputeRequest,
  type FromWorker,
  type WorkerMetric,
  packGraph,
  unpackValues,
} from '../../core/graph-metrics-protocol.ts';

/** One metric's answer. Exactly one of the two is non-null. */
export interface MetricResult {
  values: Map<string, number> | null;
  community: Map<string, number> | null;
}

const BOOT_TIMEOUT_MS = 15_000;

class GraphMetricsClient {
  private worker: Worker | null = null;
  private booting: Promise<Worker> | null = null;
  private pending = new Map<
    string,
    { ids: string[]; resolve: (r: MetricResult) => void; reject: (e: Error) => void }
  >();
  private nextId = 1;

  private async ensureWorker(): Promise<Worker> {
    if (this.worker) return this.worker;
    if (this.booting) return this.booting;
    this.booting = this.boot();
    try {
      return await this.booting;
    } finally {
      this.booting = null;
    }
  }

  private boot(): Promise<Worker> {
    // Resolve against document.baseURI so the path holds under a deploy prefix
    // (GitHub Pages serves us at /NakliData/ — a leading-slash URL 404s there).
    const url = new URL('./graph-metrics.worker.js', document.baseURI).href;
    const worker = new Worker(url, { type: 'module' });
    return new Promise<Worker>((resolve, reject) => {
      let settled = false;
      const finish = (err: Error | null) => {
        if (settled) return;
        settled = true;
        worker.removeEventListener('message', onBoot);
        worker.removeEventListener('error', onError);
        clearTimeout(timer);
        if (err) {
          try {
            worker.terminate();
          } catch {
            /* already dead */
          }
          reject(err);
          return;
        }
        // Live listeners for the worker's serving life.
        worker.addEventListener('message', (ev: MessageEvent<FromWorker>) =>
          this.handleMessage(ev.data),
        );
        worker.addEventListener('error', (ev: ErrorEvent) => this.failAll(ev.message));
        worker.addEventListener('messageerror', () =>
          this.failAll('unparseable message from the graph-metrics worker'),
        );
        this.worker = worker;
        resolve(worker);
      };
      const onBoot = (ev: MessageEvent<FromWorker>) => {
        if (ev.data.type === 'ready') finish(null);
      };
      const onError = (ev: ErrorEvent) =>
        finish(new Error(`graph-metrics worker failed to load: ${ev.message || 'unknown error'}`));
      worker.addEventListener('message', onBoot);
      worker.addEventListener('error', onError);
      const timer = setTimeout(
        () =>
          finish(
            new Error(
              'graph-metrics worker init timed out after 15s — check that graph-metrics.worker.js loads at the deploy prefix',
            ),
          ),
        BOOT_TIMEOUT_MS,
      );
    });
  }

  /** A dead worker can't answer anything in flight — reject and drop it so the next call re-boots. */
  private failAll(message: string): void {
    const err = new Error(`graph-metrics worker error: ${message}`);
    for (const { reject } of this.pending.values()) reject(err);
    this.pending.clear();
    try {
      this.worker?.terminate();
    } catch {
      /* already dead */
    }
    this.worker = null;
  }

  private handleMessage(msg: FromWorker): void {
    if (msg.type === 'ready') return;
    if (msg.type === 'error') {
      if (!msg.requestId) return;
      const entry = this.pending.get(msg.requestId);
      if (!entry) return;
      this.pending.delete(msg.requestId);
      entry.reject(new Error(msg.message));
      return;
    }
    const entry = this.pending.get(msg.requestId);
    if (!entry) return;
    this.pending.delete(msg.requestId);
    entry.resolve({
      values: msg.values ? unpackValues(entry.ids, msg.values) : null,
      community: msg.community ? unpackValues(entry.ids, msg.community) : null,
    });
  }

  async compute(
    metric: WorkerMetric,
    nodes: ReadonlyArray<{ id: string }>,
    edges: ReadonlyArray<{ source: string; target: string }>,
  ): Promise<MetricResult> {
    const worker = await this.ensureWorker();
    const { ids, pairs } = packGraph(nodes, edges);
    const requestId = `g${this.nextId++}`;
    return new Promise<MetricResult>((resolve, reject) => {
      this.pending.set(requestId, { ids, resolve, reject });
      const req: ComputeRequest = { type: 'compute', requestId, metric, ids, pairs };
      // Transfer the edge buffer — we don't read it again on this side.
      // `pairs` is a subarray view, so hand over the whole underlying buffer.
      worker.postMessage(req, [pairs.buffer]);
    });
  }
}

let _client: GraphMetricsClient | null = null;

/**
 * Compute a node metric off the main thread. Rejects if the worker can't boot
 * or the metric throws — callers should fall back to degree with a note rather
 * than leave the cell blank.
 */
export function computeNodeMetric(
  metric: WorkerMetric,
  nodes: ReadonlyArray<{ id: string }>,
  edges: ReadonlyArray<{ source: string; target: string }>,
): Promise<MetricResult> {
  if (!_client) _client = new GraphMetricsClient();
  return _client.compute(metric, nodes, edges);
}
