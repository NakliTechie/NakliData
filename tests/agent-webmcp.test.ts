// Agent surfaces — WebMCP adapter tests (Chunk 7). The adapter is a flag-gated
// spike (no live browser exercises it headless), so it earns a unit test against
// a MOCK WebMCP root: the registration shape + the execute→MCP-content mapping +
// the gate flowing through. Same tools + host as window.naklidata.

import { describe, expect, it } from 'vitest';
import {
  type AgentSurfaceDeps,
  type WebMcpToolDef,
  registerWithWebMcp,
} from '../src/lazy/agent-surface.ts';

/** Minimal stub deps — no engine/workbook needed for the verbs we exercise
 *  (listTables reads an empty workbook state; proposeCell is gated off). */
const deps = {
  engine: { query: async () => [] },
  notebook: {
    get: () => ({ cells: [] }),
    addCell: () => ({ id: 'c1', kind: 'sql' }),
    patchCell: () => {},
    runCell: async () => {},
  },
  isWritesEnabled: () => false,
  getWorkbookState: () => ({ sources: [], assignments: {} }),
  getBundle: () => null,
} as unknown as AgentSurfaceDeps;

function mockRoot() {
  const registered: WebMcpToolDef[] = [];
  const unregistered: string[] = [];
  return {
    root: {
      registerTool: (def: WebMcpToolDef) => {
        registered.push(def);
      },
      unregisterTool: (name: string) => {
        unregistered.push(name);
      },
    },
    registered,
    unregistered,
  };
}

describe('registerWithWebMcp', () => {
  it('registers all six verbs in WebMCP tool shape', () => {
    const m = mockRoot();
    const reg = registerWithWebMcp(m.root, deps);
    expect(reg.registered.sort()).toEqual(
      ['describe', 'listCells', 'listTables', 'proposeCell', 'query', 'runCell'].sort(),
    );
    for (const def of m.registered) {
      expect(typeof def.name).toBe('string');
      expect(typeof def.description).toBe('string');
      expect(def.inputSchema).toBeDefined();
      expect(def.annotations).toHaveProperty('readOnlyHint');
      expect(def.annotations).toHaveProperty('untrustedContentHint');
      // WebMCP annotations don't carry our internal `gated` flag.
      expect(def.annotations).not.toHaveProperty('gated');
      expect(typeof def.execute).toBe('function');
    }
  });

  it('maps an ok result to an MCP text-content result', async () => {
    const m = mockRoot();
    registerWithWebMcp(m.root, deps);
    const listTables = m.registered.find((d) => d.name === 'listTables')!;
    const out = await listTables.execute({});
    expect(out.isError).toBe(false);
    expect(out.content[0]?.type).toBe('text');
    expect(out.content[0]?.text).toBe('[]'); // empty workbook → no tables
  });

  it('flows a gated refusal through as isError', async () => {
    const m = mockRoot();
    registerWithWebMcp(m.root, deps);
    const proposeCell = m.registered.find((d) => d.name === 'proposeCell')!;
    const out = await proposeCell.execute({ sql: 'SELECT 1' });
    expect(out.isError).toBe(true);
    expect(out.content[0]?.text).toMatch(/error/i);
  });

  it('unregister removes every registered tool', () => {
    const m = mockRoot();
    const reg = registerWithWebMcp(m.root, deps);
    reg.unregister();
    expect(m.unregistered.sort()).toEqual(reg.registered.sort());
  });
});
