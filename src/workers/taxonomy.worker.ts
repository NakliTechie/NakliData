// Taxonomy classification worker. Real detector dispatch is wired in
// src/taxonomy/classify.ts. Worker entry kept minimal until then.

self.onmessage = (ev) => {
  if (ev.data?.type === 'ping') {
    (self as unknown as Worker).postMessage({ type: 'pong' });
  }
};
