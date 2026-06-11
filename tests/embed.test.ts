// v1.4 F9 — embed snippet tests.

import { describe, expect, it } from 'vitest';
import { buildEmbedSnippet } from '../src/core/embed.ts';

describe('buildEmbedSnippet', () => {
  it('wraps the doc in a sandboxed iframe srcdoc', () => {
    const snip = buildEmbedSnippet('<!DOCTYPE html><html><body>hi</body></html>');
    expect(snip).toMatch(/^<iframe /);
    expect(snip).toContain(' sandbox'); // empty sandbox = fully locked down
    expect(snip).toContain('srcdoc="');
    expect(snip).toContain('height:600px');
  });

  it('HTML-attribute-escapes the doc (& then ") so it round-trips', () => {
    const snip = buildEmbedSnippet('<p title="a & b">x</p>');
    // " → &quot;, & → &amp; (and the existing & escaped first)
    expect(snip).toContain(
      '&lt;p title=&quot;a &amp; b&quot;&gt;x&lt;/p&gt;'.replace(/&lt;|&gt;/g, (m) =>
        m === '&lt;' ? '<' : '>',
      ),
    );
    expect(snip).toContain('title=&quot;a &amp; b&quot;');
    // no raw double-quote from the doc leaks out to break the attribute
    expect(snip.split('srcdoc="')[1]?.split('"></iframe>')[0]).not.toContain('"');
  });

  it('clamps height to [120, 4000]', () => {
    expect(buildEmbedSnippet('x', { height: 10 })).toContain('height:120px');
    expect(buildEmbedSnippet('x', { height: 99999 })).toContain('height:4000px');
    expect(buildEmbedSnippet('x', { height: 800 })).toContain('height:800px');
  });

  it('does not grant allow-scripts / allow-same-origin (export has no JS)', () => {
    const snip = buildEmbedSnippet('<html></html>');
    expect(snip).not.toContain('allow-scripts');
    expect(snip).not.toContain('allow-same-origin');
  });
});
