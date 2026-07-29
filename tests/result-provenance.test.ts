import { describe, expect, it } from 'vitest';
import { resolveResultProvenance, unknownResultAssignment } from '../src/core/result-provenance.ts';
import type { WorkbookState } from '../src/core/workbook.ts';
import type { SqlCellState } from '../src/ui/cells/types.ts';
import type { ColumnAssignment } from '../src/ui/schema-panel.ts';

function assignment(columnName: string, typeId: string): ColumnAssignment {
  return {
    ...unknownResultAssignment(columnName),
    sqlType: 'VARCHAR',
    assigned: { typeId, origin: 'user_accept', confidence: 1 },
  };
}

function source(id: string, tableId: string, tableName: string) {
  return {
    id,
    kind: 'fsa-file' as const,
    label: id,
    tables: [
      {
        id: tableId,
        sourceId: id,
        name: tableName,
        format: 'csv' as const,
        origin: `${id}.csv`,
        rowCount: 1,
        registered: true,
      },
    ],
  };
}

function cell(
  directProjection: NonNullable<SqlCellState['resultMeta']>['directProjection'],
): SqlCellState {
  return {
    id: 'cell-1',
    kind: 'sql',
    order: 0,
    name: null,
    code: 'SELECT email FROM customers',
    status: 'success',
    lastError: null,
    lastResult: {
      columns: ['email'],
      rows: [{ email: 'a@example.com' }],
      rowCount: 1,
      elapsedMs: 1,
    },
    resultMeta: {
      ranAt: 1,
      sqlHash: 'hash',
      capped: false,
      fromSnapshot: false,
      directProjection,
    },
  };
}

function state(overrides: Partial<WorkbookState> = {}): WorkbookState {
  return {
    sources: [source('source-a', 'table-a', 'customers')],
    assignments: {
      'source-a::table-a::email': assignment('email', 'email'),
    },
    autoAcceptThreshold: 0.9,
    userTypes: [],
    overrideRules: [],
    ...overrides,
  };
}

describe('result provenance', () => {
  it('resolves a direct projection to one exact source/table/assignment', () => {
    const [resolved] = resolveResultProvenance(
      cell({ tableName: 'customers', columns: ['email'] }),
      state(),
    );
    expect(resolved).toMatchObject({
      status: 'direct',
      sourceId: 'source-a',
      tableId: 'table-a',
      tableName: 'customers',
      sourceColumn: 'email',
      assignmentKey: 'source-a::table-a::email',
    });
    expect(resolved?.assignment?.assigned.typeId).toBe('email');
  });

  it('does not borrow a same-named assignment from another table', () => {
    const workbook = state({
      sources: [
        source('source-a', 'table-a', 'customers'),
        source('source-b', 'table-b', 'orders'),
      ],
      assignments: {
        'source-a::table-a::email': assignment('email', 'email'),
        'source-b::table-b::email': assignment('email', 'secret_note'),
      },
    });
    const [resolved] = resolveResultProvenance(
      cell({ tableName: 'customers', columns: ['email'] }),
      workbook,
    );
    expect(resolved?.sourceId).toBe('source-a');
    expect(resolved?.assignment?.assigned.typeId).toBe('email');
  });

  it('fails closed when relation ownership is ambiguous', () => {
    const workbook = state({
      sources: [
        source('source-a', 'table-a', 'customers'),
        source('source-b', 'table-b', 'customers'),
      ],
    });
    expect(
      resolveResultProvenance(cell({ tableName: 'customers', columns: ['email'] }), workbook)[0],
    ).toMatchObject({ status: 'unproven', assignment: null });
  });

  it('fails closed for aliases, expressions, joins, and legacy snapshots', () => {
    expect(resolveResultProvenance(cell(null), state())[0]).toMatchObject({
      status: 'unproven',
      assignment: null,
    });
  });
});
