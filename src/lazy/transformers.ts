// W3.2 slice B chunk 2 — Transformers.js lazy chunk.
//
// This is the actual in-browser model runtime. esbuild bundles the
// @huggingface/transformers library into `dist/chunks/transformers.js`
// (~5 MB). The main shell never loads this chunk unless the user
// picks the `local` provider in Settings; even then, only when the
// first local-provider sidecar job fires.
//
// Wires three things together:
//
// 1. **OPFS-backed cache adapter** (`createOpfsCache`). Transformers.js
//    exposes `env.customCache` — a Map-like interface with match/put.
//    We point it at our local-cache module (chunk 1) so the multi-GB
//    weight downloads land in OPFS, inspectable + deletable from
//    Settings. `env.useBrowserCache = false` disables the default
//    Cache API path; OPFS becomes the sole source of truth.
//
// 2. **The pipeline** (`loadPipeline`). Lazily constructs a
//    text-generation pipeline against the configured model id
//    (`onnx-community/Qwen2.5-1.5B-Instruct` by default — see
//    DECISIONS J / scoping doc Decision 1). The pipeline is cached
//    in-process; switching models requires explicit `disposePipeline`.
//
// 3. **The generator function** (`generate`). Wraps the pipeline to
//    speak the `LocalGenerator` contract from
//    `src/core/sidecar/local-runtime.ts`: takes
//    `LocalGenerateRequest`, returns `Promise<string>`. Uses the
//    tokenizer's chat template so the system/user prompt format
//    matches what the model was trained on.
//
// Public entry point: `loadModel(modelId, onProgress)` → returns the
// generator; the MAIN bundle registers it (see loadModel for why). Callers
// (Settings UI; the boot path when `provider === 'local'` lands on a
// job) call this once; the chunk handles the rest.
//
// **Not in this chunk**: Settings UI for model picker / cache status /
// delete (chunk 3); boot-path integration when `provider === 'local'`
// is the active setting (chunk 4); per-job manual validation runs
// (chunk 5); spec amendment + DECISIONS update + tag v1.3.0 (chunks
// 6-7).

import {
  type FeatureExtractionPipeline,
  type TextGenerationPipeline,
  env,
  pipeline,
} from '@huggingface/transformers';
import {
  hasModelFile,
  isOpfsAvailable,
  readModelFile,
  writeModelFile,
} from '../core/sidecar/local-cache.ts';
import type { LocalGenerateRequest, LocalGenerator } from '../core/sidecar/local-runtime.ts';

/**
 * Default model id when the user hasn't configured one yet. Picked
 * per scoping doc Decision 1 — Qwen2.5-1.5B-Instruct, ~0.9 GB 4-bit
 * quantized, Apache 2.0. The `onnx-community/` org maintains
 * canonical ONNX exports.
 */
export const DEFAULT_LOCAL_MODEL_ID = 'onnx-community/Qwen2.5-0.5B-Instruct';

/**
 * Parse a Hugging Face Hub URL into (modelId, relativePath).
 *
 * Typical shape:
 *   https://huggingface.co/<org>/<repo>/resolve/main/<path>
 *
 * Returns null when the URL isn't an HF-resolve URL we know how to
 * route to OPFS. The cache adapter then bails to the underlying
 * fetch, matching "cache miss" semantics.
 */
export function parseHfUrl(url: string): { modelId: string; relPath: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'huggingface.co') return null;
    const path = parsed.pathname.replace(/^\/+/, '');
    // Pattern: <org>/<repo>/resolve/<revision>/<path>
    const resolveIdx = path.indexOf('/resolve/');
    if (resolveIdx < 0) return null;
    const modelId = path.slice(0, resolveIdx);
    const afterResolve = path.slice(resolveIdx + '/resolve/'.length);
    // Strip the revision (e.g. `main`) — keep what comes after.
    const firstSlash = afterResolve.indexOf('/');
    if (firstSlash < 0) return null;
    const relPath = afterResolve.slice(firstSlash + 1);
    if (!modelId || !relPath) return null;
    return { modelId, relPath };
  } catch {
    return null;
  }
}

