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
  },
  getWorkspaceEpoch: () => 0,
  getWorkbookState: () => ({ sources: [], assignments: {} }),
  getBundle: () => null,
} as unknown as AgentSurfaceDeps;

function mockRoot() {
  const registered: WebMcpToolDef[] = [];
  const options: Array<{ signal?: AbortSignal; exposedTo?: string[] }> = [];
  const unregistered: string[] = [];
  return {
    root: {
      registerTool: async (
        def: WebMcpToolDef,
        registrationOptions?: { signal?: AbortSignal; exposedTo?: string[] },
      ) => {
        registered.push(def);
        options.push(registrationOptions ?? {});
        registrationOptions?.signal?.addEventListener('abort', () => unregistered.push(def.name), {
          once: true,
        });
      },
    },
    registered,
    options,
    unregistered,
  };
}

function registeredTool(defs: WebMcpToolDef[], name: string): WebMcpToolDef {
  const found = defs.find((def) => def.name === name);
  if (!found) throw new Error(`Missing registered test tool: ${name}`);
  return found;
}

describe('registerWithWebMcp', () => {
  it('asynchronously registers twelve v3 tools and no execution tool in WebMCP shape', async () => {
    const m = mockRoot();
    const reg = await registerWithWebMcp(m.root, deps, {
      exposedTo: ['https://naklidata.example'],
    });
    expect(reg.registered.sort()).toEqual(
      [
        'describe',
        'listTables',
        'listCells',
        'getCapabilities',
        'getLineage',
        'exportDataDictionary',
        'validateArtifact',
        'query',
        'proposeSqlCell',
        'proposeChart',
        'proposeQualityCheck',
        'proposeCleaningStep',
      ].sort(),
    );
    expect(reg.registered.some((name) => /run|execute/i.test(name))).toBe(false);
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
    expect(m.options).toHaveLength(12);
    expect(m.options.every((options) => options.signal === reg.signal)).toBe(true);
    expect(
      m.options.every((options) => options.exposedTo?.[0] === 'https://naklidata.example'),
    ).toBe(true);
  });

  it('returns the structured v3 envelope directly', async () => {
    const m = mockRoot();
    await registerWithWebMcp(m.root, deps);
    const listTables = registeredTool(m.registered, 'listTables');
    const out = await listTables.execute({});
    expect(out).toMatchObject({
      version: '3',
      ok: true,
      tool: 'listTables',
      data: [],
      meta: { provenance: { workspaceRevision: 0 } },
    });
  });

  it('flows a gated refusal through as a stable structured error', async () => {
    const m = mockRoot();
    await registerWithWebMcp(m.root, deps);
    const proposeCell = registeredTool(m.registered, 'proposeSqlCell');
    await expect(proposeCell.execute({ sql: 'SELECT 1' })).resolves.toMatchObject({
      version: '3',
      ok: false,
      scope: 'workspace:propose',
      error: { code: 'permission_denied' },
    });
  });

  it('aborts one shared lifetime to unregister every tool', async () => {
    const m = mockRoot();
    const reg = await registerWithWebMcp(m.root, deps);
    reg.unregister();
    expect(reg.signal.aborted).toBe(true);
    expect(m.unregistered.sort()).toEqual(reg.registered.sort());
  });

  it('rolls back earlier registrations when asynchronous registration fails', async () => {
    const signals: AbortSignal[] = [];
    let calls = 0;
    await expect(
      registerWithWebMcp(
        {
          registerTool: async (_def, options) => {
            calls++;
            if (options?.signal) signals.push(options.signal);
            if (calls === 3) throw new Error('origin trial rejected registration');
          },
        },
        deps,
      ),
    ).rejects.toThrow(/origin trial rejected/i);
    expect(signals).toHaveLength(3);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});
