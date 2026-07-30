import { describe, expect, it, vi } from 'vitest';
import {
  type AgentSurfaceDeps,
  boundedAgentQuerySql,
  createAgentHost,
  traceDirectResultProjection,
} from '../src/lazy/agent-surface.ts';
import type { TaxonomyBundle } from '../src/taxonomy/types.ts';

const bundle: TaxonomyBundle = {
  version: 'test',
  released: '2026-07-29',
  domains: [],
  types: [],
  universal: {
    terms: [
      {
        id: 'ut:public',
        prefLabel: 'Public',
        roleFamily: 'dimension',
        sensitivity: 'public',
      },
      {
        id: 'ut:email',
        prefLabel: 'Email',
        roleFamily: 'entity',
        sensitivity: 'pii',
      },
    ],
    crosswalk: [
      { role: 'public_name', universalTerm: 'ut:public' },
      { role: 'email_address', universalTerm: 'ut:email' },
    ],
  },
};

function bundleWithoutSensitivityLayer(): TaxonomyBundle {
  return {
    version: bundle.version,
    released: bundle.released,
    domains: bundle.domains,
    types: bundle.types,
  };
}

function assignment(columnName: string, typeId: string | null) {
  return {
    columnName,
    sqlType: 'VARCHAR',
    candidates: [],
    resolution: { kind: typeId ? 'auto_accept' : 'unknown' },
    assigned: {
      typeId,
      origin: typeId ? 'detector' : 'unknown',
      confidence: typeId ? 1 : 0,
    },
    status: 'classified',
  };
}

function makeDeps(opts: {
  activeBundle?: TaxonomyBundle | null;
  rows?: Array<Record<string, unknown>>;
}) {
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith('DESCRIBE')) {
      return [
        { column_name: 'name', column_type: 'VARCHAR' },
        { column_name: 'email', column_type: 'VARCHAR' },
        { column_name: 'mystery', column_type: 'VARCHAR' },
      ];
    }
    if (sql.includes('COUNT(*) AS _n')) {
      return [{ _n: 1, c0_nn: 1, c0_d: 1, c1_nn: 1, c1_d: 1, c2_nn: 1, c2_d: 1 }];
    }
    return opts.rows ?? [{ name: 'Asha', email: 'asha@example.com', mystery: 'not-classified' }];
  });
  const state = {
    sources: [
      {
        id: 'src_people',
        kind: 'fsa-file',
        label: 'People',
        tables: [
          {
            id: 'tbl_people',
            sourceId: 'src_people',
            name: 'people',
            format: 'csv',
            origin: 'people.csv',
            rowCount: 1,
            registered: true,
          },
        ],
      },
    ],
    assignments: {
      'src_people::tbl_people::name': assignment('name', 'public_name'),
      'src_people::tbl_people::email': assignment('email', 'email_address'),
      'src_people::tbl_people::mystery': assignment('mystery', null),
    },
    autoAcceptThreshold: 0.9,
    userTypes: [],
    overrideRules: [],
  };
  const deps = {
    engine: { query },
    notebook: {
      get: () => ({ cells: [] }),
      addCell: () => ({ id: 'c1', kind: 'sql' }),
      patchCell: () => {},
    },
    getWorkspaceEpoch: () => 0,
    getWorkbookState: () => state,
    getBundle: () => (opts.activeBundle === undefined ? bundle : opts.activeBundle),
  } as unknown as AgentSurfaceDeps;
  return { deps, query };
}

describe('agent value safety', () => {
  it('places the 1,000-row cap in SQL before materialization and tolerates a trailing semicolon', () => {
    expect(boundedAgentQuerySql(' SELECT name FROM people; ')).toBe(
      'SELECT * FROM (SELECT name FROM people) AS _agent_scope LIMIT 1000',
    );
  });

  it('exposes only the same strict direct projection as result provenance', () => {
    expect(traceDirectResultProjection('SELECT name, email FROM people')).toEqual({
      tableName: 'people',
      columns: ['name', 'email'],
    });
    expect(traceDirectResultProjection('SELECT * FROM people')).toEqual({
      tableName: 'people',
      columns: null,
    });
    expect(traceDirectResultProjection('SELECT email AS alias FROM people')).toBeNull();
    expect(traceDirectResultProjection('SELECT upper(email) FROM people')).toBeNull();
  });

  it('refuses every value query before execution when the sensitivity layer is missing', async () => {
    const noLayer = bundleWithoutSensitivityLayer();
    const { deps, query } = makeDeps({ activeBundle: noLayer });
    await expect(createAgentHost(deps).query('SELECT name FROM people')).rejects.toThrow(
      /sensitivity layer is unavailable/i,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it.each(['TABLE people', "VALUES ('raw')", 'FROM people SELECT name', 'DESCRIBE people'])(
    'rejects non-SELECT row form before engine execution: %s',
    async (sql) => {
      const { deps, query } = makeDeps({ activeBundle: bundle });
      await expect(createAgentHost(deps).query(sql)).rejects.toThrow(/must use SELECT/i);
      expect(query).not.toHaveBeenCalled();
    },
  );

  it('refuses aliases, expressions, CTE aliases, and joins before execution', async () => {
    const cases = [
      'SELECT email AS e FROM people',
      'SELECT upper(email) FROM people',
      'WITH p AS (SELECT email FROM people) SELECT email FROM p',
      'SELECT people.email FROM people JOIN people p2 ON true',
    ];
    for (const sql of cases) {
      const { deps, query } = makeDeps({});
      await expect(createAgentHost(deps).query(sql)).rejects.toThrow();
      expect(query).not.toHaveBeenCalled();
    }
  });

  it('returns direct public values and redacts direct sensitive and unclassified values', async () => {
    const { deps } = makeDeps({});
    const result = await createAgentHost(deps).query('SELECT name, email, mystery FROM people');
    expect(result.columns).toEqual(['name', 'email', 'mystery']);
    expect(result.redactedColumns).toEqual(['email', 'mystery']);
    expect(result.rows).toEqual([
      {
        name: 'Asha',
        email: '[redacted:pii]',
        mystery: '[redacted:unclassified]',
      },
    ]);
  });

  it('marks describe columns unavailable or unclassified and never enriches their ranges', async () => {
    const noLayer = bundleWithoutSensitivityLayer();
    const unavailable = await createAgentHost(makeDeps({ activeBundle: noLayer }).deps).describe();
    expect(unavailable.sensitivityLayerLoaded).toBe(false);
    expect(unavailable.tables[0]?.columns.map((column) => column.sensitivity)).toEqual([
      'unavailable',
      'unavailable',
      'unavailable',
    ]);
    expect(unavailable.tables[0]?.columns.every((column) => column.min === null)).toBe(true);

    const classified = await createAgentHost(makeDeps({}).deps).describe();
    expect(classified.tables[0]?.columns.map((column) => column.sensitivity)).toEqual([
      'public',
      'pii',
      'unclassified',
    ]);
    expect(classified.tables[0]?.columns[2]?.min).toBeNull();
  });
});
