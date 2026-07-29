import type { DetectorSpec, TaxonomyBundle } from '../taxonomy/types.ts';
import { roleFamilyForType } from '../taxonomy/universal.ts';
import type { Association } from './associations.ts';
import type { MountedSource } from './mount.ts';
import { validateSafeRegexPattern } from './regex-safety.ts';

export const QUALITY_ASSERTION_PREFIX = '-- naklidata-quality: ';
export const DATA_QUALITY_CHECK_KINDS = [
  'completeness',
  'uniqueness',
  'accepted_values',
  'valid_range',
  'format',
  'referential_validity',
  'semantic_drift',
] as const;

export type DataQualityCheckKind = (typeof DATA_QUALITY_CHECK_KINDS)[number];

interface DataQualityCheckBase {
  version: 1;
  id: string;
  name: string;
  description: string;
  table: string;
  column: string;
}

export interface CompletenessCheck extends DataQualityCheckBase {
  kind: 'completeness';
}

export interface UniquenessCheck extends DataQualityCheckBase {
  kind: 'uniqueness';
}

export interface AcceptedValuesCheck extends DataQualityCheckBase {
  kind: 'accepted_values';
  values: string[];
}

export interface ValidRangeCheck extends DataQualityCheckBase {
  kind: 'valid_range';
  min: number | null;
  max: number | null;
}

export interface FormatCheck extends DataQualityCheckBase {
  kind: 'format';
  pattern: string;
}

export interface ReferentialValidityCheck extends DataQualityCheckBase {
  kind: 'referential_validity';
  referenceTable: string;
  referenceColumn: string;
}

export type DriftConstraint =
  | { kind: 'accepted_values'; values: string[] }
  | { kind: 'valid_range'; min: number | null; max: number | null }
  | { kind: 'format'; pattern: string };

export interface SemanticDriftCheck extends DataQualityCheckBase {
  kind: 'semantic_drift';
  expectedTypeId: string;
  constraint: DriftConstraint;
}

export type DataQualityCheck =
  | CompletenessCheck
  | UniquenessCheck
  | AcceptedValuesCheck
  | ValidRangeCheck
  | FormatCheck
  | ReferentialValidityCheck
  | SemanticDriftCheck;

export interface DataQualityAssertionArtifact {
  check: DataQualityCheck;
  sql: string;
}

export interface DataQualityContract {
  format: 'naklidata-data-contract';
  version: 1;
  name: string;
  execution: 'explicit';
  checks: DataQualityAssertionArtifact[];
  aliases: {
    databricks: 'Expectation';
    snowflake: 'DMF / expectation';
  };
}

export interface SuggestDataQualityInput {
  sources: ReadonlyArray<MountedSource>;
  assignments: Readonly<
    Record<
      string,
      {
        columnName: string;
        sqlType: string;
        assigned: { typeId: string | null };
      }
    >
  >;
  associations: ReadonlyArray<Association>;
  taxonomyBundle: TaxonomyBundle;
}

interface QualityColumn {
  sourceId: string;
  tableId: string;
  table: string;
  column: string;
  sqlType: string;
  typeId: string;
}