/**
 * OPFS dir / file names can't contain `/`. Flatten the in-repo path
 * before passing as a filename to local-cache (model dir is already
 * keyed by modelId at the cache layer).
 */
function flattenRelPath(relPath: string): string {
  return relPath.replace(/\//g, '__');
}

/**
 * Build the Transformers.js `customCache` adapter that routes through
 * OPFS via the chunk-1 cache module. Conforms to the v4
 * `CacheInterface`: { match, put, delete? }.
 *
 * `match` returns a `Response` wrapping the cached bytes on hit,
 * `undefined` on miss (so Transformers.js falls back to its normal
 * fetch path, which writes via `put`).
 *
 * `put` reads the response body and writes to OPFS. The response is
 * consumed; Transformers.js receives a fresh clone via its own
 * pipeline before reaching `put`.
 *
 * `delete` isn't implemented; chunks aren't deleted file-by-file in
 * practice (use `clearCachedModel` / `clearAllCachedModels` for the
 * "delete the whole model" affordances surfaced in Settings).
 */
export function createOpfsCache(): {
  match: (request: string) => Promise<Response | undefined>;
  put: (request: string, response: Response) => Promise<void>;
} {
  return {
    async match(request: string): Promise<Response | undefined> {
      const parsed = parseHfUrl(request);
      if (!parsed) return undefined;
      const filename = flattenRelPath(parsed.relPath);
      const exists = await hasModelFile(parsed.modelId, filename);
      if (!exists) return undefined;
      const bytes = await readModelFile(parsed.modelId, filename);
      if (!bytes) return undefined;
      // Wrap as a Response so Transformers.js's downstream code can
      // call .arrayBuffer() / .blob() on it like a normal fetch
      // response. Content-Type doesn't matter — the library handles
      // ONNX vs JSON vs binary by file path.
      // Copy into a fresh ArrayBuffer to sidestep TS lib strictness
      // around SharedArrayBuffer-vs-ArrayBuffer in BlobPart (same
      // pattern as writeModelFile).
      const buf = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buf).set(bytes);
      return new Response(new Blob([buf]));
    },

    async put(request: string, response: Response): Promise<void> {
      const parsed = parseHfUrl(request);
      if (!parsed) return; // not an HF URL — skip (defensive)
      const filename = flattenRelPath(parsed.relPath);
      // Consume the response body. Transformers.js gives us a fresh
      // clone, so consuming it here doesn't break its own pipeline.
      const buf = await response.arrayBuffer();
      await writeModelFile(parsed.modelId, filename, buf);
    },
  };
}

/**
 * Configure the Transformers.js library to route file fetches through
 * our OPFS cache. Idempotent — calling more than once just re-points
 * `env.customCache`.
 *
 * Must run BEFORE the first `pipeline(...)` call (any later and the
 * pipeline's initial weight fetches bypass the cache).
 *
 * **Critical**: `env.useCustomCache = true` is required for the
 * library's `getCache()` to consult `env.customCache` at all.
 * Without that flag the cache adapter is dead code — every load
 * re-downloads, listCachedModels stays empty, boot-path auto-load
 * never triggers because no files are present.
 * (Adversarial-review CRITICAL finding, 2026-06-03.)
 */
function configureEnv(): void {
  env.useBrowserCache = false;
  env.useFSCache = false;
  env.useCustomCache = true;
  // biome-ignore lint/suspicious/noExplicitAny: env.customCache lib type is the CacheInterface from utils/cache; we conform to it but typing across module boundaries is brittle.
  env.customCache = createOpfsCache() as any;
}

// Cached pipeline instance — keyed by model id so changing models
// in Settings disposes + re-creates cleanly.
let _activePipeline: TextGenerationPipeline | null = null;
let _activeModelId: string | null = null;
// In-flight pipeline promise — memoised so parallel `loadPipeline`
// calls (boot auto-load racing a user click in Settings) await the
// same construction, not two independent ones that each spin up an
// onnxruntime session and leak the loser's WASM heap.
// (Adversarial-review MEDIUM finding, 2026-06-03.)
let _pendingPipelinePromise: Promise<TextGenerationPipeline> | null = null;
let _pendingPipelineModelId: string | null = null;

