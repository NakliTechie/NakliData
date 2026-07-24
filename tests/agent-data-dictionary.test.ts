// Agent surfaces — data-dictionary serializer tests (Chunk 4). Pure: build a
// DescribeResult and assert the Markdown rendering, including the 0c discipline
// (redacted columns show no range) and table-cell escaping.

import { describe, expect, it } from 'vitest';
import { describeToMarkdown } from '../src/core/agent/data-dictionary.ts';
import type { DescribeResult, DescribedColumn } from '../src/core/agent/registry.ts';

const col = (over: Partial<DescribedColumn>): DescribedColumn => ({
  name: 'c',
  sqlType: 'VARCHAR',
  typeId: null,
  sensitivity: 'public',
  universalTerm: null,
  nullFraction: null,
  distinctCount: null,
  min: null,
  max: null,
  sampleValues: null,
  ...over,
});

const result = (over: Partial<DescribeResult> = {}): DescribeResult => ({
  version: '1',
  tables: [],
  taxonomyVersion: 'v0.1',
  sensitivityLayerLoaded: true,
  ...over,
});

describe('describeToMarkdown', () => {
  it('renders an empty workbook', () => {
    const md = describeToMarkdown(result());
    expect(md).toContain('# Data dictionary');
    expect(md).toContain('Envelope v1');
    expect(md).toContain('taxonomy v0.1');
    expect(md).toContain('0 tables');
    expect(md).toContain('_No tables mounted._');
  });

  it('renders a table with provenance + a column row', () => {
    const md = describeToMarkdown(
      result({
        tables: [
          {
            sourceId: 's1',
            tableId: 't1',
            name: 'orders',
            rowCount: 1234,
            provenance: {
              sourceLabel: 'Sales CSV',
              sourceKind: 'example-bundle',
              origin: 'orders.csv',
            },
            columns: [
              col({
                name: 'amount',
                sqlType: 'DECIMAL',
                typeId: 'amount',
                sensitivity: 'public',
                nullFraction: 0.1,
                distinctCount: 900,
                min: '5',
                max: '999',
              }),
            ],
          },
        ],
      }),
    );
    expect(md).toContain('## orders');
    expect(md).toContain('Source: Sales CSV (example-bundle) · orders.csv · 1,234 rows');
    expect(md).toMatch(/\| amount \| DECIMAL \| amount \| public \| 10% \| 900 \| 5 … 999 \|/);
  });

  it('redacts the range for a non-public column (0c)', () => {
    const md = describeToMarkdown(
      result({
        tables: [
          {
            sourceId: 's',
            tableId: 't',
            name: 'people',
            rowCount: 10,
            provenance: { sourceLabel: 'x', sourceKind: 'fsa', origin: null },
            columns: [
              // A pii column: describe() would already have left min/max null.
              col({
                name: 'email',
                typeId: 'email_address',
                sensitivity: 'pii',
                nullFraction: 0,
                distinctCount: 10,
                min: null,
                max: null,
              }),
            ],
          },
        ],
      }),
    );
    // pii row present, sensitivity shown, range is "—" (no value leaked).
    expect(md).toMatch(/\| email \| VARCHAR \| email_address \| pii \| 0% \| 10 \| — \|/);
  });

  it('escapes a pipe in a column name', () => {
    const md = describeToMarkdown(
      result({
        tables: [
          {
            sourceId: 's',
            tableId: 't',
            name: 'weird',
            rowCount: 1,
            provenance: { sourceLabel: 'x', sourceKind: 'fsa', origin: null },
            columns: [col({ name: 'a|b' })],
          },
        ],
      }),
    );
    expect(md).toContain('a\\|b');
  });

  it('flags a missing sensitivity layer', () => {
    const md = describeToMarkdown(result({ sensitivityLayerLoaded: false }));
    expect(md).toContain('sensitivity layer NOT loaded');
  });

  it('is deterministic', () => {
    const r = result({
      tables: [
        {
          sourceId: 's',
          tableId: 't',
          name: 'x',
          rowCount: 1,
          provenance: { sourceLabel: 'x', sourceKind: 'fsa', origin: null },
          columns: [col({ name: 'c' })],
        },
      ],
    });
    expect(describeToMarkdown(r)).toBe(describeToMarkdown(r));
  });
});
