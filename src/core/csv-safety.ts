// One CSV-safety contract for every export path.
//
// Spreadsheet programs can execute a textual CSV field or header beginning
// with =, +, -, @, tab, or carriage return as a formula. Small exports are
// encoded in JS; large/anonymized/golden exports use DuckDB COPY. Both paths
// apply the same leading-apostrophe neutralization.

import { quoteIdent, quoteLiteral } from './query-builder.ts';

export interface CsvProjectionColumn {
  name: string;
  type: string;
}

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function neutralizeCsvFormula(value: string): string {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

export function csvEscape(value: string, neutralizeFormula = true): string {
  const safe = neutralizeFormula ? neutralizeCsvFormula(value) : value;
  if (safe.includes(',') || safe.includes('"') || safe.includes('\n') || safe.includes('\r')) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function formatCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function encodeFormulaSafeCsv(
  columns: ReadonlyArray<string>,
  rows: ReadonlyArray<Record<string, unknown>>,
  describedColumns?: ReadonlyArray<CsvProjectionColumn>,
): Uint8Array {
  const lines = [columns.map((column) => csvEscape(column)).join(',')];
  const typeByName = new Map(describedColumns?.map((column) => [column.name, column.type]) ?? []);
  for (const row of rows) {
    lines.push(
      columns
        .map((column) =>
          csvEscape(
            formatCsvValue(row[column]),
            !typeByName.has(column) || isTextualCsvType(typeByName.get(column) ?? ''),
          ),
        )
        .join(','),
    );
  }
  lines.push('');
  return new TextEncoder().encode(lines.join('\n'));
}

/** DuckDB logical types whose CSV representation is attacker-controlled text. */
export function isTextualCsvType(sqlType: string): boolean {
  const base = sqlType.toUpperCase().split(/[([]/)[0]?.trim() ?? '';
  return ['VARCHAR', 'CHAR', 'BPCHAR', 'TEXT', 'STRING', 'JSON', 'ENUM'].includes(base);
}

/**
 * Build a projection for a COPY-to-CSV subquery. Textual values receive the
 * same apostrophe prefix as the JS writer; non-text values retain their type
 * (so a legitimate negative number is not rewritten). Every output header is
 * neutralized and identifier-quoted.
 */
export function buildFormulaSafeCsvProjection(columns: ReadonlyArray<CsvProjectionColumn>): string {
  return columns
    .map(({ name, type }) => {
      const source = quoteIdent(name);
      const output = quoteIdent(neutralizeCsvFormula(name));
      if (!isTextualCsvType(type)) return `${source} AS ${output}`;
      const text = `CAST(${source} AS VARCHAR)`;
      return (
        `CASE WHEN ${source} IS NULL THEN NULL ` +
        `WHEN LEFT(${text}, 1) IN ('=', '+', '-', '@', CHR(9), CHR(13)) ` +
        `THEN ${quoteLiteral("'")} || ${text} ELSE ${text} END AS ${output}`
      );
    })
    .join(', ');
}
