// M4 — Propose-chart parser tests.
//
// Gate artifact per handoff §M4: the parser must reject any response
// that:
//   - isn't strict JSON
//   - has `chart_type` outside the 8-value allowlist
//   - references a column not in the input (hallucination guard)
//   - includes prose (we reject by virtue of "JSON-only")
// On rejection, the parser returns `{kind: 'propose-chart',
// proposal: null}` — the UI's cue to fall back to manual chart-cell
// insertion.

import { describe, expect, it } from 'vitest';
import { buildProposeChartPrompt, parseProposeChartResponse } from '../src/core/sidecar/client.ts';

const COLUMNS = ['vendor_name', 'amount', 'iso_date'];

describe('parseProposeChartResponse — happy path', () => {
  it('parses a well-formed bar chart proposal', () => {
    const raw = JSON.stringify({
      chart_type: 'bar',
      x_column: 'vendor_name',
      y_column: 'amount',
      group_column: null,
      title: 'Sum amount by vendor_name',
    });
    const res = parseProposeChartResponse(raw, COLUMNS);
    expect(res.proposal).toEqual({
      chartType: 'bar',
      xColumn: 'vendor_name',
      yColumn: 'amount',
      groupColumn: null,
      title: 'Sum amount by vendor_name',
    });
  });

  it('parses a histogram (no y_column)', () => {
    const raw = JSON.stringify({
      chart_type: 'histogram',
      x_column: 'amount',
      y_column: null,
      group_column: null,
      title: 'Distribution of amount',
    });
    const res = parseProposeChartResponse(raw, COLUMNS);
    expect(res.proposal?.chartType).toBe('histogram');
    expect(res.proposal?.yColumn).toBeNull();
  });

  it('handles a model that wraps the response in markdown fences', () => {
    const inner = JSON.stringify({
      chart_type: 'line',
      x_column: 'iso_date',
      y_column: 'amount',
      group_column: 'vendor_name',
      title: 'Amount over time by vendor',
    });
    const raw = `\`\`\`json\n${inner}\n\`\`\``;
    const res = parseProposeChartResponse(raw, COLUMNS);
    expect(res.proposal?.chartType).toBe('line');
    expect(res.proposal?.groupColumn).toBe('vendor_name');
  });

  it('tolerates a prose tail after the closing fence (forward-pass M18)', () => {
    const inner = JSON.stringify({
      chart_type: 'bar',
      x_column: 'vendor_name',
      y_column: 'amount',
      group_column: null,
      title: 'Sum amount by vendor_name',
    });
    // The old `/```$/` only matched a fence at the exact end — trailing
    // prose broke the parse. Extracting the fenced block fixes it.
    const raw = `Here you go:\n\`\`\`json\n${inner}\n\`\`\`\n\nHope this helps!`;
    const res = parseProposeChartResponse(raw, COLUMNS);
    expect(res.proposal?.chartType).toBe('bar');
    expect(res.proposal?.xColumn).toBe('vendor_name');
  });

  it('handles all eight allowed chart types', () => {
    const types = ['bar', 'line', 'area', 'scatter', 'pie', 'histogram', 'stat', 'table'] as const;
    for (const t of types) {
      const raw = JSON.stringify({
        chart_type: t,
        x_column: 'vendor_name',
        y_column: 'amount',
        group_column: null,
        title: `${t} chart`,
      });
      const res = parseProposeChartResponse(raw, COLUMNS);
      expect(res.proposal?.chartType).toBe(t);
    }
  });
});

