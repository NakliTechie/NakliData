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

describe('SAFETY — protected demographic attributes are pii', () => {
  it('race classifies and is pii', () => {
    expect(top('race', ['White', 'Black', 'Asian-Pac-Islander'])).toBe('race_ethnicity');
    expect(sensitivityForType(BUNDLE, 'race_ethnicity')).toBe('pii');
  });
  it('marital.status (dotted header) classifies and is pii', () => {
    expect(top('marital.status', ['Never-married', 'Divorced', 'Widowed'])).toBe('marital_status');
    expect(sensitivityForType(BUNDLE, 'marital_status')).toBe('pii');
  });
  it('MaritalStatus (camelCase) hits the same type', () => {
    expect(top('MaritalStatus', ['Single', 'Married', 'Divorced'])).toBe('marital_status');
  });
  it('a medical condition is secret-tier', () => {
    expect(top('health_conditions', ['Diabetes', 'Asthma', 'Heart disease'])).toBe(
      'medical_condition',
    );
    expect(sensitivityForType(BUNDLE, 'medical_condition')).toBe('secret');
  });
});

describe('the two dubious real-data hits are corrected', () => {
  it('Ward_Facility_Code is a facility code, not a district/neighbourhood', () => {
    expect(top('Ward_Facility_Code', ['A', 'B', 'C'])).toBe('facility_code');
  });
  it('a real district column still classifies as district_neighbourhood', () => {
    expect(top('neighbourhood', ['Kreuzberg', 'Mitte', 'Neukolln'])).toBe('district_neighbourhood');
  });
  it('Severity of Illness is clinical severity, not a support priority', () => {
    expect(top('Severity of Illness', ['Minor', 'Moderate', 'Extreme'])).toBe('illness_severity');
  });
  it('a real support ticket priority still classifies as support_priority', () => {
    expect(top('priority', ['P1', 'P2', 'P3'])).toBe('support_priority');
  });
});

describe('everyday columns the real-data drive left unclassified', () => {
  it('taxi zone ids are locations', () => {
    expect(top('PULocationID', ['142', '236', '79'], 'BIGINT')).toBe('location_zone_id');
    expect(top('DOLocationID', ['142', '236', '79'], 'BIGINT')).toBe('location_zone_id');
  });
  it('payment_type is a payment method', () => {
    expect(top('payment_type', ['1', '2', '1'], 'BIGINT')).toBe('payment_method');
  });
  it('trip_distance and DistanceFromHome are distances', () => {
    expect(top('trip_distance', ['1.2', '3.4', '0.9'], 'DOUBLE')).toBe('distance');
    expect(top('DistanceFromHome', ['1', '8', '2'], 'INTEGER')).toBe('distance');
  });
  it('hours.per.week is hours worked', () => {
    expect(top('hours.per.week', ['40', '45', '38'], 'INTEGER')).toBe('hours_worked');
  });
  it('education is an education level', () => {
    expect(top('education', ['Bachelors', 'HS-grad', 'Masters'])).toBe('education_level');
  });
  it('deposits, surcharges and capital gains read as monetary amounts', () => {
    for (const h of ['Admission_Deposit', 'capital.gain', 'congestion_surcharge', 'Airport_fee']) {
      const t = top(h, ['10.5', '20.25', '0'], 'DOUBLE');
      expect(sensitivityForType(BUNDLE, t ?? 'public')).toBe('financial');
    }
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
