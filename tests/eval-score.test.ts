import { describe, expect, it } from 'vitest';
import { scoreDefineType, scoreDisambiguateType, scoreExplainError } from '../eval/score.ts';
import type {
  DefineTypeResponse,
  DisambiguateTypeResponse,
  ExplainErrorResponse,
} from '../src/core/sidecar/types.ts';

// The eval fixtures use all-passing recorded responses (so --dry-run is a
// clean harness self-test). The scorer's pass/fail DISCRIMINATION is
// verified here instead — both directions.

describe('scoreDisambiguateType', () => {
  const r = (typeId: string | null): DisambiguateTypeResponse => ({
    kind: 'disambiguate-type',
    typeId,
  });

  it('passes on exact typeId match', () => {
    expect(scoreDisambiguateType(r('gstin'), { typeId: 'gstin' })).toMatchObject({
      pass: true,
      score: 1,
    });
  });

  it('fails on wrong typeId', () => {
    expect(scoreDisambiguateType(r('pan'), { typeId: 'gstin' })).toMatchObject({
      pass: false,
      score: 0,
    });
  });

  it('passes when both are null (correct "unknown")', () => {
    expect(scoreDisambiguateType(r(null), { typeId: null })).toMatchObject({ pass: true });
  });

  it('fails when model says null but a type was expected', () => {
    expect(scoreDisambiguateType(r(null), { typeId: 'gstin' })).toMatchObject({ pass: false });
  });
});

describe('scoreDefineType', () => {
  const r = (category: string, regex: string, id = 'x'): DefineTypeResponse => ({
    kind: 'define-type',
    suggestion: { id, display_name: 'X', category, regex },
  });

  it('passes when category matches and regex matches all samples', () => {
    const res = scoreDefineType(
      r('Identifier', '^E[0-9]{4}$', 'employee_id'),
      { category: 'Identifier', regexMatchesSamples: true, idLike: 'employee' },
      ['E0001', 'E0042'],
    );
    expect(res.pass).toBe(true);
    expect(res.score).toBeCloseTo(1, 5);
  });

  it('category compare is case-insensitive', () => {
    const res = scoreDefineType(
      r('identifier', '^E[0-9]{4}$'),
      { category: 'Identifier', regexMatchesSamples: true },
      ['E0001'],
    );
    expect(res.pass).toBe(true);
  });

  it('fails when the regex does not match every sample', () => {
    const res = scoreDefineType(
      r('Identifier', '^E[0-9]{3}$'), // 3 digits, samples have 4
      { category: 'Identifier', regexMatchesSamples: true },
      ['E0001', 'E0042'],
    );
    expect(res.pass).toBe(false);
    expect(res.detail).toContain('misses');
  });

  it('fails when the regex does not compile', () => {
    const res = scoreDefineType(
      r('Identifier', '^E[0-9'), // unterminated class
      { category: 'Identifier', regexMatchesSamples: true },
      ['E0001'],
    );
    expect(res.pass).toBe(false);
    expect(res.detail).toContain('does not compile');
  });

  it('fails on wrong category even when regex is fine', () => {
    const res = scoreDefineType(
      r('Code', '^E[0-9]{4}$'),
      { category: 'Identifier', regexMatchesSamples: true },
      ['E0001'],
    );
    expect(res.pass).toBe(false);
  });

  it('does not require a regex when regexMatchesSamples is false', () => {
    const res = scoreDefineType(
      r('Domain-specific', '.*'),
      { category: 'Domain-specific', regexMatchesSamples: false },
      ['anything'],
    );
    expect(res.pass).toBe(true);
  });
});

describe('scoreExplainError', () => {
  const r = (explanation: string, suggestedFix: string | null): ExplainErrorResponse => ({
    kind: 'explain-error',
    explanation,
    suggestedFix,
  });

  it('passes with full keyword coverage and a matching fix', () => {
    const res = scoreExplainError(
      r("The table 'vendrs' is a typo for 'vendors'.", 'SELECT * FROM vendors'),
      { keywords: ['vendrs', 'vendors', 'typo'], suggestedFixContains: 'vendors' },
    );
    expect(res.pass).toBe(true);
    expect(res.score).toBeCloseTo(1, 5);
  });

  it('fails when keyword coverage is below 50%', () => {
    const res = scoreExplainError(
      r('Something is off near the end of your query.', 'SELECT * FROM vendors'),
      { keywords: ['vendrs', 'vendors', 'typo'], suggestedFixContains: 'vendors' },
    );
    expect(res.pass).toBe(false);
  });

  it('passes when fix is correctly null and coverage is met', () => {
    const res = scoreExplainError(r('Add an explicit cast between number and text.', null), {
      keywords: ['number', 'text', 'cast'],
      suggestedFixContains: null,
    });
    expect(res.pass).toBe(true);
  });

  it('fails when a null fix was expected but the model returned one', () => {
    const res = scoreExplainError(r('Add an explicit cast between number and text.', 'SELECT 1'), {
      keywords: ['number', 'text', 'cast'],
      suggestedFixContains: null,
    });
    expect(res.pass).toBe(false);
  });

  it('fails when the expected fix substring is missing', () => {
    const res = scoreExplainError(
      r('Both tables have gstin; qualify the ambiguous reference.', 'SELECT gstin FROM x'),
      { keywords: ['ambiguous', 'gstin'], suggestedFixContains: 'vendors.gstin' },
    );
    expect(res.pass).toBe(false);
  });
});
