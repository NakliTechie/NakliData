// v1.4 F4/F5 — calculated/derived field tests.

import { describe, expect, it } from 'vitest';
import {
  emitCalculatedField,
  emitWindowExpression,
  validateCalcAlias,
  validateCalcExpression,
} from '../src/core/calc-field.ts';

describe('validateCalcAlias / validateCalcExpression', () => {
  it('requires an alias, caps length', () => {
    expect(validateCalcAlias('')).toMatch(/required/);
    expect(validateCalcAlias('margin')).toBeNull();
    expect(validateCalcAlias('x'.repeat(65))).toMatch(/64/);
  });
  it('rejects DDL / semicolons in the expression', () => {
    expect(validateCalcExpression('cgst + sgst')).toBeNull();
    expect(validateCalcExpression('1; DROP TABLE x')).toMatch(/semicolon/i);
  });
});

describe('emitCalculatedField (F4)', () => {
  it('wraps the upstream as a subquery + appends the derived column', () => {
    const sql = emitCalculatedField('SELECT * FROM invoices', 'tax_total', 'cgst + sgst + igst');
    expect(sql).toBe(
      'SELECT *, (cgst + sgst + igst) AS "tax_total"\nFROM (\nSELECT * FROM invoices\n) AS calc_src',
    );
  });

  it('quotes a hostile alias safely', () => {
    const sql = emitCalculatedField('SELECT 1', 'we"ird', 'amount * 2');
    expect(sql).toContain('AS "we""ird"');
  });

  it('strips a trailing semicolon from the upstream', () => {
    const sql = emitCalculatedField('SELECT * FROM t;', 'x', '1');
    expect(sql).toContain('FROM (\nSELECT * FROM t\n) AS calc_src');
    expect(sql).not.toContain(';');
  });

  it('throws on an invalid alias or expression', () => {
    expect(() => emitCalculatedField('SELECT 1', '', '1')).toThrow(/required/);
    expect(() => emitCalculatedField('SELECT 1', 'a', 'DROP TABLE x')).toThrow(
      /forbidden|keyword/i,
    );
  });
});

describe('emitWindowExpression (F5 — LOD-style)', () => {
  it('builds a partitioned window aggregate with quoted identifiers', () => {
    expect(emitWindowExpression('SUM', 'amount', ['vendor_name'])).toBe(
      'SUM("amount") OVER (PARTITION BY "vendor_name")',
    );
  });
  it('multi-column partition', () => {
    expect(emitWindowExpression('AVG', 'amt', ['region', 'month'])).toBe(
      'AVG("amt") OVER (PARTITION BY "region", "month")',
    );
  });
  it('empty partition → whole-result window', () => {
    expect(emitWindowExpression('COUNT', 'id', [])).toBe('COUNT("id") OVER ()');
  });
  it('rejects a non-allowlisted function', () => {
    // @ts-expect-error — exercising the runtime guard
    expect(() => emitWindowExpression('DROP', 'x', [])).toThrow(/Invalid window/);
  });

  it('composes with emitCalculatedField', () => {
    const expr = emitWindowExpression('SUM', 'total_amount', ['vendor_name']);
    const sql = emitCalculatedField('SELECT * FROM invoices', 'vendor_running', expr);
    expect(sql).toContain('SUM("total_amount") OVER (PARTITION BY "vendor_name")');
    expect(sql).toContain('AS "vendor_running"');
  });
});
