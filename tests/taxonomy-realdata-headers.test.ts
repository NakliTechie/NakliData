// Real-world header shapes (2026-07-25). Reproduces the classification gaps the
// real-data drive measured on 3.5M rows of public data — see
// plan/realdata-findings-2026-07-25.md. Only 21/67 columns classified, and the
// safety-relevant miss was `doctor_name` / `patientid` in a clinical table
// staying `public` (hence UNREDACTED).
//
// The root cause was not missing patterns: `tokenize()` lowercased before
// splitting, so a header with NO separator (`patientid`) or camelCase
// (`MonthlyIncome`) collapsed to a single opaque token and could never match a
// snake_case pattern. Loads the REAL shipped bundle so these assert what users
// actually get.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyColumn } from '../src/taxonomy/classify.ts';
import type { ColumnSample, TaxonomyBundle, TypeSpec } from '../src/taxonomy/types.ts';
import { parseUniversalLayer, sensitivityForType } from '../src/taxonomy/universal.ts';

const BASE = join(process.cwd(), 'taxonomy', 'v0.1');

function loadBundle(): TaxonomyBundle {
  const types: TypeSpec[] = readFileSync(join(BASE, 'types.jsonl'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as TypeSpec);
  const universal = parseUniversalLayer(
    readFileSync(join(BASE, 'universal', 'universal-terms.jsonl'), 'utf8'),
    readFileSync(join(BASE, 'universal', 'crosswalk.jsonl'), 'utf8'),
  );
  return { version: '0.1', released: '2026-05-15', domains: [], types, universal };
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

describe('separator-less headers (patientid, orderid) resolve like their snake_case form', () => {
  it('patientid classifies as patient_id', () => {
    expect(top('patientid', ['P-1001', 'P-1002', 'P-1003'])).toBe('patient_id');
  });
  it('the snake_case form still works (no regression)', () => {
    expect(top('patient_id', ['P-1001', 'P-1002', 'P-1003'])).toBe('patient_id');
  });
});

describe('camelCase headers are split into tokens', () => {
  it('MonthlyIncome classifies as compensation', () => {
    expect(top('MonthlyIncome', ['5993', '5130', '2090'], 'INTEGER')).toBe('compensation');
  });
  it('PatientID classifies as patient_id', () => {
    expect(top('PatientID', ['P-1', 'P-2', 'P-3'])).toBe('patient_id');
  });
});

describe('SAFETY — a person name in a clinical table is PII', () => {
  it('doctor_name classifies as a person name', () => {
    const t = top('doctor_name', ['Dr. Alice Smith', 'Dr. Bob Jones', 'Dr. Carol Wu']);
    expect(t).toBe('person_name');
  });
  it('and that type carries the pii sensitivity tier (so query() redacts it)', () => {
    expect(sensitivityForType(BUNDLE, 'person_name')).toBe('pii');
  });
  it('camelCase + separator-less variants also hit it', () => {
    expect(top('DoctorName', ['Dr. A', 'Dr. B', 'Dr. C'])).toBe('person_name');
    expect(top('patient_name', ['Alice Smith', 'Bob Jones', 'Carol Wu'])).toBe('person_name');
    expect(top('full_name', ['Alice Smith', 'Bob Jones', 'Carol Wu'])).toBe('person_name');
  });
  it('does NOT hijack non-person *_name columns', () => {
    // These are real types already in the taxonomy — a greedy person-name
    // detector would wreck them, which is the whole risk of this change.
    expect(top('vendor_name', ['Acme Ltd', 'Globex', 'Initech'])).toBe('vendor_name');
    expect(top('country_name', ['India', 'Brazil', 'Kenya'])).toBe('country_name');
    expect(top('file_name', ['a.csv', 'b.csv', 'c.csv'])).not.toBe('person_name');
    expect(top('table_name', ['orders', 'vendors', 'items'])).not.toBe('person_name');
    expect(top('campaign_name', ['Spring Sale', 'BFCM', 'Q1 Push'])).not.toBe('person_name');
  });
});

describe('tenure columns are years, not money and not age', () => {
  it('TotalWorkingYears is not financial', () => {
    const t = top('TotalWorkingYears', ['8', '10', '7'], 'INTEGER');
    expect(t).not.toBe('amount');
    expect(sensitivityForType(BUNDLE, t ?? 'public')).not.toBe('financial');
  });
  it('YearsWithCurrManager is tenure, not age', () => {
    expect(top('YearsWithCurrManager', ['5', '7', '2'], 'INTEGER')).not.toBe('age_years');
  });
  it('YearsAtCompany stays tenure_years (no regression)', () => {
    expect(top('YearsAtCompany', ['6', '10', '1'], 'INTEGER')).toBe('tenure_years');
  });
});

describe('an *ID / *Code suffix outranks the numeric-percentage detector', () => {
  it('RatecodeID is not a percentage', () => {
    expect(top('RatecodeID', ['1', '2', '1'], 'BIGINT')).not.toBe('percentage');
  });
  it('a real percentage column still classifies as percentage', () => {
    expect(top('discount_percent', ['10', '25', '5'], 'DOUBLE')).toBe('percentage');
  });
});
