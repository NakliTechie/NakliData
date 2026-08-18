import { describe, expect, it } from 'vitest';
import {
  parseExplainErrorResponse,
  parseRecommendReportsResponse,
} from '../src/core/sidecar/client.ts';
import { parseNlToSchemaResponse } from '../src/core/sidecar/ontology-jobs.ts';
import { parseFirstJsonObject } from '../src/core/sidecar/response-json.ts';

describe('sidecar JSON envelope recovery', () => {
  it('extracts one balanced object with a trailing prose tail', () => {
    expect(
      parseFirstJsonObject('{"message":"brace } inside", "nested":{"ok":true}}\nDone.'),
    ).toEqual({
      message: 'brace } inside',
      nested: { ok: true },
    });
  });

  it('rejects a prose preface before an object', () => {
    expect(() => parseFirstJsonObject('Result:\n{"ok":true}')).toThrow();
  });

  it('extracts the first fenced object and ignores a prose tail', () => {
    expect(parseFirstJsonObject('```json\n{"ok":true}\n```\nExtra text')).toEqual({ ok: true });
  });

  it('does not repair truncated JSON', () => {
    expect(() => parseFirstJsonObject('{"columns":[{"name":"id"}')).toThrow();
  });

  it('retains explain-error field validation after recovering an object', () => {
    expect(
      parseExplainErrorResponse(
        '{"explanation":"The table is missing.","suggested_fix":null}\nReview the schema.',
      ),
    ).toEqual({
      kind: 'explain-error',
      explanation: 'The table is missing.',
      suggestedFix: null,
    });
  });

  it('retains report-template allowlisting after recovering an object', () => {
    expect(
      parseRecommendReportsResponse(
        '{"recommendations":[{"template_id":"allowed","score":0.8},{"template_id":"invented","score":1}]}\nDone.',
        ['allowed'],
      ),
    ).toEqual({
      kind: 'recommend-reports',
      recommendations: [{ templateId: 'allowed', score: 0.8 }],
    });
  });

  it('retains schema sanitisation and semantic allowlisting after recovery', () => {
    expect(
      parseNlToSchemaResponse(
        '{"table_name":"Support Tickets","columns":[{"name":"Ticket ID","sql_type":"BIGINT","semantic_type_id":"ticket_id","description":"Primary key"}]}\nDone.',
        ['ticket_id'],
      ),
    ).toEqual({
      kind: 'nl-to-schema',
      tableName: 'support_tickets',
      columns: [
        {
          name: 'ticket_id',
          sqlType: 'BIGINT',
          semanticTypeId: 'ticket_id',
          description: 'Primary key',
        },
      ],
    });
  });
});
