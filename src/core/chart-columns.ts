// A1 (Tier-2 reporting) — pure column-picking for the auto-embedded chart on
// "Create report from result". Given a SQL result (columns + rows), pick a
// categorical x + numeric y for a bar chart, or return null when the result
// isn't chartable. No DOM, no engine — the main.ts handler materialises the
// pick as a `chart` cell.
//
// The load-bearing subtlety is numeric detection. DuckDB-wasm hands aggregate
// results back through apache-arrow's `.toJSON()`. `SUM`/`AVG` over integers
// promote to HUGEINT (INT128), which arrow serialises NOT as a number or a
// bigint but as a little-endian 32-bit limb object — `{"0":550,"1":0,"2":0,
// "3":0}` is 550. A naive `typeof v === 'number'` check reads those as
// non-numeric, so the chart on a GROUP BY … SUM result — the single most
// common report shape — silently picks the wrong column or none. `coerceNumeric`
// reconstructs the limb object so those columns read as the numbers they are.
// This is why A1 was deferred until the detection was written (2026-07-13 notes).

/**
 * Reconstruct a number from any value DuckDB-wasm may hand back for a cell:
 * native number, bigint, a numeric string, or an apache-arrow Int128/Decimal
 * limb object. Returns null for anything non-numeric (structs, JSON, booleans,
 * text) so a real label column is never mistaken for a measure.
 */
export function coerceNumeric(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'boolean') return null; // a flag is not a measure
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === 'object') return limbObjectToNumber(v as Record<string, unknown>);
  return null;
}

/**
 * apache-arrow serialises an Int128 / Decimal / Uint64 as an object whose keys
 * are consecutive integers ("0".."n-1") holding little-endian 32-bit UNSIGNED
 * limbs, two's-complement across the full width for signed types. Reconstruct
 * with BigInt (exact), then narrow to Number for charting.
 *
 * Any object that isn't exactly this shape returns null — so a genuine struct
 * column (arrow structs key by field NAME, not "0"/"1") stays non-numeric.
 */
function limbObjectToNumber(obj: Record<string, unknown>): number | null {
  const width = Object.keys(obj).length;
  if (width === 0) return null;
  const limbs: bigint[] = [];
  for (let i = 0; i < width; i++) {
    const raw = obj[String(i)];
    // Every index 0..width-1 must be present and hold a 32-bit-range integer;
    // a missing index or an extra non-index key means this isn't a limb object.
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > 0xffffffff) {
      return null;
    }
    limbs.push(BigInt(raw));
  }
  let acc = 0n;
  for (let i = width - 1; i >= 0; i--) {
    acc = (acc << 32n) | (limbs[i] as bigint);
  }
  // Two's-complement: high bit of the top limb set → negative.
  const bits = BigInt(width * 32);
  if (acc & (1n << (bits - 1n))) acc -= 1n << bits;
  return Number(acc);
}

export interface ChartColumns {
  /** x — a categorical label column. */
  category: string;
  /** y — a numeric measure column. */
  value: string;
}

/**
 * Pick a `{category, value}` pair for an auto bar chart, or null when the
 * result can't sensibly bar-chart (no non-numeric label, or no numeric
 * measure). Heuristic tuned for the common GROUP BY … aggregate shape:
 *   - value  = the LAST numeric column (aggregates trail the group keys),
 *   - category = the FIRST non-numeric column (the group label).
 * A column counts as numeric when ≥ 80% of its non-null sampled values coerce
 * (tolerates the odd "N/A" placeholder without demoting a real measure).
 */
export function pickChartColumns(
  columns: readonly string[],
  rows: ReadonlyArray<Record<string, unknown>>,
): ChartColumns | null {
  if (columns.length < 2 || rows.length === 0) return null;
  const sample = rows.slice(0, 50);

  const isNumeric = (col: string): boolean => {
    let nonNull = 0;
    let numeric = 0;
    for (const r of sample) {
      const v = r[col];
      if (v === null || v === undefined) continue;
      nonNull++;
      if (coerceNumeric(v) !== null) numeric++;
    }
    return nonNull > 0 && numeric / nonNull >= 0.8;
  };

  const numericCols = columns.filter(isNumeric);
  const value = numericCols[numericCols.length - 1];
  if (value === undefined) return null;

  const category = columns.find((c) => !isNumeric(c));
  if (category === undefined) return null;

  return { category, value };
}
