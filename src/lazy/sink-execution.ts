// Lazy action-sink execution. The shell carries only catalogue metadata; file
// pickers, export SQL, manifests, and destination mappers load on first use.

import type { AnonColumnPlan } from '../core/anonymize.ts';
import {
  buildAnonymizedProjection,
  buildManifest,
  defaultStrategyForSensitivity,
  generateSalt,
  quoteIdent,
  sensitivityForExport,
} from '../core/anonymize.ts';
import {
  type CsvProjectionColumn,
  buildFormulaSafeCsvProjection,
  encodeFormulaSafeCsv,
} from '../core/csv-safety.ts';
import type { Engine } from '../core/engine.ts';
import { type GoldenSpec, buildGoldenSql } from '../core/golden.ts';
import { hasSensitivityLayer } from '../taxonomy/universal.ts';
import type { SqlResult } from '../ui/cells/types.ts';
import type { ColumnAssignment } from '../ui/schema-panel.ts';
import { openAnonymizeModal } from '../ui/sinks/anonymize-modal.ts';
import type { SinkContext, SinkOutcome } from '../ui/sinks/catalog.ts';
import { openGoldenModal } from '../ui/sinks/golden-modal.ts';

export class SinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SinkError';
  }
}

export async function executeSink(id: string, ctx: SinkContext): Promise<SinkOutcome> {
  switch (id) {
    case 'csv':
      return executeCsv(ctx);
    case 'parquet':
      return executeParquet(ctx);
    case 'anonymize':
      return executeAnonymize(ctx);
    case 'golden':
      return executeGolden(ctx);
    case 'kanzen':
      return executeKanzen(ctx);
    case 'bahi':
      return executeBahi(ctx);
    case 'nakliposter':
      return executeNakliPoster(ctx);
    default:
      throw new SinkError(`Unknown sink: ${id}`);
  }
}

async function executeCsv(ctx: SinkContext): Promise<SinkOutcome> {
  const suggested = `${ctx.cellName ?? `cell-${ctx.cellId}`}-${stamp()}.csv`;
  const file = await pickSaveFile(suggested, '.csv', 'text/csv');
  if (!file) throw new SinkError('Save cancelled.');
  const bytes = await csvBytes(ctx.engine, ctx.cellId, ctx.result);
  await writeBytes(file, bytes);
  return {
    message: `Wrote ${bytes.byteLength.toLocaleString()} bytes to ${file.name}.`,
    bytesWritten: bytes.byteLength,
  };
}

async function executeParquet(ctx: SinkContext): Promise<SinkOutcome> {
  const suggested = `${ctx.cellName ?? `cell-${ctx.cellId}`}-${stamp()}.parquet`;
  const file = await pickSaveFile(suggested, '.parquet', 'application/octet-stream');
  if (!file) throw new SinkError('Save cancelled.');
  const bytes = await parquetBytes(ctx.engine, ctx.cellId);
  await writeBytes(file, bytes);
  return {
    message: `Wrote ${bytes.byteLength.toLocaleString()} bytes to ${file.name}.`,
    bytesWritten: bytes.byteLength,
  };
}

