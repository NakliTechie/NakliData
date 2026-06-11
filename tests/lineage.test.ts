// M2 — Cell Lineage Tracker tests.
//
// Gate artifacts per handoff §M2:
//   1. CTE-shadow case: `WITH vendors AS (...) SELECT * FROM vendors`
//      against an existing mounted `vendors` table. Regex would have
//      false-positive'd; plan walker must NOT.
//   2. `FROM read_parquet('/p/x.parquet')` case. Regex misses; plan
//      walker must capture as a `file:/p/x.parquet` input.

import { describe, expect, it } from 'vitest';
import { type LineageGraph, LineageStore, emptyLineageGraph } from '../src/core/lineage-store.ts';
import {
  extractInputsFromPlan,
  extractInputsFromSqlRegex,
  mergeLineageInputs,
} from '../src/core/lineage.ts';

describe('extractInputsFromPlan — CTE shadow safety (gate case 1)', () => {
  it('a plain SEQ_SCAN over a mounted table returns the table as an input', () => {
    // The minimal shape DuckDB emits for `SELECT * FROM vendors`.
    const plan = {
      name: 'PROJECTION',
      children: [
        {
          name: 'SEQ_SCAN',
          extra_info: { Table: 'vendors' },
          children: [],
        },
      ],
    };
    const inputs = extractInputsFromPlan(plan);
    expect(inputs).toEqual([{ kind: 'table', name: 'vendors' }]);
  });

  it('a CTE_REF over a CTE shadowing the same name returns NO inputs', () => {
    // `WITH vendors AS (SELECT 1 AS a) SELECT * FROM vendors`
    // — the planner emits a CTE node + a CTE_REF, NOT a SEQ_SCAN of the
    // table called "vendors". The plan walker must skip CTE_REF.
    const plan = {
      name: 'PROJECTION',
      children: [
        {
          name: 'CTE_REF',
          extra_info: { CTE_INDEX: '0' },
          children: [],
        },
      ],
    };
    const inputs = extractInputsFromPlan(plan);
    expect(inputs).toEqual([]);
  });

  it('a CTE definition that ITSELF reads from a real table returns the real table', () => {
    // `WITH v AS (SELECT * FROM vendors) SELECT * FROM v`
    // — the planner emits a SEQ_SCAN of vendors INSIDE the CTE
    // definition node. The plan walker should follow it.
    const plan = {
      name: 'PROJECTION',
      children: [
        {
          name: 'CTE_REF',
          extra_info: { CTE_INDEX: '0' },
          children: [],
        },
        // CTE definition typically appears as a sibling subtree
        // OR as a child of the CTE op.
        {
          name: 'CTE',
          children: [
            {
              name: 'SEQ_SCAN',
              extra_info: { Table: 'vendors' },
              children: [],
            },
          ],
        },
      ],
    };
    const inputs = extractInputsFromPlan(plan);
    expect(inputs).toEqual([{ kind: 'table', name: 'vendors' }]);
  });
});

describe('extractInputsFromPlan — file-function case (gate case 2)', () => {
  it("`FROM read_parquet('/p/x.parquet')` returns the file path as an input", () => {
    const plan = {
      name: 'PROJECTION',
      children: [
        {
          name: 'READ_PARQUET',
          extra_info: { File: '/p/x.parquet' },
          children: [],
        },
      ],
    };
    const inputs = extractInputsFromPlan(plan);
    expect(inputs).toEqual([{ kind: 'file', path: '/p/x.parquet' }]);
  });

  it('READ_CSV with extra_info as a String returns the path token', () => {
    const plan = {
      name: 'READ_CSV',
      extra_info: "Function: read_csv_auto('/data/orders.csv', header=true)",
      children: [],
    };
    const inputs = extractInputsFromPlan(plan);
    expect(inputs).toEqual([{ kind: 'file', path: '/data/orders.csv' }]);
  });

  it('READ_JSON with object-form Files array returns the first path', () => {
    const plan = {
      name: 'READ_JSON',
      extra_info: { Files: ['/data/a.json', '/data/b.json'] },
      children: [],
    };
    const inputs = extractInputsFromPlan(plan);
    expect(inputs).toEqual([{ kind: 'file', path: '/data/a.json' }]);
  });
});

