// M5 — Visual Query Builder: pure SQL emitter.
//
// **Strict no-string-concat-injection contract** (handoff §10 Hard NOT
// + §M5 explicit "do not port `compileVisualQuery`"):
//
//   - Every column / table identifier flows through `quoteIdent`
//     (wrap in `"`, double internal `"`).
//   - Every literal value flows through a TYPE-VALIDATED emitter:
//     - numeric columns: value must parse as a finite number → emitted bare
//     - string columns: emitted via `quoteLiteral` (wrap in `'`, double internal `'`)
//     - date / timestamp columns: value validated as ISO-8601 then quoted
//     - boolean: value validated as `'true' | 'false'` (case-insensitive)
//   - LIMIT is a number, validated against [1, 1_000_000].
//   - The emitter NEVER directly templates a user-supplied string into
//     the SQL without going through `quoteIdent` or `quoteLiteral`.
//
// Scope (handoff §M5 — deliberately small):
//   - Single source table, with an optional single JOIN on a single
//     key. No multi-join, no nested subqueries, no window functions.
//   - WHERE: AND-joined predicates per column.
//   - ORDER BY: single column.
//   - GROUP BY: zero or more columns + SUM / AVG / COUNT / MIN / MAX.
//   - LIMIT: defaults to 100; cap at 1M.
//   - Output goes to a NEW SQL cell — user clicks Run (Hard NOT #4).

export type QueryColumnType = 'numeric' | 'string' | 'date' | 'boolean';

export interface QueryColumnSpec {
  name: string;
  type: QueryColumnType;
}

export interface QueryBuilderSpec {
  /** Required: the primary source table. */
  fromTable: string;
  /**
   * Zero or more JOINs (v1.4 F6 — was a single optional join). Each
   * attaches `table` to an already-in-scope `leftTable` (the fromTable
   * or an earlier join's table) on `leftColumn = rightColumn`. Emitted
   * in order as inner JOINs.
   */
  joins: ReadonlyArray<{
    table: string;
    leftTable: string;
    leftColumn: string;
    rightColumn: string;
  }>;
  /** Columns to project; empty means SELECT *. */
  selectColumns: ReadonlyArray<{ table: string; column: string }>;
  /** Filter rows. AND-joined. */
  filters: ReadonlyArray<QueryFilter>;
  /** Single ORDER BY (null = no ORDER BY). */
  orderBy: { table: string; column: string; direction: 'ASC' | 'DESC' } | null;
  /** GROUP BY columns + aggregations. If groupBy is non-empty, every
   *  selectColumn must be either in `groupBy` or in `aggregates`. */
  groupBy: ReadonlyArray<{ table: string; column: string }>;
  aggregates: ReadonlyArray<{
    fn: 'SUM' | 'AVG' | 'COUNT' | 'MIN' | 'MAX';
    table: string;
    column: string;
    alias: string;
  }>;
  /** Row cap. Defaults to 100; capped at 1M. */
  limit: number;
}

export interface QueryFilter {
  table: string;
  column: string;
  columnType: QueryColumnType;
  op: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'LIKE' | 'IS NULL' | 'IS NOT NULL';
  value: string; // user-supplied; validated + escaped at emission
}

/**
 * Build an empty spec for a given source table. The minimum-spec result
 * — empty filters, no joins, no group-by — emits `SELECT * FROM "<table>"
 * LIMIT 100`.
 */
export function emptySpec(fromTable: string): QueryBuilderSpec {
  return {
    fromTable,
    joins: [],
    selectColumns: [],
    filters: [],
    orderBy: null,
    groupBy: [],
    aggregates: [],
    limit: 100,
  };
}

/**
 * Emit the SQL for a spec. Throws if the spec references identifiers
 * containing characters that can't be safely escaped — defence in
 * depth; the UI should never let this happen.
 */
