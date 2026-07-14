import { describe, expect, it } from 'vitest';
import {
  cosineSimilarity,
  embedSearchInMemory,
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

describe('embedSearchInMemory', () => {
  it('embeds the query then ranks the in-memory corpus', async () => {
    const embed = async (texts: string[]) => texts.map(() => new Float32Array([1, 0]));
    const corpus = [
      { id: 'a', vec: [1, 0] },
      { id: 'b', vec: [0, 1] },
    ];
    const r = await embedSearchInMemory({ embed, query: 'q', corpus, k: 2 });
    expect(r.map((n) => n.id)).toEqual(['a', 'b']);
  });
  it('returns [] when the embedder yields no vector', async () => {
    const embed = async () => [] as Float32Array[];
    const r = await embedSearchInMemory({ embed, query: 'q', corpus: [{ id: 'a', vec: [1, 0] }] });
    expect(r).toEqual([]);
  });
});
