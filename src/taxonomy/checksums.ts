// Vendored checksum functions referenced from taxonomy detectors via `fn`.
// Not user-pluggable in v1.0 (handoff §3.5).

const ALPHA36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * GSTIN check digit verification.
 * Algorithm: base-36 alphabet, weights alternate 1/2 across the first 14
 * chars, products >= 36 fold high/low digits, final char = (36 - sum%36)%36.
 * Public references: GSTN portal validation, CBIC public docs.
 */
export function gstin_checksum(value: string): boolean {
  if (value.length !== 15) return false;
  const upper = value.toUpperCase();
  for (const c of upper) {
    if (ALPHA36.indexOf(c) === -1) return false;
  }
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = ALPHA36.indexOf(upper[i] as string);
    const mul = (i + 1) % 2 === 0 ? 2 : 1;
    let p = v * mul;
    p = Math.floor(p / 36) + (p % 36);
    sum += p;
  }
  const expected = ALPHA36[(36 - (sum % 36)) % 36];
  return upper[14] === expected;
}

/**
 * IBAN ISO 13616 modulo-97 check.
 * Move first 4 chars to the end, expand letters to digits (A=10..Z=35),
 * verify mod 97 == 1.
 */
export function iban_checksum(value: string): boolean {
  const upper = value.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(upper)) return false;
  const rearranged = upper.slice(4) + upper.slice(0, 4);
  let expanded = '';
  for (const c of rearranged) {
    if (c >= '0' && c <= '9') expanded += c;
    else expanded += (c.charCodeAt(0) - 55).toString();
  }
  // Compute mod 97 over an arbitrary-length numeric string in chunks.
  let mod = 0;
  for (let i = 0; i < expanded.length; i += 7) {
    const chunk = `${mod}${expanded.slice(i, i + 7)}`;
    mod = Number(chunk) % 97;
  }
  return mod === 1;
}

export const CHECKSUM_FNS: Record<string, (value: string) => boolean> = {
  gstin_checksum,
  iban_checksum,
};