export function emitSql(spec: QueryBuilderSpec): string {
  validateSpec(spec);

  const select = buildSelect(spec);
  const from = buildFrom(spec);
  const where = buildWhere(spec);
  const groupBy = buildGroupBy(spec);
  const orderBy = buildOrderBy(spec);
  const limit = buildLimit(spec);

  const parts: string[] = [`SELECT ${select}`, `FROM ${from}`];
  if (where) parts.push(`WHERE ${where}`);
  if (groupBy) parts.push(`GROUP BY ${groupBy}`);
  if (orderBy) parts.push(`ORDER BY ${orderBy}`);
  parts.push(`LIMIT ${limit}`);
  return parts.join('\n');
}

// ── Helpers (exported for testing) ──────────────────────────────────

/** Quote a DuckDB identifier (wrap in `"`, double internal `"`). */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Quote a SQL string literal (wrap in `'`, double internal `'`). */
export function quoteLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * Emit a filter-value literal, type-validated.
 *
 * Returns the SQL fragment OR null if the value can't be emitted
 * safely (the caller drops the filter and surfaces an error).
 */
export function emitValueLiteral(type: QueryColumnType, value: string): string | null {
  if (type === 'numeric') {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return String(n);
  }
  if (type === 'string') {
    return quoteLiteral(value);
  }
  if (type === 'date') {
    // Allow ISO 8601 dates / datetimes, including a 'Z' or a numeric
    // TZ offset (`+05:30` / `-08:00`) — forward-pass M15. Defence in
    // depth: only numerics + dashes + colons + 'T' + 'Z'/offset + dot.
    if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/.test(value)) {
      return null;
    }
    return quoteLiteral(value);
  }
  if (type === 'boolean') {
    const v = value.trim().toLowerCase();
    if (v === 'true') return 'TRUE';
    if (v === 'false') return 'FALSE';
    return null;
  }
  return null;
}

function validateSpec(spec: QueryBuilderSpec): void {
  if (!spec.fromTable) throw new Error('Query builder: fromTable is required.');
  // `< 1` alone lets NaN and Infinity through (both compare false), and
  // buildLimit would then emit `LIMIT NaN` — broken SQL (forward-pass H5).
  if (!Number.isFinite(spec.limit) || spec.limit < 1) {
    throw new Error('Query builder: LIMIT must be a finite number >= 1.');
  }
  // > 1_000_000 is clamped, not rejected — keeps the form forgiving.
  // Identifiers can't contain control characters or NULL bytes.
  const checkIdent = (s: string): void => {
    // Loop char codes instead of a regex literal so biome doesn't
    // flag the [\x00-\x1f] regex range as a lint.
    for (let i = 0; i < s.length; i++) {
      if (s.charCodeAt(i) < 0x20) {
        throw new Error(
          `Query builder: identifier contains control characters: ${JSON.stringify(s)}`,
        );
      }
    }
  };
  checkIdent(spec.fromTable);
  // Multi-join (F6): each join must attach to an in-scope table (the
  // fromTable or a table joined earlier) — otherwise the emitted ON
  // clause references a table that isn't in the FROM, a SQL error.
  const inScope = new Set<string>([spec.fromTable]);
  for (const j of spec.joins) {
    checkIdent(j.table);
    checkIdent(j.leftTable);
    checkIdent(j.leftColumn);
    checkIdent(j.rightColumn);
    if (!inScope.has(j.leftTable)) {
      throw new Error(
        `Query builder: join references "${j.leftTable}", which isn't the source table or an earlier join.`,
      );
    }
    inScope.add(j.table);
  }
  for (const c of spec.selectColumns) {
    checkIdent(c.table);
    checkIdent(c.column);
  }
  for (const f of spec.filters) {
    checkIdent(f.table);
    checkIdent(f.column);
  }
  for (const g of spec.groupBy) {
    checkIdent(g.table);
    checkIdent(g.column);
  }
  for (const a of spec.aggregates) {
    checkIdent(a.table);
    checkIdent(a.column);
    checkIdent(a.alias);
  }
  if (spec.orderBy) {
    checkIdent(spec.orderBy.table);
    checkIdent(spec.orderBy.column);
  }
  // H7 / M17 — aggregation consistency. Whenever the query aggregates
  // (GROUP BY present OR any aggregate), every plain projected column
  // must itself be grouped or be an aggregated column. Otherwise
  // buildSelect silently drops it (aggregation mode ignores
  // selectColumns) — for GROUP BY that's a hand-run GROUP BY error
  // (H7), and for aggregates-without-GROUP BY the selected columns
  // vanish into a single-row scalar with no warning (M17). Either way
  // the silent drop is surprising, so reject it.
  if (spec.groupBy.length > 0 || spec.aggregates.length > 0) {
    const key = (t: string, c: string): string => `${t} ${c}`;
    const grouped = new Set(spec.groupBy.map((g) => key(g.table, g.column)));
    const aggregated = new Set(spec.aggregates.map((a) => key(a.table, a.column)));
    for (const c of spec.selectColumns) {
      if (!grouped.has(key(c.table, c.column)) && !aggregated.has(key(c.table, c.column))) {
        throw new Error(
          `Query builder: "${c.table}"."${c.column}" is in SELECT but neither in GROUP BY nor aggregated.`,
        );
      }
    }
  }
}