/**
 * Progress callback shape Transformers.js emits during model file
 * fetches. Status `'progress'` is the streaming-percentage one;
 * `'ready'` fires once all files are loaded.
 */
export interface LoadProgress {
  /** A descriptive label — usually the model file being downloaded. */
  file?: string;
  /** Bytes loaded so far. */
  loaded?: number;
  /** Total bytes expected. */
  total?: number;
  /** Numeric percentage 0..100, when known. */
  progress?: number;
  /** Transformers.js status word: `initiate` / `download` / `progress` / `done` / `ready`. */
  status?: string;
}

/**
 * Lazily build (or return cached) the text-generation pipeline for
 * `modelId`. On first call, weights download (gated through OPFS),
 * pipeline initialises, and the result is cached.
 *
 * `onProgress` (optional) lets the caller surface a download progress
 * bar — Transformers.js streams progress events through its
 * `progress_callback`.
 */
export async function loadPipeline(
  modelId: string,
  onProgress?: (p: LoadProgress) => void,
): Promise<TextGenerationPipeline> {
  if (!(await isOpfsAvailable())) {
    throw new Error(
      'OPFS is not available in this browser — local model caching requires Origin Private File System support.',
    );
  }
  if (_activePipeline && _activeModelId === modelId) {
    return _activePipeline;
  }
  // Adversarial-review codex P2 (2026-06-03): if another caller is
  // mid-construction (same OR different model), serialise — don't
  // race. Same-model concurrent callers share the in-flight promise.
  // Different-model callers wait for the current one to finish before
  // starting (which then disposes the previous and builds anew).
  // Without serialisation the second model's pipeline can race the
  // first's resolution and leave `_activePipeline` pointing at the
  // wrong model, leaking the loser's onnxruntime session.
  if (_pendingPipelinePromise) {
    if (_pendingPipelineModelId === modelId) {
      return _pendingPipelinePromise;
    }
    // Different model in flight — chain after it. We don't care
    // whether the prior call resolved or rejected; either way we
    // proceed to build OUR model on a clean slate.
    try {
      await _pendingPipelinePromise;
    } catch {
      /* ignore — prior caller surfaces its own error */
    }
  }
  if (_activePipeline) {
    // Different model than what's loaded — dispose first so memory
    // doesn't compound. Transformers.js's dispose() releases the
    // backing onnxruntime session.
    await disposePipeline();
  }
  configureEnv();
  // Prefer WebGPU when the browser exposes a usable adapter. The wasm32
  // runtime can't allocate the ~1.5-2 GB q4 weights of the 1-2B models and
  // throws `std::bad_alloc` on session creation (slice-B validation
  // 2026-06-13, DECISIONS AT); WebGPU offloads the weights to GPU memory
  // and sidesteps the wasm-heap ceiling. Falls back to wasm where WebGPU is
  // absent (smaller models can still load there).
  const device = await pickLocalDevice();
  const promise = pipeline('text-generation', modelId, {
    // On WebGPU use q4f16 — fp16 activations roughly halve the GPU working
    // set vs q4 (fp32 activations), which is what lets the 1-2B models fit
    // (plain q4 OOM'd even on WebGPU — slice-B re-validation 2026-06-13).
    // wasm keeps q4 (no fp16 path there).
    dtype: device === 'webgpu' ? 'q4f16' : 'q4',
    device,
    ...(onProgress ? { progress_callback: onProgress } : {}),
  });
  _pendingPipelinePromise = promise;
  _pendingPipelineModelId = modelId;
  try {
    const pipe = await promise;
    _activePipeline = pipe;
    _activeModelId = modelId;
    return pipe;
  } catch (err) {
    // Graceful OOM handling — a raw `std::bad_alloc` / "Can't create a
    // session" is opaque. Surface what actually went wrong + the fix.
    const msg = err instanceof Error ? err.message : String(err);
    if (/bad_alloc|create a session|out of memory|allocation failed/i.test(msg)) {
      throw new Error(
        device === 'wasm'
          ? `Couldn't load "${modelId}" — out of memory on the CPU (wasm) runtime. This model is too large for wasm; open in a browser with WebGPU, or pick a smaller model.`
          : `Couldn't load "${modelId}" — GPU out of memory. Try a smaller model or free up GPU memory.`,
      );
    }
    throw err;
  } finally {
    // Only clear the pending slot if WE own it — a concurrent switch
    // may have overwritten it; clearing in that case would orphan
    // the new construction's race-guard.
    if (_pendingPipelinePromise === promise) {
      _pendingPipelinePromise = null;
      _pendingPipelineModelId = null;
    }
  }
}

