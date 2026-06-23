// Resolve track M2 — Segment primitive tests.
//
// A segment is a named WHERE predicate referenced via SEGMENT(name), expanded
// at the same single point as MEASURE/DIM. Covers: name + predicate validation
// (reuses the measure keyword guard), the store round-trip, and the SEGMENT
// expansion through `expandMeasures` (including nesting with DIM/MEASURE and the
// unknown-segment path).

import { describe, expect, it } from 'vitest';
import type { MeasureDefinition } from '../src/core/measures.ts';
import { expandMeasures } from '../src/core/measures.ts';
import {
  SegmentsStore,
  findReferencedSegments,
  validateSegmentExpression,
  validateSegmentName,
  validateSegmentsFile,
} from '../src/core/segments.ts';

const frag = (name: string, expression: string) => ({ name, expression });
const segMap = (...entries: Array<{ name: string; expression: string }>) =>
  new Map(entries.map((e) => [e.name, e]));
const noMeasures = new Map<string, MeasureDefinition>();

// ── validation ───────────────────────────────────────────────────────────

describe('validateSegmentName', () => {
  it('accepts snake_case', () => {
    expect(validateSegmentName('high_value_lapsed')).toBeNull();
  });
  it('rejects non-snake_case + empty + over-long', () => {
    expect(validateSegmentName('')).toMatch(/required/);
    expect(validateSegmentName('High Value')).toMatch(/snake_case/);
    expect(validateSegmentName('1abc')).toMatch(/snake_case/);
    expect(validateSegmentName('a'.repeat(65))).toMatch(/64/);
  });
});

describe('validateSegmentExpression (shares the measure keyword guard)', () => {
  it('accepts a boolean predicate', () => {
    expect(
      validateSegmentExpression("total_amount > 100000 AND last_seen < '2026-01-01'"),
    ).toBeNull();
  });
  it('rejects semicolons + DDL/DML keywords', () => {
    expect(validateSegmentExpression('amount > 1; DROP TABLE t')).toMatch(/semicolon/);
    expect(validateSegmentExpression('amount > 1 OR DELETE')).toMatch(/forbidden keyword/);
  });
  it('does not false-trip on a keyword inside a string literal', () => {
    expect(validateSegmentExpression("status = 'DELETED'")).toBeNull();
  });
});

describe('findReferencedSegments', () => {
  it('finds SEGMENT(name) references, deduped', () => {
    expect(
      findReferencedSegments('SELECT * FROM t WHERE SEGMENT(a) OR SEGMENT(b) OR SEGMENT(a)').sort(),
    ).toEqual(['a', 'b']);
  });
  it('returns [] when there are none', () => {
    expect(findReferencedSegments('SELECT 1')).toEqual([]);
  });
});

describe('validateSegmentsFile', () => {
  it('flags duplicate names and bad expressions', () => {
    const errors = validateSegmentsFile({
      version: 1,
      segments: [
        { name: 'a', expression: 'x > 1', description: '', version: 1 },
        { name: 'a', expression: 'x > 2', description: '', version: 1 },
        { name: 'bad', expression: 'x > 1; DROP TABLE t', description: '', version: 1 },
      ],
    });
    expect(errors.some((e) => /duplicate/.test(e))).toBe(true);
    expect(errors.some((e) => /semicolon/.test(e))).toBe(true);
  });
});

// ── store ────────────────────────────────────────────────────────────────

describe('SegmentsStore', () => {
  it('set / get / list (sorted) / remove / toFile round-trip', () => {
    const s = new SegmentsStore();
    s.set({ name: 'b_seg', expression: 'x > 2', description: '', version: 1 });
    s.set({ name: 'a_seg', expression: 'x > 1', description: 'first', version: 1 });
    expect(s.list().map((d) => d.name)).toEqual(['a_seg', 'b_seg']); // localeCompare sort
    expect(s.get('a_seg')?.expression).toBe('x > 1');
    const file = s.toFile();
    expect(file.segments).toHaveLength(2);

    const s2 = new SegmentsStore();
    s2.loadFromFile(file);
    expect(s2.list().map((d) => d.name)).toEqual(['a_seg', 'b_seg']);
    s2.remove('a_seg');
    expect(s2.get('a_seg')).toBeUndefined();
    expect(s2.list()).toHaveLength(1);
  });

  it('loadFromFile(undefined) clears the store (pre-M2 file)', () => {
    const s = new SegmentsStore();
    s.set({ name: 'x', expression: 'y > 1', description: '', version: 1 });
    s.loadFromFile(undefined);
    expect(s.list()).toHaveLength(0);
  });

  it('rejects an invalid name on set', () => {
    const s = new SegmentsStore();
    expect(() =>
      s.set({ name: 'Bad Name', expression: 'x', description: '', version: 1 }),
    ).toThrow();
  });
});

// ── expansion (the integration) ────────────────────────────────────────────

describe('expandMeasures — SEGMENT(name)', () => {
  it('expands a segment into a parenthesized predicate', () => {
    const out = expandMeasures(
      'SELECT * FROM invoices WHERE SEGMENT(high_value)',
      noMeasures,
      undefined,
      segMap(frag('high_value', "total_amount > 100000 AND last_seen < '2026-01-01'")),
    );
    expect(out.sql).toBe(
      "SELECT * FROM invoices WHERE (total_amount > 100000 AND last_seen < '2026-01-01')",
    );
    expect(out.unknownSegments).toEqual([]);
  });

  it('reports an unknown segment and substitutes FALSE to keep the SQL well-formed', () => {
    const out = expandMeasures('SELECT * FROM t WHERE SEGMENT(missing)', noMeasures);
    expect(out.unknownSegments).toEqual(['missing']);
    expect(out.sql).toBe('SELECT * FROM t WHERE FALSE');
  });

  it('nests with DIM (a segment predicate that references a dimension)', () => {
    const out = expandMeasures(
      'SELECT * FROM t WHERE SEGMENT(north)',
      noMeasures,
      segMap(frag('region', 'substr(gstin, 1, 2)')),
      segMap(frag('north', "DIM(region) = 'NN'")),
    );
    expect(out.sql).toBe("SELECT * FROM t WHERE ((substr(gstin, 1, 2)) = 'NN')");
    expect(out.unknownSegments).toEqual([]);
    expect(out.unknownDimensions).toEqual([]);
  });

  it('expands MEASURE + DIM + SEGMENT together in one query', () => {
    const measures = new Map<string, MeasureDefinition>([
      [
        'revenue',
        {
          name: 'revenue',
          expression: 'SUM(amount)',
          format: 'number',
          description: '',
          version: 1,
        },
      ],
    ]);
    const out = expandMeasures(
      'SELECT DIM(month), MEASURE(revenue) FROM t WHERE SEGMENT(big) GROUP BY 1',
      measures,
      segMap(frag('month', "date_trunc('month', ts)")),
      segMap(frag('big', 'amount > 1000')),
    );
    expect(out.sql).toBe(
      "SELECT (date_trunc('month', ts)), (SUM(amount)) FROM t WHERE (amount > 1000) GROUP BY 1",
    );
  });

  it('leaves SQL untouched when there is no macro', () => {
    const out = expandMeasures('SELECT 1', noMeasures);
    expect(out.sql).toBe('SELECT 1');
    expect(out.unknownSegments).toEqual([]);
  });
});
