// Report templates per spec §3.6. Six starter templates, type-gated.
// When the required semantic types are all present in mounted sources,
// the template surfaces in the "Suggested reports" panel.
//
// Each template renders to a small set of cells (SQL + chart + markdown).

import type { CellState, ChartCellState, MarkdownCellState, SqlCellState } from '../cells/types.ts';
import type { ColumnAssignment } from '../schema-panel.ts';

export interface Template {
  id: string;
  name: string;
  description: string;
  /** Semantic typeIds that must be present in the workbook for this template to surface. */
  requiredTypes: string[];
  /** Optional typeIds — passed in if present. */
  optionalTypes?: string[];
  /**
   * Generate cell states. `matched` maps typeId -> (table, column).
   * Tables for required types are guaranteed; optionals may be undefined.
   */
  instantiate: (matched: Record<string, ColumnRef | undefined>) => Omit<CellState, 'order'>[];
}

export interface ColumnRef {
  table: string;
  column: string;
}

/** Find the "best" assignment per typeId across all column assignments.
 *  Now considers same-table cohesion so a template's required types end up
 *  bound to columns from one consistent table whenever possible.
 */
export function indexByType(
  assignments: Record<string, ColumnAssignment>,
  sources: Array<{ tables: Array<{ id: string; name: string }> }>,
): Record<string, ColumnRef> {
  const tableNameById: Record<string, string> = {};
  for (const s of sources) {
    for (const t of s.tables) tableNameById[t.id] = t.name;
  }
  const score = (a: ColumnAssignment): number => {
    let s = a.assigned.confidence;
    if (a.assigned.origin === 'user_accept' || a.assigned.origin === 'user_override') s += 0.5;
    return s;
  };
  // Build candidates: typeId -> [{tableName, column, score}]
  const candidates: Record<string, Array<{ table: string; column: string; score: number }>> = {};
  for (const [key, a] of Object.entries(assignments)) {
    if (!a.assigned.typeId) continue;
    const [, tableId] = key.split('::');
    const tableName = tableId ? tableNameById[tableId] : undefined;
    if (!tableName) continue;
    const list = candidates[a.assigned.typeId] ?? [];
    list.push({ table: tableName, column: a.columnName, score: score(a) });
    candidates[a.assigned.typeId] = list;
  }
  // Score each table by how many distinct types it can cover. Pick types
  // greedily, preferring the table currently winning the most type coverage.
  const tableCoverage: Record<string, number> = {};
  for (const list of Object.values(candidates)) {
    const seenTables = new Set<string>();
    for (const c of list) {
      if (!seenTables.has(c.table)) {
        tableCoverage[c.table] = (tableCoverage[c.table] ?? 0) + 1;
        seenTables.add(c.table);
      }
    }
  }
  const out: Record<string, ColumnRef> = {};
  for (const [typeId, list] of Object.entries(candidates)) {
    // Pick the candidate with the highest (score, table-coverage,
    // column-name-length) — longer column names tend to be the "primary"
    // representative (e.g. total_amount beats cgst when both score 1.0).
    list.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const tcA = tableCoverage[a.table] ?? 0;
      const tcB = tableCoverage[b.table] ?? 0;
      if (tcB !== tcA) return tcB - tcA;
      return b.column.length - a.column.length;
    });
    const pick = list[0];
    if (pick) out[typeId] = { table: pick.table, column: pick.column };
  }
  return out;
}

/** Returns the list of templates whose required types are all matched.
 *  For each template, the matched columns are picked from a single source
 *  table when possible (so the generated SQL's FROM clause is consistent
 *  across the template's required types).
 */
export function findApplicableTemplates(
  templates: Template[],
  byType: Record<string, ColumnRef>,
  perType?: Record<string, Array<{ table: string; column: string; score: number }>>,
): Array<{ template: Template; matched: Record<string, ColumnRef | undefined> }> {
  const out: Array<{ template: Template; matched: Record<string, ColumnRef | undefined> }> = [];
  for (const t of templates) {
    if (t.requiredTypes.length === 0) {
      // No required types — pass through with whatever optionals are present.
      const matched: Record<string, ColumnRef | undefined> = {};
      for (const opt of t.optionalTypes ?? []) matched[opt] = byType[opt];
      out.push({ template: t, matched });
      continue;
    }
    const tableMatched = perType ? pickCohesiveTable(t.requiredTypes, perType) : null;
    if (tableMatched) {
      const matched: Record<string, ColumnRef | undefined> = { ...tableMatched };
      for (const opt of t.optionalTypes ?? []) matched[opt] = byType[opt];
      out.push({ template: t, matched });
      continue;
    }
    const ok = t.requiredTypes.every((req) => byType[req] !== undefined);
    if (!ok) continue;
    const matched: Record<string, ColumnRef | undefined> = {};
    for (const req of t.requiredTypes) matched[req] = byType[req];
    for (const opt of t.optionalTypes ?? []) matched[opt] = byType[opt];
    out.push({ template: t, matched });
  }
  return out;
}

