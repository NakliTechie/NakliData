// OPFS-backed cache for local-model weights — W3.2 slice B chunk 1.
//
// Why a custom layer instead of Transformers.js's built-in Cache API
// caching?
//
//   1. Inspectability. The user signing up for a multi-GB download
//      deserves a visible "Cached: 1.2 GB · Delete cached model"
//      affordance in Settings. The Cache API surfaces only via
//      DevTools Application > Cache Storage.
//   2. Per-file size in O(1). Cache API needs `response.blob()` for
//      every entry to find its size; OPFS gives the size via
//      `FileSystemFileHandle.getFile().size` directly.
//   3. Delete-the-whole-model in O(1) — `removeEntry(name, { recursive: true })`
//      vs Cache API's iterate-and-delete.
//   4. Matches the BYOK posture: predictable, user-managed local state.
//
// Chunk 2 (the Transformers.js chunk) wraps `fetch` so the library's
// model-file loads check OPFS first via `readModelFile`, fall back to
// HF on miss, then `writeModelFile` to populate the cache. With
// `env.useBrowserCache = false` set on the Transformers.js side, this
// becomes the sole source of truth for cached weights.
//
// Cache layout:
//   OPFS-root/
//     naklidata-local-models/
//       <flattened-model-id>/      e.g. `Qwen__Qwen2.5-1.5B-Instruct`
//         model.onnx
//         tokenizer.json
//         config.json
//         …
//
// Model IDs flatten `/` to `__` because OPFS directory names can't
// contain `/`. The original id is recovered by reversing the
// flattening when listing.

const ROOT_DIR_NAME = 'naklidata-local-models';

export interface ModelFileEntry {
  /** Filename inside the model's directory (e.g. `model.onnx`). */
  name: string;
  /** Size in bytes. */
  bytes: number;
  /** ISO timestamp of last modification. */
  modified: string;
}

export interface ModelCacheEntry {
  /** Original HF-style model id (e.g. `Qwen/Qwen2.5-1.5B-Instruct`). */
  modelId: string;
  /** Files present in the model's directory. */
  files: ModelFileEntry[];
  /** Sum of bytes across all files. */
  totalBytes: number;
}

/**
 * Separator used to flatten `/` in model ids into single OPFS dir
 * names. Chosen because:
 *   - `$` is allowed in HF org/repo names? Actually no — HF restricts
 *     names to [A-Za-z0-9-_.]. So `$$` cannot appear in any real id.
 *   - Three chars (not one) so accidental introduction in a future
 *     pattern is unlikely.
 *
 * Adversarial-review MEDIUM finding (2026-06-03): the prior
 * separator `__` collided — HF org/repo names ALLOW `_`, so
 * `org/foo_bar` and `org__foo_bar` flattened to the same string
 * `org__foo_bar`, and the unflattener couldn't reliably round-trip.
 */
const FLATTEN_SEP = '$$';

/**
 * Flatten a model id (`Qwen/Qwen2.5-1.5B-Instruct`) into a single
 * directory name (`Qwen$$Qwen2.5-1.5B-Instruct`). Exported for tests.
 *
 * Uses split+join (not String.prototype.replace) because `$$` in the
 * replacement-string position of `replace(regex, str)` collapses to a
 * literal `$` — split+join treats the separator as a plain literal.
 */
export function flattenModelId(modelId: string): string {
  return modelId.split('/').join(FLATTEN_SEP);
}

/**
 * Reverse of `flattenModelId` — recover the original HF-style id from
 * a flattened directory name. Exported for tests.
 */
export function unflattenModelId(flattened: string): string {
  return flattened.split(FLATTEN_SEP).join('/');
}

/**
 * True when `navigator.storage.getDirectory()` resolves. False on
 * Node, in old browsers, in private-browsing Firefox <111, etc. The
 * caller surfaces a clear "your browser doesn't support local model
 * caching" message when this is false; the local-runtime path then
 * disables itself.
 */
export async function isOpfsAvailable(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    return false;
  }
  try {
    await navigator.storage.getDirectory();
    return true;
  } catch {
    return false;
  }
}