/**
 * Choose the onnxruntime device. WebGPU is strongly preferred — see
 * `loadPipeline`. We pick `'webgpu'` only when an adapter actually
 * resolves (a present `navigator.gpu` doesn't guarantee a usable adapter);
 * otherwise `'wasm'`.
 */
export async function pickLocalDevice(): Promise<'webgpu' | 'wasm'> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter?: () => Promise<unknown> } }).gpu;
    if (gpu?.requestAdapter) {
      const adapter = await gpu.requestAdapter();
      if (adapter) return 'webgpu';
    }
  } catch {
    /* fall through to wasm */
  }
  return 'wasm';
}

/**
 * Dispose the currently-loaded pipeline. Lets the underlying
 * onnxruntime session free its WASM memory before a model switch /
 * cache delete / explicit unload.
 */
export async function disposePipeline(): Promise<void> {
  if (_activePipeline) {
    // biome-ignore lint/suspicious/noExplicitAny: dispose() exists on pipelines but isn't on the public Pipeline type
    await (_activePipeline as any).dispose?.();
    _activePipeline = null;
    _activeModelId = null;
  }
}

/**
 * Generate a model response for one `LocalGenerateRequest`. Wraps the
 * pipeline call with chat-template formatting so system+user prompts
 * match the model's training format (Qwen2.5 uses ChatML).
 *
 * Max new tokens caps at 512 — matches the cloud provider defaults so
 * the same eval fixtures apply.
 */
export async function generate(req: LocalGenerateRequest): Promise<string> {
  const pipe = await loadPipeline(req.model || DEFAULT_LOCAL_MODEL_ID);
  const messages = [
    { role: 'system' as const, content: req.system },
    { role: 'user' as const, content: req.user },
  ];
  // The text-generation pipeline accepts a messages array directly
  // when the underlying model has a chat template. Output is
  // `[{generated_text: <full transcript including the chat-template-
  // wrapped system+user+assistant>}]` — we extract the assistant's
  // turn at the end.
  const output = (await pipe(messages, {
    max_new_tokens: 512,
    // Pure greedy (do_sample:false) DEGENERATES on the small local models
    // into repeated-token loops (e.g. `{SQL!!!!!!`), which breaks every
    // JSON-structured sidecar parser (slice-B re-validation 2026-06-13).
    // Low-temperature sampling + a repetition penalty keeps output
    // near-deterministic for structured jobs while escaping the loops.
    do_sample: true,
    temperature: 0.3,
    top_p: 0.9,
    repetition_penalty: 1.2,
    ...(req.signal ? { signal: req.signal } : {}),
    // biome-ignore lint/suspicious/noExplicitAny: pipeline call args are loosely typed
  } as any)) as Array<{ generated_text: unknown }> | { generated_text: unknown };

  // Output shape: when called with messages, the library returns the
  // full conversation array. The assistant's turn is the last entry.
  const result = Array.isArray(output) ? output[0] : output;
  const generated = result?.generated_text;
  if (Array.isArray(generated)) {
    // Conversation form: [{ role: 'system', content }, { role: 'user', content }, { role: 'assistant', content }]
    const last = generated[generated.length - 1];
    if (
      last &&
      typeof last === 'object' &&
      'content' in last &&
      typeof (last as { content: unknown }).content === 'string'
    ) {
      return (last as { content: string }).content;
    }
  }
  if (typeof generated === 'string') return generated;
  return '';
}