/** Find the single table that covers all required types with the highest
 *  combined confidence. Returns null if no single table covers them. */
function pickCohesiveTable(
  requiredTypes: string[],
  perType: Record<string, Array<{ table: string; column: string; score: number }>>,
): Record<string, ColumnRef> | null {
  const tableScores: Record<string, { total: number; picks: Record<string, ColumnRef> }> = {};
  for (const reqType of requiredTypes) {
    const candidates = perType[reqType] ?? [];
    for (const cand of candidates) {
      const entry = tableScores[cand.table] ?? { total: 0, picks: {} };
      const existing = entry.picks[reqType];
      // Keep the highest-scoring column per (table, reqType).
      const prev = candidates.find((c) => c.table === cand.table && c.column === existing?.column);
      const prevScore = prev?.score ?? -1;
      if (cand.score > prevScore) {
        entry.picks[reqType] = { table: cand.table, column: cand.column };
        entry.total = Object.values(entry.picks)
          .map(
            (p) => candidates.find((c) => c.table === p.table && c.column === p.column)?.score ?? 0,
          )
          .reduce((s, n) => s + n, 0);
      }
      tableScores[cand.table] = entry;
    }
  }
  let best: { table: string; total: number; picks: Record<string, ColumnRef> } | null = null;
  for (const [table, entry] of Object.entries(tableScores)) {
    if (Object.keys(entry.picks).length !== requiredTypes.length) continue;
    if (!best || entry.total > best.total) {
      best = { table, total: entry.total, picks: entry.picks };
    }
  }
  return best ? best.picks : null;
}

/** Variant of indexByType that also returns the per-type candidate list. */
export function indexByTypeWithCandidates(
  assignments: Record<string, ColumnAssignment>,
  sources: Array<{ tables: Array<{ id: string; name: string }> }>,
): {
  byType: Record<string, ColumnRef>;
  perType: Record<string, Array<{ table: string; column: string; score: number }>>;
} {
  const tableNameById: Record<string, string> = {};
  for (const s of sources) for (const t of s.tables) tableNameById[t.id] = t.name;
  const score = (a: ColumnAssignment): number => {
    let s = a.assigned.confidence;
    if (a.assigned.origin === 'user_accept' || a.assigned.origin === 'user_override') s += 0.5;
    return s;
  };
  const perType: Record<string, Array<{ table: string; column: string; score: number }>> = {};
  for (const [key, a] of Object.entries(assignments)) {
    if (!a.assigned.typeId) continue;
    const [, tableId] = key.split('::');
    const tableName = tableId ? tableNameById[tableId] : undefined;
    if (!tableName) continue;
    const list = perType[a.assigned.typeId] ?? [];
    list.push({ table: tableName, column: a.columnName, score: score(a) });
    perType[a.assigned.typeId] = list;
  }
  const byType = indexByType(assignments, sources);
  return { byType, perType };
}

