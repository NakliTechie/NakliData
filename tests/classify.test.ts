import { describe, expect, it } from 'vitest';
import { classifyColumn } from '../src/taxonomy/classify.ts';
import type { ColumnSample, TaxonomyBundle, TypeSpec } from '../src/taxonomy/types.ts';

const TYPES: TypeSpec[] = [
  {
    id: 'gstin',
    display_name: 'GSTIN',
    domain: 'india-smb-finance',
    sql_compat: ['VARCHAR'],
    detectors: [
      {
        kind: 'header_match',
        patterns: ['gstin', 'vendor_gstin', 'gst_no'],
        weight: 0.35,
      },
      {
        kind: 'regex',
        pattern: '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$',
        weight: 0.35,
      },
      { kind: 'checksum', fn: 'gstin_checksum', weight: 0.3 },
    ],
    confidence_floor: 0.5,
  },
  {
    id: 'pan',
    display_name: 'PAN',
    domain: 'india-smb-finance',
    sql_compat: ['VARCHAR'],
    detectors: [
      { kind: 'header_match', patterns: ['pan'], weight: 0.4 },
      { kind: 'regex', pattern: '^[A-Z]{5}[0-9]{4}[A-Z]$', weight: 0.6 },
    ],
    confidence_floor: 0.5,
  },
  {
    id: 'log_level',
    display_name: 'Log level',
    domain: 'generic-logs',
    sql_compat: ['VARCHAR'],
    detectors: [
      { kind: 'header_match', patterns: ['level', 'log_level'], weight: 0.4 },
      {
        kind: 'value_set',
        values: ['debug', 'info', 'warn', 'error', 'fatal'],
        weight: 0.6,
      },
    ],
    confidence_floor: 0.5,
  },
];

const BUNDLE: TaxonomyBundle = {
  version: '0.1',
  released: '2026-05-15',
  domains: [],
  types: TYPES,
};

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

describe('classifyColumn', () => {
  it('auto-accepts a checksum-valid GSTIN column', () => {
    const result = classifyColumn(
      BUNDLE,
      sample('vendor_gstin', ['29HBHZW6406C1ZR', '19TQXZH4579F1Z0', '29AAACI4775H1ZA']),
    );
    expect(result.candidates[0]?.typeId).toBe('gstin');
    expect(result.candidates[0]?.confidence).toBeGreaterThan(0.9);
    expect(result.resolution.kind).toBe('auto_accept');
  });

  it('classifies a value-set column (log level)', () => {
    const result = classifyColumn(
      BUNDLE,
      sample('level', ['info', 'info', 'warn', 'error', 'debug']),
    );
    expect(result.candidates[0]?.typeId).toBe('log_level');
    expect(result.resolution.kind).toBe('auto_accept');
  });

  it('returns unknown for an unrecognized column', () => {
    const result = classifyColumn(
      BUNDLE,
      sample('comments', ['Lorem ipsum', 'Some free text', 'More words']),
    );
    expect(result.resolution.kind).toBe('unknown');
  });

  it('classifies PAN by regex when header is generic', () => {
    const result = classifyColumn(
      BUNDLE,
      sample('id_code', ['ABCDE1234F', 'BCDEF2345G', 'CDEFG3456H']),
    );
    // PAN regex matches all values; header_match doesn't fire, so confidence
    // is bounded by the regex weight portion.
    expect(result.candidates[0]?.typeId).toBe('pan');
    expect(result.candidates[0]?.confidence).toBeGreaterThan(0.5);
  });
});
