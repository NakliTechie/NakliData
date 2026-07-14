// Correlation-graph synthesis — turn a flat table into a graph so the Facet's
// analytics "fall out." Cribbed from the FrankenNetworkX tweet's best idea for a
// data workbench: even with no natural notion of edges, you can synthesize one
// by computing statistical dependency between series and thresholding it.
//
// Here: numeric COLUMNS become nodes; a strong pairwise Pearson correlation
// (|corr| ≥ threshold) becomes a weighted edge. The output is a DuckDB query
// emitting (source, target, weight) rows — exactly the edge-list shape the
// Network cell consumes (source/target = node ids, weight → edge width). Pure +
// engine-boundary clean: this only BUILDS the SQL string; the engine runs it.

export interface CorrelationGraphOptions {
  /**
   * Minimum absolute correlation for a pair to become an edge. Default 0.5 —
   * strong-enough to be interesting, loose enough to leave a connected graph.
   */
  threshold?: number;
  /**
   * Cap on the number of columns considered (pairs grow O(k²), and so does the
   * generated UNION). Extra columns beyond the cap are dropped. Default 60
   * (1770 pairs).
   */
  maxColumns?: number;
}

export const CORRELATION_GRAPH_DEFAULT_THRESHOLD = 0.5;
const DEFAULT_MAX_COLUMNS = 60;

export class CorrelationGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorrelationGraphError';
  }
}

/** Double-quote a DuckDB identifier, escaping embedded quotes. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Single-quote a SQL string literal, escaping embedded quotes. */
function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export interface CorrelationGraphPlan {
  /** The SQL to run (edge-list result: source, target, weight). */
  sql: string;
  /** Columns actually used (after the maxColumns cap). */
  columns: string[];
  /** Number of column pairs emitted before thresholding. */
  pairCount: number;
  /** True when maxColumns dropped some columns. */
  truncated: boolean;
  /** The absolute-correlation threshold applied. */
  threshold: number;
}

/**
 * Build the correlation-graph plan for `table` over its numeric `columns`.
 *
 * Emits, per unordered column pair (i < j), a row
 *   (source = colᵢ, target = colⱼ, weight = corr(colᵢ, colⱼ))
 * keeping only pairs whose |weight| ≥ threshold (and non-null — `corr` returns
 * NULL for a constant column), ordered by strongest first. DuckDB's `corr`
 * ignores rows where either value is NULL.
 *
 * Throws CorrelationGraphError if fewer than two usable columns are supplied.
 */
export function buildCorrelationGraphPlan(
  table: string,
  columns: readonly string[],
  opts: CorrelationGraphOptions = {},
): CorrelationGraphPlan {
  const threshold = opts.threshold ?? CORRELATION_GRAPH_DEFAULT_THRESHOLD;
  const maxColumns = opts.maxColumns ?? DEFAULT_MAX_COLUMNS;

  // De-dupe while preserving order (a result can't really have dup columns, but
  // be defensive), then cap.
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const c of columns) {
    if (!seen.has(c)) {
      seen.add(c);
      deduped.push(c);
    }
  }
  const truncated = deduped.length > maxColumns;
  const used = truncated ? deduped.slice(0, maxColumns) : deduped;

  if (used.length < 2) {
    throw new CorrelationGraphError(
      `A correlation graph needs at least two numeric columns; found ${used.length}. Pick a table with more numeric columns.`,
    );
  }

  const qTable = quoteIdent(table);
  const selects: string[] = [];
  for (let i = 0; i < used.length; i++) {
    for (let j = i + 1; j < used.length; j++) {
      const a = used[i] as string;
      const b = used[j] as string;
      selects.push(
        `SELECT ${quoteLiteral(a)} AS source, ${quoteLiteral(b)} AS target, ` +
          `corr(${quoteIdent(a)}, ${quoteIdent(b)}) AS weight FROM ${qTable}`,
      );
    }
  }

  const inner = selects.join('\n  UNION ALL\n  ');
  const sql = `SELECT source, target, weight FROM (\n  ${inner}\n) AS pairs\nWHERE weight IS NOT NULL AND abs(weight) >= ${threshold}\nORDER BY abs(weight) DESC`;

  return { sql, columns: used, pairCount: selects.length, truncated, threshold };
}