async function getRoot(): Promise<FileSystemDirectoryHandle | null> {
  if (!(await isOpfsAvailable())) return null;
  return navigator.storage.getDirectory();
}

async function getModelsDir(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  const root = await getRoot();
  if (!root) return null;
  try {
    return await root.getDirectoryHandle(ROOT_DIR_NAME, { create });
  } catch {
    return null;
  }
}

async function getModelDir(
  modelId: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  const modelsDir = await getModelsDir(create);
  if (!modelsDir) return null;
  try {
    return await modelsDir.getDirectoryHandle(flattenModelId(modelId), { create });
  } catch {
    return null;
  }
}

/**
 * Returns size + file metadata for a cached model, or null if the
 * model has no cached files.
 */
export async function getModelCacheInfo(modelId: string): Promise<ModelCacheEntry | null> {
  const modelDir = await getModelDir(modelId, false);
  if (!modelDir) return null;
  const files: ModelFileEntry[] = [];
  let totalBytes = 0;
  // FileSystemDirectoryHandle exposes async iterators via
  // .entries() / .values() / .keys(). Cast is needed because the
  // TS lib types don't include the iterator on older lib versions.
  for await (const [name, handle] of (
    modelDir as unknown as {
      entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
    }
  ).entries()) {
    if (handle.kind === 'file') {
      const fileHandle = handle as FileSystemFileHandle;
      const file = await fileHandle.getFile();
      files.push({
        name,
        bytes: file.size,
        modified: new Date(file.lastModified).toISOString(),
      });
      totalBytes += file.size;
    }
  }
  if (files.length === 0) return null;
  return { modelId, files, totalBytes };
}

/**
 * Enumerate every model whose files are present in OPFS. Useful for
 * the Settings "Cached models" list.
 */
export async function listCachedModels(): Promise<ModelCacheEntry[]> {
  const modelsDir = await getModelsDir(false);
  if (!modelsDir) return [];
  const out: ModelCacheEntry[] = [];
  for await (const [flattened, handle] of (
    modelsDir as unknown as {
      entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
    }
  ).entries()) {
    if (handle.kind === 'directory') {
      const info = await getModelCacheInfo(unflattenModelId(flattened));
      if (info) out.push(info);
    }
  }
  return out;
}

/**
 * Total OPFS bytes used across all cached models. The Settings UI
 * surfaces this as the topline "Cached: 1.2 GB" line; per-model
 * breakdown comes from `listCachedModels`.
 */
export async function getTotalCacheSize(): Promise<number> {
  const models = await listCachedModels();
  return models.reduce((sum, m) => sum + m.totalBytes, 0);
}

/**
 * Whether a specific file in a specific model is cached. Used by the
 * fetch-interceptor in chunk 2 to decide hit vs miss.
 */