describe('extractInputsFromPlan — extra_info shape variations', () => {
  it('handles string extra_info with `Table: <name>` prefix', () => {
    const plan = {
      name: 'SEQ_SCAN',
      extra_info: 'Table: orders\n[Projections: order_id, customer_id]\n[Filters: ...]',
      children: [],
    };
    expect(extractInputsFromPlan(plan)).toEqual([{ kind: 'table', name: 'orders' }]);
  });

  it('handles string extra_info with bare table name as first non-bracketed line', () => {
    const plan = {
      name: 'SEQ_SCAN',
      extra_info: 'customers\n[Projections: customer_id, email]',
      children: [],
    };
    expect(extractInputsFromPlan(plan)).toEqual([{ kind: 'table', name: 'customers' }]);
  });

  it('dedupes the same table referenced twice in different subtrees', () => {
    const plan = {
      name: 'HASH_JOIN',
      children: [
        { name: 'SEQ_SCAN', extra_info: { Table: 'vendors' }, children: [] },
        { name: 'SEQ_SCAN', extra_info: { Table: 'vendors' }, children: [] },
      ],
    };
    expect(extractInputsFromPlan(plan)).toEqual([{ kind: 'table', name: 'vendors' }]);
  });

  it('handles a multi-table join, returning all distinct inputs', () => {
    const plan = {
      name: 'HASH_JOIN',
      children: [
        { name: 'SEQ_SCAN', extra_info: { Table: 'orders' }, children: [] },
        { name: 'SEQ_SCAN', extra_info: { Table: 'vendors' }, children: [] },
      ],
    };
    const result = extractInputsFromPlan(plan);
    expect(result).toContainEqual({ kind: 'table', name: 'orders' });
    expect(result).toContainEqual({ kind: 'table', name: 'vendors' });
    expect(result).toHaveLength(2);
  });

  it('ignores CHUNK_SCAN / DELIM_SCAN / EXPRESSION_SCAN / DUMMY_SCAN', () => {
    const plan = {
      name: 'PROJECTION',
      children: [
        { name: 'CHUNK_SCAN', extra_info: {}, children: [] },
        { name: 'DELIM_SCAN', extra_info: {}, children: [] },
        { name: 'EXPRESSION_SCAN', extra_info: {}, children: [] },
        { name: 'DUMMY_SCAN', extra_info: {}, children: [] },
      ],
    };
    expect(extractInputsFromPlan(plan)).toEqual([]);
  });

  it('handles operator_type field as alias for name (some DuckDB builds)', () => {
    const plan = {
      operator_type: 'SEQ_SCAN',
      extra_info: { Table: 'events' },
      children: [],
    };
    expect(extractInputsFromPlan(plan)).toEqual([{ kind: 'table', name: 'events' }]);
  });

  it('returns empty for an empty plan tree', () => {
    expect(extractInputsFromPlan({})).toEqual([]);
    expect(extractInputsFromPlan(null)).toEqual([]);
    expect(extractInputsFromPlan(undefined)).toEqual([]);
  });
});

