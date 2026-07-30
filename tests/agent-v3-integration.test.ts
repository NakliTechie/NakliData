import { describe, expect, it } from 'vitest';
import {
  type AgentSurfaceDeps,
  catalogueV3,
  dispatchV3,
  setAgentGrant,
  syncAgentAccess,
} from '../src/lazy/agent-surface.ts';

let epoch = 0;
const deps = {
  engine: { query: async () => [] },
  notebook: {
    get: () => ({ cells: [] }),
    addCell: () => ({ id: 'c1', kind: 'sql' }),
    patchCell: () => {},
  },
  getWorkspaceEpoch: () => epoch,
  getWorkbookState: () => ({ sources: [], assignments: {} }),
  getBundle: () => null,
  getLineageGraph: () => ({
    version: 1,
    nodes: [{ id: 's1', kind: 'source', label: 'orders' }],
    edges: [],
  }),
  validateArtifact: async (kind: 'naklidata') => ({
    kind,
    valid: true,
    errors: [],
    summary: { sourceCount: 0 },
  }),
} as unknown as AgentSurfaceDeps;

describe('lazy v3 agent runtime', () => {
  it('publishes the eight read tools and no execution/proposal tool yet', () => {
    const names = catalogueV3(deps).map((tool) => tool.name);
    expect(names).toEqual([
      'describe',
      'listTables',
      'listCells',
      'getCapabilities',
      'getLineage',
      'exportDataDictionary',
      'validateArtifact',
      'query',
    ]);
    expect(names.some((name) => /run|execute/i.test(name))).toBe(false);
  });

  it('enforces session grants and stable v3 errors around the pure registry', async () => {
    await expect(dispatchV3(deps, 'query', { nope: true })).resolves.toMatchObject({
      version: '3',
      ok: false,
      error: { code: 'permission_denied' },
    });
    setAgentGrant(deps, 'values:read', true);
    await expect(dispatchV3(deps, 'query', { nope: true })).resolves.toMatchObject({
      version: '3',
      ok: false,
      error: { code: 'invalid_input' },
    });
  });

  it('uses injected lineage and artifact validators without workspace mutation', async () => {
    await expect(dispatchV3(deps, 'getLineage', {})).resolves.toMatchObject({
      ok: true,
      data: { version: 1, nodes: [{ id: 's1' }] },
      meta: { untrustedContent: true },
    });
    await expect(
      dispatchV3(deps, 'validateArtifact', {
        kind: 'naklidata',
        artifact: { format: 'naklidata' },
      }),
    ).resolves.toMatchObject({
      ok: true,
      data: { kind: 'naklidata', valid: true },
    });
  });

  it('observes a workspace epoch immediately and clears the value grant', async () => {
    setAgentGrant(deps, 'values:read', true);
    epoch++;
    syncAgentAccess(deps);
    await expect(dispatchV3(deps, 'query', { nope: true })).resolves.toMatchObject({
      ok: false,
      error: { code: 'permission_denied' },
      meta: { provenance: { workspaceRevision: epoch } },
    });
  });
});
