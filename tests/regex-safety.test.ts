import { describe, expect, it } from 'vitest';
import { validateSafeRegexPattern } from '../src/core/regex-safety.ts';

describe('validateSafeRegexPattern', () => {
  it('accepts bounded user-type patterns', () => {
    expect(validateSafeRegexPattern('^EMP-[0-9]{4}$')).toEqual({ safe: true });
    expect(validateSafeRegexPattern('^(?:yes|no)$')).toEqual({ safe: true });
  });

  it.each([
    ['nested quantifier', '^(a+)+$'],
    ['repeated alternation', '^(a|aa)+$'],
    ['backreference', '^(a+)\\1$'],
    ['lookbehind', '(?<=EMP-)\\d+'],
  ])('rejects %s patterns', (_name, pattern) => {
    expect(validateSafeRegexPattern(pattern)).toMatchObject({ safe: false });
  });

  it('rejects invalid and oversized patterns', () => {
    expect(validateSafeRegexPattern('[invalid(')).toMatchObject({ safe: false });
    expect(validateSafeRegexPattern(`^${'a'.repeat(257)}$`)).toMatchObject({ safe: false });
  });
});
