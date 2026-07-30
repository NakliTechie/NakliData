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
    valuesEnabled: () => true,
    proposalsEnabled: () => true,
    ...overrides,
  };
}

const byName = (host: AgentHost) => {
  const tools = buildAgentTools(host);
  return new Map(tools.map((t) => [t.name, t]));
};

const tool = (host: AgentHost, name: string) => {
  const found = byName(host).get(name);
  if (!found) throw new Error(`Missing test tool: ${name}`);
  return found;
};

describe('buildAgentTools — catalogue shape', () => {
  it('exposes five verbs and no cell-execution capability', () => {
    const names = buildAgentTools(fakeHost())
      .map((t) => t.name)
      .sort();
    expect(names).toEqual(['describe', 'listCells', 'listTables', 'proposeCell', 'query'].sort());
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
  it('metadata reads are ungated while value reads and proposals are gated', () => {
    const m = byName(fakeHost());
    for (const n of ['describe', 'listTables', 'listCells']) {
      expect(m.get(n)?.annotations.readOnlyHint).toBe(true);
      expect(m.get(n)?.annotations.gated).toBe(false);
    }
    expect(m.get('query')?.annotations.readOnlyHint).toBe(true);
    expect(m.get('query')?.annotations.gated).toBe(true);
    expect(m.get('proposeCell')?.annotations.readOnlyHint).toBe(false);
    expect(m.get('proposeCell')?.annotations.gated).toBe(true);
    expect(m.has('runCell')).toBe(false);
  });
});

describe('read verbs use separate metadata and value gates', () => {
  it('describe returns the semantic layer', async () => {
    const r = await tool(fakeHost({ proposalsEnabled: () => false }), 'describe').execute({});
    expect(r).toEqual({
      ok: true,
      data: { version: '1', tables: [], taxonomyVersion: 'v1', sensitivityLayerLoaded: true },
    });
  });
  it('query passes the sql through to the host', async () => {
    const r = await tool(fakeHost(), 'query').execute({ sql: 'SELECT 1' });
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.data as { _sql: string })._sql).toBe('SELECT 1');
  });
  it('query rejects a bad input shape', async () => {
    const r = await tool(fakeHost(), 'query').execute({ notSql: 1 });
    expect(r).toEqual({ ok: false, error: 'query expects { sql: string }.' });
  });
  it('query is refused without the per-tab value grant', async () => {
    const r = await tool(fakeHost({ valuesEnabled: () => false }), 'query').execute({
      sql: 'SELECT 1',
    });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/value access/i) });
  });
});

describe('proposal gate (0b)', () => {
  it('proposeCell is refused when proposals are disabled', async () => {
    const p = await tool(fakeHost({ proposalsEnabled: () => false }), 'proposeCell').execute({
      sql: 'SELECT 1',
    });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.error).toMatch(/proposal access/i);
  });
  it('proposeCell returns the propose-dont-execute shape when enabled', async () => {
    const r = await tool(fakeHost(), 'proposeCell').execute({ sql: 'SELECT 42' });
    expect(r).toEqual({ ok: true, data: { id: 'cell1', sql: 'SELECT 42', editable: true } });
  });
  it('runCell remains unavailable even when proposals are enabled', async () => {
    const tools = buildAgentTools(fakeHost());
    const result = await dispatchAgentTool(tools, 'runCell', { id: 'c9' });
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/Unknown verb/) });
  });
});

describe('error wrapping + dispatch', () => {
  it('a host throw becomes { ok:false, error } (validator rejections surface here)', async () => {
    const host = fakeHost({
      query: async () => {
        throw new Error('Rejected: DROP is not allowed');
      },
    });
    const r = await tool(host, 'query').execute({ sql: 'DROP TABLE t' });
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