export function suggestDataQualityChecks(input: SuggestDataQualityInput): DataQualityCheck[] {
  const checks = new Map<string, DataQualityCheck>();
  const typeById = new Map(input.taxonomyBundle.types.map((type) => [type.id, type]));
  const columns = qualityColumns(input);
  for (const column of columns) {
    const type = typeById.get(column.typeId);
    if (!type) continue;
    const role = roleFamilyForType(input.taxonomyBundle, column.typeId);
    if (role === 'entity') {
      addCheck(
        checks,
        baseCheck('completeness', column, `${column.table}.${column.column} should not be null.`),
      );
      if (isCandidateGrain(column.table, column.column)) {
        addCheck(
          checks,
          baseCheck(
            'uniqueness',
            column,
            `${column.table}.${column.column} should identify at most one row.`,
          ),
        );
      }
    }
    const valueSet = deterministicDetector(type.detectors, 'value_set');
    if (valueSet?.values?.length && valueSet.values.length <= 100) {
      addCheck(checks, {
        ...baseCheck(
          'accepted_values',
          column,
          `${column.table}.${column.column} should stay within the accepted ${type.display_name} values.`,
        ),
        values: [...valueSet.values],
      });
    }
    const range = deterministicDetector(type.detectors, 'range_numeric');
    if (range && (range.min !== undefined || range.max !== undefined)) {
      addCheck(checks, {
        ...baseCheck(
          'valid_range',
          column,
          `${column.table}.${column.column} should stay within the valid ${type.display_name} range.`,
        ),
        min: range.min ?? null,
        max: range.max ?? null,
      });
    }
    const regex = deterministicDetector(type.detectors, 'regex');
    if (regex?.pattern && validateSafeRegexPattern(regex.pattern).safe) {
      addCheck(checks, {
        ...baseCheck(
          'format',
          column,
          `${column.table}.${column.column} should match the ${type.display_name} format.`,
        ),
        pattern: regex.pattern,
      });
    }
    const driftConstraint = constraintFromDetector(valueSet ?? range ?? regex);
    if (driftConstraint) {
      addCheck(checks, {
        ...baseCheck(
          'semantic_drift',
          column,
          `${column.table}.${column.column} should continue to match semantic type ${type.display_name}.`,
        ),
        expectedTypeId: type.id,
        constraint: driftConstraint,
      });
    }
  }

  const available = new Set(columns.map((column) => `${column.table}::${column.column}`));
  for (const association of input.associations) {
    if (
      !available.has(`${association.a.table}::${association.a.column}`) ||
      !available.has(`${association.b.table}::${association.b.column}`)
    ) {
      continue;
    }
    const column: QualityColumn = {
      sourceId: '',
      tableId: '',
      table: association.a.table,
      column: association.a.column,
      sqlType: '',
      typeId: '',
    };
    addCheck(checks, {
      ...baseCheck(
        'referential_validity',
        column,
        `${association.a.table}.${association.a.column} should resolve to ${association.b.table}.${association.b.column}.`,
      ),
      referenceTable: association.b.table,
      referenceColumn: association.b.column,
    });
  }
  return [...checks.values()].sort((a, b) =>
    `${a.table}.${a.column}.${a.kind}`.localeCompare(`${b.table}.${b.column}.${b.kind}`),
  );
}

export function compileDataQualityCheck(check: DataQualityCheck): string {
  const errors = validateDataQualityCheck(check);
  if (errors.length) throw new Error(`Invalid data quality check:\n${errors.join('\n')}`);
  const table = quoteIdentifier(check.table);
  const column = quoteIdentifier(check.column);
  if (check.kind === 'uniqueness') {
    return `SELECT ${column}, COUNT(*) AS duplicate_count
FROM ${table}
WHERE ${column} IS NOT NULL
GROUP BY ${column}
HAVING COUNT(*) > 1
LIMIT 100`;
  }
  if (check.kind === 'referential_validity') {
    return `SELECT left_table.${column} AS missing_reference
FROM ${table} AS left_table
LEFT JOIN ${quoteIdentifier(check.referenceTable)} AS right_table
  ON left_table.${column} = right_table.${quoteIdentifier(check.referenceColumn)}
WHERE left_table.${column} IS NOT NULL
  AND right_table.${quoteIdentifier(check.referenceColumn)} IS NULL
LIMIT 100`;
  }
  const condition =
    check.kind === 'completeness'
      ? `${column} IS NULL`
      : check.kind === 'semantic_drift'
        ? violationCondition(column, check.constraint)
        : violationCondition(column, check);
  return `SELECT *
FROM ${table}
WHERE ${condition}
LIMIT 100`;
}

export function encodeDataQualityAssertion(check: DataQualityCheck): string {
  return `${QUALITY_ASSERTION_PREFIX}${JSON.stringify(check)}\n${compileDataQualityCheck(check)}`;
}

export function parseDataQualityAssertion(code: string): DataQualityAssertionArtifact | null {
  const newline = code.indexOf('\n');
  const firstLine = newline < 0 ? code : code.slice(0, newline);
  if (!firstLine.startsWith(QUALITY_ASSERTION_PREFIX)) return null;
  const metadata = firstLine.slice(QUALITY_ASSERTION_PREFIX.length);
  const parsed = parseDataQualityCheck(JSON.parse(metadata));
  const sql = newline < 0 ? '' : code.slice(newline + 1).trim();
  if (!sql) throw new Error(`${parsed.name}: quality assertion SQL is missing.`);
  return { check: parsed, sql };
}

export function exportDataQualityContract(
  name: string,
  assertions: ReadonlyArray<{ code: string }>,
): string {
  const checks = assertions.flatMap((assertion) => {
    const parsed = parseDataQualityAssertion(assertion.code);
    return parsed ? [parsed] : [];
  });
  const contract: DataQualityContract = {
    format: 'naklidata-data-contract',
    version: 1,
    name: portableName(name) || 'data_quality_contract',
    execution: 'explicit',
    checks,
    aliases: {
      databricks: 'Expectation',
      snowflake: 'DMF / expectation',
    },
  };
  return `${JSON.stringify(contract, null, 2)}\n`;
}

