// Resolve track M3 — Golden-table sink (Own).
//
// The Own verb of the Resolve track: collapse a result to ONE row per
// canonical entity (typically M1's `<col>__merged` column), choosing a
// surviving value per other column via a survivorship rule, and write the
// deduped table to a folder you keep. Customer 360, inverted to ownership —
// a file you hold, nothing pushed to a plane.
//
// **Engine-boundary contract (v1.3 M0):** pure logic only — no DOM, no FSA,
// no browser globals. Identifier quoting is delegated to the existing
// injection-safe emitter (query-builder.ts); aggregate function names come
// from a fixed allowlist, never from user input.

import { quoteIdent } from './query-builder.ts';

/** How to pick the surviving value when collapsing the rows of one entity. */
export type SurvivorshipRule = 'first' | 'max' | 'min' | 'latest';

export interface GoldenColumnPlan {
  columnName: string;
  rule: SurvivorshipRule;
}

export type GoldenFormat = 'csv' | 'parquet';

export interface GoldenSpec {
  /** Canonical-entity column to group by — one output row per distinct value. */
  entityColumn: string;
  /** Survivorship rule per column (the entity column itself is ignored). */
  columns: GoldenColumnPlan[];
  /**
   * Required when any column uses 'latest' — the column whose MAX picks the
   * surviving row (`arg_max`). Null otherwise.
   */
  orderColumn: string | null;
  format: GoldenFormat;
}

export const SURVIVORSHIP_RULES: ReadonlyArray<{ value: SurvivorshipRule; label: string }> = [
  { value: 'first', label: 'Keep first' },
  { value: 'max', label: 'Max' },
  { value: 'min', label: 'Min' },
  { value: 'latest', label: 'Latest (by order column)' },
];

/** True when the plan needs an order column (any 'latest' rule). */
export function needsOrderColumn(columns: ReadonlyArray<GoldenColumnPlan>): boolean {
  return columns.some((c) => c.rule === 'latest');
}

/**
 * Build the survivorship SELECT: one row per `entityColumn`, each other column
 * collapsed by its rule. Injection-safe by construction — every identifier
 * flows through `quoteIdent`; the aggregate function is chosen from a fixed
 * allowlist, never templated from user input.
 *
 *   SELECT "entity",
 *     first("name")           AS "name",
 *     max("amount")           AS "amount",
 *     arg_max("status", "ts") AS "status"
 *   FROM <source>
 *   GROUP BY "entity"
 *
 * The entity column is the GROUP BY key (emitted once); any plan entry naming
 * it is skipped. Throws if a 'latest' rule has no order column.
 */
export function buildGoldenSql(spec: GoldenSpec, sourceTable: string): string {
  const ent = quoteIdent(spec.entityColumn);
  const src = quoteIdent(sourceTable);
  const parts: string[] = [ent];
  for (const c of spec.columns) {
    if (c.columnName === spec.entityColumn) continue;
    const col = quoteIdent(c.columnName);
    parts.push(`${aggExpr(c.rule, col, spec.orderColumn)} AS ${col}`);
  }
  return `SELECT ${parts.join(', ')}\nFROM ${src}\nGROUP BY ${ent}`;
}

function aggExpr(rule: SurvivorshipRule, quotedCol: string, orderColumn: string | null): string {
  switch (rule) {
    case 'max':
      return `max(${quotedCol})`;
    case 'min':
      return `min(${quotedCol})`;
    case 'latest': {
      if (!orderColumn) {
        throw new Error('A "latest" survivorship rule needs an order column.');
      }
      return `arg_max(${quotedCol}, ${quoteIdent(orderColumn)})`;
    }
    default:
      // keep-first — DuckDB's first() aggregate (input order; the deterministic
      // recency option is 'latest').
      return `first(${quotedCol})`;
  }
}
