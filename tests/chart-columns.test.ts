// A1 — coerceNumeric + pickChartColumns. The critical case is DuckDB-wasm's
// apache-arrow Int128 limb objects (`{"0":550,…}`), the shape a GROUP BY … SUM
// result arrives in. Getting the little-endian two's-complement reconstruction
// wrong = silently wrong chart values, so it's tested against known integers
// (incl. > 2^32 multi-limb and negatives) as well as the shape guards.
import { describe, expect, it } from 'vitest';
import { type ChartColumns, coerceNumeric, pickChartColumns } from '../src/core/chart-columns.ts';

// Build a little-endian 32-bit limb object for a given integer, the way
// apache-arrow serialises Int128 (4 limbs) via `.toJSON()`.
function limbs(value: bigint, width = 4): Record<string, number> {
  const mask = (1n << 32n) - 1n;
  let v = value < 0n ? value + (1n << BigInt(width * 32)) : value; // two's-complement
  const out: Record<string, number> = {};
  for (let i = 0; i < width; i++) {
    out[String(i)] = Number(v & mask);
    v >>= 32n;
  }
  return out;
}

describe('coerceNumeric — primitive shapes', () => {
  it('passes through finite numbers, rejects NaN/Infinity', () => {
    expect(coerceNumeric(42)).toBe(42);
    expect(coerceNumeric(0)).toBe(0);
    expect(coerceNumeric(-3.5)).toBe(-3.5);
    expect(coerceNumeric(Number.NaN)).toBeNull();
    expect(coerceNumeric(Number.POSITIVE_INFINITY)).toBeNull();
  });
  it('coerces bigints and numeric strings', () => {
    expect(coerceNumeric(123456789012n)).toBe(123456789012);
    expect(coerceNumeric('1234')).toBe(1234);
    expect(coerceNumeric('  -5.5 ')).toBe(-5.5);
  });
  it('rejects null / undefined / booleans / non-numeric strings', () => {
    expect(coerceNumeric(null)).toBeNull();
    expect(coerceNumeric(undefined)).toBeNull();
    expect(coerceNumeric(true)).toBeNull();
    expect(coerceNumeric('')).toBeNull();
    expect(coerceNumeric('N/A')).toBeNull();
  });
});

describe('coerceNumeric — apache-arrow Int128 limb objects', () => {
  it('reconstructs small aggregates (the {"0":550,…} case)', () => {
    expect(coerceNumeric({ '0': 550, '1': 0, '2': 0, '3': 0 })).toBe(550);
    expect(coerceNumeric(limbs(550n))).toBe(550);
    expect(coerceNumeric(limbs(0n))).toBe(0);
    expect(coerceNumeric(limbs(1n))).toBe(1);
  });
  it('reconstructs values that overflow a single 32-bit limb', () => {
    expect(coerceNumeric(limbs(1n << 32n))).toBe(2 ** 32);
    expect(coerceNumeric(limbs(1234567890123n))).toBe(1234567890123);
    expect(coerceNumeric(limbs(9007199254740992n))).toBe(9007199254740992);
  });
  it('reconstructs negatives via two’s-complement across the full width', () => {
    expect(coerceNumeric(limbs(-1n))).toBe(-1);
    expect(coerceNumeric(limbs(-550n))).toBe(-550);
    expect(coerceNumeric(limbs(-1234567890123n))).toBe(-1234567890123);
  });
  it('handles a 2-limb (Uint64) width too', () => {
    expect(coerceNumeric(limbs(42n, 2))).toBe(42);
    expect(coerceNumeric(limbs(-42n, 2))).toBe(-42);
  });
  it('rejects genuine struct / JSON objects (field-named keys, not 0..n)', () => {
    expect(coerceNumeric({ name: 'x', qty: 5 })).toBeNull();
    expect(coerceNumeric({ '0': 5, '2': 3 })).toBeNull(); // gap at "1"
    expect(coerceNumeric({ '0': 5, foo: 1 })).toBeNull(); // extra non-index key
    expect(coerceNumeric({ '0': 1.5 })).toBeNull(); // non-integer limb
    expect(coerceNumeric({})).toBeNull();
  });
});

describe('pickChartColumns', () => {
  it('picks a text label + a numeric measure from a GROUP BY … SUM result', () => {
    // country (VARCHAR) + total (arrow Int128 limb objects) — the canonical shape.
    const rows = [
      { country: 'United Kingdom', total: limbs(48000n) },
      { country: 'France', total: limbs(9200n) },
      { country: 'Germany', total: limbs(7700n) },
    ];
    expect(pickChartColumns(['country', 'total'], rows)).toEqual<ChartColumns>({
      category: 'country',
      value: 'total',
    });
  });
  it('prefers the trailing aggregate as the value when several numerics exist', () => {
    const rows = [
      { region: 'West', year: 2020, sales: 100 },
      { region: 'East', year: 2021, sales: 250 },
    ];
    // category = first non-numeric (region); value = last numeric (sales), not year.
    expect(pickChartColumns(['region', 'year', 'sales'], rows)).toEqual<ChartColumns>({
      category: 'region',
      value: 'sales',
    });
  });
  it('returns null when there is no numeric measure', () => {
    const rows = [
      { a: 'x', b: 'y' },
      { a: 'p', b: 'q' },
    ];
    expect(pickChartColumns(['a', 'b'], rows)).toBeNull();
  });
  it('returns null when there is no categorical label (all numeric)', () => {
    const rows = [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ];
    expect(pickChartColumns(['x', 'y'], rows)).toBeNull();
  });
  it('returns null for empty / single-column results', () => {
    expect(pickChartColumns(['only'], [{ only: 1 }])).toBeNull();
    expect(pickChartColumns(['a', 'b'], [])).toBeNull();
  });
  it('tolerates the odd non-numeric placeholder in a measure column (≥80% numeric)', () => {
    const rows = [
      { cat: 'a', n: 10 },
      { cat: 'b', n: 20 },
      { cat: 'c', n: 30 },
      { cat: 'd', n: 40 },
      { cat: 'e', n: 'N/A' },
    ];
    expect(pickChartColumns(['cat', 'n'], rows)).toEqual<ChartColumns>({
      category: 'cat',
      value: 'n',
    });
  });
});
