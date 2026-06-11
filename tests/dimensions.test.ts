// v1.4 F1 — Named dimensions tests.
//
// Covers the dimension validators + store round-trip, and the DIM(name)
// expansion path added to expandMeasures (incl. cross-references with
// MEASURE and back-compat for measures-only callers).

import { describe, expect, it } from 'vitest';
import {
  DimensionsStore,
  emptyDimensionsFile,
  validateDimensionExpression,
  validateDimensionName,
  validateDimensionsFile,
} from '../src/core/dimensions.ts';
import { type MeasureDefinition, expandMeasures } from '../src/core/measures.ts';

const measure = (name: string, expression: string): MeasureDefinition => ({
  name,
  expression,
  format: 'number',
  description: '',
  version: 1,
});
const dim = (name: string, expression: string) => ({
  name,
  expression,
  description: '',
  version: 1 as const,
});

describe('dimension validators', () => {
  it('accepts a snake_case name, rejects others', () => {
    expect(validateDimensionName('gstin_state')).toBeNull();
    expect(validateDimensionName('Bad Name')).toMatch(/snake_case/);
    expect(validateDimensionName('')).toMatch(/required/);
  });

  it('rejects DDL keywords + semicolons in the expression (shared guard)', () => {
    expect(validateDimensionExpression('substr(gstin, 1, 2)')).toBeNull();
    expect(validateDimensionExpression('1; DROP TABLE x')).toMatch(/semicolon/i);
    expect(validateDimensionExpression('')).toMatch(/required/);
  });

  it('validateDimensionsFile flags duplicates', () => {
    const errs = validateDimensionsFile({
      version: 1,
      dimensions: [dim('a', '1'), dim('a', '2')],
    });
    expect(errs.some((e) => /duplicate/.test(e))).toBe(true);
  });
});

describe('DimensionsStore', () => {
  it('set / get / list / remove', () => {
    const s = new DimensionsStore();
    s.set(dim('month', "date_trunc('month', ts)"));
    expect(s.get('month')?.expression).toBe("date_trunc('month', ts)");
    expect(s.list()).toHaveLength(1);
    s.remove('month');
    expect(s.list()).toEqual([]);
  });

  it('round-trips through toFile / loadFromFile', () => {
    const s = new DimensionsStore();
    s.set(dim('month', "date_trunc('month', ts)"));
    s.set(dim('state', 'substr(gstin, 1, 2)'));
    const t = new DimensionsStore();
    t.loadFromFile(s.toFile());
    expect(t.list()).toHaveLength(2);
    expect(t.get('state')?.expression).toBe('substr(gstin, 1, 2)');
  });

  it('emptyDimensionsFile is a valid v1 file', () => {
    expect(emptyDimensionsFile()).toEqual({ version: 1, dimensions: [] });
  });
});

describe('expandMeasures — DIM(name) expansion (F1)', () => {
  const measures = new Map([['revenue', measure('revenue', 'SUM(amount)')]]);
  const dims = new Map([['state', dim('state', 'substr(gstin, 1, 2)')]]);

  it('expands a DIM call', () => {
    const r = expandMeasures('SELECT DIM(state) FROM invoices GROUP BY 1', measures, dims);
    expect(r.sql).toBe('SELECT (substr(gstin, 1, 2)) FROM invoices GROUP BY 1');
    expect(r.unknownDimensions).toEqual([]);
  });

  it('expands MEASURE + DIM together', () => {
    const r = expandMeasures(
      'SELECT DIM(state), MEASURE(revenue) FROM invoices GROUP BY 1',
      measures,
      dims,
    );
    expect(r.sql).toBe('SELECT (substr(gstin, 1, 2)), (SUM(amount)) FROM invoices GROUP BY 1');
  });

  it('flags an unknown dimension + substitutes NULL', () => {
    const r = expandMeasures('SELECT DIM(ghost) FROM x', measures, dims);
    expect(r.unknownDimensions).toEqual(['ghost']);
    expect(r.sql).toBe('SELECT NULL FROM x');
  });

  it('cross-references: a measure body referencing a DIM expands both', () => {
    const m = new Map([
      ['per_state', measure('per_state', 'SUM(amount) / COUNT(DISTINCT DIM(state))')],
    ]);
    const r = expandMeasures('SELECT MEASURE(per_state) FROM x', m, dims);
    expect(r.sql).toBe('SELECT (SUM(amount) / COUNT(DISTINCT (substr(gstin, 1, 2)))) FROM x');
  });

  it('back-compat: measures-only call (no dims arg) still works + reports empty unknownDimensions', () => {
    const r = expandMeasures('SELECT MEASURE(revenue) FROM x', measures);
    expect(r.sql).toBe('SELECT (SUM(amount)) FROM x');
    expect(r.unknownDimensions).toEqual([]);
  });
});