describe('extractInputsFromSqlRegex — low-confidence fallback', () => {
  it('returns the table name for `SELECT * FROM vendors`', () => {
    const known = new Set(['vendors', 'orders']);
    expect(extractInputsFromSqlRegex('SELECT * FROM vendors', known)).toEqual([
      { kind: 'table', name: 'vendors' },
    ]);
  });

  it('filters by knownTables — unknown identifiers are dropped', () => {
    const known = new Set(['vendors']);
    expect(extractInputsFromSqlRegex('SELECT * FROM unknown_table', known)).toEqual([]);
  });

  it('captures JOIN identifiers too', () => {
    const known = new Set(['vendors', 'orders']);
    const inputs = extractInputsFromSqlRegex(
      'SELECT * FROM orders o JOIN vendors v ON o.vendor_id = v.id',
      known,
    );
    expect(inputs).toContainEqual({ kind: 'table', name: 'orders' });
    expect(inputs).toContainEqual({ kind: 'table', name: 'vendors' });
  });

  it('skips function-call FROM (e.g. FROM read_csv(...))', () => {
    // Regex fallback does NOT see file paths — handoff §M2 calls this out.
    // Only the plan walker handles the read_csv/read_parquet case.
    const known = new Set(['vendors']);
    const inputs = extractInputsFromSqlRegex("SELECT * FROM read_csv('/data/x.csv')", known);
    expect(inputs).toEqual([]);
  });

  it('strips block + line comments before matching', () => {
    const known = new Set(['vendors']);
    // The "FROM secret" hides inside a comment; should not match.
    const sql = '-- FROM secret\n/* SELECT * FROM secret */\nSELECT * FROM vendors';
    expect(extractInputsFromSqlRegex(sql, known)).toEqual([{ kind: 'table', name: 'vendors' }]);
  });

  it('strips string literals so quoted FROM tokens are ignored', () => {
    const known = new Set(['vendors']);
    // `FROM ghost` inside a string literal should not match.
    const sql = `SELECT 'FROM ghost' AS s, * FROM vendors`;
    expect(extractInputsFromSqlRegex(sql, known)).toEqual([{ kind: 'table', name: 'vendors' }]);
  });
});

