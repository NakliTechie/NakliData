// Shared categorical colour palette for the Facet deck.gl views. Lives in core
// (not the deck.gl chunk) so a cell in the main bundle can render a legend whose
// swatches EXACTLY match the colours the chunk draws — both sides call
// assignCategoryColors over the same value sequence, so the mapping is identical.
//
// RGB tuples (0–255), not CSS hex, because deck.gl accessors want [r,g,b(,a)].
// The values mirror the deck.gl scatter palette so the visual identity is shared
// across every Facet surface (embedding · network · points).

/** Accent — the shared deck.gl categorical accent (== tokens brand red). */
export const ACCENT_RGB: [number, number, number] = [0xb5, 0x37, 0x1c];

/** Distinct-category cycle. Capped-length; assignment cycles past the end. */
export const CATEGORICAL_RGB: ReadonlyArray<[number, number, number]> = [
  [0xb5, 0x37, 0x1c],
  [0x6f, 0x7e, 0x76],
  [0xd6, 0xa2, 0x4e],
  [0x3c, 0x5a, 0x6b],
  [0x8c, 0x6f, 0x4a],
  [0x4f, 0x7b, 0x6e],
  [0xa5, 0x6a, 0x8c],
  [0x9c, 0x52, 0x30],
  [0x5b, 0x7f, 0x9b],
  [0x7b, 0x6f, 0xb1],
  [0x50, 0x66, 0x50],
  [0xa7, 0x7e, 0x5f],
];

/**
 * Map each distinct non-empty value to a stable colour, in first-appearance
 * order, capped at the palette length (further distinct values cycle the
 * palette). Empty / null values are skipped — the caller falls back to a
 * neutral colour for them. Deterministic: same input order → same mapping, so a
 * legend built here matches a renderer built from the same sequence.
 */
export function assignCategoryColors(
  values: Iterable<string | null | undefined>,
): Map<string, [number, number, number]> {
  const lookup = new Map<string, [number, number, number]>();
  let next = 0;
  for (const v of values) {
    if (v == null || v === '') continue;
    if (lookup.has(v)) continue;
    lookup.set(v, CATEGORICAL_RGB[next % CATEGORICAL_RGB.length] as [number, number, number]);
    next++;
  }
  return lookup;
}

/** `rgb(r,g,b)` string for a CSS swatch (legends live in the DOM, not WebGL). */
export function rgbCss(rgb: readonly [number, number, number]): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}
