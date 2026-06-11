// M2 — Cell Lineage Tracker.
//
// Pure functions: extract a cell's INPUTS (other cells, mounted
// tables, file paths) from a DuckDB EXPLAIN (FORMAT JSON) plan. The
// caller wraps these in a graph (`lineage-store.ts`) and renders
// (`lineage-panel.ts`).
//
// Why EXPLAIN-based, not regex (handoff §M2):
//   - CTE-shadow safety: `WITH vendors AS (...) SELECT * FROM vendors`
//     does NOT read the mounted `vendors` table. The plan walker sees
//     only the CTE scan; regex would have falsely emitted a vendors
//     edge.
//   - Inline-table-function safety: `FROM read_parquet('/p/x.parquet')`
//     never looks like a table identifier. The plan walker sees
//     READ_PARQUET with the filepath; regex would have missed it.
//
// Regex fallback exists only for cells that didn't parse (EXPLAIN
// itself errored). Those edges are tagged `confidence: 'low'`.

/** A single upstream input — either a registered DuckDB table/view
 *  (the common case: mounted source, `cell_<id>` view, CTE-resolved
 *  scan) or an inline file path (`read_parquet('/p/x.parquet')`-style). */
export type LineageInput = { kind: 'table'; name: string } | { kind: 'file'; path: string };

export interface LineageExtractResult {
  inputs: LineageInput[];
  confidence: 'high' | 'low';
  source: 'explain' | 'regex';
}

/**
 * Extract upstream inputs from a DuckDB EXPLAIN (FORMAT JSON) plan.
 *
 * Plan shape (DuckDB-wasm 1.x): a tree of nodes each with
 *  - `name`: operator name (`SEQ_SCAN`, `READ_PARQUET`, `READ_CSV`,
 *            `READ_CSV_AUTO`, `READ_JSON`, `PROJECTION`, `FILTER`,
 *            `HASH_JOIN`, `HASH_GROUP_BY`, `ORDER_BY`, `LIMIT`,
 *            `CTE`, `CTE_REF`, ...)
 *  - `children`: nested operators
 *  - `extra_info`: either a string ("Table: vendors\nProjections: ...")
 *                  or an object ({ Table: "vendors", ... }) depending
 *                  on the DuckDB build. We accept BOTH shapes.
 *
 * Walk algorithm:
 *  1. Recurse the tree, visiting every node.
 *  2. For any node whose name matches a SCAN-like pattern, pull the
 *     `Table` field (or `Function`/`File`/path) from `extra_info`.
 *  3. Deduplicate and return.
 *
 * CTE_REF / CHUNK_SCAN / DELIM_SCAN / EMPTY_RESULT are explicitly
 * ignored: they don't represent reads from a registered table.
 */
export function extractInputsFromPlan(plan: unknown): LineageInput[] {
  const seen = new Map<string, LineageInput>();
  walk(plan, (node) => {
    const input = inputFromNode(node);
    if (!input) return;
    const key = `${input.kind}:${input.kind === 'table' ? input.name : input.path}`;
    if (!seen.has(key)) seen.set(key, input);
  });
  return Array.from(seen.values());
}

function walk(
  node: unknown,
  visit: (n: Record<string, unknown>) => void,
  // Cycle guard: the plan normally arrives JSON-parsed (acyclic), but
  // `plan: unknown` lets a caller pass a live object graph, and a
  // self-referential node would otherwise spin forever. Mirrors the
  // `visited`-set guard in refresh.ts cascadeStaleness (forward-pass H4).
  seen: WeakSet<object> = new WeakSet(),
): void {
  if (Array.isArray(node)) {
    if (seen.has(node)) return;
    seen.add(node);
    for (const child of node) walk(child, visit, seen);
    return;
  }
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (seen.has(obj)) return;
    seen.add(obj);
    visit(obj);
    for (const v of Object.values(obj)) {
      if (typeof v === 'object' && v !== null) walk(v, visit, seen);
    }
  }
}

/**
 * SCAN-shape operator names that represent reads of a registered
 * table or an external file. Each maps to a different extractor for
 * the actual identifier.
 */
const TABLE_SCAN_OPS = new Set(['SEQ_SCAN', 'INDEX_SCAN', 'COLUMN_DATA_SCAN', 'TABLE_SCAN']);
const FILE_SCAN_OPS = new Set([
  'READ_PARQUET',
  'READ_CSV',
  'READ_CSV_AUTO',
  'READ_JSON',
  'READ_JSON_AUTO',
  'READ_NDJSON',
  'READ_ARROW',
]);

/** Operators that LOOK like scans but should NOT contribute lineage. */
const IGNORE_OPS = new Set([
  'CTE_REF',
  'CHUNK_SCAN',
  'DELIM_SCAN',
  'EMPTY_RESULT',
  'EXPRESSION_SCAN',
  'DUMMY_SCAN',
]);