describe('LineageStore — graph operations', () => {
  it('emptyLineageGraph returns a v1 graph with no nodes or edges', () => {
    const g = emptyLineageGraph();
    expect(g).toEqual({ version: 1, nodes: [], edges: [] });
  });

  it('upsertSource is idempotent', () => {
    const s = new LineageStore();
    s.upsertSource('vendors', 'Vendors', '/data/vendors.csv');
    s.upsertSource('vendors', 'Vendors (re-labeled)', '/data/vendors.csv');
    // setCellInputs to surface the node via toJSON's pruning
    s.setCellInputs({
      cellId: 'c1',
      cellLabel: 'cell_c1',
      inputs: [{ kind: 'table', name: 'vendors' }],
      confidence: 'high',
    });
    const g = s.toJSON();
    const node = g.nodes.find((n) => n.id === 'vendors');
    expect(node?.label).toBe('Vendors (re-labeled)');
  });

  it('setCellInputs builds source → cell edges', () => {
    const s = new LineageStore();
    s.setCellInputs({
      cellId: 'c1',
      cellLabel: 'q1',
      inputs: [{ kind: 'table', name: 'vendors' }],
      confidence: 'high',
    });
    const g = s.toJSON();
    expect(g.edges).toEqual([{ from: 'vendors', to: 'c1', confidence: 'high' }]);
    expect(g.nodes.some((n) => n.id === 'vendors' && n.kind === 'source')).toBe(true);
    expect(g.nodes.some((n) => n.id === 'c1' && n.kind === 'cell')).toBe(true);
  });

  it('setCellInputs translates `cell_<id>` references into upstream cell edges', () => {
    const s = new LineageStore();
    s.upsertCell('upstream', 'q_upstream');
    s.setCellInputs({
      cellId: 'downstream',
      cellLabel: 'q_downstream',
      inputs: [{ kind: 'table', name: 'cell_upstream' }],
      confidence: 'high',
    });
    const g = s.toJSON();
    expect(g.edges).toEqual([{ from: 'upstream', to: 'downstream', confidence: 'high' }]);
    // The `cell_upstream` source node is NOT auto-created — it was
    // identified as a cell view, so the edge points at the cell node.
    expect(g.nodes.find((n) => n.id === 'cell_upstream')).toBeUndefined();
    expect(g.nodes.find((n) => n.id === 'upstream' && n.kind === 'cell')).toBeDefined();
  });

  it('setCellInputs called a second time on the same cell REPLACES inbound edges', () => {
    const s = new LineageStore();
    s.setCellInputs({
      cellId: 'c1',
      cellLabel: 'q1',
      inputs: [{ kind: 'table', name: 'vendors' }],
      confidence: 'high',
    });
    s.setCellInputs({
      cellId: 'c1',
      cellLabel: 'q1',
      inputs: [{ kind: 'table', name: 'orders' }],
      confidence: 'high',
    });
    const g = s.toJSON();
    expect(g.edges).toEqual([{ from: 'orders', to: 'c1', confidence: 'high' }]);
    // vendors node should be pruned (no edges referencing it any more).
    expect(g.nodes.find((n) => n.id === 'vendors')).toBeUndefined();
  });

  it('removeCell drops the cell + its inbound edges', () => {
    const s = new LineageStore();
    s.setCellInputs({
      cellId: 'c1',
      cellLabel: 'q1',
      inputs: [{ kind: 'table', name: 'vendors' }],
      confidence: 'high',
    });
    s.removeCell('c1');
    const g = s.toJSON();
    expect(g.nodes.find((n) => n.id === 'c1')).toBeUndefined();
    expect(g.edges).toEqual([]);
  });

  it('cellRefs add cell→cell edges for @name references', () => {
    const s = new LineageStore();
    s.setCellInputs({
      cellId: 'c2',
      cellLabel: 'q2',
      inputs: [],
      cellRefs: [{ refCellId: 'c1', refLabel: 'q1' }],
      confidence: 'high',
    });
    const g = s.toJSON();
    expect(g.edges).toEqual([{ from: 'c1', to: 'c2', confidence: 'high' }]);
  });

  it('roundtrips a 3-hop chain via toJSON + loadFromJson', () => {
    const s = new LineageStore();
    // raw → join → agg → sink chain
    s.setCellInputs({
      cellId: 'join',
      cellLabel: 'q_join',
      inputs: [
        { kind: 'table', name: 'orders' },
        { kind: 'table', name: 'vendors' },
      ],
      confidence: 'high',
    });
    s.setCellInputs({
      cellId: 'agg',
      cellLabel: 'q_agg',
      inputs: [{ kind: 'table', name: 'cell_join' }],
      confidence: 'high',
    });
    s.setCellSinks('agg', [{ id: 'csv', label: 'CSV to ~/Downloads' }]);

    const snapshot = s.toJSON();
    expect(snapshot.nodes.length).toBeGreaterThan(0);
    expect(snapshot.edges.length).toBeGreaterThan(0);

    const s2 = new LineageStore();
    s2.loadFromJson(snapshot);
    const snapshot2 = s2.toJSON();
    expect(snapshot2.edges).toEqual(snapshot.edges);
    expect(snapshot2.nodes.map((n) => n.id).sort()).toEqual(snapshot.nodes.map((n) => n.id).sort());
  });

  it('dedupes edges + prefers high-confidence on the same pair', () => {
    const s = new LineageStore();
    s.setCellInputs({
      cellId: 'c1',
      cellLabel: 'q1',
      inputs: [{ kind: 'table', name: 'vendors' }],
      // explicit cell ref to the same upstream (would create an extra edge,
      // but setCellInputs dedupes within the cell).
      cellRefs: [],
      confidence: 'low',
    });
    s.setCellInputs({
      cellId: 'c1',
      cellLabel: 'q1',
      inputs: [{ kind: 'table', name: 'vendors' }],
      cellRefs: [],
      confidence: 'high',
    });
    const g = s.toJSON();
    expect(g.edges).toEqual([{ from: 'vendors', to: 'c1', confidence: 'high' }]);
  });

  it('loadFromJson with mismatched version ignores the load (defensive)', () => {
    const s = new LineageStore();
    s.setCellInputs({
      cellId: 'c1',
      cellLabel: 'q1',
      inputs: [{ kind: 'table', name: 'vendors' }],
      confidence: 'high',
    });
    s.loadFromJson({ version: 99, nodes: [], edges: [] } as unknown as LineageGraph);
    // Store gets cleared but the bad graph is rejected — net result: empty.
    expect(s.toJSON()).toEqual({ version: 1, nodes: [], edges: [] });
  });
});

describe('extractInputsFromPlan — cycle guard (forward-pass H4)', () => {
  it('terminates on a self-referential plan and still extracts inputs', () => {
    // `plan: unknown` means a caller can hand in a live object graph;
    // a node whose child points back at an ancestor would spin a naive
    // walker forever. The WeakSet guard must break the cycle.
    const scan: Record<string, unknown> = {
      name: 'SEQ_SCAN',
      extra_info: { Table: 'vendors' },
      children: [],
    };
    const root: Record<string, unknown> = { name: 'PROJECTION', children: [scan] };
    // Close the loop: the scan references the root back.
    (scan.children as unknown[]).push(root);

    const inputs = extractInputsFromPlan(root);
    expect(inputs).toEqual([{ kind: 'table', name: 'vendors' }]);
  });
});

