// Local-model runtime seam (W3.2 slice A).
//
// The actual in-browser model (Transformers.js + a Phi-3-mini-class
// 4-bit ONNX model) ships as a lazy chunk in a follow-up slice — it's
// multi-MB and needs a real browser + WebGPU/wasm to run, so it can't
// live in the shell or be exercised by the headless smoke test.
//
// This module is the seam between the sidecar dispatch layer and that
// future chunk: the chunk calls `registerLocalGenerator()` once loaded,
// and `dispatchJob` routes `provider: 'local'` jobs to whatever's
// registered. Until the chunk registers, `getLocalGenerator()` returns
// null and dispatch surfaces an actionable "not loaded" error rather
// than silently shipping the user's schema to a cloud provider (the
// privacy expectation that picking 'local' sets — see DECISIONS
// 2026-05-24 22:30).

export interface LocalGenerateRequest {
  system: string;
  user: string;
  /** Model id the user configured (e.g. an HF ONNX repo). */
  model: string;
  signal?: AbortSignal;
}

/** Produces the raw model text for a prompt — same contract as the
 *  HTTP provider call functions, minus the API key. */
export type LocalGenerator = (req: LocalGenerateRequest) => Promise<string>;

let _generator: LocalGenerator | null = null;

/**
 * Called by the local-model lazy chunk once the model is loaded and
 * ready to generate. Idempotent — the most recent registration wins
 * (e.g. after a model switch).
 */
export function registerLocalGenerator(fn: LocalGenerator): void {
  _generator = fn;
}

/** Clear the registered generator (e.g. on model unload / error). */
export function unregisterLocalGenerator(): void {
  _generator = null;
}

/** The current local generator, or null when no model is loaded. */
export function getLocalGenerator(): LocalGenerator | null {
  return _generator;
}

/** Whether a local model is loaded + ready to serve sidecar jobs. */
export function isLocalModelReady(): boolean {
  return _generator !== null;
}
