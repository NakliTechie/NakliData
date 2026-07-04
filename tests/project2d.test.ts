// core/project2d — coerceVector + pcaProject2D (Facet Embedding view's
// in-browser 2-D reduction). Pure numeric logic, no DOM.

import { describe, expect, it } from 'vitest';
import { coerceVector, pcaProject2D } from '../src/core/project2d.ts';

describe('coerceVector', () => {
  it('passes through Float32Array', () => {
    const v = Float32Array.from([1, 2, 3]);
    expect(coerceVector(v)).toBe(v);
  });

  it('converts other typed arrays', () => {
    const out = coerceVector(Float64Array.from([1.5, -2]));
    expect(out).toBeInstanceOf(Float32Array);
    expect(Array.from(out ?? [])).toEqual([1.5, -2]);
  });

  it('converts finite number arrays and rejects non-finite ones', () => {
    expect(Array.from(coerceVector([0.25, -1]) ?? [])).toEqual([0.25, -1]);
    expect(coerceVector([1, Number.NaN])).toBeNull();
    expect(coerceVector([1, 'x'])).toBeNull();
  });

  it('unwraps Arrow-style objects with toArray()', () => {
    const arrowish = { toArray: () => Float64Array.from([3, 4]) };
    expect(Array.from(coerceVector(arrowish) ?? [])).toEqual([3, 4]);
  });

  it('parses JSON array strings, rejects other strings', () => {
    expect(Array.from(coerceVector('[1, 2.5]') ?? [])).toEqual([1, 2.5]);
    expect(coerceVector('not a vector')).toBeNull();
    expect(coerceVector('[1, "a"]')).toBeNull();
    expect(coerceVector('[broken')).toBeNull();
  });

  it('rejects null, undefined, numbers, plain objects', () => {
    expect(coerceVector(null)).toBeNull();
    expect(coerceVector(undefined)).toBeNull();
    expect(coerceVector(42)).toBeNull();
    expect(coerceVector({ a: 1 })).toBeNull();
  });
});

describe('pcaProject2D', () => {
  it('handles empty + single-point inputs', async () => {
    expect(await pcaProject2D([])).toEqual([]);
    expect(await pcaProject2D([Float32Array.from([1, 2, 3])])).toEqual([[0, 0]]);
  });

  it('throws on mixed dimensions', async () => {
    await expect(
      pcaProject2D([Float32Array.from([1, 2]), Float32Array.from([1, 2, 3])]),
    ).rejects.toThrow(/Mixed vector dimensions/);
  });

  it('recovers a dominant axis: variance along x maps to component 1', async () => {
    // Points spread along the first axis, tiny jitter on the second.
    const vecs = [-2, -1, 0, 1, 2].map((x, i) => Float32Array.from([x, (i % 2) * 0.01, 0]));
    const proj = await pcaProject2D(vecs);
    // First projected coordinate should preserve the ordering of x.
    const xs = proj.map((p) => p[0]);
    const sorted = [...xs].sort((a, b) => a - b);
    expect(xs).toEqual(sorted);
    // Spread on axis 1 dwarfs axis 2.
    const spread = (arr: number[]) => Math.max(...arr) - Math.min(...arr);
    expect(spread(xs)).toBeGreaterThan(3.9);
    expect(spread(proj.map((p) => p[1]))).toBeLessThan(0.1);
  });

  it('separates two clusters embedded in high-D space', async () => {
    // Two tight clusters offset along a random-ish high-D direction: PCA's
    // first component must separate them cleanly.
    const d = 64;
    const dir = Float32Array.from({ length: d }, (_, j) => Math.sin(j * 1.7));
    const mk = (sign: number, jitterSeed: number) =>
      Float32Array.from({ length: d }, (_, j) => {
        const jitter = 0.05 * Math.sin(j * 3.1 + jitterSeed);
        return sign * 5 * (dir[j] as number) + jitter;
      });
    const a = [1, 2, 3, 4].map((s) => mk(1, s));
    const b = [1, 2, 3, 4].map((s) => mk(-1, s + 10));
    const proj = await pcaProject2D([...a, ...b]);
    const ax = proj.slice(0, 4).map((p) => p[0]);
    const bx = proj.slice(4).map((p) => p[0]);
    // All of cluster A on one side of component 1, all of B on the other.
    const aSide = Math.sign(ax[0] as number);
    expect(ax.every((x) => Math.sign(x) === aSide)).toBe(true);
    expect(bx.every((x) => Math.sign(x) === -aSide)).toBe(true);
  });

  it('is deterministic across runs', async () => {
    const vecs = [0, 1, 2, 3, 4, 5].map((i) =>
      Float32Array.from({ length: 8 }, (_, j) => Math.sin(i * 2.3 + j) * (j + 1)),
    );
    const a = await pcaProject2D(vecs);
    const b = await pcaProject2D(vecs);
    expect(a).toEqual(b);
  });

  it('produces orthogonal components (cross-covariance ≈ 0)', async () => {
    const vecs = [...Array(20)].map((_, i) =>
      Float32Array.from({ length: 6 }, (_, j) => Math.sin(i * 1.1 + j * 0.7) * (1 + (j % 3))),
    );
    const proj = await pcaProject2D(vecs);
    const n = proj.length;
    const mx = proj.reduce((s, p) => s + p[0], 0) / n;
    const my = proj.reduce((s, p) => s + p[1], 0) / n;
    const cross = proj.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / n;
    const vx = proj.reduce((s, p) => s + (p[0] - mx) ** 2, 0) / n;
    const vy = proj.reduce((s, p) => s + (p[1] - my) ** 2, 0) / n;
    expect(Math.abs(cross) / Math.sqrt(vx * vy + 1e-12)).toBeLessThan(0.01);
    // Variance ordering: component 1 carries at least as much as component 2.
    expect(vx).toBeGreaterThanOrEqual(vy);
  });

  it('degenerate: zero-variance input projects to zeros', async () => {
    const vecs = [1, 2, 3].map(() => Float32Array.from([7, 7, 7]));
    const proj = await pcaProject2D(vecs);
    for (const [x, y] of proj) {
      expect(Math.abs(x)).toBeLessThan(1e-9);
      expect(Math.abs(y)).toBeLessThan(1e-9);
    }
  });

  it('1-D input: second coordinate is 0', async () => {
    const proj = await pcaProject2D([1, 2, 3].map((x) => Float32Array.from([x])));
    for (const [, y] of proj) expect(y).toBe(0);
  });

  it('calls onIteration between iterations', async () => {
    let calls = 0;
    const vecs = [...Array(10)].map((_, i) =>
      Float32Array.from({ length: 4 }, (_, j) => Math.cos(i + j * 0.9) * (j + 1)),
    );
    await pcaProject2D(vecs, {
      onIteration: async () => {
        calls++;
      },
    });
    expect(calls).toBeGreaterThan(0);
  });
});
