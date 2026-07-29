import { describe, expect, it } from 'vitest';
import { formatAnalyticalNumber } from '../src/core/number-display.ts';

describe('analytical number display', () => {
  it('hides binary floating-point tails without changing the exact value', () => {
    const display = formatAnalyticalNumber(0.1 + 0.2, null, 'en-US');
    expect(display).toEqual({ text: '0.3', exact: '0.30000000000000004' });
  });

  it('uses two display decimals for monetary semantic types', () => {
    const display = formatAnalyticalNumber(1234.567, 'transaction_amount', 'en-US');
    expect(display).toEqual({ text: '1,234.57', exact: '1234.567' });
  });

  it('groups big integers without coercing them through Number', () => {
    const display = formatAnalyticalNumber(9007199254740993n, null, 'en-US');
    expect(display).toEqual({
      text: '9,007,199,254,740,993',
      exact: '9007199254740993',
    });
  });
});
