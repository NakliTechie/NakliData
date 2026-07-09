// Facet Embedding view — 2-D projection of a precomputed embedding column.
// PCA via power iteration with deflation: dependency-free (bundle budget),
// deterministic (seeded init + sign convention, so re-renders don't flip the
// map), and engine-boundary clean — no DOM, no globals, pure numeric logic.
//
// Why PCA and not UMAP: UMAP needs a new runtime dep + a worker to be
// usable, and the job here is "see structure without offline precompute",
// not faithful manifold geometry. PCA is O(iters × N × D) with cooperative
// yields between iterations, so even 100k × 384 stays responsive on the
// main thread — no third worker (convention: don't add one without a
// clear reason). Revisit UMAP only if PCA's structure is visibly inadequate
// on real corpora.

/**
 * Coerce a query-result cell value into a Float32Array vector, or null if it
 * isn't one. DuckDB-wasm's Arrow rows surface a FLOAT[] column as (depending
 * on type + path) a typed array, a JS number array, an Arrow vector-like
 * object with `toArray()`, or occasionally a JSON string — handle all four.
 */
export function coerceVector(value: unknown): Float32Array | null {
  if (value == null) return null;
  if (value instanceof Float32Array) return value;
  // L20: BigInt64Array/BigUint64Array are ArrayBuffer views but `Float32Array
  // .from` THROWS on BigInt elements — the contract is "return the vector or
  // null", not throw. A BIGINT[] embedding column should be skipped, not crash.
  if (value instanceof BigInt64Array || value instanceof BigUint64Array) {
    return Float32Array.from(value, (v) => Number(v));
  }
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return Float32Array.from(value as unknown as ArrayLike<number>);
  }
  if (Array.isArray(value)) {
    return allFinite(value) ? Float32Array.from(value as number[]) : null;
  }
  if (typeof value === 'object' && typeof (value as { toArray?: unknown }).toArray === 'function') {
    const arr = (value as { toArray: () => ArrayLike<number> }).toArray();
    return coerceVector(ArrayBuffer.isView(arr) ? arr : Array.from(arr));
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s.startsWith('[')) return null;
    try {
      const parsed: unknown = JSON.parse(s);
      return Array.isArray(parsed) && allFinite(parsed) ? Float32Array.from(parsed) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function allFinite(arr: unknown[]): boolean {
  for (const x of arr) {
    if (typeof x !== 'number' || !Number.isFinite(x)) return false;
  }
  return true;
}

export interface PcaOptions {
  /** Max power-iteration steps per component. Default 100. */
  maxIter?: number;
  /** Convergence threshold on |1 - |cos(v_new, v_old)||. Default 1e-7. */
  tol?: number;
  /**
   * Called between iterations so the caller can yield to the event loop
   * (the embedding cell passes a setTimeout(0) hop). Default: no yield —
   * tests and small inputs run synchronously fast.
   */
  onIteration?: () => Promise<void>;
}

/**
 * Project N equal-length vectors onto their top-2 principal components.
 * Returns [x, y] pairs aligned with the input order.
 *
 * Deterministic: seeded init + a sign convention (the component's
 * largest-magnitude entry is positive), so repeated runs on the same data
 * produce the same map. Throws on mixed dimensions; degenerate inputs
 * (N < 2, D < 2, zero variance) fall back to zeros in the flat axis.
 */
export async function pcaProject2D(
  vectors: readonly Float32Array[],
  opts: PcaOptions = {},
): Promise<Array<[number, number]>> {
  const n = vectors.length;
  if (n === 0) return [];
  const first = vectors[0] as Float32Array;
  const d = first.length;
  for (const v of vectors) {
    if (v.length !== d) {
      throw new Error(`Mixed vector dimensions: expected ${d}, got ${v.length}`);
    }
  }
  if (d === 0) return vectors.map(() => [0, 0]);
  if (n === 1) return [[0, 0]];

  // Mean-center (into a Float64 working copy — power iteration accumulates,
  // and fp32 rounding across 100k rows is visible).
  const mean = new Float64Array(d);
  for (const v of vectors) {
    for (let j = 0; j < d; j++) mean[j] = (mean[j] as number) + (v[j] as number);
  }
  for (let j = 0; j < d; j++) mean[j] = (mean[j] as number) / n;

  const centered: Float64Array[] = vectors.map((v) => {
    const row = new Float64Array(d);
    for (let j = 0; j < d; j++) row[j] = (v[j] as number) - (mean[j] as number);
    return row;
  });

  const pc1 = await powerIteration(centered, d, null, opts);
  const pc2 = d >= 2 ? await powerIteration(centered, d, pc1, opts) : null;

  return centered.map((row) => [dot(row, pc1), pc2 ? dot(row, pc2) : 0]);
}

/**
 * Leading eigenvector of Xᵀ X via power iteration, optionally deflated
 * against `orthoTo` (Gram-Schmidt each step, for the second component).
 * Returns a unit vector; an all-zero X (no variance) returns the init
 * direction, which projects everything to 0 — harmless.
 */
async function powerIteration(
  rows: readonly Float64Array[],
  d: number,
  orthoTo: Float64Array | null,
  opts: PcaOptions,
): Promise<Float64Array> {
  const maxIter = opts.maxIter ?? 100;
  const tol = opts.tol ?? 1e-7;

  // Deterministic init: alternating-sign ramp, then orthogonalized +
  // normalized. Anything not exactly orthogonal to the true component works.
  let v = new Float64Array(d);
  for (let j = 0; j < d; j++) v[j] = (j % 2 === 0 ? 1 : -1) * (1 + j / d);
  if (orthoTo) subtractProjection(v, orthoTo);
  normalize(v);

  for (let iter = 0; iter < maxIter; iter++) {
    // w = Xᵀ (X v) — two O(N·D) passes, never materializing D×D.
    const w = new Float64Array(d);
    for (const row of rows) {
      const s = dot(row, v);
      if (s === 0) continue;
      for (let j = 0; j < d; j++) w[j] = (w[j] as number) + s * (row[j] as number);
    }
    if (orthoTo) subtractProjection(w, orthoTo);
    const norm = normalize(w);
    if (norm === 0) break; // no variance in this subspace — keep current v
    const cos = Math.abs(dot(w, v));
    v = w;
    if (1 - cos < tol) break;
    if (opts.onIteration) await opts.onIteration();
  }

  // Sign convention: largest-|entry| positive → stable across runs.
  let maxIdx = 0;
  for (let j = 1; j < d; j++) {
    if (Math.abs(v[j] as number) > Math.abs(v[maxIdx] as number)) maxIdx = j;
  }
  if ((v[maxIdx] as number) < 0) {
    for (let j = 0; j < d; j++) v[j] = -(v[j] as number);
  }
  return v;
}

function dot(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let j = 0; j < a.length; j++) s += (a[j] as number) * (b[j] as number);
  return s;
}

/** a ← a - (a·unit) unit. `unit` must be normalized. */
function subtractProjection(a: Float64Array, unit: Float64Array): void {
  const s = dot(a, unit);
  for (let j = 0; j < a.length; j++) a[j] = (a[j] as number) - s * (unit[j] as number);
}

/** Normalize in place; returns the pre-normalization L2 norm. */
function normalize(v: Float64Array): number {
  const norm = Math.sqrt(dot(v, v));
  if (norm > 0) {
    for (let j = 0; j < v.length; j++) v[j] = (v[j] as number) / norm;
  }
  return norm;
}