function inputFromNode(node: Record<string, unknown>): LineageInput | null {
  const nameVal = node.name;
  const opTypeVal = node.operator_type;
  const name = typeof nameVal === 'string' ? nameVal.toUpperCase() : null;
  const operator = typeof opTypeVal === 'string' ? opTypeVal.toUpperCase() : null;
  const op = name ?? operator;
  if (!op) return null;
  if (IGNORE_OPS.has(op)) return null;

  if (TABLE_SCAN_OPS.has(op)) {
    const tableName = extractTableName(node);
    if (tableName) return { kind: 'table', name: tableName };
  }

  if (FILE_SCAN_OPS.has(op)) {
    const path = extractFilePath(node);
    if (path) return { kind: 'file', path };
  }

  return null;
}

/**
 * Pull the table name out of an `extra_info` blob. Two shapes:
 *  - Object: `{ "Table": "vendors", ... }` (newer DuckDB)
 *  - String: `"vendors\n[Projections: a, b]\n[Filters: ...]"`
 *           — the first non-bracketed line is the table name.
 *  - String with explicit key: `"Table: vendors\n..."` (some versions)
 *
 * The string form's first line is sometimes the table name standalone,
 * sometimes `Table: <name>`. Handle both.
 */
function extractTableName(node: Record<string, unknown>): string | null {
  const extra = node.extra_info;
  if (extra && typeof extra === 'object') {
    const eo = extra as Record<string, unknown>;
    const t = eo.Table;
    if (typeof t === 'string' && t.trim()) return t.trim();
    // Some DuckDB shapes use lowercase `table`.
    const t2 = eo.table;
    if (typeof t2 === 'string' && t2.trim()) return t2.trim();
  }
  if (typeof extra === 'string') {
    // Try `Table: <name>` first.
    const m1 = /(?:^|\n)\s*Table:\s*([^\n[]+?)\s*(?:\n|$)/i.exec(extra);
    if (m1?.[1]) return m1[1].trim();
    // Fallback: first non-bracketed line.
    const lines = extra.split('\n');
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('[')) continue;
      if (line.includes(':')) continue;
      return line;
    }
  }
  return null;
}

/**
 * Pull the file path out of an `extra_info` blob for a READ_X node.
 *
 * DuckDB plans for `read_parquet('/p/x.parquet')` produce a READ_PARQUET
 * node with extra_info containing either a `File` field (object form)
 * or a `/path/x.parquet` substring (string form).
 *
 * For `read_parquet` over multiple files (glob), we return the GLOB
 * pattern as-is — it's lineage signal, not a strict path.
 */
function extractFilePath(node: Record<string, unknown>): string | null {
  const extra = node.extra_info;
  if (extra && typeof extra === 'object') {
    const eo = extra as Record<string, unknown>;
    const f = eo.File;
    if (typeof f === 'string' && f.trim()) return f.trim();
    const fs = eo.Files;
    if (typeof fs === 'string' && fs.trim()) return fs.trim();
    if (Array.isArray(fs) && fs.length > 0 && typeof fs[0] === 'string') return fs[0];
    // Some versions embed the filepath in `Function` like `read_parquet('/p/x.parquet')`.
    const fn = eo.Function;
    if (typeof fn === 'string') {
      const m = /'([^']+)'/.exec(fn);
      if (m?.[1]) return m[1];
    }
  }
  if (typeof extra === 'string') {
    // Try to pull a path-like token from the blob. Matches (a) a
    // scheme URL (s3:// / gs:// / http(s):// / azure://) or (b) a path
    // ending in a known extension, optionally gzip-compressed and/or
    // followed by a query string (forward-pass H6 — the old regex
    // missed remote URLs, `.csv.gz`, and `…parquet?token=…`).
    const m =
      /'((?:s3|gs|https?|azure):\/\/[^']+|[^']+\.(?:parquet|csv|tsv|json|jsonl|ndjson|arrow|feather)(?:\.gz)?(?:\?[^']*)?)'/i.exec(
        extra,
      );
    if (m?.[1]) return m[1];
    // Or `File: /p/x.parquet`.
    const m2 = /(?:^|\n)\s*Files?:\s*([^\n]+)/i.exec(extra);
    if (m2?.[1]) return m2[1].trim();
  }
  return null;
}

/**
 * Low-confidence regex fallback for cells whose SQL didn't parse
 * cleanly. Tag every output as `confidence: 'low'`.
 *
 * Uses the same `@name`-extraction logic as `notebook-graph.ts`'s
 * `extractRefs` for cell-to-cell references, plus a permissive
 * FROM/JOIN sniff for direct table names.
 *
 * Caller passes the set of known table names so the regex can filter
 * matches against reality. Anything not in the allowlist is dropped.
 */
export function extractInputsFromSqlRegex(
  sql: string,
  knownTables: ReadonlySet<string>,
): LineageInput[] {
  // Strip line / block comments + string literals before sniffing.
  const stripped = sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"((?:[^"]|"")*)"/g, ' $1 '); // strip surrounding quotes from idents

  const inputs = new Map<string, LineageInput>();

  // FROM / JOIN <ident> — without trailing call-paren (`(` means function).
  const fromRe = /\b(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_]*)(?!\s*\()/gi;
  for (const m of stripped.matchAll(fromRe)) {
    const ident = m[1];
    if (!ident) continue;
    if (knownTables.has(ident)) {
      inputs.set(`table:${ident}`, { kind: 'table', name: ident });
    }
  }

  return Array.from(inputs.values());
}
