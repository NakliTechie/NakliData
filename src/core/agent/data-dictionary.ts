// Agent surfaces — the data-dictionary serializer (Chunk 4). One artifact, two
// jobs (the coverage research ranked this Tier-1): the `describe()` JSON is the
// agent's grounding, and this renders the SAME structure as a human-readable
// Markdown handoff doc. Pure + engine-boundary clean — it takes a `DescribeResult`
// and returns text, no DOM / engine / window. The versioned JSON envelope IS the
// `DescribeResult`; this module is the human view of it.
//
// Sensitivity discipline (0c) is inherited from `describe`: the range columns are
// already null for non-public columns, so the doc renders "—" there and never
// leaks a value the surface redacted.

import type { DescribeResult, DescribedColumn, DescribedTable } from './registry.ts';

/** Escape a cell for a Markdown table (pipe + newline would break the row). */
function cell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/** Percentage text from a 0..1 fraction, or "—". */
function pct(fraction: number | null): string {
  if (fraction == null) return '—';
  return `${Math.round(fraction * 100)}%`;
}

function rangeText(col: DescribedColumn): string {
  if (col.min == null && col.max == null) return '—';
  return `${col.min ?? '?'} … ${col.max ?? '?'}`;
}

function tableSection(t: DescribedTable): string {
  const lines: string[] = [];
  lines.push(`## ${t.name}`);
  const rows = t.rowCount == null ? 'unknown rows' : `${t.rowCount.toLocaleString()} rows`;
  const origin = t.provenance.origin ? ` · ${cell(t.provenance.origin)}` : '';
  lines.push(
    `Source: ${cell(t.provenance.sourceLabel)} (${cell(t.provenance.sourceKind)})${origin} · ${rows}`,
  );
  lines.push('');
  lines.push('| Column | Type | Semantic type | Sensitivity | Null % | Distinct | Range |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const c of t.columns) {
    lines.push(
      `| ${cell(c.name)} | ${cell(c.sqlType)} | ${cell(c.typeId ?? '—')} | ${c.sensitivity} | ${pct(
        c.nullFraction,
      )} | ${c.distinctCount ?? '—'} | ${cell(rangeText(c))} |`,
    );
  }
  return lines.join('\n');
}

/**
 * Render a `DescribeResult` as a Markdown data dictionary. Deterministic — the
 * same input yields the same document (safe to diff / snapshot).
 */
export function describeToMarkdown(result: DescribeResult): string {
  const header: string[] = [];
  header.push('# Data dictionary');
  header.push('');
  const tax = result.taxonomyVersion ? `taxonomy ${result.taxonomyVersion}` : 'taxonomy unknown';
  const layer = result.sensitivityLayerLoaded
    ? 'sensitivity layer loaded'
    : 'sensitivity layer NOT loaded — tiers unreliable';
  const tableCount = result.tables.length;
  header.push(
    `Envelope v${result.version} · ${tax} · ${layer} · ${tableCount} ${
      tableCount === 1 ? 'table' : 'tables'
    }.`,
  );
  header.push('');
  header.push(
    'Values are omitted by design — schema + semantics only. Range is shown for public numeric/date columns; redacted columns show "—".',
  );

  if (result.tables.length === 0) {
    header.push('');
    header.push('_No tables mounted._');
    return header.join('\n');
  }

  const sections = result.tables.map(tableSection);
  return `${header.join('\n')}\n\n${sections.join('\n\n')}\n`;
}
