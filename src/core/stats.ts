// v1.3 M4 — Stats cell SQL emitters.
//
// Descriptive statistics + correlation matrix via DuckDB SQL only.
// No regression / modelling / math libraries — if a stat can't be
// expressed in DuckDB SQL or trivial JS, it's out of scope (handoff
// §M4).
//
// **Engine-boundary contract (v1.3 M0):** no DOM, no FSA, no browser
// globals. Pure SQL emission + identifier safety.
//
// **Identifier safety:** every column flows through `quoteIdent`;
// every table reference is also quoted. The emitter is airtight
// against hostile column names — same contract as the v1.2 M5 visual
// query builder + v1.3 M1 selection predicate builder.

/**
 * The column-type buckets the stats emitter recognises. Aligned with
 * the v1.2 M5 query-builder shape so callers can map their existing
 * taxonomy-to-bucket helper to it.
 *
 *   - numeric: SUM / AVG / STDDEV / MIN / MAX / MEDIAN expressible.
 *   - identifier: GSTIN / IFSC / email / etc. — excluded from numeric
 *     stats. Instead gets count + nulls + distinct count + (UI layer)
 *     validity check via the existing taxonomy validators.
 *   - other: count + nulls + distinct count only (date / string / boolean).
 */
export type StatsColumnType = 'numeric' | 'identifier' | 'other';

export interface StatsColumnSpec {
  /** Column name as it appears in the cell's result. */
  name: string;
  /** Bucket for this column. Driven by taxonomy + SQL type. */
  type: StatsColumnType;
}

/**
 * Emit ONE SQL statement that returns one row of descriptives across
 * all columns. The result row has columns of the shape
 * `<colName>__<stat>` where `<stat>` is one of:
 *   - count, nulls, distinct (always)
 *   - min, max, mean, stddev (numeric only)
 *
 * Median is emitted via DuckDB's `quantile_cont(<col>, 0.5)`. The
 * caller renders the row as a per-column descriptive table.
 *
 * Throws on column names containing control characters (defence in
 * depth; the UI should never feed those in).
 */
export function emitDescriptivesSql(
  tableName: string,
  columns: ReadonlyArray<StatsColumnSpec>,
): string {
  validateIdent(tableName);
  if (columns.length === 0) {
    return `SELECT 0 AS _empty_no_columns FROM ${quoteIdent(tableName)} LIMIT 0`;
  }
  const exprs: string[] = [];
  for (const c of columns) {
    validateIdent(c.name);
    const col = quoteIdent(c.name);
    const alias = (s: string) => quoteIdent(`${c.name}__${s}`);
    exprs.push(`COUNT(${col}) AS ${alias('count')}`);
    exprs.push(`SUM(CASE WHEN ${col} IS NULL THEN 1 ELSE 0 END) AS ${alias('nulls')}`);
    exprs.push(`COUNT(DISTINCT ${col}) AS ${alias('distinct')}`);
    if (c.type === 'numeric') {
      exprs.push(`MIN(${col}) AS ${alias('min')}`);
      exprs.push(`MAX(${col}) AS ${alias('max')}`);
      exprs.push(`AVG(CAST(${col} AS DOUBLE)) AS ${alias('mean')}`);
      exprs.push(`STDDEV(CAST(${col} AS DOUBLE)) AS ${alias('stddev')}`);
      // quantile_cont returns DOUBLE; works on any orderable type.
      exprs.push(`quantile_cont(CAST(${col} AS DOUBLE), 0.5) AS ${alias('median')}`);
    }
  }
  return `SELECT ${exprs.join(', ')} FROM ${quoteIdent(tableName)}`;
}

/**
 * Emit a SQL statement that computes the Pearson correlation matrix
 * over the supplied numeric columns. Returns ONE row with columns
 * shaped `corr__<a>__<b>` for each upper-triangle pair (including
 * self-correlation for completeness).
 *
 * Pearson is `corr(x, y)` in DuckDB — built-in aggregate. The
 * matrix is symmetric, so we emit only the upper triangle to halve
 * cost; the caller renders both sides from the same row.
 *
 * For < 2 numeric columns, returns a query that produces an empty
 * result so the caller can skip the matrix gracefully.
 */
