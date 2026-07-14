// G-series vertical domain packs (real-estate / education / healthcare / …).
// Same shape as taxonomy-tier1: loads the REAL taxonomy/v0.1 bundle (so this
// also validates the shipped types.jsonl parses) and asserts that domain-shaped
// columns classify to the new roles and that the matching report templates
// surface. Data-only packs — no engine changes; all assertions are headless.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyColumn } from '../src/taxonomy/classify.ts';
import type { ColumnSample, TaxonomyBundle, TypeSpec } from '../src/taxonomy/types.ts';
import {
  ALL_TEMPLATES,
  type ColumnRef,
  findApplicableTemplates,
} from '../src/ui/templates/templates.ts';

const BASE = join(process.cwd(), 'taxonomy', 'v0.1');

function loadBundle(): TaxonomyBundle {
  const types: TypeSpec[] = readFileSync(join(BASE, 'types.jsonl'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as TypeSpec);
  return { version: '0.1', released: '2026-05-15', domains: [], types };
}
const BUNDLE = loadBundle();

function sample(columnName: string, values: string[], sqlType = 'VARCHAR'): ColumnSample {
  return {
    tableName: 't',
    columnName,
    sqlType,
    values,
    totalSampled: values.length,
    nullCount: 0,
    distinctCount: new Set(values).size,
  };
}
const top = (name: string, values: string[], sqlType?: string): string | null =>
  classifyColumn(BUNDLE, sample(name, values, sqlType)).candidates[0]?.typeId ?? null;

const byType = (ids: string[]): Record<string, ColumnRef> =>
  Object.fromEntries(ids.map((id) => [id, { table: 'listings', column: id }]));
const templateIds = (present: string[]): string[] =>
  findApplicableTemplates(ALL_TEMPLATES, byType(present)).map((a) => a.template.id);

describe('G1 — real-estate domain pack', () => {
  it('classifies property_type / bedrooms / bathrooms / square_feet / sale_price', () => {
    expect(top('property_type', ['Apartment', 'Villa', 'Studio'])).toBe('property_type');
    expect(top('bedrooms', ['2', '3', '1'], 'INTEGER')).toBe('bedrooms');
    expect(top('bathrooms', ['1', '2', '2'], 'INTEGER')).toBe('bathrooms');
    expect(top('area_sqft', ['1200', '850', '2400'], 'INTEGER')).toBe('square_feet');
    expect(top('sale_price', ['450000', '620000', '310000'], 'BIGINT')).toBe('sale_price');
  });
  it('sale_price is marked financial', () => {
    expect(BUNDLE.types.find((t) => t.id === 'sale_price')?.sensitivity).toBe('financial');
  });
  it('does NOT hijack a bare "price" column as sale_price', () => {
    // sale_price deliberately omits bare "price" to avoid marketplace/retail collisions.
    expect(top('price', ['120', '95', '150'], 'INTEGER')).not.toBe('sale_price');
  });
  it('real_estate_inventory surfaces when property_type + sale_price present', () => {
    expect(templateIds(['property_type', 'sale_price', 'square_feet'])).toContain(
      'real_estate_inventory',
    );
  });
  it('real_estate_inventory does NOT surface for a bare finance workbook', () => {
    expect(templateIds(['gstin', 'amount'])).not.toContain('real_estate_inventory');
  });
});