export function validateDataQualityCheck(check: DataQualityCheck): string[] {
  const errors: string[] = [];
  if (check.version !== 1) errors.push('version must be 1.');
  if (!isPortableName(check.id)) errors.push('id must be a portable snake_case identifier.');
  if (!isPortableName(check.name)) errors.push('name must be a portable snake_case identifier.');
  if (!check.table.trim()) errors.push('table is required.');
  if (!check.column.trim()) errors.push('column is required.');
  if (!check.description.trim()) errors.push('description is required.');
  if (check.kind === 'accepted_values') validateValues(check.values, errors);
  if (check.kind === 'valid_range') validateRange(check.min, check.max, errors);
  if (check.kind === 'format') validatePattern(check.pattern, errors);
  if (check.kind === 'referential_validity') {
    if (!check.referenceTable.trim()) errors.push('referenceTable is required.');
    if (!check.referenceColumn.trim()) errors.push('referenceColumn is required.');
  }
  if (check.kind === 'semantic_drift') {
    if (!check.expectedTypeId.trim()) errors.push('expectedTypeId is required.');
    if (check.constraint.kind === 'accepted_values') {
      validateValues(check.constraint.values, errors);
    } else if (check.constraint.kind === 'valid_range') {
      validateRange(check.constraint.min, check.constraint.max, errors);
    } else {
      validatePattern(check.constraint.pattern, errors);
    }
  }
  return errors;
}

function qualityColumns(input: SuggestDataQualityInput): QualityColumn[] {
  const columns: QualityColumn[] = [];
  for (const source of input.sources) {
    for (const table of source.tables) {
      const prefix = `${source.id}::${table.id}::`;
      for (const [key, assignment] of Object.entries(input.assignments)) {
        if (!key.startsWith(prefix) || !assignment.assigned.typeId) continue;
        columns.push({
          sourceId: source.id,
          tableId: table.id,
          table: table.name,
          column: assignment.columnName,
          sqlType: assignment.sqlType,
          typeId: assignment.assigned.typeId,
        });
      }
    }
  }
  return columns;
}

function deterministicDetector(
  detectors: ReadonlyArray<DetectorSpec>,
  kind: DetectorSpec['kind'],
): DetectorSpec | null {
  return (
    detectors.filter((detector) => detector.kind === kind).sort((a, b) => b.weight - a.weight)[0] ??
    null
  );
}

function constraintFromDetector(detector: DetectorSpec | null): DriftConstraint | null {
  if (!detector) return null;
  if (detector.kind === 'value_set' && detector.values?.length && detector.values.length <= 100) {
    return { kind: 'accepted_values', values: [...detector.values] };
  }
  if (
    detector.kind === 'range_numeric' &&
    (detector.min !== undefined || detector.max !== undefined)
  ) {
    return { kind: 'valid_range', min: detector.min ?? null, max: detector.max ?? null };
  }
  if (
    detector.kind === 'regex' &&
    detector.pattern &&
    validateSafeRegexPattern(detector.pattern).safe
  ) {
    return { kind: 'format', pattern: detector.pattern };
  }
  return null;
}

function baseCheck<
  K extends
    | 'completeness'
    | 'uniqueness'
    | 'accepted_values'
    | 'valid_range'
    | 'format'
    | 'referential_validity'
    | 'semantic_drift',
>(kind: K, column: QualityColumn, description: string): DataQualityCheckBase & { kind: K } {
  const name = portableName(`${kind}_${column.table}_${column.column}`);
  return {
    version: 1,
    id: name,
    name,
    kind,
    description,
    table: column.table,
    column: column.column,
  };
}

function addCheck(checks: Map<string, DataQualityCheck>, check: DataQualityCheck): void {
  checks.set(check.id, check);
}

function isCandidateGrain(table: string, column: string): boolean {
  const normalizedTable = portableName(table);
  const singular = normalizedTable.endsWith('ies')
    ? `${normalizedTable.slice(0, -3)}y`
    : normalizedTable.endsWith('s')
      ? normalizedTable.slice(0, -1)
      : normalizedTable;
  const normalizedColumn = portableName(column);
  return (
    normalizedColumn === 'id' ||
    normalizedColumn === `${singular}_id` ||
    normalizedColumn === `${singular}id`
  );
}

function violationCondition(
  column: string,
  constraint: AcceptedValuesCheck | ValidRangeCheck | FormatCheck | DriftConstraint,
): string {
  if (constraint.kind === 'accepted_values') {
    const values = constraint.values.map((value) => quoteLiteral(value.toLowerCase())).join(', ');
    return `${column} IS NOT NULL AND LOWER(CAST(${column} AS VARCHAR)) NOT IN (${values})`;
  }
  if (constraint.kind === 'valid_range') {
    const bounds = [
      constraint.min === null ? null : `TRY_CAST(${column} AS DOUBLE) < ${constraint.min}`,
      constraint.max === null ? null : `TRY_CAST(${column} AS DOUBLE) > ${constraint.max}`,
    ].filter((value): value is string => value !== null);
    return `${column} IS NOT NULL AND (TRY_CAST(${column} AS DOUBLE) IS NULL OR ${bounds.join(' OR ')})`;
  }
  return `${column} IS NOT NULL AND NOT regexp_full_match(CAST(${column} AS VARCHAR), ${quoteLiteral(constraint.pattern)})`;
}

