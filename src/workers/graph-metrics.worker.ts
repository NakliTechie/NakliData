// Graph-metrics worker (Facet Network view). Runs the pricier node metrics —
// PageRank, Brandes betweenness, Louvain — off the main thread.
//
// Why a third worker (CLAUDE.md says don't add one without a clear reason):
// these metrics were computed SYNCHRONOUSLY on the main thread right after
// layout, so the only thing keeping the tab from freezing was a pair of
// conservative node caps (betweenness ≤3000, Louvain ≤20000) that refused to
// answer above them. Brandes is O(n·m) — there is no making it cheap, only
// making it not block. Off-thread, a slow metric is a spinner instead of a
// frozen tab, which is what lets the caps rise toward the 30k layout ceiling.
// The Phase-3 wasm spike independently named this the cheapest >30k lever.
//
// The worker owns no state: each `compute` is self-contained, so there's no
// init handshake beyond a `ready` ping the client uses to tell "the worker
// booted" apart from "the compute is just slow" (taxonomy/client.ts M7 — a
// worker that 404s must not look like a pending promise forever).
//
// Bundled by esbuild to dist/graph-metrics.worker.js. This is also what takes
// core/graph-metrics.ts off the inlined shell budget (spec §7.1 / A35): the
// algorithms now live in the worker's bundle, not in index.html.

import {
  type ComputeResultMsg,
  type FromWorker,
  type ToWorker,
  type WorkerErrorMsg,
  packCommunities,
  packValues,
  unpackGraph,
} from '../core/graph-metrics-protocol.ts';
import { betweennessCentrality, louvainCommunities, pageRank } from '../core/graph-metrics.ts';

const w = self as unknown as Worker;

function post(msg: FromWorker, transfer: Transferable[] = []): void {
  w.postMessage(msg, transfer);
}

w.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  if (!msg || msg.type !== 'compute') return;
  try {
    const { nodes, edges } = unpackGraph({ ids: msg.ids, pairs: msg.pairs });
    let result: ComputeResultMsg;
    switch (msg.metric) {
      case 'pagerank': {
        const values = packValues(msg.ids, pageRank(nodes, edges));
        result = { type: 'compute_result', requestId: msg.requestId, values, community: null };
        break;
      }
      case 'betweenness': {
        const values = packValues(msg.ids, betweennessCentrality(nodes, edges));
        result = { type: 'compute_result', requestId: msg.requestId, values, community: null };
        break;
      }
      case 'community': {
        const community = packCommunities(msg.ids, louvainCommunities(nodes, edges));
        result = { type: 'compute_result', requestId: msg.requestId, values: null, community };
        break;
      }
      default: {
        const err: WorkerErrorMsg = {
          type: 'error',
          requestId: msg.requestId,
          message: `unknown metric: ${String(msg.metric)}`,
        };
        post(err);
        return;
      }
    }
    // Transfer the result buffer out — it's dead to us the moment it's sent.
    const buf = result.values?.buffer ?? result.community?.buffer;
    post(result, buf ? [buf] : []);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    post({ type: 'error', requestId: msg.requestId, message });
  }
};

// Boot ping — the client's "did this worker actually load?" signal.
post({ type: 'ready' });
