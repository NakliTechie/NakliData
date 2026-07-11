// Tier-1 taxonomy slice — geography / marketplace / sample-dataset roles and
// their report templates. Loads the REAL taxonomy/v0.1 bundle (so this also
// validates the shipped types.jsonl parses) and asserts that Airbnb- and
// Titanic-shaped columns classify to the new roles, plus that the matching
// report templates surface. Fixtures mirror the real public datasets from the
// 2026-07-05 real-data pass (NYC Airbnb 2019, Titanic).
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

describe('Tier-1 taxonomy — geography', () => {
  it('classifies latitude / longitude by header + numeric range', () => {
    expect(top('latitude', ['40.75', '40.68', '40.80'], 'DOUBLE')).toBe('latitude');
    expect(top('longitude', ['-73.98', '-73.94', '-73.95'], 'DOUBLE')).toBe('longitude');
  });
  it('does NOT call an out-of-range column latitude', () => {
    // A column headed "lat" but full of 0..1000 values is not a latitude.
    expect(top('lat', ['500', '820', '999'], 'DOUBLE')).not.toBe('latitude');
  });
  it('classifies city / state_region / district / postal / address', () => {
    expect(top('neighbourhood_group', ['Brooklyn', 'Manhattan', 'Queens'])).toBe('state_region');
    expect(top('city', ['Mumbai', 'Delhi', 'Pune'])).toBe('city');
    expect(top('neighbourhood', ['Kensington', 'Midtown', 'Astoria'])).toBe(
      'district_neighbourhood',
    );
    expect(top('zipcode', ['10001', '11201', '10453'])).toBe('postal_code');
    expect(top('address', ['12 Main St', '9 Elm Ave', '77 Oak Rd'])).toBe('address_line');
  });
  it('address_line is flagged PII', () => {
    const addr = BUNDLE.types.find((t) => t.id === 'address_line');
    expect(addr?.sensitivity).toBe('pii');
  });
});

describe('Tier-1 taxonomy — marketplace (Airbnb)', () => {
  it('classifies room_type by value set', () => {
    expect(top('room_type', ['Entire home/apt', 'Private room', 'Shared room'])).toBe('room_type');
  });
  it('classifies availability / reviews / minimum stay', () => {
    expect(top('availability_365', ['365', '120', '0'], 'INTEGER')).toBe('availability_days');
    expect(top('number_of_reviews', ['9', '45', '0'], 'INTEGER')).toBe('review_count');
    expect(top('minimum_nights', ['1', '3', '30'], 'INTEGER')).toBe('minimum_stay');
    expect(top('reviews_per_month', ['0.21', '1.5', '3.2'], 'DOUBLE')).toBe('reviews_per_period');
    expect(top('host_id', ['2787', '2845', '4632'], 'BIGINT')).toBe('host_id');
  });
});

describe('Tier-1 taxonomy — sample datasets (Titanic)', () => {
  it('classifies survival / class / sex / age / fare / embarked', () => {
    expect(top('survived', ['0', '1', '1', '0'], 'INTEGER')).toBe('survival_flag');
    expect(top('pclass', ['3', '1', '2', '3'], 'INTEGER')).toBe('passenger_class');
    expect(top('sex', ['male', 'female', 'male'])).toBe('sex_gender');
    expect(top('age', ['22', '38', '26', '35'], 'DOUBLE')).toBe('age_years');
    expect(top('fare', ['7.25', '71.28', '8.05'], 'DOUBLE')).toBe('fare_amount');
    expect(top('embarked', ['S', 'C', 'Q', 'S'])).toBe('embarkation_port');
  });
  it('sex_gender is flagged PII', () => {
    expect(BUNDLE.types.find((t) => t.id === 'sex_gender')?.sensitivity).toBe('pii');
  });
});

describe('Tier-1 report templates surface for matching roles', () => {
  const byType = (ids: string[]): Record<string, ColumnRef> =>
    Object.fromEntries(ids.map((id) => [id, { table: 'listings', column: id }]));
  const ids = (present: string[]): string[] =>
    findApplicableTemplates(ALL_TEMPLATES, byType(present)).map((a) => a.template.id);

  it('marketplace_supply surfaces when room_type + amount present', () => {
    expect(ids(['room_type', 'amount', 'state_region'])).toContain('marketplace_supply');
  });
  it('outcome_comparison surfaces when survival_flag + passenger_class present', () => {
    expect(ids(['survival_flag', 'passenger_class', 'sex_gender'])).toContain('outcome_comparison');
  });
  it('geo_distribution surfaces when state_region present', () => {
    expect(ids(['state_region', 'amount'])).toContain('geo_distribution');
  });
  it('none of the Tier-1 templates surface for a bare finance workbook', () => {
    const got = ids(['gstin', 'amount']);
    expect(got).not.toContain('marketplace_supply');
    expect(got).not.toContain('outcome_comparison');
    expect(got).not.toContain('geo_distribution');
  });
});
