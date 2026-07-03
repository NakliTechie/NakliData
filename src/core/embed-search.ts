// Facet embedSearch — semantic nearest-neighbour search over a precomputed
// embedding column. The keeper module behind the Embedding / semantic-map
// view and the `window.facet.embedSearch` agent verb (Facet track, spec A34;
// M0 gate G4). Engine-boundary clean: no DOM, no globals — it takes an
// injected embedder fn and a structural query runner, so it is pure logic +
// SQL emission and unit-testable without a browser or a model.
//
// Two strategies, both here:
//   * buildVssSql + embedSearch     — DuckDB VSS (array_cosine_similarity)
//                                     over a precomputed FLOAT[dim] column;
//                                     the product-scale path.
//   * rankBySimilarity + embedSearchInMemory — a JS cosine scan over an
//                                     in-memory corpus; used by the M0 eval
//                                     runner (no into-DuckDB plumbing) and as
//                                     the reference for the SQL path.
//
// Embedders return L2-normalised vectors (see loadEmbedder), so cosine
// similarity is a dot product; array_cosine_similarity is used regardless so
// the SQL is correct even if a caller passes un-normalised vectors.

/** Embeds a batch of texts into vectors. Injected (from the transformers chunk). */
export type EmbedFn = (texts: string[]) => Promise<Float32Array[]>;

/** Structural subset of Engine — just what embedSearch needs to run a query. */
export interface QueryRunner {
  query<Row = Record<string, unknown>>(sql: string): Promise<Row[]>;
}

export type Vector = Float32Array | number[];

export interface Neighbor {
  id: string;
  score: number;
}

export interface VssSqlOptions {
  table: string;
  /** FLOAT[dim] embedding column. */
  embColumn: string;
  /** Column returned as the neighbour id. */
  idColumn: string;
  queryVec: Vector;
  k: number;
  dim: number;
}

/** Double-quote an identifier, doubling internal quotes. Injection-safe. */
function quoteIdent(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/**
 * Render a vector as a DuckDB `FLOAT[dim]` array literal. Every element must
 * be a finite number — anything else (NaN/Infinity/non-number) throws rather
 * than emitting a malformed or injectable literal.
 */
export function formatVector(vec: Vector, dim: number): string {
  const arr = Array.from(vec);
  if (arr.length !== dim) {
    throw new Error(`Vector length ${arr.length} != expected dim ${dim}`);
  }
  const parts = arr.map((x) => {
    if (typeof x !== 'number' || !Number.isFinite(x)) {
      throw new Error(`Non-finite vector component: ${String(x)}`);
    }
    return String(x);
  });
  return `[${parts.join(',')}]::FLOAT[${dim}]`;
}

/**
 * Build the VSS ranking SQL: top-k rows of `table` by cosine similarity of
 * `embColumn` to `queryVec`, highest first. Identifiers are quoted; the vector
 * is a validated numeric literal; `k` must be a positive integer. Rows with a
 * NULL embedding are excluded.
 */
export function buildVssSql(opts: VssSqlOptions): string {
  const { table, embColumn, idColumn, queryVec, k, dim } = opts;
  if (!Number.isInteger(k) || k < 1) {
    throw new Error(`k must be a positive integer, got ${k}`);
  }
  const q = formatVector(queryVec, dim);
  return (
    `SELECT ${quoteIdent(idColumn)} AS id, ` +
    `array_cosine_similarity(${quoteIdent(embColumn)}, ${q}) AS score ` +
    `FROM ${quoteIdent(table)} ` +
    `WHERE ${quoteIdent(embColumn)} IS NOT NULL ` +
    `ORDER BY score DESC LIMIT ${k}`
  );
}

/**
 * embedSearch (DuckDB path): embed the query, then rank a precomputed
 * embedding column by cosine similarity in-engine. Assumes a table with an
 * `idColumn` and a FLOAT[dim] `embColumn` already exists.
 */
export async function embedSearch(opts: {
  runner: QueryRunner;
  embed: EmbedFn;
  query: string;
  k?: number;
  table?: string;
  embColumn?: string;
  idColumn?: string;
  dim?: number;
}): Promise<Neighbor[]> {
  const {
    runner,
    embed,
    query,
    k = 10,
    table = 'paper_emb',
    embColumn = 'emb',
    idColumn = 'pid',
    dim = 384,
  } = opts;
  const [queryVec] = await embed([query]);
  if (!queryVec) return [];
  const sql = buildVssSql({ table, embColumn, idColumn, queryVec, k, dim });
  const rows = await runner.query<{ id: string; score: number }>(sql);
  return rows.map((r) => ({ id: r.id, score: r.score }));
}

// --- JS path (in-memory cosine; reference + M0 runner) ---------------------

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
