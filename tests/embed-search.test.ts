import { describe, expect, it } from 'vitest';
import {
  buildVssSql,
  cosineSimilarity,
  embedSearch,
  embedSearchInMemory,
  formatVector,
  rankBySimilarity,
} from '../src/core/embed-search.ts';

describe('cosineSimilarity', () => {
  it('is 1 for identical, 0 for orthogonal, -1 for opposite', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });
  it('is magnitude-invariant', () => {
    expect(cosineSimilarity([2, 0], [5, 0])).toBeCloseTo(1);
  });
  it('returns 0 for a zero vector (no divide-by-zero)', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
  it('throws on length mismatch', () => {
    expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow(/mismatch/);
  });
});

describe('rankBySimilarity', () => {
  const corpus = [
    { id: 'a', vec: [1, 0] },
    { id: 'b', vec: [0.9, 0.1] },
    { id: 'c', vec: [0, 1] },
    { id: 'd', vec: [-1, 0] },
  ];
  it('ranks nearest first', () => {
    const r = rankBySimilarity([1, 0], corpus, 4);
    expect(r.map((n) => n.id)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('respects k', () => {
    expect(rankBySimilarity([1, 0], corpus, 2).map((n) => n.id)).toEqual(['a', 'b']);
  });
});

describe('formatVector', () => {
  it('emits a typed array literal', () => {
    expect(formatVector([0.5, -0.25, 1], 3)).toBe('[0.5,-0.25,1]::FLOAT[3]');
  });
  it('throws on wrong dim', () => {
    expect(() => formatVector([1, 2], 3)).toThrow(/dim/);
  });
  it('throws on non-finite components (no malformed/injectable literal)', () => {
    expect(() => formatVector([1, Number.NaN], 2)).toThrow(/finite/);
    expect(() => formatVector([1, Number.POSITIVE_INFINITY], 2)).toThrow(/finite/);
  });
});

describe('buildVssSql', () => {
  it('builds a top-k cosine-similarity query', () => {
    const sql = buildVssSql({
      table: 'paper_emb',
      embColumn: 'emb',
      idColumn: 'pid',
      queryVec: [0.1, 0.2],
      k: 5,
      dim: 2,
    });
    expect(sql).toContain('array_cosine_similarity("emb", [0.1,0.2]::FLOAT[2])');
    expect(sql).toContain('FROM "paper_emb"');
    expect(sql).toContain('WHERE "emb" IS NOT NULL');
    expect(sql).toContain('ORDER BY score DESC LIMIT 5');
  });
  it('quotes hostile identifiers (injection-safe)', () => {
    const sql = buildVssSql({
      table: 'p";DROP TABLE p;--',
      embColumn: 'emb',
      idColumn: 'pid',
      queryVec: [1],
      k: 1,
      dim: 1,
    });
    // the doubled-quote escaping keeps it a single quoted identifier
    expect(sql).toContain('FROM "p"";DROP TABLE p;--"');
    expect(sql).not.toMatch(/FROM "p";DROP/);
  });
  it('rejects a non-positive or non-integer k', () => {
    const base = { table: 't', embColumn: 'e', idColumn: 'i', queryVec: [1], dim: 1 };
    expect(() => buildVssSql({ ...base, k: 0 })).toThrow(/positive integer/);
    expect(() => buildVssSql({ ...base, k: 2.5 })).toThrow(/positive integer/);
  });
});

describe('embedSearchInMemory', () => {
  it('embeds the query and returns ranked neighbours', async () => {
    // fake embedder: maps a query to a fixed vector
    const embed = async (texts: string[]) => texts.map(() => Float32Array.from([1, 0]));
    const corpus = [
      { id: 'far', vec: [0, 1] },
      { id: 'near', vec: [1, 0] },
    ];
    const out = await embedSearchInMemory({ embed, query: 'q', corpus, k: 1 });
    expect(out).toEqual([{ id: 'near', score: expect.closeTo(1) }]);
  });
});

describe('embedSearch (DuckDB path)', () => {
  it('embeds, builds the VSS SQL, and maps rows', async () => {
    let seenSql = '';
    const embed = async (texts: string[]) => texts.map(() => Float32Array.from([0.3, 0.4]));
    const runner = {
      query: async <R>(sql: string): Promise<R[]> => {
        seenSql = sql;
        return [{ id: 'W1', score: 0.99 }] as unknown as R[];
      },
    };
    const out = await embedSearch({ runner, embed, query: 'q', k: 3, dim: 2 });
    // Float32Array quantises 0.3 -> 0.30000001…, so assert structure, not the
    // exact decimals (formatVector emits full float32 precision, by design).
    expect(seenSql).toContain('array_cosine_similarity("emb", [');
    expect(seenSql).toContain(']::FLOAT[2])');
    expect(seenSql).toContain('LIMIT 3');
    expect(out).toEqual([{ id: 'W1', score: 0.99 }]);
  });
});