async function executeAnonymize(ctx: SinkContext): Promise<SinkOutcome> {
  const bundle = ctx.taxonomyBundle;
  if (!hasSensitivityLayer(bundle)) {
    throw new SinkError(
      'Anonymized export unavailable: the sensitivity layer failed to load. Nothing was written.',
    );
  }
  const provenanceByCol = new Map(ctx.resultProvenance.map((entry) => [entry.outputColumn, entry]));
  const assignmentByCol = new Map(ctx.columnAssignments.map((entry) => [entry.columnName, entry]));
  const initialPlan: AnonColumnPlan[] = ctx.result.columns.map((columnName) => {
    const provenance = provenanceByCol.get(columnName);
    const assignment = assignmentByCol.get(columnName);
    const typeId = assignment?.assigned.typeId ?? null;
    const sensitivity =
      provenance?.status === 'direct' ? sensitivityForExport(bundle, ctx.userTypes, typeId) : null;
    return {
      columnName,
      sqlType: assignment?.sqlType ?? 'VARCHAR',
      sensitivity,
      typeId,
      strategy: defaultStrategyForSensitivity(sensitivity),
      provenance: {
        status: provenance?.status ?? 'unproven',
        sourceId: provenance?.sourceId ?? null,
        tableId: provenance?.tableId ?? null,
        tableName: provenance?.tableName ?? null,
        sourceColumn: provenance?.sourceColumn ?? null,
        assignmentKey: provenance?.assignmentKey ?? null,
      },
    };
  });
  const configured = await openAnonymizeModal({
    initialPlan,
    generatedSalt: generateSalt(),
  });
  if (!configured) throw new SinkError('Anonymized export cancelled.');
  const { plan, salt, saltOrigin } = configured;
  const projection = buildAnonymizedProjection(plan, salt);
  if (projection === 'NULL AS _empty') {
    throw new SinkError('Every column is dropped. Keep or transform at least one column.');
  }

  const suggested = `${ctx.cellName ?? `cell-${ctx.cellId}`}-anonymized-${stamp()}.csv`;
  const file = await pickSaveFile(suggested, '.csv', 'text/csv');
  if (!file) throw new SinkError('Save cancelled.');
  const manifestFile = await pickSaveFile(
    suggested.replace(/\.csv$/, '.manifest.json'),
    '.json',
    'application/json',
  );
  if (!manifestFile) throw new SinkError('Manifest save cancelled. Nothing was written.');

  const bytes = await formulaSafeCopyBytes(
    ctx.engine,
    `SELECT ${projection} FROM ${quoteIdent(`cell_${ctx.cellId}`)}`,
    anonymizedCsvColumns(plan),
    `tmp_anon_${ctx.cellId}.csv`,
  );
  const manifestBytes = new TextEncoder().encode(
    JSON.stringify(
      buildManifest({ plan, taxonomyVersion: bundle.version, saltUsed: true }),
      null,
      2,
    ),
  );
  await writeBytes(file, bytes);
  try {
    await writeBytes(manifestFile, manifestBytes);
  } catch (err) {
    throw new SinkError(
      `Data was written to ${file.name}, but the manifest failed. Retry before sharing. ${errorMessage(err)}`,
    );
  }
  const kept = plan.filter((column) => column.strategy !== 'drop').length;
  return {
    message: `Exported ${kept} columns (${plan.length - kept} dropped) via ${saltOrigin} salt. Save the salt for re-runnable hashes.`,
    bytesWritten: bytes.byteLength,
  };
}

async function executeGolden(ctx: SinkContext): Promise<SinkOutcome> {
  const viewName = `cell_${ctx.cellId}`;
  const spec = await openGoldenModal({ columns: ctx.result.columns, sourceLabel: viewName });
  if (!spec) throw new SinkError('Golden-table export cancelled.');
  const sql = buildGoldenSql(spec, viewName);
  const ext = spec.format === 'parquet' ? '.parquet' : '.csv';
  const rawName = `tmp_golden_${ctx.cellId}${ext}`;
  const bytes =
    spec.format === 'parquet'
      ? await copyBytes(ctx.engine, sql, rawName, '(FORMAT PARQUET)')
      : await formulaSafeCopyBytes(
          ctx.engine,
          sql,
          goldenCsvColumns(spec, await ctx.engine.describeColumns(viewName)),
          rawName,
        );
  const suggested = `${ctx.cellName ?? `cell-${ctx.cellId}`}-golden-${stamp()}${ext}`;
  const file = await pickSaveFile(
    suggested,
    ext,
    spec.format === 'parquet' ? 'application/octet-stream' : 'text/csv',
  );
  if (!file) throw new SinkError('Save cancelled.');
  await writeBytes(file, bytes);
  return {
    message: `Wrote a golden table (one row per "${spec.entityColumn}") — ${bytes.byteLength.toLocaleString()} bytes to ${file.name}.`,
    bytesWritten: bytes.byteLength,
  };
}

