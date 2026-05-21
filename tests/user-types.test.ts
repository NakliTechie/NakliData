import { describe, expect, it } from 'vitest';
import type { UserType } from '../src/core/workbook.ts';
import { classifyColumn } from '../src/taxonomy/classify.ts';
import type { ColumnSample, TaxonomyBundle, TypeSpec } from '../src/taxonomy/types.ts';
import { mergeUserTypesIntoBundle, userTypeToTypeSpec } from '../src/taxonomy/user-types.ts';

const EMPLOYEE_ID: UserType = {
  id: 'employee_id',
  display_name: 'Employee ID',
  category: 'Identifier',
  regex: '^EMP-[0-9]{4}$',
  created: '2026-05-19T00:00:00.000Z',
  note: 'Seeded from invoices.employee_id',
};

describe('userTypeToTypeSpec', () => {
  it('emits a TypeSpec with a regex + header_match detector', () => {
    const spec = userTypeToTypeSpec(EMPLOYEE_ID);
    expect(spec.id).toBe('employee_id');
    expect(spec.display_name).toBe('Employee ID');
    expect(spec.domain).toBe('user-defined');
    expect(spec.seed_origin).toBe('user-defined');
    expect(spec.detectors).toHaveLength(2);
    const regex = spec.detectors.find((d) => d.kind === 'regex');
    expect(regex?.pattern).toBe('^EMP-[0-9]{4}$');
    const header = spec.detectors.find((d) => d.kind === 'header_match');
    expect(header?.patterns).toContain('employee_id');
    expect(header?.patterns).toContain('employee id');
    expect(header?.patterns).toContain('employeeid');
  });
});

describe('mergeUserTypesIntoBundle', () => {
  const bundle: TaxonomyBundle = {
    version: '0.1',
    released: '2026-05-15',
    domains: [],
    types: [
      {
        id: 'gstin',
        display_name: 'GSTIN',
        domain: 'india-smb-finance',
        sql_compat: ['VARCHAR'],
        detectors: [{ kind: 'header_match', patterns: ['gstin'], weight: 1 }],
        confidence_floor: 0.5,
      },
    ],
  };

  it('appends user types to the bundle without mutating', () => {
    const merged = mergeUserTypesIntoBundle(bundle, [EMPLOYEE_ID]);
    expect(merged.types).toHaveLength(2);
    expect(merged.types.find((t) => t.id === 'employee_id')).toBeDefined();
    expect(bundle.types).toHaveLength(1); // original untouched
  });

  it('returns the bundle unchanged when no user types are supplied', () => {
    const merged = mergeUserTypesIntoBundle(bundle, []);
    expect(merged).toBe(bundle);
  });

  it('lets a user type override a colliding bundled type', () => {
    const colliding: UserType = {
      id: 'gstin', // collides
      display_name: 'My Custom GSTIN',
      category: 'Identifier',
      regex: '^XX-[0-9]+$',
      created: '2026-05-19T00:00:00.000Z',
    };
    const merged = mergeUserTypesIntoBundle(bundle, [colliding]);
    const gstin = merged.types.find((t) => t.id === 'gstin');
    expect(gstin?.display_name).toBe('My Custom GSTIN');
    expect(gstin?.domain).toBe('user-defined');
  });
});

describe('classifyColumn against a merged bundle', () => {
  const bundle: TaxonomyBundle = {
    version: '0.1',
    released: '2026-05-15',
    domains: [],
    types: [
      {
        id: 'gstin',
        display_name: 'GSTIN',
        domain: 'india-smb-finance',
        sql_compat: ['VARCHAR'],
        detectors: [
          { kind: 'header_match', patterns: ['gstin'], weight: 0.5 },
          { kind: 'regex', pattern: '^[0-9]{2}[A-Z]{5}', weight: 0.5 },
        ],
        confidence_floor: 0.5,
      },
    ],
  };

  function sample(columnName: string, values: string[]): ColumnSample {
    return {
      tableName: 't',
      columnName,
      sqlType: 'VARCHAR',
      values,
      totalSampled: values.length,
      nullCount: 0,
      distinctCount: new Set(values).size,
    };
  }

  it('fires the user type on values + headers that match it', () => {
    const merged = mergeUserTypesIntoBundle(bundle, [EMPLOYEE_ID]);
    const result = classifyColumn(
      merged,
      sample('employee_id', ['EMP-0001', 'EMP-0002', 'EMP-0003']),
    );
    const winner = result.candidates[0];
    expect(winner?.typeId).toBe('employee_id');
    expect(winner?.displayName).toBe('Employee ID');
    expect(winner?.confidence).toBeGreaterThan(0.9);
  });

  it("doesn't fire when neither header nor regex matches", () => {
    const merged = mergeUserTypesIntoBundle(bundle, [EMPLOYEE_ID]);
    const result = classifyColumn(merged, sample('comments', ['Lorem', 'Ipsum', 'Dolor']));
    expect(result.candidates.find((c) => c.typeId === 'employee_id')).toBeUndefined();
  });

  it('user-type detectors stack: regex-only match still fires above floor', () => {
    const merged = mergeUserTypesIntoBundle(bundle, [EMPLOYEE_ID]);
    // Generic header `id_code` won't match employee_id header patterns,
    // but the regex matches → score ~ 0.6 weight contribution.
    const result = classifyColumn(merged, sample('id_code', ['EMP-0001', 'EMP-0002', 'EMP-0003']));
    const candidate = result.candidates.find((c) => c.typeId === 'employee_id');
    expect(candidate).toBeDefined();
    expect(candidate?.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('does not interfere with bundled types — a GSTIN column still classifies as GSTIN', () => {
    const merged = mergeUserTypesIntoBundle(bundle, [EMPLOYEE_ID]);
    const result = classifyColumn(merged, sample('gstin', ['29HBHZW6406C1ZR']));
    expect(result.candidates[0]?.typeId).toBe('gstin');
  });

  // Type-checker exercise — confirm TypeSpec / TaxonomyBundle compile under
  // the imported types (catches drift if `TypeSpec` changes shape).
  it('exported TypeSpec shape compiles', () => {
    const spec: TypeSpec = userTypeToTypeSpec(EMPLOYEE_ID);
    expect(spec.id).toBe('employee_id');
  });
});
