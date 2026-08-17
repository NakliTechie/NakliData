import sqlParser from 'node-sql-parser';
import type { WarehouseReadAuthorizer } from '../../../src/core/bridge/warehouse-adapter-core.ts';

const { Parser } = sqlParser;

export type WarehouseDialect = 'databricks' | 'snowflake';

export interface ParsedAuthorizerOptions {
  dialect: WarehouseDialect;
  allowedTables: readonly string[];
}

const WRITE_NODE_TYPES = new Set([
  'alter',
  'call',
  'copy',
  'create',
  'delete',
  'drop',
  'execute',
  'grant',
  'insert',
  'merge',
  'put',
  'remove',
  'replace',
  'revoke',
  'set',
  'truncate',
  'unset',
  'update',
  'use',
]);

const UNSAFE_READ_TOKENS =
  /(?:https?:\/\/|s3:\/\/|gs:\/\/|gcs:\/\/|azure:\/\/|@(?:~|%|[A-Za-z_])|\b(?:read_csv|read_json|read_parquet|read_ndjson|read_blob|read_text|http_get|http_post|system\$|external_access)\b)/i;

/**
 * A fail-closed AST boundary for direct warehouse SQL. The Snowflake grammar
 * is native to node-sql-parser. Its Flink grammar is the closest maintained
 * JVM/Spark-family grammar and remains an intentionally conservative
 * Databricks subset until Batch 7 live fixtures expand it.
 */
export function createParsedReadAuthorizer(
  options: ParsedAuthorizerOptions,
): WarehouseReadAuthorizer {
  const database = options.dialect === 'snowflake' ? 'Snowflake' : 'FlinkSQL';
  const allowedTables = new Set(options.allowedTables.map(normalizeTableName));
  const parser = new Parser();
  return {
    authorize(sql) {
      if (UNSAFE_READ_TOKENS.test(sql)) {
        return {
          allowed: false,
          reason: 'External-access and staged-file expressions are denied.',
        };
      }
      try {
        const parsed = parser.parse(sql, { database });
        const statements = Array.isArray(parsed.ast) ? parsed.ast : [parsed.ast];
        if (statements.length !== 1 || statements[0]?.type !== 'select') {
          return { allowed: false, reason: 'Exactly one SELECT or WITH query is required.' };
        }
        if (containsWriteNode(statements[0])) {
          return {
            allowed: false,
            reason: 'The parsed query contains a write or session operation.',
          };
        }
        const cteNames = collectCteNames(statements[0]);
        for (const reference of parsed.tableList) {
          const parts = reference.split('::');
          const operation = parts[0]?.toLowerCase();
          const databasePath = parts[1] ?? 'null';
          const table = parts.slice(2).join('::');
          if (operation !== 'select' || !table) {
            return { allowed: false, reason: 'The parsed query contains a non-read table access.' };
          }
          if (databasePath === 'null' && cteNames.has(table.toLowerCase())) continue;
          const qualified = normalizeTableName(
            databasePath === 'null' ? table : `${databasePath}.${table}`,
          );
          if (!allowedTables.has(qualified)) {
            return {
              allowed: false,
              reason: 'The query references a table outside the allowlist.',
            };
          }
        }
        return { allowed: true };
      } catch {
        return {
          allowed: false,
          reason: `The query is outside the supported ${options.dialect} SQL subset.`,
        };
      }
    },
  };
}

function normalizeTableName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /["'`\[\];]/.test(trimmed)) {
    throw new Error('Allowlisted table names must use unquoted dot-qualified identifiers.');
  }
  return trimmed.toLowerCase();
}

function containsWriteNode(root: unknown): boolean {
  const stack: unknown[] = [root];
  const seen = new Set<object>();
  while (stack.length > 0) {
    const value = stack.pop();
    if (!value || typeof value !== 'object') continue;
    if (seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      stack.push(...value);
      continue;
    }
    const record = value as Record<string, unknown>;
    const type = typeof record.type === 'string' ? record.type.toLowerCase() : '';
    if (WRITE_NODE_TYPES.has(type)) return true;
    if (record.into && typeof record.into === 'object') {
      const into = record.into as Record<string, unknown>;
      if (into.expr || into.position) return true;
    }
    stack.push(...Object.values(record));
  }
  return false;
}

function collectCteNames(root: unknown): Set<string> {
  const output = new Set<string>();
  if (!root || typeof root !== 'object' || Array.isArray(root)) return output;
  const withEntries = (root as Record<string, unknown>).with;
  if (!Array.isArray(withEntries)) return output;
  for (const entry of withEntries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const name = (entry as Record<string, unknown>).name;
    if (!name || typeof name !== 'object' || Array.isArray(name)) continue;
    const value = (name as Record<string, unknown>).value;
    if (typeof value === 'string') output.add(value.toLowerCase());
  }
  return output;
}
