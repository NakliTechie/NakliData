// Facet crossfilter — turns a Temporal brush / Distribution bar selection into a
// SQL WHERE predicate that downstream cells inject via the `CROSSFILTER(name)`
// macro (the boolean-position analog of `SEGMENT(name)`; see core/measures.ts).
//
// A Facet view (Temporal / Distribution) writes its live selection onto its own
// cell state (`cell.selection`); the notebook builds a name→predicate map from
// those cells and threads it into the macro expander. So the "selection store"
// is just the notebook cells — no singleton, and the selection round-trips in
// `.naklidata` for free (persistence passes Facet-cell config through as-is).
//
// Pure + engine-boundary clean: no DOM, no globals, unit-testable in Node.

/**
 * A committed Facet selection. Plain-serializable (numbers + strings) so it
 * round-trips on the cell with no persistence changes.
 *   - `timeRange`  — a Temporal brush window (epoch-ms bounds over a time column)
 *   - `numRange`   — a Distribution numeric bin (a [lo, hi] slice of a number col)
 *   - `valueSet`   — a Distribution categorical bar (one or more exact values)
 */
export type FacetSelection =
  | { kind: 'timeRange'; col: string; lo: number; hi: number }
  | { kind: 'numRange'; col: string; lo: number; hi: number }
  | { kind: 'valueSet'; col: string; values: string[] };

/** Quote a column as a DuckDB identifier (double-quote, doubling embedded `"`). */
function quoteIdent(col: string): string {
  return `"${col.replace(/"/g, '""')}"`;
}

/** Single-quote a string literal (doubling embedded `'`). */
function quoteLiteral(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

/** epoch-ms → a DuckDB TIMESTAMP literal body `YYYY-MM-DD HH:MM:SS.mmm`. */
function tsLiteral(ms: number): string {
  return new Date(ms).toISOString().slice(0, 23).replace('T', ' ');
}

/**
 * Runtime guard — a cell's persisted `selection` came from an older/edited file
 * and might be malformed. The notebook skips anything this rejects (→ treated as
 * "no active selection" → the macro expands to TRUE, a no-op filter).
 */
export function isFacetSelection(x: unknown): x is FacetSelection {
  if (typeof x !== 'object' || x === null) return false;
  const s = x as Record<string, unknown>;
  if (typeof s.col !== 'string' || s.col.length === 0) return false;
  if (s.kind === 'timeRange' || s.kind === 'numRange') {
    return Number.isFinite(s.lo) && Number.isFinite(s.hi);
  }
  if (s.kind === 'valueSet') {
    return Array.isArray(s.values) && s.values.every((v) => typeof v === 'string');
  }
  return false;
}

/**
 * Compile a selection into a boolean SQL predicate. Sits in a WHERE position
 * (`WHERE CROSSFILTER(name)`), so it must always be a well-formed boolean.
 *
 * Time columns go through `TRY_CAST(… AS TIMESTAMP)` so the predicate works
 * whether the source column is TIMESTAMP, DATE, or a datetime-shaped VARCHAR
 * (mirrors how the Temporal cell coerces values for bucketing). Bounds are
 * inclusive to match the in-window count the Temporal readout shows.
 */
export function selectionToPredicate(sel: FacetSelection): string {
  const col = quoteIdent(sel.col);
  switch (sel.kind) {
    case 'timeRange': {
      const lo = Math.min(sel.lo, sel.hi);
      const hi = Math.max(sel.lo, sel.hi);
      return `TRY_CAST(${col} AS TIMESTAMP) BETWEEN TIMESTAMP '${tsLiteral(lo)}' AND TIMESTAMP '${tsLiteral(hi)}'`;
    }
    case 'numRange': {
      const lo = Math.min(sel.lo, sel.hi);
      const hi = Math.max(sel.lo, sel.hi);
      return `${col} BETWEEN ${lo} AND ${hi}`;
    }
    case 'valueSet': {
      if (sel.values.length === 0) return 'FALSE'; // empty set matches nothing
      return `${col} IN (${sel.values.map(quoteLiteral).join(', ')})`;
    }
  }
}
