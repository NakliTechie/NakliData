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
  /** Job-specific response budget. Defaults to 512 tokens. */
  maxTokens?: number;
  signal?: AbortSignal;
}

/** Produces the raw model text for a prompt — same contract as the
 *  HTTP provider call functions, minus the API key. */
export type LocalGenerator = (req: LocalGenerateRequest) => Promise<string>;

// Lazy entries are bundled as standalone ESM files with splitting disabled.
// They therefore receive their own copy of this module. Keep the generator on
// the page global so shell and lazy dispatch copies share one runtime without
// exposing model weights or provider credentials.
const LOCAL_GENERATOR_KEY = '__naklidataLocalGeneratorV1' as const;

type LocalRuntimeGlobal = typeof globalThis & {
  [LOCAL_GENERATOR_KEY]?: LocalGenerator | null;
};

function runtimeGlobal(): LocalRuntimeGlobal {
  return globalThis as LocalRuntimeGlobal;
}

/**
 * Called by the local-model lazy chunk once the model is loaded and
 * ready to generate. Idempotent — the most recent registration wins
 * (e.g. after a model switch).
 */
export function registerLocalGenerator(fn: LocalGenerator): void {
  runtimeGlobal()[LOCAL_GENERATOR_KEY] = fn;
}

/** Clear the registered generator (e.g. on model unload / error). */
export function unregisterLocalGenerator(): void {
  delete runtimeGlobal()[LOCAL_GENERATOR_KEY];
}

/** The current local generator, or null when no model is loaded. */
export function getLocalGenerator(): LocalGenerator | null {
  return runtimeGlobal()[LOCAL_GENERATOR_KEY] ?? null;
}

/** Whether a local model is loaded + ready to serve sidecar jobs. */
export function isLocalModelReady(): boolean {
  return getLocalGenerator() !== null;
}