describe('parseProposeChartResponse — rejection cases', () => {
  it('rejects non-JSON', () => {
    expect(parseProposeChartResponse('not json', COLUMNS).proposal).toBeNull();
  });

  it('rejects prose preface ("Here is a chart...")', () => {
    const inner = JSON.stringify({
      chart_type: 'bar',
      x_column: 'vendor_name',
      y_column: 'amount',
      group_column: null,
      title: 'A bar chart',
    });
    const raw = `Here is a chart for your data:\n${inner}`;
    expect(parseProposeChartResponse(raw, COLUMNS).proposal).toBeNull();
  });

  it('rejects an unknown chart type', () => {
    const raw = JSON.stringify({
      chart_type: 'doughnut',
      x_column: 'vendor_name',
      y_column: 'amount',
      group_column: null,
      title: 'A doughnut',
    });
    expect(parseProposeChartResponse(raw, COLUMNS).proposal).toBeNull();
  });

  it('rejects an x_column not in the input (hallucination guard)', () => {
    const raw = JSON.stringify({
      chart_type: 'bar',
      x_column: 'made_up_column',
      y_column: 'amount',
      group_column: null,
      title: 'Hallucinated bar',
    });
    expect(parseProposeChartResponse(raw, COLUMNS).proposal).toBeNull();
  });

  it('rejects a y_column not in the input', () => {
    const raw = JSON.stringify({
      chart_type: 'bar',
      x_column: 'vendor_name',
      y_column: 'fake_y',
      group_column: null,
      title: 'Hallucinated y',
    });
    expect(parseProposeChartResponse(raw, COLUMNS).proposal).toBeNull();
  });

  it('rejects a group_column not in the input', () => {
    const raw = JSON.stringify({
      chart_type: 'line',
      x_column: 'iso_date',
      y_column: 'amount',
      group_column: 'fake_group',
      title: 'Hallucinated grouping',
    });
    expect(parseProposeChartResponse(raw, COLUMNS).proposal).toBeNull();
  });

  it('rejects a missing title', () => {
    const raw = JSON.stringify({
      chart_type: 'bar',
      x_column: 'vendor_name',
      y_column: 'amount',
      group_column: null,
    });
    expect(parseProposeChartResponse(raw, COLUMNS).proposal).toBeNull();
  });

  it('rejects a title > 80 chars', () => {
    const title = 'x'.repeat(100);
    const raw = JSON.stringify({
      chart_type: 'bar',
      x_column: 'vendor_name',
      y_column: 'amount',
      group_column: null,
      title,
    });
    expect(parseProposeChartResponse(raw, COLUMNS).proposal).toBeNull();
  });

  it('rejects an empty title', () => {
    const raw = JSON.stringify({
      chart_type: 'bar',
      x_column: 'vendor_name',
      y_column: 'amount',
      group_column: null,
      title: '',
    });
    expect(parseProposeChartResponse(raw, COLUMNS).proposal).toBeNull();
  });

  it('rejects a non-object response (array)', () => {
    expect(parseProposeChartResponse('[]', COLUMNS).proposal).toBeNull();
  });

  it('rejects a chart_type field of wrong type (number)', () => {
    const raw = JSON.stringify({
      chart_type: 1,
      x_column: 'vendor_name',
      y_column: 'amount',
      group_column: null,
      title: 'A chart',
    });
    expect(parseProposeChartResponse(raw, COLUMNS).proposal).toBeNull();
  });
});

describe('buildProposeChartPrompt — prompt shape', () => {
  it('emits a system message that bans prose', () => {
    const { system } = buildProposeChartPrompt({
      kind: 'propose-chart',
      sql: 'SELECT vendor_name, SUM(amount) FROM invoices GROUP BY 1',
      columns: [
        { name: 'vendor_name', sqlType: 'VARCHAR' },
        { name: 'amount', sqlType: 'DOUBLE' },
      ],
      sampleRows: [{ vendor_name: 'Acme', amount: '1200' }],
      rowCount: 1,
    });
    expect(system).toMatch(/JSON ONLY/i);
    expect(system).toMatch(/NEVER include prose/i);
  });

  it('emits a user message that includes the SQL and sample rows', () => {
    const { user } = buildProposeChartPrompt({
      kind: 'propose-chart',
      sql: 'SELECT * FROM t',
      columns: [{ name: 'a', sqlType: 'BIGINT' }],
      sampleRows: [{ a: '1' }, { a: '2' }],
      rowCount: 2,
    });
    expect(user).toContain('SELECT * FROM t');
    expect(user).toContain('a (BIGINT)');
    expect(user).toContain('Row count: 2');
  });

  it('truncates very long SQL', () => {
    const { user } = buildProposeChartPrompt({
      kind: 'propose-chart',
      sql: 'SELECT '.repeat(200),
      columns: [{ name: 'a', sqlType: 'BIGINT' }],
      sampleRows: [],
      rowCount: 0,
    });
    expect(user.length).toBeLessThan(2000);
  });
});