function qualifiedColumn(table: string, column: string): string {
  return `${quoteIdent(table)}.${quoteIdent(column)}`;
}

function buildSelect(spec: QueryBuilderSpec): string {
  // Aggregation mode: emit GROUP BY columns + aggregates.
  if (spec.aggregates.length > 0) {
    const groupExprs = spec.groupBy.map((g) => qualifiedColumn(g.table, g.column));
    const aggExprs = spec.aggregates.map(
      (a) => `${a.fn}(${qualifiedColumn(a.table, a.column)}) AS ${quoteIdent(a.alias)}`,
    );
    const all = [...groupExprs, ...aggExprs];
    if (all.length === 0) return '*';
    return all.join(', ');
  }
  if (spec.selectColumns.length === 0) return '*';
  return spec.selectColumns.map((c) => qualifiedColumn(c.table, c.column)).join(', ');
}

function buildFrom(spec: QueryBuilderSpec): string {
  let from = quoteIdent(spec.fromTable);
  for (const j of spec.joins) {
    from += ` JOIN ${quoteIdent(j.table)} ON ${qualifiedColumn(j.leftTable, j.leftColumn)} = ${qualifiedColumn(j.table, j.rightColumn)}`;
  }
  return from;
}

function buildWhere(spec: QueryBuilderSpec): string | null {
  const preds: string[] = [];
  for (const f of spec.filters) {
    const col = qualifiedColumn(f.table, f.column);
    if (f.op === 'IS NULL' || f.op === 'IS NOT NULL') {
      preds.push(`${col} ${f.op}`);
      continue;
    }
    const lit = emitValueLiteral(f.columnType, f.value);
    if (lit === null) {
      // Skip the filter rather than emit a broken predicate. The
      // builder UI should already have flagged the invalid value;
      // this is defence in depth.
      continue;
    }
    preds.push(`${col} ${f.op} ${lit}`);
  }
  if (preds.length === 0) return null;
  return preds.join('\n  AND ');
}

function buildGroupBy(spec: QueryBuilderSpec): string | null {
  if (spec.groupBy.length === 0) return null;
  return spec.groupBy.map((g) => qualifiedColumn(g.table, g.column)).join(', ');
}

function buildOrderBy(spec: QueryBuilderSpec): string | null {
  if (!spec.orderBy) return null;
  return `${qualifiedColumn(spec.orderBy.table, spec.orderBy.column)} ${spec.orderBy.direction}`;
}

function buildLimit(spec: QueryBuilderSpec): string {
  return String(Math.max(1, Math.min(1_000_000, Math.floor(spec.limit))));
}
