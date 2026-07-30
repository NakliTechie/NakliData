import { describe, expect, it } from 'vitest';
import {
  type AgentArtifactValidation,
  type AgentV3Host,
  buildAgentV3Tools,
  dispatchAgentV3Tool,
} from '../src/core/agent/registry-v3.ts';

function host(overrides: Partial<AgentV3Host> = {}): AgentV3Host {
  return {
    describe: () => ({
      version: '1',
      taxonomyVersion: 'taxonomy-1',
      sensitivityLayerLoaded: true,
      tables: [
        {
          sourceId: 'source-1',
          tableId: 'table-1',
          name: 'people',
          rowCount: 2,
          provenance: { sourceLabel: 'People', sourceKind: 'file', origin: 'people.csv' },
          columns: [
            {
              name: 'email',
              sqlType: 'VARCHAR',
              typeId: 'email',
              sensitivity: 'pii',
              universalTerm: 'ut:email',
              nullFraction: 0,
              distinctCount: 2,
              min: null,
              max: null,
              sampleValues: null,
            },
          ],
        },
      ],
    }),
    listTables: () => [
      {
        sourceId: 'source-1',
        tableId: 'table-1',
        name: 'people',
        rowCount: 2,
        columnCount: 1,
      },
    ],
    listCells: () => [],
    query: async () => ({
      columns: ['email'],
      rows: [{ email: '[redacted:pii]' }],
      rowCount: 1,
      redactedColumns: ['email'],
      sourceId: 'source-1',
      tableId: 'table-1',
      truncated: false,
    }),
    proposeCell: async (sql) => ({ id: 'c1', sql, editable: true }),
    proposeSqlCell: async (sql) => ({
      proposalType: 'sql-cell',
      createdCell: { id: 'c1', kind: 'sql', status: 'un-run' },
      preview: { sql },
      affectedObjects: [{ kind: 'cell', id: 'c1', label: 'c1' }],
      warnings: [],
      editable: true,
      humanAction: 'Review and click Run.',
    }),
    proposeChart: async ({ inputCellId, config }) => ({
      proposalType: 'chart',
      createdCell: { id: 'c2', kind: 'chart', status: 'un-run' },
      preview: { inputCellId, config },
      affectedObjects: [{ kind: 'cell', id: 'c2', label: config.title }],
      warnings: [],
      editable: true,
      humanAction: 'Review the chart.',
    }),
    proposeQualityCheck: async () => ({
      proposalType: 'quality-check',
      createdCell: { id: 'c3', kind: 'assertion', status: 'un-run' },
      preview: {},
      affectedObjects: [{ kind: 'cell', id: 'c3', label: 'quality check' }],
      warnings: [],
      editable: true,
      humanAction: 'Review and click Run.',
    }),
    valuesEnabled: () => true,
    proposalsEnabled: () => true,
    getLineage: () => ({
      version: 1,
      nodes: [{ id: 'source-1', kind: 'source', label: 'people' }],
      edges: [],
    }),
    validateArtifact: async (kind) =>
      ({
        kind,
        valid: true,
        errors: [],
        summary: { checked: true },
      }) satisfies AgentArtifactValidation,
    ...overrides,
  };
}

function context(permissionGranted = true) {
  return {
    workspaceRevision: 7,
    signal: new AbortController().signal,
    permissionGranted,
  };
}

