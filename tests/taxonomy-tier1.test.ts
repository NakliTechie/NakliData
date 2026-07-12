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
import { getQuickActions } from '../src/ui/quick-aggregations.ts';
import type { ColumnAssignment } from '../src/ui/schema-panel.ts';
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

// Real-data fixes from the 2026-07-12 Kaggle pass.
describe('Tier-1 fixes — country names + numeric-code noise', () => {
  it('classifies full country NAMES as country_name', () => {
    expect(top('country', ['United Kingdom', 'France', 'Germany', 'EIRE'])).toBe('country_name');
  });
  it('still classifies 2-letter country CODES as iso_country_code', () => {
    expect(top('country', ['US', 'GB', 'IN', 'DE'])).toBe('iso_country_code');
  });
  it('does NOT mislabel a headerless 6-digit code column (invoice no) as postal/pin', () => {
    // A 6-digit VARCHAR with no postal/pin header: regex-only weight (0.4) is
    // now below the floor, so the numeric-code types no longer fire on it.
    const t = top('invoice_no', ['536365', '536366', '536367', '536389']);
    expect(t).not.toBe('postal_code');
    expect(t).not.toBe('pin_code');
    expect(t).not.toBe('hsn_code');
  });
  it('still classifies a real postal_code column (zip header + 5-digit values)', () => {
    expect(top('zipcode', ['10001', '11201', '10453'])).toBe('postal_code');
  });
});

describe('Tier-1 fixes — flexible date detection', () => {
  it('classifies a US datetime column (InvoiceDate → iso_datetime)', () => {
    // "12/1/2010 8:26" matched the datetime regex, but the header now co-signals.
    expect(top('InvoiceDate', ['12/1/2010 8:26', '12/1/2010 8:28', '12/1/2010 8:34'])).toBe(
      'iso_datetime',
    );
  });
  it('classifies a textual-month date column (date_added → iso_date)', () => {
    expect(top('date_added', ['September 25, 2021', 'August 24, 2021', 'March 1, 2020'])).toBe(
      'iso_date',
    );
  });
  it('still classifies plain slash dates + ISO datetimes', () => {
    expect(top('order_date', ['12/1/2010', '1/3/2011', '5/9/2011'])).toBe('iso_date');
    expect(top('created_at', ['2010-12-01T08:26:00', '2011-01-03T09:00:00'])).toBe('iso_datetime');
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

describe('Retail domain pack (e-commerce)', () => {
  it('classifies sku / quantity / customer_id / order_id', () => {
    expect(top('StockCode', ['85123A', '71053', '84406B'])).toBe('sku');
    expect(top('Quantity', ['6', '8', '2', '32'], 'INTEGER')).toBe('quantity');
    expect(top('CustomerID', ['17850', '13047', '12583'], 'INTEGER')).toBe('customer_id');
    expect(top('order_no', ['536365', '536366', '536367'])).toBe('order_id');
  });
  it('customer_id is flagged PII', () => {
    expect(BUNDLE.types.find((t) => t.id === 'customer_id')?.sensitivity).toBe('pii');
  });
});

describe('Media domain pack (Netflix)', () => {
  it('classifies title / director / genre / release_year', () => {
    expect(top('title', ['Blood & Water', 'Ganglands', 'Midnight Mass'])).toBe('content_title');
    expect(top('director', ['Julien Leclercq', 'Mike Flanagan', 'Kate Herron'])).toBe(
      'credited_person',
    );
    expect(top('listed_in', ['Dramas, Thrillers', 'Crime TV Shows', 'TV Horror'])).toBe('genre');
    expect(top('release_year', ['2021', '2020', '1993'], 'INTEGER')).toBe('release_year');
  });
  it('classifies content_rating + media_type by value set (not by header alone)', () => {
    expect(top('rating', ['TV-MA', 'TV-14', 'PG-13', 'R'])).toBe('content_rating');
    expect(top('type', ['Movie', 'TV Show', 'Movie', 'TV Show'])).toBe('media_type');
  });
  it('does NOT call a numeric 1-5 rating a content_rating, nor a generic type column media_type', () => {
    expect(top('rating', ['4', '5', '3', '2'], 'INTEGER')).not.toBe('content_rating');
    expect(top('type', ['premium', 'basic', 'trial'])).not.toBe('media_type');
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
  it('retail_sales surfaces when quantity + amount present', () => {
    expect(ids(['quantity', 'amount', 'country_name'])).toContain('retail_sales');
  });
  it('content_catalog surfaces when release_year present', () => {
    expect(ids(['release_year', 'media_type', 'content_rating'])).toContain('content_catalog');
  });
  it('none of the Tier-1 templates surface for a bare finance workbook', () => {
    const got = ids(['gstin', 'amount']);
    expect(got).not.toContain('marketplace_supply');
    expect(got).not.toContain('outcome_comparison');
    expect(got).not.toContain('geo_distribution');
  });
  it('amount_summary (generic fallback) surfaces for any amount-bearing dataset', () => {
    expect(ids(['amount'])).toContain('amount_summary');
    expect(ids(['room_type'])).not.toContain('amount_summary');
  });
});

describe('Tier-1 deterministic quick charts (no BYOK)', () => {
  const assign = (columnName: string, typeId: string): ColumnAssignment => ({
    columnName,
    sqlType: 'VARCHAR',
    candidates: [],
    resolution: { kind: 'auto_accept' },
    assigned: { typeId, origin: 'detector', confidence: 1 },
    status: 'classified',
  });
  const labels = (target: ColumnAssignment, partners: Array<{ column: string; typeId: string }>) =>
    getQuickActions(
      target,
      't',
      partners.map((p) => ({ column: p.column, typeId: p.typeId })),
    ).map((a) => a.label);

  it('numeric metrics (fare_amount) get sum-by-category + distribution', () => {
    const got = labels(assign('fare', 'fare_amount'), [
      { column: 'pclass', typeId: 'passenger_class' },
    ]);
    expect(got).toContain('Sum fare by pclass');
    expect(got.some((l) => l.includes('Distribution'))).toBe(true);
  });
  it('new categoricals (room_type) get count-by', () => {
    expect(labels(assign('room_type', 'room_type'), [])).toContain('Count by room_type');
  });
  it('survival_flag gets an outcome-rate-by-category action', () => {
    const got = labels(assign('survived', 'survival_flag'), [
      { column: 'sex', typeId: 'sex_gender' },
    ]);
    expect(got).toContain('survived rate by sex');
  });
  it('last_review_date gets count-over-time', () => {
    expect(labels(assign('last_review', 'last_review_date'), [])).toContain(
      'Count over time (daily)',
    );
  });
});
