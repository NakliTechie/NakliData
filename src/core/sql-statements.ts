const DIRECT_RESULT_KEYWORDS = new Set([
  'SHOW',
  'DESCRIBE',
  'DESC',
  'PRAGMA',
  'EXPLAIN',
  'SUMMARIZE',
]);

/** Leading SQL keyword after stripping any run of leading comments/space. */
export function leadingSqlKeyword(sql: string): string {
  let value = sql.trimStart();
  for (;;) {
    if (value.startsWith('--')) {
      const newline = value.indexOf('\n');
      value = newline === -1 ? '' : value.slice(newline + 1).trimStart();
      continue;
    }
    if (value.startsWith('/*')) {
      const end = value.indexOf('*/');
      value = end === -1 ? '' : value.slice(end + 2).trimStart();
      continue;
    }
    break;
  }
  return value.match(/^[a-zA-Z_]+/)?.[0]?.toUpperCase() ?? '';
}

/**
 * Read-only introspection statements return rows but cannot back a reusable
 * DuckDB view. Their notebook result is deliberately non-referenceable.
 */
export function isDirectResultStatement(sql: string): boolean {
  return DIRECT_RESULT_KEYWORDS.has(leadingSqlKeyword(sql));
}
