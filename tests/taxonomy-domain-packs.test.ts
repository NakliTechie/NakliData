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

describe('G2 — education domain pack', () => {
  it('classifies student_id / grade_level / course_name / score_percent / completion_status', () => {
    expect(top('student_id', ['S1001', 'S1002', 'S1003'])).toBe('student_id');
    expect(top('grade_level', ['9', '10', '11'], 'INTEGER')).toBe('grade_level');
    expect(top('course_name', ['Algebra', 'Biology', 'History'])).toBe('course_name');
    expect(top('exam_score', ['82', '91', '77'], 'INTEGER')).toBe('score_percent');
    expect(top('completion_status', ['completed', 'in_progress', 'completed'])).toBe(
      'completion_status',
    );
  });
  it('student_id + score_percent are marked pii', () => {
    expect(BUNDLE.types.find((t) => t.id === 'student_id')?.sensitivity).toBe('pii');
    expect(BUNDLE.types.find((t) => t.id === 'score_percent')?.sensitivity).toBe('pii');
  });
  it('score_percent does NOT hijack a bare "score"/"percentage" column (owned by probability/percentage)', () => {
    expect(top('score', ['0.8', '0.6', '0.9'], 'DOUBLE')).not.toBe('score_percent');
    expect(top('percentage', ['12', '48', '30'], 'INTEGER')).not.toBe('score_percent');
  });
  it('education_performance surfaces when course_name + score_percent present', () => {
    expect(templateIds(['course_name', 'score_percent', 'grade_level'])).toContain(
      'education_performance',
    );
  });
  it('education_performance does NOT surface for a bare finance workbook', () => {
    expect(templateIds(['gstin', 'amount'])).not.toContain('education_performance');
  });
});

describe('G3 — healthcare / clinical domain pack', () => {
  it('classifies patient_id / diagnosis_code / encounter_id / length_of_stay / claim_amount', () => {
    expect(top('patient_id', ['P0001', 'P0002', 'P0003'])).toBe('patient_id');
    expect(top('icd10', ['E11.9', 'I10', 'J45.909'])).toBe('diagnosis_code');
    expect(top('encounter_id', ['E1', 'E2', 'E3'])).toBe('encounter_id');
    expect(top('length_of_stay', ['3', '5', '2'], 'INTEGER')).toBe('length_of_stay');
    expect(top('claim_amount', ['1200', '4500', '890'], 'DOUBLE')).toBe('claim_amount');
  });
  it('clinical identifiers are sensitivity-marked (secret / financial)', () => {
    expect(BUNDLE.types.find((t) => t.id === 'patient_id')?.sensitivity).toBe('secret');
    expect(BUNDLE.types.find((t) => t.id === 'diagnosis_code')?.sensitivity).toBe('secret');
    expect(BUNDLE.types.find((t) => t.id === 'claim_amount')?.sensitivity).toBe('financial');
  });
  it('claim_amount does NOT hijack a bare "amount" column', () => {
    expect(top('amount', ['10', '20', '30'], 'INTEGER')).not.toBe('claim_amount');
  });
  it('clinical_claims surfaces when diagnosis_code + claim_amount present', () => {
    expect(templateIds(['diagnosis_code', 'claim_amount', 'length_of_stay'])).toContain(
      'clinical_claims',
    );
  });
  it('clinical_claims does NOT surface for a bare finance workbook', () => {
    expect(templateIds(['gstin', 'amount'])).not.toContain('clinical_claims');
  });
});

describe('G4 — public-sector / demographics domain pack', () => {
  it('classifies population / households / median_income / unemployment_rate / age_band', () => {
    expect(top('population', ['81000', '120500', '43000'], 'BIGINT')).toBe('population');
    expect(top('households', ['32000', '48000', '17000'], 'BIGINT')).toBe('households');
    expect(top('median_income', ['52000', '61000', '38000'], 'INTEGER')).toBe('median_income');
    expect(top('unemployment_rate', ['4.2', '6.1', '3.8'], 'DOUBLE')).toBe('unemployment_rate');
    expect(top('age_band', ['18-24', '25-34', '35-44'])).toBe('age_band');
  });
  it('age_band does NOT hijack a bare "age" column (owned by age_years)', () => {
    expect(top('age', ['34', '28', '52'], 'INTEGER')).not.toBe('age_band');
  });
  it('demographic_summary surfaces when state_region + population present', () => {
    expect(templateIds(['state_region', 'population', 'median_income'])).toContain(
      'demographic_summary',
    );
  });
  it('demographic_summary does NOT surface without a geography role', () => {
    expect(templateIds(['population', 'median_income'])).not.toContain('demographic_summary');
  });
});