describe('live duckdb-wasm 1.29.0 plan — regression for the empty-lineage bug', () => {
  // These fixtures are REAL `EXPLAIN (FORMAT JSON)` output captured from
  // @duckdb/duckdb-wasm@1.29.0 (the exact build vendored for the offline
  // bundle), not hand-authored shapes. The M2 fixtures used `{Table:'x'}`
  // with clean op names — shapes this build never emits — which is why the
  // unit tests stayed green while live source→cell lineage was broken.

  it('base-table SEQ_SCAN: trailing-space op name + `Text` key still extracts the table', () => {
    // Captured from `SELECT * FROM base_t` (a CREATE TABLE, i.e. an
    // Arrow-IPC mount). Note the trailing space in the op name and the
    // `Text` key (not `Table`).
    const plan = [
      {
        name: 'SEQ_SCAN ',
        children: [],
        extra_info: { Text: 'base_t', Projections: ['a', 'b'], 'Estimated Cardinality': '1' },
      },
    ];
    expect(extractInputsFromPlan(plan)).toEqual([{ kind: 'table', name: 'base_t' }]);
  });

  it('view-backed source: the inlined physical plan yields NO inputs on its own', () => {
    // Captured from `SELECT * FROM (SELECT * FROM invoices LIMIT 50)` where
    // `invoices` is `CREATE VIEW invoices AS SELECT * FROM read_csv_auto(...)`
    // (how the example bundle + every CSV/JSON/Parquet mount is registered).
    // DuckDB inlined the view: the plan is a bare READ_CSV_AUTO with no File
    // field and no table name. Documents WHY a plan-only walk returns [] —
    // the source name must come from the SQL sniff instead.
    const plan = [
      {
        name: 'STREAMING_LIMIT',
        children: [
          {
            name: 'READ_CSV_AUTO ',
            children: [],
            extra_info: {
              Function: 'READ_CSV_AUTO',
              Projections: ['invoice_id', 'vendor', 'amount'],
              'Estimated Cardinality': '5',
            },
          },
        ],
        extra_info: {},
      },
    ];
    expect(extractInputsFromPlan(plan)).toEqual([]);
  });

  it('view-backed source: plan walk ∪ catalog-filtered SQL sniff recovers `invoices`', () => {
    // The combination recordLineageForCell now performs. The plan contributes
    // nothing (view inlined); the sniff recovers the source name from the
    // query text, filtered against the live catalog.
    const plan = [
      {
        name: 'STREAMING_LIMIT',
        children: [
          { name: 'READ_CSV_AUTO ', children: [], extra_info: { Function: 'READ_CSV_AUTO' } },
        ],
        extra_info: {},
      },
    ];
    const rewritten = 'SELECT * FROM (SELECT * FROM invoices LIMIT 50)';
    const known = new Set(['invoices', 'vendors', 'payments']);
    const inputs = mergeLineageInputs(
      extractInputsFromPlan(plan),
      extractInputsFromSqlRegex(rewritten, known),
    );
    expect(inputs).toEqual([{ kind: 'table', name: 'invoices' }]);
  });

  it('CTE shadowing a real view emits NO edge even when EXPLAIN succeeds', () => {
    // `WITH invoices AS (SELECT 1 AS a) SELECT * FROM invoices` — the
    // physical plan has no scan of the catalog `invoices`, and the sniff
    // must drop the CTE-shadowed name. This is the §M2 guarantee, now upheld
    // on the plan-success path (the sniff runs alongside EXPLAIN, not only
    // on parse failure).
    const plan = [{ name: 'PROJECTION', children: [], extra_info: {} }];
    const rewritten = 'WITH invoices AS (SELECT 1 AS a) SELECT * FROM invoices';
    const known = new Set(['invoices']);
    const inputs = mergeLineageInputs(
      extractInputsFromPlan(plan),
      extractInputsFromSqlRegex(rewritten, known),
    );
    expect(inputs).toEqual([]);
  });

  it('base table + view join: plan-side base table ∪ sniff-side view, deduped', () => {
    // A base table (plan-visible) joined to a view (sniff-only). Both land,
    // and a name present in both lists is not duplicated.
    const plan = [
      {
        name: 'HASH_JOIN',
        children: [
          { name: 'SEQ_SCAN ', children: [], extra_info: { Text: 'base_t' } },
          { name: 'READ_CSV_AUTO ', children: [], extra_info: { Function: 'READ_CSV_AUTO' } },
        ],
        extra_info: {},
      },
    ];
    const rewritten = 'SELECT * FROM base_t b JOIN invoices i ON b.a = i.vendor';
    const known = new Set(['base_t', 'invoices']);
    const inputs = mergeLineageInputs(
      extractInputsFromPlan(plan),
      extractInputsFromSqlRegex(rewritten, known),
    );
    expect(inputs).toContainEqual({ kind: 'table', name: 'base_t' });
    expect(inputs).toContainEqual({ kind: 'table', name: 'invoices' });
    expect(inputs).toHaveLength(2);
  });
});

