import { describe, expect, it } from 'vitest';
import { humanizeEvidence } from '../src/core/evidence-labels.ts';

describe('classification evidence labels', () => {
  it('translates header and format detectors while preserving technical detail', () => {
    expect(humanizeEvidence('header == "total_amount"')).toEqual({
      summary: 'Column name exactly matches “total_amount”.',
      technical: 'header == "total_amount"',
    });
    expect(humanizeEvidence('regex match 92% (23/25)').summary).toBe(
      '92% of sampled values match the expected format.',
    );
  });

  it('combines distribution signals into plain language', () => {
    const label = humanizeEvidence(
      'cardinality 96%, numeric 100% (25/25 non-blank), length∈[2,8] 84%',
    );
    expect(label.summary).toContain('96% distinct');
    expect(label.summary).toContain('100%');
    expect(label.summary).toContain('2–8 character length');
    expect(label.technical).toContain('length∈');
  });

  it('keeps unfamiliar evidence available without exposing it as the headline', () => {
    expect(humanizeEvidence('future-detector: score=1')).toEqual({
      summary: 'A classification detector found supporting evidence.',
      technical: 'future-detector: score=1',
    });
  });
});