describe('G5 — scientific / measurements domain pack', () => {
  it('classifies sensor_id / temperature / humidity / pressure / measurement_unit', () => {
    expect(top('sensor_id', ['S-01', 'S-02', 'S-03'])).toBe('sensor_id');
    expect(top('temp_c', ['21.5', '19.8', '23.1'], 'DOUBLE')).toBe('temperature');
    expect(top('humidity', ['45', '52', '38'], 'INTEGER')).toBe('humidity');
    expect(top('barometric_pressure', ['1013', '1009', '1015'], 'INTEGER')).toBe('pressure');
    expect(top('uom', ['C', 'hPa', '%'])).toBe('measurement_unit');
  });
  it('measurement_unit does NOT hijack unit_price / unit_cost / business_unit', () => {
    // measurement_unit uses uom-specific patterns only — bare "unit" would token-match these.
    expect(top('unit_price', ['12.5', '9.0', '15.0'], 'DOUBLE')).not.toBe('measurement_unit');
    expect(top('unit_cost', ['8.2', '6.1', '10.0'], 'DOUBLE')).not.toBe('measurement_unit');
    expect(top('business_unit', ['Retail', 'Wholesale', 'Online'])).not.toBe('measurement_unit');
  });
  it('sensor_readings surfaces when sensor_id + temperature present', () => {
    expect(templateIds(['sensor_id', 'temperature', 'humidity'])).toContain('sensor_readings');
  });
  it('sensor_readings does NOT surface for a bare finance workbook', () => {
    expect(templateIds(['gstin', 'amount'])).not.toContain('sensor_readings');
  });
});

describe('G6 — risk / fraud / security domain pack', () => {
  it('classifies fraud_flag / risk_score / auth_result / device_id / card_last4', () => {
    expect(top('is_fraud', ['0', '1', '0'], 'INTEGER')).toBe('fraud_flag');
    expect(top('risk_score', ['0.82', '0.13', '0.44'], 'DOUBLE')).toBe('risk_score');
    expect(top('authorization_status', ['approved', 'declined', 'approved'])).toBe('auth_result');
    expect(top('device_fingerprint', ['d9f1', 'a2c8', 'b7e0'])).toBe('device_id');
    expect(top('card_last4', ['4242', '1881', '0002'])).toBe('card_last4');
  });
  it('risk-fraud identifiers are sensitivity-marked (secret / pii)', () => {
    expect(BUNDLE.types.find((t) => t.id === 'risk_score')?.sensitivity).toBe('secret');
    expect(BUNDLE.types.find((t) => t.id === 'card_last4')?.sensitivity).toBe('secret');
    expect(BUNDLE.types.find((t) => t.id === 'device_id')?.sensitivity).toBe('pii');
  });
  it('risk_score does NOT hijack a bare "score" column (owned by probability)', () => {
    expect(top('score', ['0.8', '0.6', '0.9'], 'DOUBLE')).not.toBe('risk_score');
  });
  it('fraud_review surfaces when auth_result + risk_score present', () => {
    expect(templateIds(['auth_result', 'risk_score', 'fraud_flag'])).toContain('fraud_review');
  });
});