async function executeKanzen(ctx: SinkContext): Promise<SinkOutcome> {
  const cards = mapToKanzenCards(ctx.result, ctx.columnAssignments);
  return writeJson(
    `${ctx.cellName ?? `cell-${ctx.cellId}`}-kanzen-${stamp()}.json`,
    { format: 'kanzen-import', version: '1', origin: 'lens', cards },
    `Wrote ${cards.length} cards.`,
  );
}

async function executeBahi(ctx: SinkContext): Promise<SinkOutcome> {
  const entries = mapToBahiJournal(ctx.result, ctx.columnAssignments);
  return writeJson(
    `${ctx.cellName ?? `cell-${ctx.cellId}`}-bahi-${stamp()}.json`,
    {
      format: 'bahi-journal-proposal',
      version: '1',
      origin: 'lens',
      auto_post: false,
      entries,
    },
    `Wrote ${entries.length} journal entries.`,
  );
}

async function executeNakliPoster(ctx: SinkContext): Promise<SinkOutcome> {
  const template = window.prompt(
    'Paste a NakliPoster request template JSON. Use ${col_name} for row values.',
    '{"method":"GET","url":"https://api.example.com/${id}"}',
  );
  if (!template) throw new SinkError('Template missing.');
  const requests = mapToNakliPoster(template, ctx.result);
  return writeJson(
    `${ctx.cellName ?? `cell-${ctx.cellId}`}-nakliposter-${stamp()}.json`,
    { format: 'nakliposter-collection', version: '1', origin: 'lens', requests },
    `Wrote ${requests.length} parametrized requests.`,
  );
}

export async function csvBytes(
  engine: Engine,
  cellId: string,
  result: SqlResult,
): Promise<Uint8Array> {
  const viewName = `cell_${cellId}`;
  const columns = await engine.describeColumns(viewName);
  if (result.rowCount > 5000) {
    return formulaSafeCopyBytes(
      engine,
      `SELECT * FROM ${quoteIdent(viewName)}`,
      columns,
      `tmp_export_${cellId}.csv`,
    );
  }
  return encodeFormulaSafeCsv(result.columns, result.rows, columns);
}

async function parquetBytes(engine: Engine, cellId: string): Promise<Uint8Array> {
  return copyBytes(
    engine,
    `SELECT * FROM ${quoteIdent(`cell_${cellId}`)}`,
    `tmp_export_${cellId}.parquet`,
    '(FORMAT PARQUET)',
  );
}

async function formulaSafeCopyBytes(
  engine: Engine,
  sourceSql: string,
  columns: ReadonlyArray<CsvProjectionColumn>,
  rawName: string,
): Promise<Uint8Array> {
  if (columns.length === 0) throw new SinkError('CSV export has no columns.');
  return copyBytes(
    engine,
    `SELECT ${buildFormulaSafeCsvProjection(columns)} FROM (${sourceSql}) AS "_naklidata_csv"`,
    rawName,
    "(HEADER, DELIMITER ',')",
  );
}

async function copyBytes(
  engine: Engine,
  sql: string,
  rawName: string,
  options: string,
): Promise<Uint8Array> {
  await engine.exec(`COPY (${sql}) TO '${rawName.replace(/'/g, "''")}' ${options}`);
  try {
    return await engine.exportFileBytes(rawName);
  } catch (err) {
    throw new SinkError(`Failed to read exported file: ${errorMessage(err)}`);
  } finally {
    await engine.removeFile(rawName).catch(() => {});
  }
}

function anonymizedCsvColumns(plan: ReadonlyArray<AnonColumnPlan>): CsvProjectionColumn[] {
  return plan
    .filter((column) => column.strategy !== 'drop')
    .map((column) => ({
      name: column.columnName,
      type: column.strategy === 'keep' || column.strategy === 'bucket' ? column.sqlType : 'VARCHAR',
    }));
}

