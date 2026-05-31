// W6.1 — Input cell SQL-literal coercion. The reference-resolution
// path in Notebook.rewriteReferences calls this helper for every
// `@<input-name>` it spots in user SQL. The literal forms must be
// DuckDB-parseable; this test locks in the contract.

import { describe, expect, it } from 'vitest';
import { inputAsSqlLiteral } from '../src/ui/cells/input-cell.ts';
import type { InputCellState } from '../src/ui/cells/types.ts';

const base = {
  id: 'c1',
  kind: 'input' as const,
  order: 0,
  name: 'x',
  label: null,
  options: [] as string[],
};

describe('inputAsSqlLiteral', () => {
  it('text: quotes and escapes internal single quotes', () => {
    expect(inputAsSqlLiteral({ ...base, inputType: 'text', value: 'hello' })).toBe("'hello'");
    expect(inputAsSqlLiteral({ ...base, inputType: 'text', value: "it's" })).toBe("'it''s'");
    expect(inputAsSqlLiteral({ ...base, inputType: 'text', value: '' })).toBe("''");
  });

  it('number: emits raw numeric literal, NULL for invalid', () => {
    expect(inputAsSqlLiteral({ ...base, inputType: 'number', value: '42' })).toBe('42');
    expect(inputAsSqlLiteral({ ...base, inputType: 'number', value: '3.14' })).toBe('3.14');
    expect(inputAsSqlLiteral({ ...base, inputType: 'number', value: '-7.5' })).toBe('-7.5');
    expect(inputAsSqlLiteral({ ...base, inputType: 'number', value: 'abc' })).toBe('NULL');
    expect(inputAsSqlLiteral({ ...base, inputType: 'number', value: '' })).toBe('NULL');
  });

  it('date: emits DuckDB DATE literal, NULL for empty', () => {
    expect(inputAsSqlLiteral({ ...base, inputType: 'date', value: '2026-05-31' })).toBe(
      "DATE '2026-05-31'",
    );
    expect(inputAsSqlLiteral({ ...base, inputType: 'date', value: '' })).toBe('NULL');
    expect(inputAsSqlLiteral({ ...base, inputType: 'date', value: '   ' })).toBe('NULL');
  });

  it('select: same as text (quoted)', () => {
    const cell: InputCellState = {
      ...base,
      inputType: 'select',
      value: 'purchase',
      options: ['page_view', 'add_to_cart', 'purchase'],
    };
    expect(inputAsSqlLiteral(cell)).toBe("'purchase'");
  });

  it('text: SQL-injection protection — runtime cannot inject via value', () => {
    // A literal SQL injection attempt — the quote-doubling closes it
    // off so the result stays a single string literal.
    const cell: InputCellState = {
      ...base,
      inputType: 'text',
      value: "x'; DROP TABLE invoices; --",
    };
    expect(inputAsSqlLiteral(cell)).toBe("'x''; DROP TABLE invoices; --'");
    // The result is a string literal containing the attacker's text
    // verbatim — when used in `WHERE col = @x`, DuckDB sees one
    // string parameter, not three statements.
  });
});
