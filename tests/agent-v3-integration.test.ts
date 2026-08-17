import { beforeEach, describe, expect, it } from 'vitest';
import { _primeChunkForTests } from '../src/core/lazy-loader.ts';
import {
  type AgentSurfaceDeps,
  catalogueV3,
  dispatch,
  dispatchV3,
  setAgentGrant,
  syncAgentAccess,
} from '../src/lazy/agent-surface.ts';
import * as dataQualityChunk from '../src/lazy/data-quality.ts';

let epoch = 0;
let cells: Array<Record<string, unknown>> = [];
let runCalls = 0;
let cellSequence = 1;
const deps = {
  engine: { query: async () => [] },
  notebook: {
    get: () => ({ cells }),
    addCell: (kind: string) => {
      const cell =
        kind === 'chart'
          ? {
              id: `c${cellSequence++}`,
              kind,
              order: cells.length,
              name: null,
              inputCell: null,
              chartType: 'bar',
              x: null,
              y: null,
              facet: null,
            }
          : {
              id: `c${cellSequence++}`,
              kind,
              order: cells.length,
              name: null,
              code: '',
              status: 'idle',
              lastError: null,
              lastResult: null,
            };
      cells.push(cell);
      return cell;
    },
    patchCell: (id: string, patch: Record<string, unknown>) => {
      cells = cells.map((cell) => (cell.id === id ? { ...cell, ...patch } : cell));
    },
    runCell: async () => {
      runCalls++;
    },
  },
  getWorkspaceEpoch: () => epoch,
  getWorkbookState: () => ({
    sources: [
      {
        id: 'source-1',
        label: 'Orders',
        kind: 'file',
        tables: [{ id: 'table-1', name: 'orders', rowCount: 2 }],
      },
    ],
    assignments: {
      'source-1::table-1::amount': {
        columnName: 'amount',
        sqlType: 'DOUBLE',
        assigned: { typeId: null },
      },
    },
  }),
  getBundle: () => null,
  getLineageGraph: () => ({
    version: 1,
    nodes: [{ id: 's1', kind: 'source', label: 'orders' }],
    edges: [],
  }),
  getCleaningSuggestions: () => [
    {
      id: 'unpivot:revenue',
      label: 'Unpivot revenue columns',
      columns: ['revenue_2023', 'revenue_2024'],
      affected: 2,
      fraction: 1,
      rationale: 'Two compatible year columns share one stem.',
      sql: 'UNPIVOT "orders" ON "revenue_2023", "revenue_2024" INTO NAME "period" VALUE "revenue"',
      preview: [{ before: 'revenue_2023 | revenue_2024', after: 'period | revenue' }],
    },
  ],
  validateArtifact: async (kind: 'naklidata') => ({
    kind,
    valid: true,
    errors: [],
    summary: { sourceCount: 0 },
  }),
} as unknown as AgentSurfaceDeps;

describe('lazy v3 agent runtime', () => {
  beforeEach(() => {
    epoch++;
    syncAgentAccess(deps);
    cells = [];
    runCalls = 0;
    cellSequence = 1;
    _primeChunkForTests('data-quality', dataQualityChunk);
  });

  it('publishes twelve read/proposal tools and exposes no execution tool', () => {
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
      'proposeSqlCell',
      'proposeChart',
      'proposeQualityCheck',
      'proposeCleaningStep',
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

  it('routes v3 SQL and the v2 alias to the same editable, idle notebook path', async () => {
    setAgentGrant(deps, 'workspace:propose', true);
    await expect(
      dispatchV3(deps, 'proposeSqlCell', { sql: 'SELECT * FROM orders' }),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        createdCell: { kind: 'sql', status: 'un-run' },
        editable: true,
        humanAction: expect.any(String),
      },
    });
    await expect(
      dispatch(deps, 'proposeCell', { sql: 'SELECT amount FROM orders' }),
    ).resolves.toMatchObject({ ok: true, data: { editable: true } });
    expect(cells).toMatchObject([
      { kind: 'sql', code: 'SELECT * FROM orders', status: 'idle', lastResult: null },
      { kind: 'sql', code: 'SELECT amount FROM orders', status: 'idle', lastResult: null },
    ]);
    expect(runCalls).toBe(0);
  });

  it('adds a cached table-context cleaning proposal without executing it', async () => {
    setAgentGrant(deps, 'workspace:propose', true);
    await expect(
      dispatchV3(deps, 'proposeCleaningStep', {
        sourceId: 'source-1',
        tableId: 'table-1',
        suggestionId: 'unpivot:revenue',
      }),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        proposalType: 'cleaning-step',
        createdCell: { kind: 'sql', status: 'un-run' },
        preview: { suggestionId: 'unpivot:revenue' },
      },
    });
    expect(cells).toMatchObject([
      {
        kind: 'sql',
        status: 'idle',
        lastResult: null,
        code: expect.stringContaining('UNPIVOT'),
      },
    ]);
    expect(runCalls).toBe(0);
  });

  it('uses canonical chart inference/state and tagged quality assertion paths without running', async () => {
    cells = [
      {
        id: 'result-1',
        kind: 'sql',
        order: 0,
        name: 'orders_result',
        code: 'SELECT vendor, amount FROM orders',
        status: 'success',
        lastError: null,
        lastResult: {
          columns: ['vendor', 'amount'],
          rows: [
            { vendor: 'Acme', amount: 10 },
            { vendor: 'Beta', amount: 20 },
          ],
          rowCount: 2,
          elapsedMs: 1,
        },
      },
    ];
    setAgentGrant(deps, 'workspace:propose', true);
    await expect(
      dispatchV3(deps, 'proposeChart', {
        inputCellId: 'result-1',
        config: {
          chartType: 'bar',
          xColumn: null,
          yColumn: null,
          groupColumn: null,
          title: 'Amount by vendor',
        },
      }),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        createdCell: { kind: 'chart', status: 'un-run' },
        preview: {
          config: { xColumn: 'vendor', yColumn: 'amount' },
        },
      },
    });
    await expect(
      dispatchV3(deps, 'proposeQualityCheck', {
        check: {
          version: 1,
          id: 'amount_complete',
          name: 'amount_complete',
          kind: 'completeness',
          description: 'orders.amount should not be null.',
          table: 'orders',
          column: 'amount',
        },
      }),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        createdCell: { kind: 'assertion', status: 'un-run' },
        preview: { check: { id: 'amount_complete' } },
      },
      meta: {
        provenance: { sourceIds: ['source-1'], tableIds: ['table-1'] },
      },
    });
    expect(cells.find((cell) => cell.kind === 'chart')).toMatchObject({
      inputCell: 'result-1',
      x: 'vendor',
      y: 'amount',
    });
    expect(cells.find((cell) => cell.kind === 'assertion')).toMatchObject({
      status: 'idle',
      lastResult: null,
      code: expect.stringContaining('-- naklidata-quality: '),
    });
    expect(runCalls).toBe(0);
  });
});
