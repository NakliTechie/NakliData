// Facet similarity ranking — cosine nearest-neighbour over in-memory embedding
// vectors. Behind the Embedding / semantic-map view (Facet track, spec A34).
// Engine-boundary clean: pure logic, no DOM/globals — unit-testable without a
// browser or a model.
//
// Embedders return L2-normalised vectors (see loadEmbedder), so cosine
// similarity is a dot product.
//
// NOTE: the DuckDB-VSS SQL path (embedSearch / buildVssSql / formatVector +
// the QueryRunner/VssSqlOptions types) was removed 2026-07-14 (E2, user-ratified)
// — it was exported but never wired to a runtime consumer (tests only). The
// in-memory ranking below is what the embedding cell uses; embedSearchInMemory
// is used by the M0 eval runner (eval/m0/runner/harness.ts). Reinstate the VSS
// path from git history if the product-scale semantic-map ever needs it.

/** Embeds a batch of texts into vectors. Injected (from the transformers chunk). */
export type EmbedFn = (texts: string[]) => Promise<Float32Array[]>;

export type Vector = Float32Array | number[];

export interface Neighbor {
  id: string;
  score: number;
}

/** Cosine similarity of two equal-length vectors. */
export function cosineSimilarity(a: Vector, b: Vector): number {
  const av = Array.from(a);
  const bv = Array.from(b);
  if (av.length !== bv.length) {
    throw new Error(`Vector length mismatch: ${av.length} vs ${bv.length}`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < av.length; i++) {
    const x = av[i] as number;
    const y = bv[i] as number;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Rank a corpus of {id, vec} by cosine similarity to queryVec, top-k. */
export function rankBySimilarity(
  queryVec: Vector,
  corpus: Array<{ id: string; vec: Vector }>,
  k = 10,
): Neighbor[] {
  const scored = corpus.map((c) => ({ id: c.id, score: cosineSimilarity(queryVec, c.vec) }));
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, Math.max(0, k));
}

/**
 * embedSearch (JS path): embed the query and rank an in-memory corpus. Used by
 * the M0 eval runner, which holds the precomputed corpus vectors in memory.
 */
export async function embedSearchInMemory(opts: {
  embed: EmbedFn;
  query: string;
  corpus: Array<{ id: string; vec: Vector }>;
  k?: number;
}): Promise<Neighbor[]> {
  const { embed, query, corpus, k = 10 } = opts;
  const [queryVec] = await embed([query]);
  if (!queryVec) return [];
  return rankBySimilarity(queryVec, corpus, k);
}
