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
  parseUniversalLayer,
  roleFamilyForType,
  sensitivityForType,
} from '../src/taxonomy/universal.ts';
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

const byType = (ids: string[]): Record<string, ColumnRef> =>
  Object.fromEntries(ids.map((id) => [id, { table: 'listings', column: id }]));
const templateIds = (present: string[]): string[] =>
  findApplicableTemplates(ALL_TEMPLATES, byType(present)).map((a) => a.template.id);
// Tier-3 (A36): role-family-aware matching — passes the crosswalk resolver.
const rf = (id: string) => roleFamilyForType(BUNDLE, id);
const templateIdsRF = (present: string[]): string[] =>
  findApplicableTemplates(ALL_TEMPLATES, byType(present), undefined, rf).map((a) => a.template.id);

describe('G1 — real-estate domain pack', () => {
  it('classifies property_type / bedrooms / bathrooms / square_feet / sale_price', () => {
    expect(top('property_type', ['Apartment', 'Villa', 'Studio'])).toBe('property_type');
    expect(top('bedrooms', ['2', '3', '1'], 'INTEGER')).toBe('bedrooms');
    expect(top('bathrooms', ['1', '2', '2'], 'INTEGER')).toBe('bathrooms');
    expect(top('area_sqft', ['1200', '850', '2400'], 'INTEGER')).toBe('square_feet');
    expect(top('sale_price', ['450000', '620000', '310000'], 'BIGINT')).toBe('sale_price');
  });
  it('sale_price is marked financial', () => {
    expect(sensitivityForType(BUNDLE, 'sale_price')).toBe('financial');
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
    expect(sensitivityForType(BUNDLE, 'student_id')).toBe('pii');
    expect(sensitivityForType(BUNDLE, 'score_percent')).toBe('pii');
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
    expect(sensitivityForType(BUNDLE, 'patient_id')).toBe('secret');
    expect(sensitivityForType(BUNDLE, 'diagnosis_code')).toBe('secret');
    expect(sensitivityForType(BUNDLE, 'claim_amount')).toBe('financial');
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
    expect(sensitivityForType(BUNDLE, 'risk_score')).toBe('secret');
    expect(sensitivityForType(BUNDLE, 'card_last4')).toBe('secret');
    expect(sensitivityForType(BUNDLE, 'device_id')).toBe('pii');
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
    expect(sensitivityForType(BUNDLE, 'transaction_amount')).toBe('financial');
    expect(sensitivityForType(BUNDLE, 'principal_amount')).toBe('financial');
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
    expect(sensitivityForType(BUNDLE, 'policy_id')).toBe('financial');
    expect(sensitivityForType(BUNDLE, 'premium_amount')).toBe('financial');
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

describe('G10 — supply-chain / procurement domain pack', () => {
  it('classifies purchase_order_id / warehouse_id / inventory_quantity / lead_time_days / unit_cost', () => {
    expect(top('po_number', ['PO-1', 'PO-2', 'PO-3'])).toBe('purchase_order_id');
    expect(top('warehouse_id', ['W1', 'W2', 'W3'])).toBe('warehouse_id');
    expect(top('stock_on_hand', ['120', '45', '600'], 'INTEGER')).toBe('inventory_quantity');
    expect(top('lead_time_days', ['7', '14', '3'], 'INTEGER')).toBe('lead_time_days');
    expect(top('unit_cost', ['12.5', '9.0', '15.0'], 'DOUBLE')).toBe('unit_cost');
  });
  it('sensitivity resolves via the crosswalk (unit_cost + PO are financial)', () => {
    expect(sensitivityForType(BUNDLE, 'unit_cost')).toBe('financial');
    expect(sensitivityForType(BUNDLE, 'purchase_order_id')).toBe('financial');
    expect(sensitivityForType(BUNDLE, 'warehouse_id')).toBe('public');
  });
  it('does NOT redefine the retail "sku" or hijack finance "supplier" (routed around owners)', () => {
    // supply-chain deliberately omits sku (retail owns it) and supplier (vendor_name owns it).
    expect(top('sku', ['A1', 'B2', 'C3'])).toBe('sku'); // still the retail type, not a supply-chain one
    expect(top('supplier_name', ['Acme', 'Globex', 'Initech'])).toBe('vendor_name');
  });
  it('inventory_health surfaces when warehouse_id + inventory_quantity present', () => {
    expect(templateIds(['warehouse_id', 'inventory_quantity', 'lead_time_days'])).toContain(
      'inventory_health',
    );
  });
});

describe('G11 — energy / utilities domain pack', () => {
  it('classifies meter_id / usage_kwh / demand_kw / tariff_code / outage_minutes', () => {
    expect(top('meter_id', ['M1', 'M2', 'M3'])).toBe('meter_id');
    expect(top('consumption_kwh', ['320', '145', '600'], 'DOUBLE')).toBe('usage_kwh');
    expect(top('peak_kw', ['4.2', '6.1', '3.8'], 'DOUBLE')).toBe('demand_kw');
    expect(top('rate_plan', ['TOU-A', 'FLAT', 'TOU-B'])).toBe('tariff_code');
    expect(top('outage_minutes', ['12', '0', '45'], 'INTEGER')).toBe('outage_minutes');
  });
  it('tariff_code carries a financial sensitivity override (concept default is public)', () => {
    expect(sensitivityForType(BUNDLE, 'tariff_code')).toBe('financial');
    expect(sensitivityForType(BUNDLE, 'meter_id')).toBe('pii');
  });
  it('consumption_summary surfaces when meter_id + usage_kwh present', () => {
    expect(templateIds(['meter_id', 'usage_kwh', 'demand_kw'])).toContain('consumption_summary');
  });
  it('consumption_summary does NOT surface for a bare finance workbook', () => {
    expect(templateIds(['gstin', 'amount'])).not.toContain('consumption_summary');
  });
});

describe('Tier-3 (A36) — generic role-family template (metric_by_dimension)', () => {
  it('surfaces for any dimension + measure workbook (role-family aware)', () => {
    // department → dimension (ut:org_unit); compensation → measure (ut:monetary_amount)
    expect(rf('department')).toBe('dimension');
    expect(rf('compensation')).toBe('measure');
    expect(templateIdsRF(['department', 'compensation'])).toContain('metric_by_dimension');
  });
  it('generalizes beyond the literal "amount" type — a kWh measure works', () => {
    // usage_kwh → measure (ut:physical_measurement); tariff_code → dimension (ut:category)
    expect(rf('usage_kwh')).toBe('measure');
    expect(templateIdsRF(['tariff_code', 'usage_kwh'])).toContain('metric_by_dimension');
  });
  it('does NOT surface without the roleFamily resolver (back-compat with the old call)', () => {
    expect(templateIds(['department', 'compensation'])).not.toContain('metric_by_dimension');
  });
  it('does NOT surface with a measure but no dimension (entity + measure only)', () => {
    // customer_id → entity, not dimension
    expect(rf('customer_id')).toBe('entity');
    expect(templateIdsRF(['customer_id', 'compensation'])).not.toContain('metric_by_dimension');
  });
  it('binds dimension + measure and instantiates a GROUP BY (single FROM)', () => {
    const app = findApplicableTemplates(
      ALL_TEMPLATES,
      byType(['department', 'compensation']),
      undefined,
      rf,
    ).find((a) => a.template.id === 'metric_by_dimension');
    expect(app).toBeDefined();
    const cells = app?.template.instantiate(app.matched) ?? [];
    const sqlCell = cells.find((c) => c.kind === 'sql') as { code: string } | undefined;
    expect(sqlCell?.code).toContain('GROUP BY');
    expect(sqlCell?.code).toContain('department'); // the dimension column
    expect(sqlCell?.code).toContain('compensation'); // the measure column
  });
});

describe('G12 — manufacturing / quality domain pack', () => {
  it('classifies work_order_id / produced_quantity / defect_count / yield_rate / quality_result', () => {
    expect(top('work_order', ['WO-1', 'WO-2', 'WO-3'])).toBe('work_order_id');
    expect(top('output_qty', ['1200', '980', '1500'], 'INTEGER')).toBe('produced_quantity');
    expect(top('defects', ['3', '0', '7'], 'INTEGER')).toBe('defect_count');
    expect(top('first_pass_yield', ['0.98', '0.91', '0.99'], 'DOUBLE')).toBe('yield_rate');
    expect(top('inspection_result', ['pass', 'fail', 'pass'])).toBe('quality_result');
  });
  it('produced_quantity does NOT hijack the retail bare "quantity" (owned by quantity)', () => {
    expect(top('quantity', ['2', '5', '1'], 'INTEGER')).not.toBe('produced_quantity');
  });
  it('production_quality surfaces when quality_result + produced_quantity present', () => {
    expect(templateIds(['quality_result', 'produced_quantity', 'defect_count'])).toContain(
      'production_quality',
    );
  });
});

describe('G13 — legal / contracts / compliance domain pack', () => {
  it('classifies contract_id / contract_type / contract_value / renewal_status / compliance_status', () => {
    expect(top('agreement_id', ['C-1', 'C-2', 'C-3'])).toBe('contract_id');
    expect(top('contract_type', ['MSA', 'NDA', 'SOW'])).toBe('contract_type');
    expect(top('total_contract_value', ['500000', '120000', '80000'], 'BIGINT')).toBe(
      'contract_value',
    );
    expect(top('renewal_status', ['auto', 'manual', 'expired'])).toBe('renewal_status');
    expect(top('compliance_status', ['compliant', 'open', 'remediated'])).toBe('compliance_status');
  });
  it('crosswalk overrides: contract_type/value financial, compliance_status secret', () => {
    expect(sensitivityForType(BUNDLE, 'contract_type')).toBe('financial');
    expect(sensitivityForType(BUNDLE, 'contract_value')).toBe('financial');
    expect(sensitivityForType(BUNDLE, 'compliance_status')).toBe('secret');
  });
  it('contract_pipeline surfaces when contract_type + contract_value present', () => {
    expect(templateIds(['contract_type', 'contract_value', 'renewal_status'])).toContain(
      'contract_pipeline',
    );
  });
});

describe('G14 — nonprofit / fundraising domain pack', () => {
  it('classifies donor_id / donation_amount / campaign_name / fund_name / recurring_flag', () => {
    expect(top('supporter_id', ['D1', 'D2', 'D3'])).toBe('donor_id');
    expect(top('gift_amount', ['50', '250', '100'], 'INTEGER')).toBe('donation_amount');
    expect(top('appeal', ['Spring', 'GivingTuesday', 'Gala'])).toBe('campaign_name');
    expect(top('restricted_fund', ['Scholarship', 'General', 'Building'])).toBe('fund_name');
    expect(top('is_recurring', ['1', '0', '1'], 'INTEGER')).toBe('recurring_flag');
  });
  it('donor_id pii; donation_amount + fund_name financial (fund via override)', () => {
    expect(sensitivityForType(BUNDLE, 'donor_id')).toBe('pii');
    expect(sensitivityForType(BUNDLE, 'donation_amount')).toBe('financial');
    expect(sensitivityForType(BUNDLE, 'fund_name')).toBe('financial');
  });
  it('campaign_name does NOT hijack utm_campaign', () => {
    expect(top('utm_campaign', ['spring_sale', 'q4', 'launch'])).toBe('utm_campaign');
  });
  it('nonprofit_giving surfaces when campaign_name + donation_amount present', () => {
    expect(templateIds(['campaign_name', 'donation_amount', 'fund_name'])).toContain(
      'nonprofit_giving',
    );
  });
});

describe('G15 — research / scholarly domain pack', () => {
  it('classifies paper_id / paper_title / publication_year / citation_count / venue_name', () => {
    expect(top('publication_id', ['W1', 'W2', 'W3'])).toBe('paper_id');
    expect(top('article_title', ['On Foo', 'Bar Methods', 'Baz'])).toBe('paper_title');
    expect(top('pub_year', ['2019', '2020', '2021'], 'INTEGER')).toBe('publication_year');
    expect(top('cited_by_count', ['12', '3', '88'], 'INTEGER')).toBe('citation_count');
    expect(top('journal_name', ['Nature', 'JMLR', 'PLOS'])).toBe('venue_name');
  });
  it('paper_title does NOT hijack the media content_title (owns bare "title")', () => {
    expect(top('title', ['Ganglands', 'Midnight Mass'])).not.toBe('paper_title');
  });
  it('research_output surfaces when venue_name + citation_count present', () => {
    expect(templateIds(['venue_name', 'citation_count', 'publication_year'])).toContain(
      'research_output',
    );
  });
});

describe('G16 — government operations domain pack', () => {
  it('classifies agency_name / program_name / application_status / processing_days / benefit_amount', () => {
    expect(top('agency', ['DMV', 'IRS', 'USCIS'])).toBe('agency_name');
    expect(top('benefit_program', ['SNAP', 'Medicaid', 'TANF'])).toBe('program_name');
    expect(top('application_status', ['approved', 'pending', 'denied'])).toBe('application_status');
    expect(top('turnaround_days', ['14', '30', '7'], 'INTEGER')).toBe('processing_days');
    expect(top('grant_amount', ['1200', '450', '3000'], 'INTEGER')).toBe('benefit_amount');
  });
  it('benefit_amount financial; agency_name/program_name public', () => {
    expect(sensitivityForType(BUNDLE, 'benefit_amount')).toBe('financial');
    expect(sensitivityForType(BUNDLE, 'agency_name')).toBe('public');
  });
  it('gov_services surfaces when program_name + benefit_amount present', () => {
    expect(templateIds(['program_name', 'benefit_amount', 'application_status'])).toContain(
      'gov_services',
    );
  });
});