describe('mergeLineageInputs', () => {
  it('unions and dedupes by identity', () => {
    const a = [
      { kind: 'table', name: 'base_t' },
      { kind: 'file', path: '/p/x.parquet' },
    ] as const;
    const b = [
      { kind: 'table', name: 'base_t' }, // dup
      { kind: 'table', name: 'invoices' }, // new
    ] as const;
    expect(mergeLineageInputs(a, b)).toEqual([
      { kind: 'table', name: 'base_t' },
      { kind: 'file', path: '/p/x.parquet' },
      { kind: 'table', name: 'invoices' },
    ]);
  });

  it('handles empty inputs on either side', () => {
    expect(mergeLineageInputs([], [{ kind: 'table', name: 'x' }])).toEqual([
      { kind: 'table', name: 'x' },
    ]);
    expect(mergeLineageInputs([{ kind: 'table', name: 'x' }], [])).toEqual([
      { kind: 'table', name: 'x' },
    ]);
  });
});

describe('extractInputsFromSqlRegex — CTE-shadow exclusion', () => {
  it('drops a FROM match whose name is defined as a CTE', () => {
    const known = new Set(['vendors']);
    const sql = 'WITH vendors AS (SELECT 1 AS a) SELECT * FROM vendors';
    expect(extractInputsFromSqlRegex(sql, known)).toEqual([]);
  });

  it('keeps a real table read alongside a CTE that shadows a different name', () => {
    const known = new Set(['vendors', 'orders']);
    // `staging` is a CTE; `vendors` is a real table read in the CTE body.
    const sql =
      'WITH staging AS (SELECT * FROM vendors) SELECT * FROM staging JOIN orders USING (id)';
    const inputs = extractInputsFromSqlRegex(sql, known);
    expect(inputs).toContainEqual({ kind: 'table', name: 'vendors' });
    expect(inputs).toContainEqual({ kind: 'table', name: 'orders' });
    // `staging` is a CTE name → excluded even though it appears in FROM.
    expect(inputs).not.toContainEqual({ kind: 'table', name: 'staging' });
    expect(inputs).toHaveLength(2);
  });
});

describe('extractInputsFromPlan — extended path schemes (forward-pass H6)', () => {
  it('extracts an s3:// URL from a string extra_info blob', () => {
    const plan = {
      name: 'READ_PARQUET',
      extra_info: "Function: read_parquet('s3://bucket/data.parquet')",
      children: [],
    };
    expect(extractInputsFromPlan(plan)).toEqual([
      { kind: 'file', path: 's3://bucket/data.parquet' },
    ]);
  });

  it('extracts a gzip-compressed path with a query string', () => {
    const plan = {
      name: 'READ_CSV',
      extra_info: "read_csv('https://host.example/logs/access.csv.gz?token=abc')",
      children: [],
    };
    expect(extractInputsFromPlan(plan)).toEqual([
      { kind: 'file', path: 'https://host.example/logs/access.csv.gz?token=abc' },
    ]);
  });
});
