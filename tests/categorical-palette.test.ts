// core/categorical-palette — shared Facet categorical colour assignment.

import { describe, expect, it } from 'vitest';
import { CATEGORICAL_RGB, assignCategoryColors, rgbCss } from '../src/core/categorical-palette.ts';

describe('assignCategoryColors', () => {
  it('assigns palette colours in first-appearance order', () => {
    const m = assignCategoryColors(['b', 'a', 'b', 'c']);
    expect(m.get('b')).toEqual(CATEGORICAL_RGB[0]);
    expect(m.get('a')).toEqual(CATEGORICAL_RGB[1]);
    expect(m.get('c')).toEqual(CATEGORICAL_RGB[2]);
    expect(m.size).toBe(3);
  });

  it('skips null / undefined / empty values', () => {
    const m = assignCategoryColors(['a', null, '', undefined, 'a', 'b']);
    expect(m.size).toBe(2);
    expect(m.get('a')).toEqual(CATEGORICAL_RGB[0]);
    expect(m.get('b')).toEqual(CATEGORICAL_RGB[1]);
  });

  it('cycles the palette past its length', () => {
    const values = Array.from({ length: CATEGORICAL_RGB.length + 2 }, (_, i) => `v${i}`);
    const m = assignCategoryColors(values);
    expect(m.get('v0')).toEqual(CATEGORICAL_RGB[0]);
    expect(m.get(`v${CATEGORICAL_RGB.length}`)).toEqual(CATEGORICAL_RGB[0]); // wrapped
    expect(m.get(`v${CATEGORICAL_RGB.length + 1}`)).toEqual(CATEGORICAL_RGB[1]);
  });

  it('is deterministic for the same input order', () => {
    const a = assignCategoryColors(['x', 'y', 'z']);
    const b = assignCategoryColors(['x', 'y', 'z']);
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it('rgbCss renders a css rgb() string', () => {
    expect(rgbCss([1, 2, 3])).toBe('rgb(1, 2, 3)');
  });
});
