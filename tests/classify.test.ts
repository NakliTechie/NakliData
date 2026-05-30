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

// W4.1 — Event-shape taxonomy seeds for product analytics. Loads the
// real types.jsonl (vs the inline TYPES above) and confirms each new
// type wins on a representative event-stream column.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

async function loadRealBundle(): Promise<TaxonomyBundle> {
  const here = dirname(fileURLToPath(import.meta.url));
  const typesText = await readFile(join(here, '..', 'taxonomy', 'v0.1', 'types.jsonl'), 'utf8');
  const types = typesText
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as TypeSpec);
  return { version: '0.1', released: '2026-05-15', domains: [], types };
}

describe('product-analytics taxonomy seeds (W4.1)', () => {
  it('classifies event_name on a low-cardinality named column', async () => {
    const bundle = await loadRealBundle();
    const result = classifyColumn(
      bundle,
      sample('event_name', [
        'page_view',
        'page_view',
        'signup',
        'signup',
        'add_to_cart',
        'purchase',
      ]),
    );
    expect(result.candidates[0]?.typeId).toBe('event_name');
  });

  it('classifies user_id on a high-cardinality id column', async () => {
    const bundle = await loadRealBundle();
    const result = classifyColumn(
      bundle,
      sample('user_id', ['u_abc123', 'u_def456', 'u_ghi789', 'u_jkl012', 'u_mno345']),
    );
    expect(result.candidates[0]?.typeId).toBe('user_id');
  });

  it('classifies session_id on a session-named column', async () => {
    const bundle = await loadRealBundle();
    const result = classifyColumn(
      bundle,
      sample('session_id', ['s_111', 's_222', 's_333', 's_444', 's_555']),
    );
    expect(result.candidates[0]?.typeId).toBe('session_id');
  });

  it('classifies event_properties_json when values start with {', async () => {
    const bundle = await loadRealBundle();
    const result = classifyColumn(
      bundle,
      sample('properties', ['{"price":12}', '{"price":34}', '{"qty":5}']),
    );
    expect(result.candidates[0]?.typeId).toBe('event_properties_json');
  });

  it('classifies utm_source / utm_medium / utm_campaign on UTM-named columns', async () => {
    const bundle = await loadRealBundle();
    const src = classifyColumn(
      bundle,
      sample('utm_source', ['google', 'facebook', 'newsletter', 'twitter']),
    );
    expect(src.candidates[0]?.typeId).toBe('utm_source');
    const med = classifyColumn(
      bundle,
      sample('utm_medium', ['cpc', 'cpc', 'organic', 'email', 'social']),
    );
    expect(med.candidates[0]?.typeId).toBe('utm_medium');
    const camp = classifyColumn(
      bundle,
      sample('utm_campaign', ['spring_sale', 'summer_promo', 'launch_2026']),
    );
    expect(camp.candidates[0]?.typeId).toBe('utm_campaign');
  });

  it('iso_datetime header-match list now includes event_timestamp', async () => {
    const bundle = await loadRealBundle();
    const result = classifyColumn(
      bundle,
      sample('event_timestamp', [
        '2026-05-30T12:00:00Z',
        '2026-05-30T12:00:01Z',
        '2026-05-30T12:00:02Z',
      ]),
    );
    expect(result.candidates[0]?.typeId).toBe('iso_datetime');
  });
});
