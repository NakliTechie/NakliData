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
    pinned: false,
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
]);

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
  if (typeId === 'amount' || typeId === 'duration_ms' || typeId === 'percentage') {
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

  // ── Datetime: count over time ────────────────────────────────────
  if (typeId === 'iso_datetime' || typeId === 'iso_date') {
    out.push({
      id: `count_over_time_${col}`,
      label: 'Count over time (daily)',
      generate: () => [
        md('# Activity per day'),
        sql(
          `count_over_time_${col}`,
          `SELECT DATE_TRUNC('day', CAST(${q(col)} AS TIMESTAMP)) AS day,
       COUNT(*) AS n
FROM ${q(tableName)}
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