function parseDataQualityCheck(value: unknown): DataQualityCheck {
  const item = objectValue(value, 'quality check');
  const rawKind = stringValue(item.kind, 'quality check.kind');
  if (!DATA_QUALITY_CHECK_KINDS.includes(rawKind as DataQualityCheckKind)) {
    throw new Error(`Unsupported data quality check kind: ${rawKind}.`);
  }
  const kind = rawKind as DataQualityCheckKind;
  const base = {
    version: numberValue(item.version, 'quality check.version') as 1,
    id: stringValue(item.id, 'quality check.id'),
    name: stringValue(item.name, 'quality check.name'),
    description: stringValue(item.description, 'quality check.description'),
    table: stringValue(item.table, 'quality check.table'),
    column: stringValue(item.column, 'quality check.column'),
  };
  let check: DataQualityCheck;
  if (kind === 'accepted_values') {
    check = { ...base, kind, values: stringArray(item.values, 'quality check.values') };
  } else if (kind === 'valid_range') {
    check = {
      ...base,
      kind,
      min: nullableNumber(item.min, 'quality check.min'),
      max: nullableNumber(item.max, 'quality check.max'),
    };
  } else if (kind === 'format') {
    check = { ...base, kind, pattern: stringValue(item.pattern, 'quality check.pattern') };
  } else if (kind === 'referential_validity') {
    check = {
      ...base,
      kind,
      referenceTable: stringValue(item.referenceTable, 'quality check.referenceTable'),
      referenceColumn: stringValue(item.referenceColumn, 'quality check.referenceColumn'),
    };
  } else if (kind === 'semantic_drift') {
    check = {
      ...base,
      kind,
      expectedTypeId: stringValue(item.expectedTypeId, 'quality check.expectedTypeId'),
      constraint: parseDriftConstraint(item.constraint),
    };
  } else {
    check = { ...base, kind };
  }
  const errors = validateDataQualityCheck(check);
  if (errors.length) throw new Error(`Invalid data quality check:\n${errors.join('\n')}`);
  return check;
}

function parseDriftConstraint(value: unknown): DriftConstraint {
  const item = objectValue(value, 'quality check.constraint');
  const kind = stringValue(item.kind, 'quality check.constraint.kind');
  if (kind === 'accepted_values') {
    return { kind, values: stringArray(item.values, 'quality check.constraint.values') };
  }
  if (kind === 'valid_range') {
    return {
      kind,
      min: nullableNumber(item.min, 'quality check.constraint.min'),
      max: nullableNumber(item.max, 'quality check.constraint.max'),
    };
  }
  if (kind === 'format') {
    return { kind, pattern: stringValue(item.pattern, 'quality check.constraint.pattern') };
  }
  throw new Error(`Unsupported semantic-drift constraint: ${kind}.`);
}

function validateValues(values: string[], errors: string[]): void {
  if (!values.length) errors.push('accepted values cannot be empty.');
  if (values.length > 100) errors.push('accepted values cannot exceed 100 entries.');
  if (values.some((value) => !value.trim() || value.length > 256)) {
    errors.push('accepted values must be non-empty and at most 256 characters.');
  }
}

function validateRange(min: number | null, max: number | null, errors: string[]): void {
  if (min === null && max === null) errors.push('a valid range needs min or max.');
  if (min !== null && !Number.isFinite(min)) errors.push('range min must be finite.');
  if (max !== null && !Number.isFinite(max)) errors.push('range max must be finite.');
  if (min !== null && max !== null && min > max) errors.push('range min cannot exceed max.');
}

function validatePattern(pattern: string, errors: string[]): void {
  const result = validateSafeRegexPattern(pattern);
  if (!result.safe) errors.push(`format pattern is unsafe: ${result.reason}.`);
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function portableName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[0-9]/, '_$&')
    .slice(0, 64);
}

function isPortableName(value: string): boolean {
  return /^[a-z_][a-z0-9_]{0,63}$/.test(value);
}

function objectValue(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${path} must be a string.`);
  return value.trim();
}

function numberValue(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number.`);
  }
  return value;
}

function nullableNumber(value: unknown, path: string): number | null {
  if (value === null) return null;
  return numberValue(value, path);
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${path} must be an array of strings.`);
  }
  return value.map((item) => item.trim());
}
