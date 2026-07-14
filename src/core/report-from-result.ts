// "Create report from result" (Tier-2 / reporting-improvements #1) — the pure
// scaffold builder. Given a SQL cell's name + query + row count, it produces:
//   - the name the SQL cell should carry (existing, or a generated one) so the
//     report can `cell-ref` it,
//   - an editable notes/provenance markdown cell (row count, timestamp, the
//     query, and a "Key notes" area),
//   - a ReportDefinition that embeds the notes then the result table.
// No DOM, no engine, no store access — the main.ts handler wires it into the
// notebook (name the SQL cell, add the markdown + report cells).

import { type ReportDefinition, type ReportItem, emptyReportDefinition } from './report-layout.ts';

export interface ReportScaffold {
  /** Name to ensure on the source SQL cell (so `cell-ref` resolves it). */
  sqlName: string;
  /** Name of the notes/provenance markdown cell. */
  notesName: string;
  /** Body of the notes/provenance markdown cell. */
  notesMarkdown: string;
  /**
   * Name of the auto bar-chart cell the caller should create, or null when the
   * result isn't chartable (A1). When non-null, `definition` already cell-refs
   * it after the result table.
   */
  chartName: string | null;
  /** The report cell's definition — embeds notes, the result table, and (when chartable) the chart. */
  definition: ReportDefinition;
}

/** "invoice_totals" → "Invoice totals"; blank → "Report". */
function humanizeTitle(name: string): string {
  const words = name
    .replace(/[_\s]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (words.length === 0) return 'Report';
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
}

export function buildReportScaffold(args: {
  /** The SQL cell's id — used to derive a stable name when it has none. */
  cellId: string;
  /** The SQL cell's current name (may be null/blank). */
  sqlName: string | null;
  /** The SQL the cell ran, for the provenance block. */
  sqlCode: string;
  /** Row count of the result being reported on. */
  rowCount: number;
  /** ISO date (YYYY-MM-DD), injected by the caller (no Date() in pure code). */
  today: string;
  /** Optional "Sources" provenance markdown block (Tier-2 #10). */
  sourcesBlock?: string;
  /**
   * When the result is chartable (A1 `pickChartColumns` found a category+value
   * pair), the caller passes it so the report embeds an auto bar chart after
   * the table. Omit/undefined → no chart cell-ref.
   */
  chart?: { category: string; value: string };
  /**
   * A2 — when the result has a numeric measure, the caller derives total /
   * average / count KPI tiles (bound to named measures, with cached values) and
   * passes them here so the report leads with a KPI row. `valueColumn` lets the
   * Refresh-data path recompute the cached values from the re-run result.
   */
  kpis?: {
    tiles: ReadonlyArray<{ measure: string; label: string; value: string }>;
    valueColumn: string;
  };
}): ReportScaffold {
  const named = args.sqlName?.trim() || '';
  const sqlName = named || `result_${args.cellId}`;
  const notesName = `${sqlName}_notes`;
  const chartName = args.chart ? `${sqlName}_chart` : null;
  const title = named ? humanizeTitle(named) : 'Report';
  const rows = `${args.rowCount.toLocaleString()} row${args.rowCount === 1 ? '' : 's'}`;

  const query = args.sqlCode.trim();
  const provenance = args.sourcesBlock?.trim() ? [args.sourcesBlock.trim(), ''] : [];
  const notesMarkdown = [
    `**${rows}** · generated ${args.today}`,
    '',
    '**Query**',
    '',
    '```sql',
    query,
    '```',
    '',
    ...provenance,
    '### Key notes',
    '',
    '_Add your notes here._',
  ].join('\n');

  const kpiRow: ReportItem[] = args.kpis
    ? [
        {
          kind: 'kpi-row',
          tiles: args.kpis.tiles,
          sourceCell: sqlName,
          valueColumn: args.kpis.valueColumn,
        },
      ]
    : [];

  const definition: ReportDefinition = {
    ...emptyReportDefinition(),
    title,
    subtitle: `${rows} · ${args.today}`,
    items: [
      // KPI row leads the report (executive summary first), then notes, table, chart.
      ...kpiRow,
      { kind: 'cell-ref', cellName: notesName },
      { kind: 'cell-ref', cellName: sqlName },
      ...(chartName ? [{ kind: 'cell-ref', cellName: chartName } as const] : []),
    ],
  };

  return { sqlName, notesName, notesMarkdown, chartName, definition };
}
