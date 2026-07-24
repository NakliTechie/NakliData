// Agent surfaces — agent-authored-workbook contract tests (Chunk 5). Proves an
// agent can author a `.naklidata` from scratch and it restores, and guards the
// published JSON Schema against drift from what `parse()` actually enforces.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from '../src/core/persistence.ts';

const schema = JSON.parse(readFileSync('docs/naklidata-file.schema.json', 'utf8'));

/** The minimal workbook from docs/agent-authoring.md — an agent authoring from
 *  scratch, no live tab. */
const minimalWorkbook = {
  format: 'naklidata',
  version: '1.0',
  name: 'Revenue by region',
  sources: [],
  assignments: [],
  cells: [
    {
      id: 'c1',
      kind: 'sql',
      name: 'by_region',
      code: 'SELECT region, SUM(amount) AS revenue FROM orders GROUP BY 1 ORDER BY 2 DESC',
    },
  ],
  user_types: [],
  settings: { auto_accept_threshold: 0.9 },
};

describe('agent-authored .naklidata workbook', () => {
  it('a minimal from-scratch workbook parses + restores', () => {
    const restored = parse(JSON.stringify(minimalWorkbook));
    expect(restored.format).toBe('naklidata');
    expect(restored.version).toBe('1.0');
    expect(restored.cells).toHaveLength(1);
    const cell = restored.cells[0];
    expect(cell?.kind).toBe('sql');
    expect((cell as { code?: string }).code).toContain('SUM(amount)');
  });

  it('round-trips through serialize-shaped JSON without loss of the core fields', () => {
    const restored = parse(JSON.stringify(minimalWorkbook));
    const again = parse(JSON.stringify(restored));
    expect(again).toEqual(restored);
  });
});

describe('published JSON Schema stays honest vs parse()', () => {
  it("the schema's required set matches what parse() enforces", () => {
    // parse() hard-rejects a file missing format / a valid version / sources /
    // cells. The schema must require exactly those (drift guard).
    expect([...schema.required].sort()).toEqual(['cells', 'format', 'sources', 'version']);
  });

  it('parse() rejects a file missing each schema-required field', () => {
    for (const field of schema.required) {
      const broken: Record<string, unknown> = { ...minimalWorkbook };
      delete broken[field];
      expect(() => parse(JSON.stringify(broken))).toThrow();
    }
  });

  it('the schema declares the discriminator + version pattern parse() checks', () => {
    expect(schema.properties.format.const).toBe('naklidata');
    expect(schema.properties.version.pattern).toBe('^\\d+(\\.\\d+)*$');
    // a version failing that pattern is rejected by parse()
    expect(() => parse(JSON.stringify({ ...minimalWorkbook, version: '1.x' }))).toThrow();
  });
});
