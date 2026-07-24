// Agent surfaces — registry contract tests (Chunk 2). Pure: a fake host stands
// in for the browser binder, so we can lock the WebMCP-shaped catalogue, the
// read/write gate (0b), input-shape validation, and error-wrapping without an
// engine.

import { describe, expect, it } from 'vitest';
import { type AgentHost, buildAgentTools, dispatchAgentTool } from '../src/core/agent/registry.ts';

function fakeHost(overrides: Partial<AgentHost> = {}): AgentHost {
  return {
    describe: () => ({
      version: '1',
      tables: [],
      taxonomyVersion: 'v1',
      sensitivityLayerLoaded: true,
    }),
    listTables: () => [],
    listCells: () => [],
    query: async (sql: string) => ({
      columns: ['c'],
      rows: [{ c: 1 }],
      rowCount: 1,
      redactedColumns: [],
      _sql: sql,
    }),
    proposeCell: async (sql: string) => ({ id: 'cell1', sql, editable: true as const }),
    runCell: async (id: string) => ({ id, status: 'success' }),
    writesEnabled: () => true,
    ...overrides,
  };
}

const byName = (host: AgentHost) => {
  const tools = buildAgentTools(host);
  return new Map(tools.map((t) => [t.name, t]));
};

describe('buildAgentTools — catalogue shape', () => {
  it('exposes the six v1 verbs', () => {
    const names = buildAgentTools(fakeHost())
      .map((t) => t.name)
      .sort();
    expect(names).toEqual(
      ['describe', 'listCells', 'listTables', 'proposeCell', 'query', 'runCell'].sort(),
    );
  });
  it('every tool has a WebMCP-shaped contract', () => {
    for (const t of buildAgentTools(fakeHost())) {
      expect(typeof t.name).toBe('string');
      expect(typeof t.description).toBe('string');
      expect(t.inputSchema).toMatchObject({ type: 'object' });
      expect(t.annotations).toHaveProperty('readOnlyHint');
      expect(t.annotations).toHaveProperty('gated');
      expect(typeof t.execute).toBe('function');
    }
  });
  it('read verbs are readOnly + ungated; write verbs are gated + not readOnly', () => {
    const m = byName(fakeHost());
    for (const n of ['describe', 'listTables', 'listCells', 'query']) {
      expect(m.get(n)?.annotations.readOnlyHint).toBe(true);
      expect(m.get(n)?.annotations.gated).toBe(false);
    }
    for (const n of ['proposeCell', 'runCell']) {
      expect(m.get(n)?.annotations.readOnlyHint).toBe(false);
      expect(m.get(n)?.annotations.gated).toBe(true);
    }
  });
});

describe('read verbs work regardless of the write gate', () => {
  it('describe returns the semantic layer', async () => {
    const r = await byName(fakeHost({ writesEnabled: () => false }))
      .get('describe')!
      .execute({});
    expect(r).toEqual({
      ok: true,
      data: { version: '1', tables: [], taxonomyVersion: 'v1', sensitivityLayerLoaded: true },
    });
  });
  it('query passes the sql through to the host', async () => {
    const r = await byName(fakeHost()).get('query')!.execute({ sql: 'SELECT 1' });
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.data as { _sql: string })._sql).toBe('SELECT 1');
  });
  it('query rejects a bad input shape', async () => {
    const r = await byName(fakeHost()).get('query')!.execute({ notSql: 1 });
    expect(r).toEqual({ ok: false, error: 'query expects { sql: string }.' });
  });
});

describe('write gate (0b)', () => {
  it('proposeCell + runCell are refused when writes are disabled', async () => {
    const m = byName(fakeHost({ writesEnabled: () => false }));
    const p = await m.get('proposeCell')!.execute({ sql: 'SELECT 1' });
    const r = await m.get('runCell')!.execute({ id: 'c1' });
    expect(p.ok).toBe(false);
    expect(r.ok).toBe(false);
    if (!p.ok) expect(p.error).toMatch(/Settings/);
  });
  it('proposeCell returns the propose-dont-execute shape when enabled', async () => {
    const r = await byName(fakeHost()).get('proposeCell')!.execute({ sql: 'SELECT 42' });
    expect(r).toEqual({ ok: true, data: { id: 'cell1', sql: 'SELECT 42', editable: true } });
  });
  it('runCell executes when enabled', async () => {
    const r = await byName(fakeHost()).get('runCell')!.execute({ id: 'c9' });
    expect(r).toEqual({ ok: true, data: { id: 'c9', status: 'success' } });
  });
});

describe('error wrapping + dispatch', () => {
  it('a host throw becomes { ok:false, error } (validator rejections surface here)', async () => {
    const host = fakeHost({
      query: async () => {
        throw new Error('Rejected: DROP is not allowed');
      },
    });
    const r = await byName(host).get('query')!.execute({ sql: 'DROP TABLE t' });
    expect(r).toEqual({ ok: false, error: 'Rejected: DROP is not allowed' });
  });
  it('dispatchAgentTool routes by name', async () => {
    const tools = buildAgentTools(fakeHost());
    const r = await dispatchAgentTool(tools, 'listTables', {});
    expect(r).toEqual({ ok: true, data: [] });
  });
  it('dispatchAgentTool reports an unknown verb', async () => {
    const tools = buildAgentTools(fakeHost());
    const r = await dispatchAgentTool(tools, 'nope', {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Unknown verb "nope"/);
  });
});