function goldenCsvColumns(
  spec: GoldenSpec,
  sourceColumns: ReadonlyArray<CsvProjectionColumn>,
): CsvProjectionColumn[] {
  const typeByName = new Map(sourceColumns.map((column) => [column.name, column.type]));
  const names = [
    spec.entityColumn,
    ...spec.columns
      .filter((column) => column.columnName !== spec.entityColumn)
      .map((column) => column.columnName),
  ];
  return names.map((name) => ({ name, type: typeByName.get(name) ?? 'VARCHAR' }));
}

function mapToKanzenCards(
  result: SqlResult,
  assignments: ColumnAssignment[],
): Array<Record<string, unknown>> {
  const title = assignments.find((a) => a.sqlType.toUpperCase() === 'VARCHAR')?.columnName;
  return result.rows.map((row) => {
    const card: Record<string, unknown> = {
      title: String(row[title ?? result.columns[0] ?? ''] ?? '').slice(0, 200),
    };
    for (const assignment of assignments) {
      if (assignment.columnName === title) continue;
      const value = row[assignment.columnName];
      if (value == null) continue;
      if (assignment.assigned.typeId === 'iso_date') card.due_date = value;
      else if (assignment.sqlType.toUpperCase() === 'VARCHAR' && card.description == null) {
        card.description = value;
      }
    }
    return card;
  });
}

function mapToBahiJournal(
  result: SqlResult,
  assignments: ColumnAssignment[],
): Array<Record<string, unknown>> {
  const named = (predicate: (assignment: ColumnAssignment) => boolean) =>
    assignments.find(predicate)?.columnName;
  const date = named(
    (a) => a.assigned.typeId === 'iso_date' || a.sqlType.toUpperCase().includes('DATE'),
  );
  const amount = named((a) => a.assigned.typeId === 'amount');
  const party = named(
    (a) => a.assigned.typeId === 'vendor_name' || a.assigned.typeId === 'gl_account',
  );
  const gstin = named((a) => a.assigned.typeId === 'gstin');
  const hsn = named((a) => a.assigned.typeId === 'hsn_code');
  if (!date || !amount) return [];
  return result.rows.map((row) => ({
    date: row[date],
    amount: Number(row[amount]) || 0,
    ...(party ? { party: row[party] } : {}),
    ...(gstin ? { gstin: row[gstin] } : {}),
    ...(hsn ? { hsn_code: row[hsn] } : {}),
  }));
}

function mapToNakliPoster(template: string, result: SqlResult): Array<Record<string, unknown>> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(template);
  } catch {
    throw new SinkError('Template is not valid JSON.');
  }
  return result.rows.map((row) =>
    Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [key, substituteVars(value, row)]),
    ),
  );
}

function substituteVars(value: unknown, row: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
      const replacement = row[name];
      return replacement == null ? '' : String(replacement);
    });
  }
  if (Array.isArray(value)) return value.map((entry) => substituteVars(entry, row));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, substituteVars(entry, row)]),
    );
  }
  return value;
}

async function writeJson(suggested: string, value: unknown, message: string): Promise<SinkOutcome> {
  const file = await pickSaveFile(suggested, '.json', 'application/json');
  if (!file) throw new SinkError('Save cancelled.');
  const bytes = new TextEncoder().encode(JSON.stringify(value, null, 2));
  await writeBytes(file, bytes);
  return { message, bytesWritten: bytes.byteLength };
}

type WritableFile = { name: string; write: (bytes: Uint8Array) => Promise<void> };

async function pickSaveFile(
  suggestedName: string,
  ext: string,
  mime: string,
): Promise<WritableFile | null> {
  type Picker = (options: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandle>;
  const picker = (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({
        suggestedName,
        types: [{ description: ext.slice(1).toUpperCase(), accept: { [mime]: [ext] } }],
      });
      return {
        name: handle.name,
        write: async (bytes) => {
          const writable = await handle.createWritable();
          await writable.write(new Blob([new Uint8Array(bytes)]));
          await writable.close();
        },
      };
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return null;
      throw err;
    }
  }
  return {
    name: suggestedName,
    write: async (bytes) => {
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = suggestedName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    },
  };
}

const writeBytes = (file: WritableFile, bytes: Uint8Array) => file.write(bytes);
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
