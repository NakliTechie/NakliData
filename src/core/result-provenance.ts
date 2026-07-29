// Fail-closed result-column provenance.
//
// A SQL result is trusted only when its recorded projection proves direct
// columns from one uniquely owned mounted relation. Output-name coincidence is
// never provenance: aliases, expressions, joins, CTEs, duplicate ownership, and
// legacy snapshots all resolve to `unproven`.

import type { SqlCellState } from '../ui/cells/types.ts';
import type { ColumnAssignment } from '../ui/schema-panel.ts';
import type { WorkbookState } from './workbook.ts';

export interface ResultColumnProvenance {
  outputColumn: string;
  status: 'direct' | 'unproven';
  sourceId: string | null;
  tableId: string | null;
  tableName: string | null;
  sourceColumn: string | null;
  assignmentKey: string | null;
  assignment: ColumnAssignment | null;
}

export function unknownResultAssignment(columnName: string): ColumnAssignment {
  return {
    columnName,
    sqlType: 'UNKNOWN',
    candidates: [],
    resolution: { kind: 'unknown' },
    assigned: { typeId: null, origin: 'unknown', confidence: 0 },
    status: 'classified',
  };
}

export function resolveResultProvenance(
  cell: SqlCellState,
  state: WorkbookState,
): ResultColumnProvenance[] {
  const columns = cell.lastResult?.columns ?? [];
  const unprovenColumn = (outputColumn: string): ResultColumnProvenance => ({
    outputColumn,
    status: 'unproven',
    sourceId: null,
    tableId: null,
    tableName: null,
    sourceColumn: null,
    assignmentKey: null,
    assignment: null,
  });
  const unproven = () => columns.map(unprovenColumn);
  const projection = cell.resultMeta?.directProjection;
  if (!projection) return unproven();
  const owners = state.sources.flatMap((source) =>
    source.tables
      .filter((table) => table.name.toLowerCase() === projection.tableName.toLowerCase())
      .map((table) => ({ source, table })),
  );
  if (owners.length !== 1) return unproven();
  const owner = owners[0];
  if (!owner) return unproven();
  const sourceColumns = projection.columns ?? columns.map((column) => column.toLowerCase());
  if (sourceColumns.length !== columns.length) return unproven();

  const prefix = `${owner.source.id}::${owner.table.id}::`;
  const assignmentsByColumn = new Map<
    string,
    Array<{ key: string; assignment: ColumnAssignment }>
  >();
  for (const [key, assignment] of Object.entries(state.assignments)) {
    if (!key.startsWith(prefix)) continue;
    const folded = assignment.columnName.toLowerCase();
    const entries = assignmentsByColumn.get(folded) ?? [];
    entries.push({ key, assignment });
    assignmentsByColumn.set(folded, entries);
  }
  return columns.map((outputColumn, index) => {
    const sourceColumn = sourceColumns[index];
    if (!sourceColumn) return unprovenColumn(outputColumn);
    const matches = assignmentsByColumn.get(sourceColumn.toLowerCase()) ?? [];
    const match = matches.length === 1 ? matches[0] : null;
    return {
      outputColumn,
      status: 'direct',
      sourceId: owner.source.id,
      tableId: owner.table.id,
      tableName: owner.table.name,
      sourceColumn: match?.assignment.columnName ?? sourceColumn,
      assignmentKey: match?.key ?? null,
      assignment: match
        ? { ...match.assignment, columnName: outputColumn }
        : unknownResultAssignment(outputColumn),
    };
  });
}
