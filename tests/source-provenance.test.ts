import { describe, expect, it } from 'vitest';
import type { MountedSource } from '../src/core/mount.ts';
import {
  describeSource,
  provenanceMarkdown,
  provenanceSummary,
} from '../src/core/source-provenance.ts';

const httpSrc: MountedSource = {
  id: 's1',
  kind: 'http',
  label: 'NYC Airbnb',
  ref: 'https://raw.githubusercontent.com/acme/data/main/ab_nyc.csv',
  tables: [
    {
      id: 't1',
      sourceId: 's1',
      name: 'ab_nyc',
      format: 'csv',
      origin: 'https://…/ab_nyc.csv',
      rowCount: 48895,
      registered: true,
    },
  ],
};

const fsaSrc: MountedSource = {
  id: 's2',
  kind: 'fsa-file',
  label: 'sales.csv',
  ref: 'handle-123',
  tables: [
    {
      id: 't2',
      sourceId: 's2',
      name: 'sales',
      format: 'csv',
      origin: 'sales.csv',
      rowCount: 5,
      registered: true,
    },
  ],
};

describe('describeSource', () => {
  it('extracts URL + host + tables for an http source', () => {
    const p = describeSource(httpSrc);
    expect(p.kindLabel).toBe('Public URL');
    expect(p.location).toBe('https://raw.githubusercontent.com/acme/data/main/ab_nyc.csv');
    expect(p.host).toBe('raw.githubusercontent.com');
    expect(p.tables).toEqual([{ name: 'ab_nyc', format: 'csv', rowCount: 48895 }]);
  });
  it('has no remote location for a local file (origin is per-table)', () => {
    const p = describeSource(fsaSrc);
    expect(p.kindLabel).toBe('Local file');
    expect(p.location).toBeNull();
    expect(p.host).toBeNull();
  });
});

describe('provenanceSummary (tooltip)', () => {
  it('shows kind + host for a URL source', () => {
    expect(provenanceSummary(httpSrc)).toBe('Public URL · raw.githubusercontent.com');
  });
  it('shows just the kind for a local source', () => {
    expect(provenanceSummary(fsaSrc)).toBe('Local file');
  });
});

describe('provenanceMarkdown (report block)', () => {
  it('lists each source with location + tables', () => {
    const md = provenanceMarkdown([httpSrc, fsaSrc]);
    expect(md).toContain('### Sources');
    expect(md).toContain(
      '- **NYC Airbnb** (Public URL) — `https://raw.githubusercontent.com/acme/data/main/ab_nyc.csv`',
    );
    expect(md).toContain('  - ab_nyc · csv · 48,895 rows');
    expect(md).toContain('- **sales.csv** (Local file)');
    expect(md).toContain('  - sales · csv · 5 rows');
  });
  it('is empty when there are no sources', () => {
    expect(provenanceMarkdown([])).toBe('');
  });
});
