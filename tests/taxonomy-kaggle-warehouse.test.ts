// KAG-04 — exact headers and representative values from the 2026-07-29
// authenticated Kaggle corpus. This is the analyst-facing warehouse vocabulary
// layer: HR lifecycle, country indicators, order lifecycle, payments, and
// unit-bearing product dimensions.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyColumn } from '../src/taxonomy/classify.ts';
import type { ColumnSample, TaxonomyBundle, TypeSpec } from '../src/taxonomy/types.ts';
import { parseUniversalLayer, sensitivityForType } from '../src/taxonomy/universal.ts';

const BASE = join(process.cwd(), 'taxonomy', 'v0.1');
const types: TypeSpec[] = readFileSync(join(BASE, 'types.jsonl'), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => JSON.parse(line) as TypeSpec);
const BUNDLE: TaxonomyBundle = {
  version: '0.1',
  released: '2026-05-15',
  domains: [],
  types,
  universal: parseUniversalLayer(
    readFileSync(join(BASE, 'universal', 'universal-terms.jsonl'), 'utf8'),
    readFileSync(join(BASE, 'universal', 'crosswalk.jsonl'), 'utf8'),
  ),
};

function top(columnName: string, values: string[], sqlType = 'VARCHAR'): string | null {
  const sample: ColumnSample = {
    tableName: 'kaggle_fixture',
    columnName,
    sqlType,
    values,
    totalSampled: values.length,
    nullCount: 0,
    distinctCount: new Set(values).size,
  };
  return classifyColumn(BUNDLE, sample).candidates[0]?.typeId ?? null;
}

describe('KAG-04 — HR lifecycle and people analytics', () => {
  it.each([
    ['DateofHire', ['7/5/2011', '3/30/2015'], 'DATE', 'hire_date'],
    ['DateofTermination', ['6/16/2016', '9/24/2012'], 'DATE', 'termination_date'],
    ['EmploymentStatus', ['Active', 'Voluntarily Terminated'], 'VARCHAR', 'employment_status'],
    ['TermReason', ['N/A-StillEmployed', 'career change'], 'VARCHAR', 'termination_reason'],
    ['ManagerName', ['Michael Albert', 'Simon Roup'], 'VARCHAR', 'manager_name'],
    ['ManagerID', ['22', '4'], 'INTEGER', 'manager_id'],
    ['RecruitmentSource', ['LinkedIn', 'Indeed'], 'VARCHAR', 'recruitment_source'],
    ['PerformanceScore', ['Exceeds', 'Fully Meets'], 'VARCHAR', 'performance_rating'],
    ['EngagementSurvey', ['4.60', '4.96'], 'DOUBLE', 'employee_engagement_score'],
    ['EmpSatisfaction', ['5', '3'], 'INTEGER', 'employee_satisfaction'],
    ['SpecialProjectsCount', ['0', '6'], 'INTEGER', 'special_projects_count'],
    ['DaysLateLast30', ['0', '2'], 'INTEGER', 'late_days_count'],
    ['Absences', ['1', '17'], 'INTEGER', 'absence_count'],
  ])('%s maps to %s', (header, values, sqlType, expected) => {
    expect(top(header, values, sqlType)).toBe(expected);
  });

  it('employee lifecycle, performance, and attendance semantics are PII', () => {
    for (const typeId of [
      'hire_date',
      'termination_date',
      'employment_status',
      'termination_reason',
      'manager_name',
      'manager_id',
      'recruitment_source',
      'performance_rating',
      'employee_engagement_score',
      'employee_satisfaction',
      'special_projects_count',
      'late_days_count',
      'absence_count',
    ]) {
      expect(sensitivityForType(BUNDLE, typeId), typeId).toBe('pii');
    }
  });
});

describe('KAG-04 — country indicator panels', () => {
  it.each([
    ['Country', ['Afghanistan', 'Albania', 'Zimbabwe'], 'VARCHAR', 'country_name'],
    ['Year', ['2000', '2001', '2026'], 'INTEGER', 'calendar_year'],
    ['Economic_Tier', ['1', '2', '4'], 'INTEGER', 'economic_tier'],
    ['Happiness_Rank', ['1', '78', '195'], 'INTEGER', 'indicator_rank'],
    ['GDP_Per_Capita_Rank', ['2', '96', '212'], 'INTEGER', 'indicator_rank'],
    ['Environmental_Performance_Rank', ['4', '83', '214'], 'INTEGER', 'indicator_rank'],
  ])('%s maps to %s', (header, values, sqlType, expected) => {
    expect(top(header, values, sqlType)).toBe(expected);
  });

  it('keeps two-letter country codes and unrelated ranks distinct', () => {
    expect(top('Country', ['US', 'IN', 'DE'])).toBe('iso_country_code');
    expect(top('taxon_rank', ['species', 'genus', 'family'])).not.toBe('indicator_rank');
  });
});

describe('KAG-04 — commerce lifecycle and unit-bearing product data', () => {
  it.each([
    ['order_status', ['delivered', 'shipped'], 'VARCHAR', 'order_status'],
    [
      'order_purchase_timestamp',
      ['2017-10-02 10:56:33', '2018-07-24 20:41:37'],
      'TIMESTAMP',
      'order_purchase_timestamp',
    ],
    [
      'order_approved_at',
      ['2017-10-02 11:07:15', '2018-07-26 03:24:27'],
      'TIMESTAMP',
      'order_approval_timestamp',
    ],
    [
      'order_delivered_carrier_date',
      ['2017-10-04 19:55:00', '2018-08-08 13:50:00'],
      'TIMESTAMP',
      'order_carrier_handoff_timestamp',
    ],
    [
      'order_delivered_customer_date',
      ['2017-10-10 21:25:13', '2018-08-17 18:06:29'],
      'TIMESTAMP',
      'order_delivery_timestamp',
    ],
    [
      'order_estimated_delivery_date',
      ['2017-10-18 00:00:00', '2018-09-04 00:00:00'],
      'TIMESTAMP',
      'order_promised_delivery_timestamp',
    ],
    ['payment_installments', ['1', '8'], 'INTEGER', 'payment_installment_count'],
    ['product_category_name', ['perfumaria', 'artes'], 'VARCHAR', 'product_category'],
    ['product_weight_g', ['225', '1000'], 'INTEGER', 'product_weight'],
    ['product_length_cm', ['16', '30'], 'INTEGER', 'product_length'],
    ['product_height_cm', ['10', '18'], 'INTEGER', 'product_height'],
    ['product_width_cm', ['14', '20'], 'INTEGER', 'product_width'],
  ])('%s maps to %s', (header, values, sqlType, expected) => {
    expect(top(header, values, sqlType)).toBe(expected);
  });

  it('treats order lifecycle and installment data as financial', () => {
    for (const typeId of [
      'order_status',
      'order_purchase_timestamp',
      'order_approval_timestamp',
      'order_carrier_handoff_timestamp',
      'order_delivery_timestamp',
      'order_promised_delivery_timestamp',
      'payment_installment_count',
    ]) {
      expect(sensitivityForType(BUNDLE, typeId), typeId).toBe('financial');
    }
  });

  it('does not hijack generic dimensions without product context', () => {
    expect(top('width', ['10', '20'], 'INTEGER')).not.toBe('product_width');
    expect(top('height', ['10', '20'], 'INTEGER')).not.toBe('product_height');
  });
});