/**
 * The single public entry point the rest of the app calls. Loads the
 * model (downloading + caching as needed) and RETURNS the generator
 * function. The caller (in the MAIN bundle) registers it with the
 * sidecar dispatch via `registerLocalGenerator`.
 *
 * **Why return instead of register here:** esbuild runs with
 * `splitting: false`, so this lazy chunk bundles its OWN copy of
 * `local-runtime.ts`. If the chunk called `registerLocalGenerator`, it
 * would write the CHUNK's copy of the `_generator` singleton — which the
 * main-bundle dispatch (`client.ts`) never reads. Every local job would
 * then report "model not loaded" despite a successful load. Returning the
 * generator and letting the main bundle register it keeps a single shared
 * singleton. (Same split-singleton class as the measures-panel bug,
 * DECISIONS AJ; surfaced in the slice-B re-validation, DECISIONS AU.)
 */
export async function loadModel(
  modelId: string = DEFAULT_LOCAL_MODEL_ID,
  onProgress?: (p: LoadProgress) => void,
): Promise<LocalGenerator> {
  await loadPipeline(modelId, onProgress);
  return (req) => generate(req);
}

// --- Local embeddings (Facet embedSearch / L2 WebGPU rung) ------------------
//
// A SEPARATE feature-extraction pipeline from the text-generation one above —
// different task, different (much smaller) model. Powers the semantic-map /
// embedSearch surface: embed text -> unit vector -> cosine VSS. The 384-dim
// MiniLM is ~23 MB (q8), fits wasm as well as WebGPU. Mirrors loadModel's
// "return the fn, don't register" contract (split-singleton avoidance, DECISIONS
// AJ/AU) — the caller in the main/runner bundle owns the embedder reference.

/** all-MiniLM-L6-v2: 384-dim sentence embeddings, feature-extraction. */
export const DEFAULT_EMBED_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
export const DEFAULT_EMBED_DIM = 384;

/** Embeds a batch of texts into unit-normalised vectors (cosine = dot). */
export type Embedder = (texts: string[]) => Promise<Float32Array[]>;

let _activeEmbedder: FeatureExtractionPipeline | null = null;
let _activeEmbedModelId: string | null = null;
let _pendingEmbedderPromise: Promise<FeatureExtractionPipeline> | null = null;

async function loadEmbedderPipeline(
  modelId: string,
  onProgress?: (p: LoadProgress) => void,
): Promise<FeatureExtractionPipeline> {
  if (!(await isOpfsAvailable())) {
    throw new Error(
      'OPFS is not available in this browser — local embeddings require Origin Private File System support.',
    );
  }
  if (_activeEmbedder && _activeEmbedModelId === modelId) return _activeEmbedder;
  if (_pendingEmbedderPromise) {
    try {
      await _pendingEmbedderPromise;
    } catch {
      /* ignore — prior caller surfaces its own error */
    }
    if (_activeEmbedder && _activeEmbedModelId === modelId) return _activeEmbedder;
  }
  configureEnv();
  const device = await pickLocalDevice();
  const promise = pipeline('feature-extraction', modelId, {
    // fp32 keeps the tiny model exact — quantisation noise would perturb
    // cosine ranking, and the model is small enough that size isn't the
    // constraint (unlike the 0.5-2B generators above).
    dtype: 'fp32',
    device,
    ...(onProgress ? { progress_callback: onProgress } : {}),
  }) as Promise<FeatureExtractionPipeline>;
  _pendingEmbedderPromise = promise;
  try {
    const pipe = await promise;
    _activeEmbedder = pipe;
    _activeEmbedModelId = modelId;
    return pipe;
  } finally {
    if (_pendingEmbedderPromise === promise) _pendingEmbedderPromise = null;
  }
}

/**
 * Load the embedding model and return an {@link Embedder}. Output vectors
 * are mean-pooled + L2-normalised, so similarity is a plain dot product.
 */
export async function loadEmbedder(
  modelId: string = DEFAULT_EMBED_MODEL_ID,
  onProgress?: (p: LoadProgress) => void,
): Promise<Embedder> {
  const pipe = await loadEmbedderPipeline(modelId, onProgress);
  return async (texts: string[]) => {
    if (texts.length === 0) return [];
    // biome-ignore lint/suspicious/noExplicitAny: pipeline options are loosely typed
    const out = (await pipe(texts, { pooling: 'mean', normalize: true } as any)) as {
      tolist: () => number[][];
    };
    return out.tolist().map((v) => Float32Array.from(v));
  };
}
