// Lightweight sink catalogue used by the always-on SQL-cell UI. Execution,
// modals, export encoders, and mappers live in the lazy `sink-execution` chunk.

import type { Engine } from '../../core/engine.ts';
import { loadChunk } from '../../core/lazy-loader.ts';
import type { ResultColumnProvenance } from '../../core/result-provenance.ts';
import type { UserType } from '../../core/workbook.ts';
import type { TaxonomyBundle } from '../../taxonomy/types.ts';
import type { SqlResult } from '../cells/types.ts';
import type { ColumnAssignment } from '../schema-panel.ts';
import type { GatedSink } from './gating.ts';

export type { GatedSink, Requirement } from './gating.ts';
export { blockReasonFor, evaluateRequirements } from './gating.ts';

export interface SinkContext {
  engine: Engine;
  cellId: string;
  cellName: string | null;
  result: SqlResult;
  columnAssignments: ColumnAssignment[];
  resultProvenance: ResultColumnProvenance[];
  userTypes: UserType[];
  taxonomyBundle: TaxonomyBundle | null;
}

export interface SinkOutcome {
  message: string;
  bytesWritten?: number;
}

export interface SinkDescriptor extends GatedSink {
  execute: (ctx: SinkContext) => Promise<SinkOutcome>;
}

const execute =
  (id: string) =>
  async (ctx: SinkContext): Promise<SinkOutcome> =>
    (await loadChunk('sink-execution')).executeSink(id, ctx);

export const SINKS: SinkDescriptor[] = [
  {
    id: 'csv',
    name: 'Write CSV to folder',
    description: 'Save the result as a .csv file in a folder you choose.',
    execute: execute('csv'),
  },
  {
    id: 'parquet',
    name: 'Write Parquet to folder',
    description: 'Save the result as a Parquet file in a folder you choose.',
    execute: execute('parquet'),
  },
  {
    id: 'anonymize',
    name: 'Export anonymized',
    description:
      'Hash / redact / bucket / drop sensitive columns based on their taxonomy badges. CSV output plus a manifest.',
    execute: execute('anonymize'),
  },
  {
    id: 'golden',
    name: 'Export golden table',
    description:
      'Collapse to one row per canonical entity with survivorship rules; write CSV or Parquet.',
    execute: execute('golden'),
  },
  {
    id: 'kanzen',
    name: 'Push to KanZen board',
    description: 'Generate a KanZen import JSON: each row → one card.',
    customBlockReason: (_result, assignments) =>
      assignments.some((assignment) => assignment.sqlType.toUpperCase() === 'VARCHAR')
        ? null
        : 'Need a proven string column for the card title (3–200 chars).',
    execute: execute('kanzen'),
  },
  {
    id: 'bahi',
    name: 'Push to Bahi journal proposal',
    description: 'Generate a Bahi journal proposal (auto_post: false).',
    requires: [
      { any: ['iso_date'], label: 'date' },
      { any: ['amount'], label: 'amount' },
      { any: ['vendor_name', 'gl_account'], label: 'vendor or account' },
    ],
    execute: execute('bahi'),
  },
  {
    id: 'nakliposter',
    name: 'Push to NakliPoster collection',
    description: 'Parametrize a template per row (you provide the template JSON).',
    execute: execute('nakliposter'),
  },
];
