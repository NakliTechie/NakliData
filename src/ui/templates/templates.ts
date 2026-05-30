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

// --- Product analytics templates (W4.2) ----------------------------
//
// Activate when an event-stream dataset is mounted — Mixpanel,
// Amplitude, PostHog exports, or any custom event log with the
// product-analytics taxonomy types (W4.1) detected.

export const DAU: Template = {
  id: 'dau',
  name: 'Daily active users (DAU)',
  description: 'Distinct users per day from your event stream.',
  requiredTypes: ['iso_datetime', 'user_id'],
  instantiate(m) {
    const ts = m.iso_datetime!;
    const u = m.user_id!;
    return [
      md('# Daily active users\n\nDistinct users with at least one event per day.'),
      sql(
        'dau',
        `SELECT DATE_TRUNC('day', CAST(${q(ts.column)} AS TIMESTAMP)) AS day,
       COUNT(DISTINCT ${q(u.column)}) AS dau
FROM ${q(ts.table)}
GROUP BY 1
ORDER BY 1`,
      ),
      chart('line', 'dau', 'day', 'dau'),
    ];
  },
};

export const TOP_EVENTS_BY_USER: Template = {
  id: 'top_events_by_user',
  name: 'Top events by user-count',
  description: 'Which event names drive the most unique users.',
  requiredTypes: ['event_name', 'user_id'],
  instantiate(m) {
    const e = m.event_name!;
    const u = m.user_id!;
    return [
      md(
        '# Top events by user-count\n\n' +
          'Each row counts distinct users who fired that event at least once. ' +
          'Drives the "what does this product actually do?" question on a fresh dataset.',
      ),
      sql(
        'top_events_by_user',
        `SELECT ${q(e.column)} AS event_name,
       COUNT(DISTINCT ${q(u.column)}) AS unique_users,
       COUNT(*) AS occurrences
FROM ${q(e.table)}
GROUP BY 1
ORDER BY unique_users DESC
LIMIT 20`,
      ),
      chart('bar', 'top_events_by_user', 'event_name', 'unique_users'),
    ];
  },
};

export const FUNNEL_A_B_C: Template = {
  id: 'funnel_a_b_c',
  name: 'Funnel: A → B → C',
  description:
    'Three-step conversion funnel. Pick the steps in the SQL (the seed picks the three most common event names).',
  requiredTypes: ['event_name', 'user_id', 'iso_datetime'],
  instantiate(m) {
    const e = m.event_name!;
    const u = m.user_id!;
    const ts = m.iso_datetime!;
    return [
      md(
        '# Funnel: A → B → C\n\n' +
          'Three-step conversion. The seed query auto-picks the three most-common ' +
          'event names; edit the `step_a`, `step_b`, `step_c` selections to point at ' +
          'your real funnel. Users must hit step B *after* step A and step C *after* step B.',
      ),
      sql(
        'funnel_steps',
        `-- Edit these three event names to match your real funnel:
WITH step_a AS (
  SELECT ${q(u.column)} AS user_id, MIN(CAST(${q(ts.column)} AS TIMESTAMP)) AS t_a
  FROM ${q(e.table)}
  WHERE ${q(e.column)} = (
    SELECT ${q(e.column)} FROM ${q(e.table)}
    GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1
  )
  GROUP BY 1
),
step_b AS (
  SELECT a.user_id, MIN(CAST(b.${q(ts.column)} AS TIMESTAMP)) AS t_b
  FROM step_a a
  JOIN ${q(e.table)} b
    ON b.${q(u.column)} = a.user_id
   AND b.${q(e.column)} = (
     SELECT ${q(e.column)} FROM ${q(e.table)}
     GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1 OFFSET 1
   )
   AND CAST(b.${q(ts.column)} AS TIMESTAMP) > a.t_a
  GROUP BY a.user_id
),
step_c AS (
  SELECT b.user_id, MIN(CAST(c.${q(ts.column)} AS TIMESTAMP)) AS t_c
  FROM step_b b
  JOIN ${q(e.table)} c
    ON c.${q(u.column)} = b.user_id
   AND c.${q(e.column)} = (
     SELECT ${q(e.column)} FROM ${q(e.table)}
     GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1 OFFSET 2
   )
   AND CAST(c.${q(ts.column)} AS TIMESTAMP) > b.t_b
  GROUP BY b.user_id
)
SELECT 'A: ' || (SELECT ${q(e.column)} FROM ${q(e.table)} GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1) AS step, COUNT(*) AS users FROM step_a
UNION ALL
SELECT 'B: ' || (SELECT ${q(e.column)} FROM ${q(e.table)} GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1 OFFSET 1), COUNT(*) FROM step_b
UNION ALL
SELECT 'C: ' || (SELECT ${q(e.column)} FROM ${q(e.table)} GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1 OFFSET 2), COUNT(*) FROM step_c`,
      ),
      chart('bar', 'funnel_steps', 'step', 'users'),
    ];
  },
};

