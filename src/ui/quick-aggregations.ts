// Quick aggregation suggestions per column — Wave 5 W5.3.
//
// Power BI's "quick measure" pattern: the schema panel shows a small
// "Quick chart ▾" affordance on each column row. Click it, pick a
// suggestion, get a templated SQL + chart cell appended to the
// notebook. The suggestions are deterministic functions of (column
// type, partner column types in the same table).
//
// Design: pure helper. No DOM, no engine. Returns Cell partials in
// the same shape the templates panel emits. The caller (schema-
// panel.ts) drops them into the notebook via the same path templates
// use.

import { dateCastExpr } from '../core/sql-date.ts';
import type { CellState, ChartCellState, MarkdownCellState, SqlCellState } from './cells/types.ts';
import type { ColumnAssignment } from './schema-panel.ts';

export interface QuickAction {
  /** Stable id, used for analytics/ranking; not user-visible. */
  id: string;
  /** One-line user-facing label ("Sum amount by vendor_name"). */
  label: string;
  /** Builder — returns cell partials (no id, no order; caller fills). */
  generate(): Array<Omit<CellState, 'order' | 'id'>>;
}

interface PartnerCol {
  column: string;
  typeId: string | null;
}

function q(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

function sql(name: string, code: string): Omit<SqlCellState, 'order' | 'id'> {
  return {
    kind: 'sql',
    name,
    code,
    status: 'idle',
    lastError: null,
    lastResult: null,
  };
}

function md(text: string): Omit<MarkdownCellState, 'order' | 'id'> {
  return { kind: 'markdown', name: null, code: text };
}

function chart(
  type: ChartCellState['chartType'],
  x: string | null,
  y: string | null,
): Omit<ChartCellState, 'order' | 'id'> {
  return {
    kind: 'chart',
    name: null,
    inputCell: null,
    chartType: type,
    x,
    y,
    facet: null,
  };
}

const LOW_CARD_CATEGORICAL = new Set([
  'vendor_name',
  'payment_status',
  'payment_mode',
  'log_level',
  'http_method',
  'http_status',
  'service_name',
  'event_name',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'iso_country_code',
  'gst_state_code',
  'currency_iso',
  // Tier-1 (geography / marketplace / sample-datasets). City/district can be
  // higher-cardinality, but "count by … LIMIT 20" stays a useful top-N cut.
  'room_type',
  'state_region',
  'city',
  'district_neighbourhood',
  'sex_gender',
  'passenger_class',
  'embarkation_port',
]);

// Numeric measures that support "sum by category" + a distribution histogram.
const NUMERIC_METRIC = new Set([
  'amount',
  'duration_ms',
  'percentage',
  'fare_amount',
  'age_years',
  'availability_days',
  'review_count',
  'reviews_per_period',
  'minimum_stay',
]);

// Date-like types that support "count over time (daily)".
const DATE_LIKE = new Set(['iso_datetime', 'iso_date', 'last_review_date']);

/**
 * Compute the list of quick actions applicable to `target` given the
 * other columns in the same table. The caller (schema panel) renders
 * these as one button per action.
 */
export function getQuickActions(
  target: ColumnAssignment,
  tableName: string,
  partnersInTable: PartnerCol[],
): QuickAction[] {
  const out: QuickAction[] = [];
  const typeId = target.assigned.typeId;
  const col = target.columnName;
  if (!typeId) return out;

  // ── Numeric / monetary: sum + optional group-by partner ──────────
  if (NUMERIC_METRIC.has(typeId)) {
    const partner = partnersInTable.find((p) => p.typeId && LOW_CARD_CATEGORICAL.has(p.typeId));
    if (partner) {
      out.push({
        id: `sum_${typeId}_by_${partner.column}`,
        label: `Sum ${col} by ${partner.column}`,
        generate: () => [
          md(
            `# Sum of ${col} by ${partner.column}\n\nTop 20 ${partner.column} values by total ${col}.`,
          ),
          sql(
            `sum_${col}_by_${partner.column}`,
            `SELECT ${q(partner.column)} AS category,
       SUM(${q(col)}) AS total,
       COUNT(*) AS rows
FROM ${q(tableName)}
GROUP BY 1
ORDER BY total DESC
LIMIT 20`,
          ),
          chart('bar', 'category', 'total'),
        ],
      });
    }
    out.push({
      id: `dist_${typeId}`,
      label: `Distribution of ${col} (histogram)`,
      generate: () => [
        md(`# ${col} distribution`),
        sql(
          `dist_${col}`,
          `SELECT ${q(col)} AS value FROM ${q(tableName)} WHERE ${q(col)} IS NOT NULL`,
        ),
        chart('histogram', 'value', null),
      ],
    });
  }

  // ── Categorical low-card: count by category ──────────────────────
  if (LOW_CARD_CATEGORICAL.has(typeId)) {
    out.push({
      id: `count_by_${col}`,
      label: `Count by ${col}`,
      generate: () => [
        md(`# Counts by ${col}`),
        sql(
          `count_by_${col}`,
          `SELECT ${q(col)} AS category, COUNT(*) AS n
FROM ${q(tableName)}
GROUP BY 1
ORDER BY n DESC
LIMIT 20`,
        ),
        chart('bar', 'category', 'n'),
      ],
    });
  }

  // ── Outcome flag: rate by categorical partner ────────────────────
  if (typeId === 'survival_flag') {
    const partner = partnersInTable.find((p) => p.typeId && LOW_CARD_CATEGORICAL.has(p.typeId));
    if (partner) {
      out.push({
        id: `rate_${col}_by_${partner.column}`,
        label: `${col} rate by ${partner.column}`,
        generate: () => [
          md(`# ${col} rate by ${partner.column}\n\nMean outcome (0..1) per ${partner.column}.`),
          sql(
            `rate_${col}_by_${partner.column}`,
            `SELECT ${q(partner.column)} AS category,
       ROUND(AVG(CAST(${q(col)} AS DOUBLE)), 3) AS rate,
       COUNT(*) AS n
FROM ${q(tableName)}
GROUP BY 1
ORDER BY rate DESC`,
          ),
          chart('bar', 'category', 'rate'),
        ],
      });
    }
  }

  // ── Datetime: count over time ────────────────────────────────────
  if (DATE_LIKE.has(typeId)) {
    out.push({
      id: `count_over_time_${col}`,
      label: 'Count over time (daily)',
      generate: () => [
        md('# Activity per day'),
        sql(
          `count_over_time_${col}`,
          `SELECT DATE_TRUNC('day', ${dateCastExpr(q(col))}) AS day,
       COUNT(*) AS n
FROM ${q(tableName)}
WHERE ${dateCastExpr(q(col))} IS NOT NULL
GROUP BY 1
ORDER BY 1`,
        ),
        chart('line', 'day', 'n'),
      ],
    });
  }
  if (typeId === 'unix_timestamp_ms' || typeId === 'unix_timestamp_s') {
    const seconds = typeId === 'unix_timestamp_s';
    out.push({
      id: `count_over_time_${col}`,
      label: 'Count over time (daily)',
      generate: () => [
        md('# Activity per day'),
        sql(
          `count_over_time_${col}`,
          `SELECT DATE_TRUNC('day', to_timestamp(${q(col)}${seconds ? '' : ' / 1000.0'})) AS day,
       COUNT(*) AS n
FROM ${q(tableName)}
GROUP BY 1
ORDER BY 1`,
        ),
        chart('line', 'day', 'n'),
      ],
    });
  }

  // ── ID-like high-card: COUNT DISTINCT ────────────────────────────
  if (typeId === 'user_id' || typeId === 'session_id' || typeId === 'uuid') {
    out.push({
      id: `unique_${col}`,
      label: `Unique ${col}`,
      generate: () => [
        sql(
          `unique_${col}`,
          `SELECT COUNT(DISTINCT ${q(col)}) AS unique_${col.replace(/[^a-z0-9_]/gi, '_')}
FROM ${q(tableName)}`,
        ),
        chart('stat', null, `unique_${col.replace(/[^a-z0-9_]/gi, '_')}`),
      ],
    });
  }

  // ── GSTIN: spend by state (SUBSTR trick) ─────────────────────────
  if (typeId === 'gstin') {
    const amount = partnersInTable.find((p) => p.typeId === 'amount');
    if (amount) {
      out.push({
        id: 'gstin_state_spend',
        label: 'Spend by state (GSTIN[0..2])',
        generate: () => [
          md(`# Spend by state\n\nGSTIN's first two digits encode the issuing state (per CBIC).`),
          sql(
            'state_spend',
            `SELECT SUBSTR(${q(col)}, 1, 2) AS state_code,
       SUM(${q(amount.column)}) AS total,
       COUNT(*) AS n
FROM ${q(tableName)}
GROUP BY 1
ORDER BY total DESC`,
          ),
          chart('bar', 'state_code', 'total'),
        ],
      });
    }
  }

  return out;
}