function q(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

function sql(name: string, code: string, pinned = false): Omit<SqlCellState, 'order'> {
  return {
    id: '',
    kind: 'sql',
    name,
    code,
    status: 'idle',
    lastError: null,
    lastResult: null,
    pinned,
  };
}

function md(text: string): Omit<MarkdownCellState, 'order'> {
  return { id: '', kind: 'markdown', name: null, code: text };
}

function chart(
  type: ChartCellState['chartType'],
  _inputName: string,
  x: string | null,
  y: string | null,
): Omit<ChartCellState, 'order'> {
  // The instantiator wires inputCell to the most recent SQL cell with a name.
  // `_inputName` is documentation-only.
  return {
    id: '',
    kind: 'chart',
    name: null,
    inputCell: null,
    chartType: type,
    x,
    y,
    facet: null,
  };
}

// --- Templates -----------------------------------------------------------

export const AR_AGING: Template = {
  id: 'ar_aging',
  name: 'AR aging',
  description: 'Bucket open invoices by days overdue. Requires invoice date + amount + vendor.',
  requiredTypes: ['iso_date', 'amount', 'vendor_name'],
  instantiate(m) {
    const d = m.iso_date!;
    const a = m.amount!;
    const v = m.vendor_name!;
    return [
      md('# AR aging\n\nOpen amounts by overdue bucket.'),
      sql(
        'open_invoices',
        `SELECT ${q(v.column)} AS vendor, ${q(d.column)} AS invoice_date, ${q(a.column)} AS amount,
       DATE_DIFF('day', CAST(${q(d.column)} AS DATE), CURRENT_DATE) AS days_overdue
FROM ${q(d.table)}
ORDER BY days_overdue DESC`,
      ),
      sql(
        'ar_aging',
        `SELECT
  CASE
    WHEN days_overdue <= 0 THEN '0 (not yet due)'
    WHEN days_overdue <= 30 THEN '1-30'
    WHEN days_overdue <= 60 THEN '31-60'
    WHEN days_overdue <= 90 THEN '61-90'
    ELSE '90+'
  END AS bucket,
  SUM(amount) AS total_amount,
  COUNT(*) AS invoice_count
FROM @open_invoices
GROUP BY 1
ORDER BY 1`,
      ),
      chart('bar', 'ar_aging', 'bucket', 'total_amount'),
    ];
  },
};

export const VENDOR_CONCENTRATION: Template = {
  id: 'vendor_concentration',
  name: 'Vendor concentration',
  description: 'Top vendors by spend. Pareto-style.',
  requiredTypes: ['vendor_name', 'amount'],
  instantiate(m) {
    const v = m.vendor_name!;
    const a = m.amount!;
    return [
      md('# Vendor concentration\n\nTop vendors by total spend.'),
      sql(
        'vendor_spend',
        `SELECT ${q(v.column)} AS vendor, SUM(${q(a.column)}) AS total
FROM ${q(v.table)}
GROUP BY 1
ORDER BY total DESC
LIMIT 20`,
      ),
      chart('bar', 'vendor_spend', 'vendor', 'total'),
    ];
  },
};

export const GST_RECON: Template = {
  id: 'gst_recon',
  name: 'GSTIN spend by state',
  description:
    'Aggregate spend per vendor GSTIN, with the state derived from the first two digits.',
  requiredTypes: ['gstin', 'amount'],
  instantiate(m) {
    const g = m.gstin!;
    const a = m.amount!;
    return [
      md('# GSTIN spend by state\n\nGSTIN[0..2] is the state code (per CBIC).'),
      sql(
        'gst_by_state',
        `SELECT SUBSTR(${q(g.column)}, 1, 2) AS state_code, SUM(${q(a.column)}) AS total, COUNT(*) AS n
FROM ${q(g.table)}
GROUP BY 1
ORDER BY total DESC`,
      ),
      chart('bar', 'gst_by_state', 'state_code', 'total'),
    ];
  },
};

export const ERROR_FREQUENCY: Template = {
  id: 'error_frequency',
  name: 'Error frequency by service',
  description: 'Time-binned error counts per service.',
  requiredTypes: ['log_level', 'service_name', 'iso_datetime'],
  instantiate(m) {
    const lv = m.log_level!;
    const sv = m.service_name!;
    const ts = m.iso_datetime!;
    return [
      md('# Error frequency by service'),
      sql(
        'errors_by_service',
        `SELECT ${q(sv.column)} AS service, COUNT(*) AS n
FROM ${q(lv.table)}
WHERE LOWER(${q(lv.column)}) IN ('error', 'err', 'fatal', 'crit', 'critical')
GROUP BY 1
ORDER BY n DESC`,
      ),
      sql(
        'errors_over_time',
        `SELECT DATE_TRUNC('hour', CAST(${q(ts.column)} AS TIMESTAMP)) AS hour, COUNT(*) AS errors
FROM ${q(lv.table)}
WHERE LOWER(${q(lv.column)}) IN ('error', 'err', 'fatal', 'crit', 'critical')
GROUP BY 1
ORDER BY 1`,
      ),
      chart('bar', 'errors_by_service', 'service', 'n'),
      chart('line', 'errors_over_time', 'hour', 'errors'),
    ];
  },
};

export const LATENCY_PCT: Template = {
  id: 'p95_p99',
  name: 'P95 / P99 latency',
  description: 'Latency quantiles per endpoint.',
  requiredTypes: ['endpoint', 'duration_ms'],
  instantiate(m) {
    const e = m.endpoint!;
    const d = m.duration_ms!;
    return [
      md('# P95 / P99 latency by endpoint'),
      sql(
        'latency_quantiles',
        `SELECT ${q(e.column)} AS endpoint,
       quantile_cont(${q(d.column)}, 0.50) AS p50,
       quantile_cont(${q(d.column)}, 0.95) AS p95,
       quantile_cont(${q(d.column)}, 0.99) AS p99,
       COUNT(*) AS n
FROM ${q(e.table)}
GROUP BY 1
ORDER BY p99 DESC`,
      ),
      chart('bar', 'latency_quantiles', 'endpoint', 'p99'),
    ];
  },
};

export const COLUMN_PROFILE: Template = {
  id: 'column_profile',
  name: 'Column profile (first table)',
  description: 'Cardinality, nulls, and length distribution per column of the first mounted table.',
  requiredTypes: [],
  instantiate() {
    return [
      md(
        '# Column profile\n\n' +
          'Replace `your_table` with one of your mounted tables to see per-column cardinality and null counts.',
      ),
      sql('profile', 'SELECT * FROM your_table LIMIT 5'),
    ];
  },
};

export const ALL_TEMPLATES: Template[] = [
  AR_AGING,
  VENDOR_CONCENTRATION,
  GST_RECON,
  ERROR_FREQUENCY,
  LATENCY_PCT,
  COLUMN_PROFILE,
];