export const RETENTION_30D: Template = {
  id: 'retention_30d',
  name: '30-day retention (cohort)',
  description: 'For each weekly cohort, how many came back N weeks later.',
  requiredTypes: ['iso_datetime', 'user_id'],
  instantiate(m) {
    const ts = m.iso_datetime!;
    const u = m.user_id!;
    return [
      md(
        '# 30-day retention\n\n' +
          'Rows = the week each user first appeared (cohort). Columns = how many weeks ' +
          'after that week. Cells = how many of that cohort came back. The heatmap reads ' +
          'top-left dense if your retention is strong.',
      ),
      sql(
        'retention_cohort',
        `WITH first_seen AS (
  SELECT ${q(u.column)} AS user_id,
         DATE_TRUNC('week', MIN(CAST(${q(ts.column)} AS TIMESTAMP))) AS cohort_week
  FROM ${q(ts.table)}
  GROUP BY 1
),
activity AS (
  SELECT e.${q(u.column)} AS user_id,
         DATE_TRUNC('week', CAST(e.${q(ts.column)} AS TIMESTAMP)) AS active_week
  FROM ${q(ts.table)} e
  GROUP BY 1, 2
)
SELECT f.cohort_week,
       DATEDIFF('week', f.cohort_week, a.active_week) AS week_offset,
       COUNT(DISTINCT a.user_id) AS users
FROM first_seen f
JOIN activity a ON a.user_id = f.user_id
WHERE DATEDIFF('week', f.cohort_week, a.active_week) BETWEEN 0 AND 4
GROUP BY 1, 2
ORDER BY 1, 2`,
      ),
      chart('heatmap', 'retention_cohort', 'week_offset', 'cohort_week'),
    ];
  },
};

export const CONVERSION_BY_SOURCE: Template = {
  id: 'conversion_by_source',
  name: 'Conversion rate by source',
  description: 'For each UTM source, what fraction of users converted (default: signup event).',
  requiredTypes: ['utm_source', 'event_name', 'user_id'],
  instantiate(m) {
    const src = m.utm_source!;
    const e = m.event_name!;
    const u = m.user_id!;
    return [
      md(
        '# Conversion rate by source\n\n' +
          'The seed query treats `signup` as the conversion. Edit the SQL to point at ' +
          'your real conversion event (`purchase`, `subscribe`, `complete_onboarding`, …).',
      ),
      sql(
        'conversion_by_source',
        `WITH source_users AS (
  SELECT ${q(src.column)} AS source,
         ${q(u.column)} AS user_id
  FROM ${q(src.table)}
  GROUP BY 1, 2
),
converted AS (
  SELECT DISTINCT ${q(u.column)} AS user_id
  FROM ${q(e.table)}
  WHERE LOWER(${q(e.column)}) = 'signup'
)
SELECT su.source,
       COUNT(DISTINCT su.user_id) AS users,
       COUNT(DISTINCT c.user_id) AS converters,
       ROUND(100.0 * COUNT(DISTINCT c.user_id) / NULLIF(COUNT(DISTINCT su.user_id), 0), 2) AS conversion_pct
FROM source_users su
LEFT JOIN converted c ON c.user_id = su.user_id
GROUP BY 1
HAVING COUNT(DISTINCT su.user_id) >= 5
ORDER BY conversion_pct DESC`,
      ),
      chart('bar', 'conversion_by_source', 'source', 'conversion_pct'),
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
  DAU,
  TOP_EVENTS_BY_USER,
  FUNNEL_A_B_C,
  RETENTION_30D,
  CONVERSION_BY_SOURCE,
  COLUMN_PROFILE,
];
