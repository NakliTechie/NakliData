import { describe, expect, it } from 'vitest';
import { gstin_checksum, iban_checksum } from '../src/taxonomy/checksums.ts';

describe('gstin_checksum', () => {
  it('accepts known-valid GSTINs', () => {
    // GSTINs produced by our deterministic generator with the same algorithm.
    expect(gstin_checksum('29HBHZW6406C1ZR')).toBe(true);
    expect(gstin_checksum('29AAACI4775H1ZA')).toBe(true);
  });

  it('rejects a wrong-length string', () => {
    expect(gstin_checksum('29HBHZW6406C1Z')).toBe(false);
    expect(gstin_checksum('29HBHZW6406C1ZRX')).toBe(false);
  });

  it('rejects invalid characters', () => {
    expect(gstin_checksum('29HBHZW64$6C1ZR')).toBe(false);
  });

  it('rejects a flipped-check-digit GSTIN', () => {
    expect(gstin_checksum('29HBHZW6406C1ZA')).toBe(false);
  });
});

describe('iban_checksum', () => {
  it('accepts a known-valid IBAN', () => {
    expect(iban_checksum('GB82WEST12345698765432')).toBe(true);
    expect(iban_checksum('DE89370400440532013000')).toBe(true);
  });

  it('rejects mutated check digits', () => {
    expect(iban_checksum('GB83WEST12345698765432')).toBe(false);
  });

  it('rejects malformed input', () => {
    expect(iban_checksum('XX')).toBe(false);
    expect(iban_checksum('GB82-WEST!!!')).toBe(false);
  });
});