export async function hasModelFile(modelId: string, filename: string): Promise<boolean> {
  const modelDir = await getModelDir(modelId, false);
  if (!modelDir) return false;
  try {
    await modelDir.getFileHandle(filename);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a cached model file, or null on miss. Returned as Uint8Array
 * (callers that want a Response or ArrayBuffer wrap appropriately).
 */
export async function readModelFile(modelId: string, filename: string): Promise<Uint8Array | null> {
  const modelDir = await getModelDir(modelId, false);
  if (!modelDir) return null;
  try {
    const fileHandle = await modelDir.getFileHandle(filename);
    const file = await fileHandle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Write a model file. Creates the model dir + file as needed.
 * Throws if OPFS isn't available (caller should check `isOpfsAvailable`
 * first; this is the "model is downloading right now" path where
 * silent-fail is the wrong posture).
 */
export async function writeModelFile(
  modelId: string,
  filename: string,
  data: Uint8Array | ArrayBuffer | Blob,
): Promise<void> {
  const modelDir = await getModelDir(modelId, true);
  if (!modelDir) {
    throw new Error('OPFS not available — cannot write model file');
  }
  const fileHandle = await modelDir.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  let writeError: unknown = null;
  try {
    if (data instanceof Blob) {
      await writable.write(data);
    } else if (data instanceof ArrayBuffer) {
      await writable.write(data);
    } else {
      // Uint8Array — `data` is BufferSource so the write overload
      // accepts it, but TS lib types around SharedArrayBuffer vs
      // ArrayBuffer get strict. Copy into a fresh ArrayBuffer to
      // sidestep the variance noise; cheap for typical model-file
      // sizes (cache is a chunk-2 hot path but writes are amortised
      // over MB-scale downloads).
      const buf = new ArrayBuffer(data.byteLength);
      new Uint8Array(buf).set(data);
      await writable.write(buf);
    }
  } catch (err) {
    writeError = err;
  } finally {
    try {
      await writable.close();
    } catch {
      /* ignore — close-after-failed-write may throw; the original
         write error is more informative. */
    }
  }
  if (writeError) {
    // Adversarial-review MEDIUM (2026-06-03): on a quota-exhausted
    // / partial write, OPFS leaves a truncated artifact. The next
    // hasModelFile() returns true and readModelFile() returns the
    // corrupt bytes — onnxruntime then fails with a cryptic protobuf
    // parse error instead of triggering a clean re-download.
    // Remove the partial file before re-throwing so the cache stays
    // in a clean hit-or-miss state.
    try {
      await modelDir.removeEntry(filename);
    } catch {
      /* best-effort cleanup; don't mask the original error. */
    }
    throw writeError;
  }
}

/**
 * Delete every file under a model's directory. Returns true on success,
 * false on no-cache / not-found / OPFS unavailable.
 */
export async function clearCachedModel(modelId: string): Promise<boolean> {
  const modelsDir = await getModelsDir(false);
  if (!modelsDir) return false;
  try {
    await modelsDir.removeEntry(flattenModelId(modelId), { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete the entire `naklidata-local-models` tree from OPFS. The
 * Settings "Forget all cached models" affordance.
 */
export async function clearAllCachedModels(): Promise<boolean> {
  const root = await getRoot();
  if (!root) return false;
  try {
    await root.removeEntry(ROOT_DIR_NAME, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Lower-bound byte size below which a cached model is considered
 * "partial / incomplete" — a sentinel for the auto-load gate.
 *
 * Adversarial-review HIGH finding (2026-06-03): a cancelled or
 * quota-killed download often leaves `tokenizer.json` + `config.json`
 * (each ~10–500 KB) in OPFS but NO `model.onnx` (the multi-hundred-MB
 * weights). Pre-fix the boot-path auto-load gated on
 * `files.length > 0` — true for partial caches — and silently
 * re-downloaded the weights from HF every boot.
 *
 * Real curated-list models in `LOCAL_MODEL_OPTIONS`:
 *   - Qwen2.5-1.5B-Instruct quantized: ~0.9 GB
 *   - Phi-3.5-mini-instruct quantized: ~2.3 GB
 *   - Llama-3.2-1B-Instruct quantized: ~0.7 GB
 *
 * 100 MB is comfortably below every supported model's weight-file
 * size yet far above any tokenizer / config sidecar files, so
 * `isModelCacheComplete` returns `true` only when the weights have
 * actually landed.
 */
const MIN_COMPLETE_MODEL_BYTES = 100 * 1024 * 1024;

/**
 * Whether the cached model has weight bytes large enough to indicate
 * a completed download — not just leftover tokenizer / config files
 * from a cancelled run.
 *
 * Heuristic: total bytes > 100 MB. Cheaper than parsing the
 * model_index / config.json and good enough for the three curated
 * models. Callers needing tighter assurance can probe
 * `hasModelFile(modelId, 'onnx__model_q4.onnx')` or similar.
 */
export async function isModelCacheComplete(modelId: string): Promise<boolean> {
  const info = await getModelCacheInfo(modelId);
  if (!info) return false;
  return info.totalBytes >= MIN_COMPLETE_MODEL_BYTES;
}

/**
 * Format a byte count for UI display. Exported because it's part of
 * the cache surface — the Settings panel shows formatted sizes.
 */
export function formatCacheSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
