import { describe, expect, it } from 'vitest';
import type { CellState } from '../src/ui/cells/types.ts';
import type { ColumnAssignment } from '../src/ui/schema-panel.ts';
import {
  type Template,
  findApplicableTemplates,
  indexByTypeWithCandidates,
} from '../src/ui/templates/templates.ts';

function assignment(columnName: string, typeId: string, confidence: number): ColumnAssignment {
  return {
    columnName,
    sqlType: 'VARCHAR',
    candidates: [],
    resolution: { kind: 'auto_accept' },
    assigned: { typeId, origin: 'detector', confidence },
    status: 'classified',
  };
}

describe('suggested-report table binding', () => {
  it('scores every required (table,type) independently and keeps optionals on the winner', () => {
    const assignments = {
      'source::table_a::a_one': assignment('a_one', 'type_one', 0.5),
      'source::table_a::a_two': assignment('a_two', 'type_two', 0.95),
      'source::table_a::a_optional': assignment('a_optional', 'optional', 0.99),
      'source::table_b::b_one': assignment('b_one', 'type_one', 0.99),
      'source::table_b::b_two': assignment('b_two', 'type_two', 0.9),
      'source::table_b::b_optional': assignment('b_optional', 'optional', 0.2),
    };
    const { byType, perType } = indexByTypeWithCandidates(assignments, [
      {
        tables: [
          { id: 'table_a', name: 'table_a' },
          { id: 'table_b', name: 'table_b' },
        ],
      },
    ]);
    const template: Template = {
      id: 'cohesive',
      name: 'Cohesive',
      description: 'test',
      requiredTypes: ['type_one', 'type_two'],
      optionalTypes: ['optional'],
      instantiate: () => [] as Array<Omit<CellState, 'order'>>,
    };

    const applicable = findApplicableTemplates([template], byType, perType);

    expect(applicable).toHaveLength(1);
    expect(applicable[0]?.matched).toEqual({
      type_one: { table: 'table_b', column: 'b_one' },
      type_two: { table: 'table_b', column: 'b_two' },
      optional: { table: 'table_b', column: 'b_optional' },
    });
  });
});
