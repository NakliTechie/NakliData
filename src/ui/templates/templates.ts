// Report templates per spec §3.6. Six starter templates, type-gated.
// When the required semantic types are all present in mounted sources,
// the template surfaces in the "Suggested reports" panel.
//
// Each template renders to a small set of cells (SQL + chart + markdown).

import {
  DEFAULT_MARGINS_MM,
  type ReportDefinition,
  type ReportItem,
} from '../../core/report-layout.ts';
import { dateCastExpr } from '../../core/sql-date.ts';
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
 *  Internal — `indexByTypeWithCandidates` is the exported entry point (E2/S18).
 */
function indexByType(
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

function sql(name: string, code: string): Omit<SqlCellState, 'order'> {
  return {
    id: '',
    kind: 'sql',
    name,
    code,
    status: 'idle',
    lastError: null,
    lastResult: null,
  };
}

function md(text: string): Omit<MarkdownCellState, 'order'> {
  return { id: '', kind: 'markdown', name: null, code: text };
}

/**
 * Chart partial. The 4th arg `inputName` documents WHICH named SQL
 * cell this chart should bind to. Forward-pass H4 (2026-06-02): we now
 * carry it through as `_intendedInputName` so `instantiateTemplate`
 * can resolve the binding correctly by name when the template emits
 * multiple SQL cells (e.g., ERROR_FREQUENCY's
 * `errors_by_service` + `errors_over_time`). The old nearest-prev-SQL-
 * with-a-name heuristic bound every chart to the LATEST named cell,
 * which silently rendered "Errors by service" as a time-series.
 *
 * `_intendedInputName` is internal to the templates pipeline — the
 * instantiator strips it before returning `CellState[]`, so it never
 * appears in the final notebook state or persistence.
 */
type ChartPartial = Omit<ChartCellState, 'order'> & { _intendedInputName: string | null };

function chart(
  type: ChartCellState['chartType'],
  inputName: string,
  x: string | null,
  y: string | null,
): ChartPartial {
  return {
    id: '',
    kind: 'chart',
    name: null,
    inputCell: null,
    chartType: type,
    x,
    y,
    facet: null,
    _intendedInputName: inputName || null,
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
      chart('funnel', 'funnel_steps', 'step', 'users'),
    ];
  },
};

