// DuckDB worker client wrapper. Full bootstrap lives in src/core/engine.ts —
// this file is the worker entry. We import the real DuckDB worker at runtime
// via dynamic import in engine.ts; this placeholder exists so esbuild has an
// entry point for the workers directory.

self.onmessage = (ev) => {
  // Forward early ping/pong so engine.ts can health-check.
  if (ev.data?.type === 'ping') {
    (self as unknown as Worker).postMessage({ type: 'pong' });
  }
};