describe('agent v3 registry', () => {
  it('discovers versions, scopes, bounds, adapters, tools, and no execution scope', async () => {
    const tools = buildAgentV3Tools(host());
    const result = await dispatchAgentV3Tool(tools, 'getCapabilities', {}, context());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as {
      contractVersion: string;
      executionScope: null;
      tools: Array<{ name: string; scope: string }>;
      deferredTools: Record<string, string>;
    };
    expect(data.contractVersion).toBe('3');
    expect(data.executionScope).toBeNull();
    expect(data.tools.map((tool) => tool.name)).toEqual([
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
    ]);
    expect(data.tools.some((tool) => /execute|runCell/i.test(tool.name))).toBe(false);
    expect(data.deferredTools.proposeCleaningStep).toMatch(/table-context cleaning/i);
    expect(data.tools.some((tool) => tool.name === 'proposeCleaningStep')).toBe(false);
  });

  it('returns provenance, bounds, redaction, and untrusted-content metadata', async () => {
    const result = await dispatchAgentV3Tool(
      buildAgentV3Tools(host()),
      'query',
      { sql: 'SELECT email FROM people' },
      context(),
    );
    expect(result).toMatchObject({
      version: '3',
      ok: true,
      tool: 'query',
      scope: 'values:read',
      meta: {
        provenance: {
          workspaceRevision: 7,
          sourceIds: ['source-1'],
          tableIds: ['table-1'],
        },
        bounds: { rowLimit: 1000, rowsReturned: 1, truncated: false },
        redaction: {
          applied: true,
          columns: ['email'],
          policy: 'semantic-sensitivity-v1',
        },
        untrustedContent: true,
      },
    });
  });

  it('fails with a stable permission code before a value tool executes', async () => {
    let called = false;
    const tools = buildAgentV3Tools(
      host({
        query: async () => {
          called = true;
          throw new Error('should not execute');
        },
      }),
    );
    const result = await dispatchAgentV3Tool(
      tools,
      'query',
      { sql: 'SELECT email FROM people' },
      context(false),
    );
    expect(result).toMatchObject({
      ok: false,
      scope: 'values:read',
      error: { code: 'permission_denied', retryable: false },
    });
    expect(called).toBe(false);
  });

  it('gates every proposal before mutation and never exposes an execution tool', async () => {
    let mutations = 0;
    const tools = buildAgentV3Tools(
      host({
        proposeSqlCell: async () => {
          mutations++;
          throw new Error('should not mutate');
        },
      }),
    );
    await expect(
      dispatchAgentV3Tool(tools, 'proposeSqlCell', { sql: 'SELECT 1' }, context(false)),
    ).resolves.toMatchObject({
      ok: false,
      scope: 'workspace:propose',
      error: { code: 'permission_denied' },
    });
    expect(mutations).toBe(0);
    expect(tools.some((tool) => /run|execute|apply/i.test(tool.name))).toBe(false);
  });

  it('returns the deterministic editable, un-run proposal contract', async () => {
    await expect(
      dispatchAgentV3Tool(
        buildAgentV3Tools(host()),
        'proposeSqlCell',
        { sql: 'SELECT 1' },
        context(),
      ),
    ).resolves.toMatchObject({
      ok: true,
      scope: 'workspace:propose',
      data: {
        proposalType: 'sql-cell',
        createdCell: { id: 'c1', kind: 'sql', status: 'un-run' },
        preview: { sql: 'SELECT 1' },
        editable: true,
        humanAction: expect.any(String),
      },
      meta: {
        bounds: { rowsReturned: null },
        untrustedContent: true,
      },
    });
  });

  it('rejects malformed and oversized proposals before host mutation', async () => {
    const tools = buildAgentV3Tools(host());
    await expect(
      dispatchAgentV3Tool(tools, 'proposeChart', { inputCellId: 'c1' }, context()),
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    await expect(
      dispatchAgentV3Tool(tools, 'proposeSqlCell', { sql: 'x'.repeat(64 * 1024 + 1) }, context()),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation_failed' } });
    await expect(
      dispatchAgentV3Tool(tools, 'proposeQualityCheck', {}, context()),
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  });

  it('maps validator refusals and malformed inputs to stable codes', async () => {
    const tools = buildAgentV3Tools(
      host({
        query: async () => {
          throw new Error('Agent value query refused because projection is ambiguous.');
        },
      }),
    );
    await expect(
      dispatchAgentV3Tool(tools, 'query', { sql: 'SELECT a + b FROM people' }, context()),
    ).resolves.toMatchObject({ ok: false, error: { code: 'safety_refusal' } });
    await expect(
      dispatchAgentV3Tool(tools, 'query', { nope: true }, context()),
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  });

  it('validates bounded artifacts without mutating the host workspace', async () => {
    let received: unknown = null;
    const tools = buildAgentV3Tools(
      host({
        validateArtifact: async (kind, artifact) => {
          received = artifact;
          return { kind, valid: true, errors: [], summary: { cells: 0 } };
        },
      }),
    );
    const artifact = { format: 'naklidata', version: '1.0' };
    const result = await dispatchAgentV3Tool(
      tools,
      'validateArtifact',
      { kind: 'naklidata', artifact },
      context(),
    );
    expect(result).toMatchObject({ ok: true, data: { kind: 'naklidata', valid: true } });
    expect(received).toBe(artifact);
  });

  it('returns stable unknown-tool and cancellation errors', async () => {
    const tools = buildAgentV3Tools(host());
    await expect(dispatchAgentV3Tool(tools, 'runCell', {}, context())).resolves.toMatchObject({
      ok: false,
      error: { code: 'unknown_tool' },
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      dispatchAgentV3Tool(
        tools,
        'describe',
        {},
        {
          workspaceRevision: 3,
          signal: controller.signal,
          permissionGranted: true,
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'cancelled', retryable: true } });
  });

  it('fails closed when workspace ownership changes during a call', async () => {
    let revision = 1;
    const base = host();
    const tools = buildAgentV3Tools(
      host({
        describe: async () => {
          revision = 2;
          return await base.describe();
        },
      }),
    );
    await expect(
      dispatchAgentV3Tool(
        tools,
        'describe',
        {},
        {
          workspaceRevision: 1,
          readWorkspaceRevision: () => revision,
          signal: new AbortController().signal,
          permissionGranted: true,
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'workspace_changed', retryable: true },
    });
  });
});