describe('G7 — banking / payments / lending domain pack', () => {
  it('classifies transaction_amount / transaction_fee / debit_credit / interest_rate / principal_amount', () => {
    expect(top('txn_amount', ['1200', '450', '89'], 'DOUBLE')).toBe('transaction_amount');
    expect(top('processing_fee', ['2.5', '1.0', '3.2'], 'DOUBLE')).toBe('transaction_fee');
    expect(top('dr_cr', ['DR', 'CR', 'DR'])).toBe('debit_credit');
    expect(top('interest_rate', ['7.5', '9.2', '6.0'], 'DOUBLE')).toBe('interest_rate');
    expect(top('loan_amount', ['500000', '250000', '80000'], 'BIGINT')).toBe('principal_amount');
  });
  it('banking amounts are marked financial', () => {
    expect(BUNDLE.types.find((t) => t.id === 'transaction_amount')?.sensitivity).toBe('financial');
    expect(BUNDLE.types.find((t) => t.id === 'principal_amount')?.sensitivity).toBe('financial');
  });
  it('transaction_amount does NOT hijack a bare "amount"/"balance" column', () => {
    expect(top('amount', ['10', '20', '30'], 'INTEGER')).not.toBe('transaction_amount');
    expect(top('balance', ['100', '200', '300'], 'INTEGER')).not.toBe('transaction_amount');
  });
  it('banking_flows surfaces when debit_credit + transaction_amount present', () => {
    expect(templateIds(['debit_credit', 'transaction_amount', 'transaction_fee'])).toContain(
      'banking_flows',
    );
  });
});

describe('G8 — insurance domain pack', () => {
  it('classifies policy_id / premium_amount / sum_insured / claim_status / line_of_business', () => {
    expect(top('policy_number', ['PN-1', 'PN-2', 'PN-3'])).toBe('policy_id');
    expect(top('gross_premium', ['1200', '4500', '890'], 'DOUBLE')).toBe('premium_amount');
    expect(top('coverage_amount', ['500000', '250000', '80000'], 'BIGINT')).toBe('sum_insured');
    expect(top('claim_status', ['open', 'settled', 'rejected'])).toBe('claim_status');
    expect(top('line_of_business', ['Motor', 'Health', 'Life'])).toBe('line_of_business');
  });
  it('policy_id + premium/sum are marked financial', () => {
    expect(BUNDLE.types.find((t) => t.id === 'policy_id')?.sensitivity).toBe('financial');
    expect(BUNDLE.types.find((t) => t.id === 'premium_amount')?.sensitivity).toBe('financial');
  });
  it('insurance_book surfaces when line_of_business + premium_amount present', () => {
    expect(templateIds(['line_of_business', 'premium_amount', 'sum_insured'])).toContain(
      'insurance_book',
    );
  });
  it('does NOT hijack a retail "product_line" or a banking "limit_amount" column', () => {
    // line_of_business drops bare product_line/business_line; sum_insured drops limit_amount.
    expect(top('product_line', ['Shoes', 'Bags', 'Hats'])).not.toBe('line_of_business');
    expect(top('limit_amount', ['50000', '100000', '25000'], 'BIGINT')).not.toBe('sum_insured');
  });
  it('insurance_book does NOT surface for a bare finance workbook', () => {
    expect(templateIds(['gstin', 'amount'])).not.toContain('insurance_book');
  });
});

describe('G9 — customer support / success domain pack', () => {
  it('classifies ticket_id / ticket_status / support_priority / first_response_minutes / csat_score', () => {
    expect(top('ticket_number', ['T-100', 'T-101', 'T-102'])).toBe('ticket_id');
    expect(top('ticket_status', ['open', 'pending', 'closed'])).toBe('ticket_status');
    expect(top('priority', ['High', 'Low', 'Medium'])).toBe('support_priority');
    expect(top('first_response_time', ['12', '45', '8'], 'INTEGER')).toBe('first_response_minutes');
    expect(top('csat', ['4', '5', '3'], 'INTEGER')).toBe('csat_score');
  });
  it('ticket_id does NOT claim a healthcare case_id (owned by encounter_id)', () => {
    // ticket_id drops bare case_id (encounter_id owns it); uses ticket_number/case_number instead.
    expect(top('case_id', ['C1', 'C2', 'C3'])).not.toBe('ticket_id');
  });
  it('support_sla surfaces when support_priority + first_response_minutes present', () => {
    expect(templateIds(['support_priority', 'first_response_minutes', 'csat_score'])).toContain(
      'support_sla',
    );
  });
  it('support_sla does NOT surface for a bare finance workbook', () => {
    expect(templateIds(['gstin', 'amount'])).not.toContain('support_sla');
  });
});