export function emitCorrelationMatrixSql(
  tableName: string,
  numericColumns: ReadonlyArray<string>,
): string {
  validateIdent(tableName);
  if (numericColumns.length < 2) {
    return `SELECT 0 AS _empty_no_pairs FROM ${quoteIdent(tableName)} LIMIT 0`;
  }
  const exprs: string[] = [];
  for (let i = 0; i < numericColumns.length; i++) {
    for (let j = i; j < numericColumns.length; j++) {
      const a = numericColumns[i] as string;
      const b = numericColumns[j] as string;
      validateIdent(a);
      validateIdent(b);
      const aQ = quoteIdent(a);
      const bQ = quoteIdent(b);
      const alias = quoteIdent(`corr__${a}__${b}`);
      exprs.push(`corr(CAST(${aQ} AS DOUBLE), CAST(${bQ} AS DOUBLE)) AS ${alias}`);
    }
  }
  return `SELECT ${exprs.join(', ')} FROM ${quoteIdent(tableName)}`;
}

/**
 * Parse a descriptives result row back into a per-column structure.
 * The row column names are `<col>__<stat>`; this helper undoes the
 * encoding.
 *
 * Stats that aren't present for a column type (e.g., `mean` on a
 * non-numeric) are simply `undefined`.
 */
export interface ColumnDescriptives {
  name: string;
  count: number | null;
  nulls: number | null;
  distinct: number | null;
  min?: unknown;
  max?: unknown;
  mean?: number | null;
  stddev?: number | null;
  median?: number | null;
}

export function parseDescriptivesRow(
  row: Record<string, unknown>,
  columns: ReadonlyArray<StatsColumnSpec>,
): ColumnDescriptives[] {
  return columns.map((c) => {
    const get = <T>(stat: string): T | null => {
      const v = row[`${c.name}__${stat}`];
      return v === null || v === undefined ? null : (v as T);
    };
    const out: ColumnDescriptives = {
      name: c.name,
      count: get<number>('count'),
      nulls: get<number>('nulls'),
      distinct: get<number>('distinct'),
    };
    if (c.type === 'numeric') {
      out.min = row[`${c.name}__min`];
      out.max = row[`${c.name}__max`];
      out.mean = get<number>('mean');
      out.stddev = get<number>('stddev');
      out.median = get<number>('median');
    }
    return out;
  });
}

/**
 * Parse the correlation-matrix result row into a `{a, b, value}[]`
 * shape. Self-correlations (a === b) are included with value 1
 * (Pearson of a column against itself is 1 unless every value is
 * null, in which case it's null — preserved).
 *
 * The matrix is symmetric, so the caller can flip `(b, a)` from
 * `(a, b)` to fill the lower triangle when rendering.
 */
export function parseCorrelationRow(
  row: Record<string, unknown>,
  numericColumns: ReadonlyArray<string>,
): Array<{ a: string; b: string; value: number | null }> {
  const out: Array<{ a: string; b: string; value: number | null }> = [];
  for (let i = 0; i < numericColumns.length; i++) {
    for (let j = i; j < numericColumns.length; j++) {
      const a = numericColumns[i] as string;
      const b = numericColumns[j] as string;
      const v = row[`corr__${a}__${b}`];
      out.push({
        a,
        b,
        value: typeof v === 'number' && Number.isFinite(v) ? v : null,
      });
    }
  }
  return out;
}

// ── Helpers (engine-boundary safe) ──────────────────────────────────

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function validateIdent(name: string): void {
  if (!name) throw new Error('Stats SQL: identifier is required.');
  for (let i = 0; i < name.length; i++) {
    if (name.charCodeAt(i) < 0x20) {
      throw new Error(`Stats SQL: identifier contains control characters: ${JSON.stringify(name)}`);
    }
  }
}
