// A3 — executive report-cell templates (briefing memo / operating review /
// dataset audit). Pure scaffold builder: markdown section cells + a
// ReportDefinition that cell-refs them.
import { describe, expect, it } from 'vitest';
import { validateReport } from '../src/core/report-layout.ts';
import { buildExecutiveReport } from '../src/ui/templates/templates.ts';

describe('buildExecutiveReport', () => {
  it('returns null for an unknown template id', () => {
    expect(buildExecutiveReport('nope', 'c_1', '2026-07-13')).toBeNull();
  });

  it('briefing memo: seeded markdown cells + a definition that refs them in order', () => {
    const s = buildExecutiveReport('briefing_memo', 'c_ab12', '2026-07-13');
    expect(s).not.toBeNull();
    if (!s) return;
    expect(s.markdownCells.map((m) => m.name)).toEqual([
      'c_ab12_summary',
      'c_ab12_findings',
      'c_ab12_recommendation',
    ]);
    expect(s.markdownCells[0]?.code).toContain('## Summary');
    expect(s.definition.title).toBe('Executive briefing');
    expect(s.definition.subtitle).toBe('Prepared 2026-07-13');
    expect(s.definition.items).toEqual([
      { kind: 'cell-ref', cellName: 'c_ab12_summary' },
      { kind: 'cell-ref', cellName: 'c_ab12_findings' },
      { kind: 'cell-ref', cellName: 'c_ab12_recommendation' },
    ]);
  });

  it('operating review: inserts a page-break before the segments section', () => {
    const s = buildExecutiveReport('operating_review', 'r', '2026-07-13');
    expect(s).not.toBeNull();
    if (!s) return;
    // page-break precedes the segments cell-ref.
    const kinds = s.definition.items.map((i) => i.kind);
    expect(kinds).toContain('page-break');
    const pbIdx = kinds.indexOf('page-break');
    const seg = s.definition.items[pbIdx + 1];
    expect(seg).toEqual({ kind: 'cell-ref', cellName: 'r_segments' });
  });

  it('dataset audit: four sections, all named + referenced', () => {
    const s = buildExecutiveReport('dataset_audit', 'r', '2026-07-13');
    expect(s).not.toBeNull();
    if (!s) return;
    expect(s.markdownCells).toHaveLength(4);
    // Every cell-ref resolves to a created markdown cell (report validates clean).
    const names = s.markdownCells.map((m) => m.name);
    expect(validateReport(s.definition, names)).toEqual([]);
  });

  it('produced definitions validate against the cells they create', () => {
    for (const id of ['briefing_memo', 'operating_review', 'dataset_audit']) {
      const s = buildExecutiveReport(id, 'seed', '2026-07-13');
      expect(s, id).not.toBeNull();
      if (!s) continue;
      expect(
        validateReport(
          s.definition,
          s.markdownCells.map((m) => m.name),
        ),
        id,
      ).toEqual([]);
    }
  });
});