export const TOP_PATHS: Template = {
  id: 'top_paths',
  name: 'Top user paths',
  description: 'Most common 3-event sequences users take.',
  requiredTypes: ['event_name', 'user_id', 'iso_datetime'],
  instantiate(m) {
    const e = m.event_name!;
    const u = m.user_id!;
    const ts = m.iso_datetime!;
    return [
      md(
        '# Top user paths\n\n' +
          'Each path = the first three events a user fires, in time order. ' +
          'Sankey is overkill for the eyeball question "what do users actually do?"; ' +
          'a top-20 list of triplets answers it cleaner.',
      ),
      sql(
        'top_paths',
        `WITH ordered AS (
  SELECT ${q(u.column)} AS user_id,
         ${q(e.column)} AS event,
         CAST(${q(ts.column)} AS TIMESTAMP) AS ts,
         ROW_NUMBER() OVER (PARTITION BY ${q(u.column)} ORDER BY CAST(${q(ts.column)} AS TIMESTAMP)) AS rn
  FROM ${q(e.table)}
),
triplets AS (
  SELECT a.user_id,
         a.event || ' → ' || b.event || ' → ' || c.event AS path
  FROM ordered a
  JOIN ordered b ON b.user_id = a.user_id AND b.rn = 2
  JOIN ordered c ON c.user_id = a.user_id AND c.rn = 3
  WHERE a.rn = 1
)
SELECT path, COUNT(*) AS users
FROM triplets
GROUP BY 1
ORDER BY users DESC
LIMIT 20`,
      ),
      chart('path', 'top_paths', 'path', 'users'),
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

// --- Tier-1 domain templates (geography / marketplace / sample datasets) --

export const MARKETPLACE_SUPPLY: Template = {
  id: 'marketplace_supply',
  name: 'Marketplace supply and price brief',
  description:
    'Supply and average price by listing/room type, with an optional geography cut. Fits Airbnb-style listing exports.',
  requiredTypes: ['room_type', 'amount'],
  optionalTypes: ['state_region', 'availability_days', 'review_count'],
  instantiate(m) {
    const rt = m.room_type!;
    const price = m.amount!;
    const region = m.state_region;
    const cells: Omit<CellState, 'order'>[] = [
      md('# Marketplace supply and price brief\n\nListings and average price by room type.'),
      sql(
        'supply_by_type',
        `SELECT ${q(rt.column)} AS room_type,
       COUNT(*) AS listings,
       ROUND(AVG(${q(price.column)}), 2) AS avg_price
FROM ${q(rt.table)}
GROUP BY 1
ORDER BY listings DESC`,
      ),
      chart('bar', 'supply_by_type', 'room_type', 'listings'),
    ];
    if (region) {
      cells.push(
        sql(
          'supply_by_region',
          `SELECT ${q(region.column)} AS region,
       COUNT(*) AS listings,
       ROUND(AVG(${q(price.column)}), 2) AS avg_price
FROM ${q(region.table)}
GROUP BY 1
ORDER BY listings DESC
LIMIT 20`,
        ),
        chart('bar', 'supply_by_region', 'region', 'listings'),
      );
    }
    return cells;
  },
};

export const OUTCOME_COMPARISON: Template = {
  id: 'outcome_comparison',
  name: 'Outcome comparison brief',
  description:
    'Compare an outcome rate across a categorical group (e.g. survival by passenger class). Fits Titanic-style datasets.',
  requiredTypes: ['survival_flag', 'passenger_class'],
  optionalTypes: ['sex_gender'],
  instantiate(m) {
    const outcome = m.survival_flag!;
    const group = m.passenger_class!;
    const sex = m.sex_gender;
    const cells: Omit<CellState, 'order'>[] = [
      md('# Outcome comparison brief\n\nOutcome rate by group.'),
      sql(
        'outcome_by_group',
        `SELECT ${q(group.column)} AS grp,
       COUNT(*) AS n,
       ROUND(AVG(CAST(${q(outcome.column)} AS DOUBLE)), 3) AS outcome_rate
FROM ${q(group.table)}
GROUP BY 1
ORDER BY 1`,
      ),
      chart('bar', 'outcome_by_group', 'grp', 'outcome_rate'),
    ];
    if (sex) {
      cells.push(
        sql(
          'outcome_by_group_sex',
          `SELECT ${q(group.column)} AS grp,
       ${q(sex.column)} AS sex,
       COUNT(*) AS n,
       ROUND(AVG(CAST(${q(outcome.column)} AS DOUBLE)), 3) AS outcome_rate
FROM ${q(group.table)}
GROUP BY 1, 2
ORDER BY 1, 2`,
        ),
      );
    }
    return cells;
  },
};

export const GEO_DISTRIBUTION: Template = {
  id: 'geo_distribution',
  name: 'Geography distribution brief',
  description:
    'Record counts (and total amount, if present) by state/region. Fits any dataset with a geography column.',
  requiredTypes: ['state_region'],
  optionalTypes: ['amount', 'room_type'],
  instantiate(m) {
    const region = m.state_region!;
    const amount = m.amount;
    const amountSelect = amount
      ? `,\n       ROUND(SUM(${q(amount.column)}), 2) AS total_amount`
      : '';
    return [
      md('# Geography distribution brief\n\nRecords by region.'),
      sql(
        'by_region',
        `SELECT ${q(region.column)} AS region,
       COUNT(*) AS records${amountSelect}
FROM ${q(region.table)}
GROUP BY 1
ORDER BY records DESC
LIMIT 25`,
      ),
      chart('bar', 'by_region', 'region', 'records'),
    ];
  },
};

/**
 * Generic-role fallback. Surfaces for ANY dataset with a recognised amount /
 * metric column — the doc's "broader suggested reports" gap (non-finance data
 * showed nothing). Produces a monthly total trend when a date column is
 * present, else a compact totals row (per-column quick-charts already offer
 * the amount histogram, so this stays lean to hold the shell budget). Broad by
 * design (requires only `amount`), so it complements the domain templates.
 */
export const AMOUNT_SUMMARY: Template = {
  id: 'amount_summary',
  name: 'Amount summary',
  description:
    'Total of the main amount/metric column — as a monthly trend when a date column is present.',
  requiredTypes: ['amount'],
  optionalTypes: ['iso_datetime', 'iso_date'],
  instantiate(m) {
    const a = m.amount!;
    const date = m.iso_datetime ?? m.iso_date;
    if (date) {
      return [
        md('# Amount over time\n\nMonthly total of the main amount column.'),
        sql(
          'amount_over_time',
          `SELECT DATE_TRUNC('month', ${dateCastExpr(q(date.column))}) AS month,
       SUM(${q(a.column)}) AS total, COUNT(*) AS records
FROM ${q(a.table)}
WHERE ${dateCastExpr(q(date.column))} IS NOT NULL
GROUP BY 1
ORDER BY 1`,
        ),
        chart('line', 'amount_over_time', 'month', 'total'),
      ];
    }
    return [
      md('# Amount summary\n\nTotal and average of the main amount column.'),
      sql(
        'amount_totals',
        `SELECT COUNT(*) AS records, ROUND(SUM(${q(a.column)}), 2) AS total,
       ROUND(AVG(${q(a.column)}), 2) AS average
FROM ${q(a.table)}`,
      ),
    ];
  },
};

export const RETAIL_SALES: Template = {
  id: 'retail_sales',
  name: 'Retail sales brief',
  description:
    'Revenue (quantity × price), units, and order lines — broken out by country when present. Fits retail / e-commerce transaction exports.',
  requiredTypes: ['quantity', 'amount'],
  optionalTypes: ['country_name', 'sku'],
  instantiate(m) {
    const qty = m.quantity!;
    const price = m.amount!;
    const country = m.country_name;
    const cells: Omit<CellState, 'order'>[] = [
      md('# Retail sales brief\n\nRevenue = quantity × price.'),
    ];
    if (country) {
      cells.push(
        sql(
          'revenue_by_country',
          `SELECT ${q(country.column)} AS country,
       ROUND(SUM(${q(qty.column)} * ${q(price.column)}), 2) AS revenue,
       SUM(${q(qty.column)}) AS units,
       COUNT(*) AS lines
FROM ${q(qty.table)}
GROUP BY 1
ORDER BY revenue DESC
LIMIT 20`,
        ),
        chart('bar', 'revenue_by_country', 'country', 'revenue'),
      );
    } else {
      cells.push(
        sql(
          'revenue_totals',
          `SELECT ROUND(SUM(${q(qty.column)} * ${q(price.column)}), 2) AS revenue,
       SUM(${q(qty.column)}) AS units,
       COUNT(*) AS lines
FROM ${q(qty.table)}`,
        ),
      );
    }
    return cells;
  },
};

export const CONTENT_CATALOG: Template = {
  id: 'content_catalog',
  name: 'Content catalog brief',
  description:
    'Title counts by release year, with media-type and content-rating breakdowns when present. Fits streaming / catalog exports.',
  requiredTypes: ['release_year'],
  optionalTypes: ['media_type', 'content_rating'],
  instantiate(m) {
    const yr = m.release_year!;
    const type = m.media_type;
    const rating = m.content_rating;
    const cells: Omit<CellState, 'order'>[] = [
      md('# Content catalog brief\n\nTitles by release year.'),
      sql(
        'titles_by_year',
        `SELECT ${q(yr.column)} AS release_year, COUNT(*) AS titles
FROM ${q(yr.table)}
GROUP BY 1
ORDER BY 1`,
      ),
      chart('bar', 'titles_by_year', 'release_year', 'titles'),
    ];
    if (type) {
      cells.push(
        sql(
          'titles_by_type',
          `SELECT ${q(type.column)} AS media_type, COUNT(*) AS titles
FROM ${q(type.table)}
GROUP BY 1
ORDER BY titles DESC`,
        ),
        chart('bar', 'titles_by_type', 'media_type', 'titles'),
      );
    }
    if (rating) {
      cells.push(
        sql(
          'titles_by_rating',
          `SELECT ${q(rating.column)} AS rating, COUNT(*) AS titles
FROM ${q(rating.table)}
GROUP BY 1
ORDER BY titles DESC
LIMIT 20`,
        ),
      );
    }
    return cells;
  },
};

/**
 * Legacy "always applicable" fallback template. Kept exported (the
 * recommend-reports eval fixture still references the id), but NOT
 * registered in ALL_TEMPLATES — its body shipped a `SELECT * FROM
 * your_table LIMIT 5` placeholder string that DuckDB rejected on Run,
 * confusing real users (demo-verification finding 2026-05-31). The
 * templates panel now shows a helpful empty state ("Mount sources
 * with recognized columns…") when nothing else applies. A future
 * iteration could resurrect this template by plumbing the first
 * mounted table name into instantiate() so `your_table` becomes a
 * real reference; until then, removing it is the smallest correct
 * fix.
 */
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

// B2 — HR / people domain pack (workforce brief).
export const HR_WORKFORCE: Template = {
  id: 'hr_workforce',
  name: 'Workforce brief',
  description:
    'Headcount and average compensation by department — with average tenure when present. Fits HRIS / people-analytics exports.',
  requiredTypes: ['department', 'compensation'],
  optionalTypes: ['tenure_years'],
  instantiate(m) {
    const dept = m.department!;
    const comp = m.compensation!;
    const tenure = m.tenure_years;
    const tenureSelect = tenure
      ? `,\n       ROUND(AVG(${q(tenure.column)}), 1) AS avg_tenure_years`
      : '';
    const cells: Omit<CellState, 'order'>[] = [
      md('# Workforce brief\n\nHeadcount and average compensation by department.'),
      sql(
        'workforce_by_department',
        `SELECT ${q(dept.column)} AS department,
       COUNT(*) AS headcount,
       ROUND(AVG(${q(comp.column)}), 0) AS avg_compensation${tenureSelect}
FROM ${q(dept.table)}
GROUP BY 1
ORDER BY headcount DESC
LIMIT 30`,
      ),
      chart('bar', 'workforce_by_department', 'department', 'headcount'),
    ];
    return cells;
  },
};

// G1 — Real-estate domain pack (inventory and price brief).
export const REAL_ESTATE_INVENTORY: Template = {
  id: 'real_estate_inventory',
  name: 'Inventory and price brief',
  description:
    'Listing count and average sale price by property type — with average size when present. Fits real-estate listing / transaction exports.',
  requiredTypes: ['property_type', 'sale_price'],
  optionalTypes: ['square_feet'],
  instantiate(m) {
    const ptype = m.property_type!;
    const price = m.sale_price!;
    const sqft = m.square_feet;
    const sqftSelect = sqft ? `,\n       ROUND(AVG(${q(sqft.column)}), 0) AS avg_square_feet` : '';
    const cells: Omit<CellState, 'order'>[] = [
      md('# Inventory and price brief\n\nListing count and average sale price by property type.'),
      sql(
        'inventory_by_property_type',
        `SELECT ${q(ptype.column)} AS property_type,
       COUNT(*) AS listings,
       ROUND(AVG(${q(price.column)}), 0) AS avg_sale_price${sqftSelect}
FROM ${q(ptype.table)}
GROUP BY 1
ORDER BY listings DESC
LIMIT 30`,
      ),
      chart('bar', 'inventory_by_property_type', 'property_type', 'listings'),
    ];
    return cells;
  },
};

// G2 — Education domain pack (performance brief).
export const EDUCATION_PERFORMANCE: Template = {
  id: 'education_performance',
  name: 'Performance brief',
  description:
    'Average score and student count by course — with grade level when present. Fits school / LMS / assessment exports.',
  requiredTypes: ['course_name', 'score_percent'],
  optionalTypes: ['grade_level'],
  instantiate(m) {
    const course = m.course_name!;
    const score = m.score_percent!;
    const grade = m.grade_level;
    const gradeSelect = grade ? `,\n       ${q(grade.column)} AS grade_level` : '';
    const gradeGroup = grade ? ', 3' : '';
    const cells: Omit<CellState, 'order'>[] = [
      md('# Performance brief\n\nAverage score and student count by course.'),
      sql(
        'performance_by_course',
        `SELECT ${q(course.column)} AS course,
       COUNT(*) AS students,
       ROUND(AVG(${q(score.column)}), 1) AS avg_score${gradeSelect}
FROM ${q(course.table)}
GROUP BY 1${gradeGroup}
ORDER BY students DESC
LIMIT 30`,
      ),
      chart('bar', 'performance_by_course', 'course', 'avg_score'),
    ];
    return cells;
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
  TOP_PATHS,
  MARKETPLACE_SUPPLY,
  OUTCOME_COMPARISON,
  GEO_DISTRIBUTION,
  AMOUNT_SUMMARY,
  RETAIL_SALES,
  CONTENT_CATALOG,
  HR_WORKFORCE,
  REAL_ESTATE_INVENTORY,
  EDUCATION_PERFORMANCE,
];

// ── A3 — Executive report-cell templates ────────────────────────────────────
// Pre-built REPORT layouts (distinct from the analysis Templates above): a
// titled ReportDefinition + named markdown scaffold cells the user fills in.
// Lives in this lazy chunk so the bodies stay off the shell budget; the report
// cell's empty-state picker carries only the id/name (shell). A "seed" (the
// report cell id) namespaces the markdown cell names so multiple reports don't
// collide.

interface ExecSection {
  /** Appended to the seed for the markdown cell name. */
  suffix: string;
  /** Markdown body. */
  body: string;
  /** Insert a page-break before this section. */
  pageBreakBefore?: boolean;
}
interface ExecTemplate {
  id: string;
  name: string;
  title: string;
  sections: ExecSection[];
}

const EXEC_TEMPLATES: ExecTemplate[] = [
  {
    id: 'briefing_memo',
    name: 'Briefing memo',
    title: 'Executive briefing',
    sections: [
      {
        suffix: 'summary',
        body: '## Summary\n\n_One-paragraph TL;DR: what this covers and the single most important takeaway._',
      },
      { suffix: 'findings', body: '## Key findings\n\n- \n- \n- ' },
      {
        suffix: 'recommendation',
        body: '## Recommendation\n\n_What should happen next, and why._',
      },
    ],
  },
  {
    id: 'operating_review',
    name: 'Operating review',
    title: 'Operating review',
    sections: [
      {
        suffix: 'period',
        body: '## Period summary\n\n_Reporting period and the headline movement vs. the prior period._',
      },
      {
        suffix: 'metrics',
        body: '## Metrics\n\n_Add a KPI row or chart cell, then reference it here and call out the drivers._',
      },
      {
        suffix: 'segments',
        body: '## By segment\n\n_Where performance concentrated — the top and bottom segments._',
        pageBreakBefore: true,
      },
      { suffix: 'actions', body: '## Risks & actions\n\n- Risk: \n- Action: ' },
    ],
  },
  {
    id: 'dataset_audit',
    name: 'Dataset audit',
    title: 'Dataset audit',
    sections: [
      {
        suffix: 'overview',
        body: '## Overview\n\n_What this dataset is, its source, and the period it covers._',
      },
      {
        suffix: 'schema',
        body: '## Schema & coverage\n\n_Columns, semantic types, row count, and null / coverage notes._',
      },
      { suffix: 'quality', body: '## Quality notes\n\n- \n- ' },
      {
        suffix: 'provenance',
        body: '## Provenance\n\n_Where the data came from, how it was mounted, and any transforms applied._',
      },
    ],
  },
];

export interface ExecutiveReportScaffold {
  /** Named markdown cells to create (before the report cell-refs them). */
  markdownCells: Array<{ name: string; code: string }>;
  /** The report definition referencing those cells in order. */
  definition: ReportDefinition;
}

/**
 * Build an executive report scaffold, or null for an unknown id. `seed`
 * (the report cell id) namespaces the markdown cell names; `today` is injected
 * (no `Date()` in this pure builder).
 */
export function buildExecutiveReport(
  templateId: string,
  seed: string,
  today: string,
): ExecutiveReportScaffold | null {
  const tpl = EXEC_TEMPLATES.find((t) => t.id === templateId);
  if (!tpl) return null;
  const markdownCells = tpl.sections.map((s) => ({
    name: `${seed}_${s.suffix}`,
    code: s.body,
  }));
  const items: ReportItem[] = [];
  for (const s of tpl.sections) {
    if (s.pageBreakBefore) items.push({ kind: 'page-break' });
    items.push({ kind: 'cell-ref', cellName: `${seed}_${s.suffix}` });
  }
  return {
    markdownCells,
    definition: {
      title: tpl.title,
      pageSize: 'A4',
      margins: DEFAULT_MARGINS_MM,
      subtitle: `Prepared ${today}`,
      items,
    },
  };
}
