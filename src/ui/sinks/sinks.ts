// Action sinks per spec §3.4. Type-gated menu of "Send to..." destinations.
//
// v1.0 sinks (5 total):
//   1. Write CSV to FSA folder (no type req)
//   2. Write Parquet to FSA folder (no type req)
//   3. Push to KanZen board (requires title-class string column)
//   4. Push to Bahi journal proposal (requires date + amount + vendor/account)
//   5. Push to NakliPoster collection (requires user-supplied template)

import type { Engine } from '../../core/engine.ts';
import { getTaxonomyClient } from '../../taxonomy/client.ts';
import type { TypeSensitivity } from '../../taxonomy/types.ts';
import type { SqlResult } from '../cells/types.ts';
import type { ColumnAssignment } from '../schema-panel.ts';
import { openAnonymizeModal } from './anonymize-modal.ts';
import type { AnonColumnPlan } from './anonymize.ts';
import {
  buildAnonymizedProjection,
  buildManifest,
  defaultStrategyForSensitivity,
  generateSalt,
} from './anonymize.ts';
import type { GatedSink } from './gating.ts';

export type { GatedSink, Requirement } from './gating.ts';
export { blockReasonFor, evaluateRequirements } from './gating.ts';

export interface SinkDescriptor extends GatedSink {
  /** Run the sink. The function is responsible for any UI prompts. */
  execute: (ctx: SinkContext) => Promise<SinkOutcome>;
}

export interface SinkContext {
  engine: Engine;
  cellId: string;
  cellName: string | null;
  result: SqlResult;
  columnAssignments: ColumnAssignment[];
}

export interface SinkOutcome {
  message: string;
  bytesWritten?: number;
}

export class SinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SinkError';
  }
}

export const CSV_SINK: SinkDescriptor = {
  id: 'csv',
  name: 'Write CSV to folder',
  description: 'Save the result as a .csv file in a folder you choose.',
  async execute({ engine, cellId, cellName, result }) {
    const suggested = `${cellName ?? `cell-${cellId}`}-${stamp()}.csv`;
    const file = await pickSaveFile(suggested, '.csv', 'text/csv');
    if (!file) throw new SinkError('Save cancelled.');
    const bytes = await csvBytes(engine, cellId, result);
    await writeBytes(file, bytes);
    return {
      message: `Wrote ${bytes.byteLength.toLocaleString()} bytes to ${file.name}.`,
      bytesWritten: bytes.byteLength,
    };
  },
};

export const PARQUET_SINK: SinkDescriptor = {
  id: 'parquet',
  name: 'Write Parquet to folder',
  description: 'Save the result as a Parquet file in a folder you choose.',
  async execute({ engine, cellId, cellName }) {
    const suggested = `${cellName ?? `cell-${cellId}`}-${stamp()}.parquet`;
    const file = await pickSaveFile(suggested, '.parquet', 'application/octet-stream');
    if (!file) throw new SinkError('Save cancelled.');
    const bytes = await parquetBytes(engine, cellId);
    await writeBytes(file, bytes);
    return {
      message: `Wrote ${bytes.byteLength.toLocaleString()} bytes to ${file.name}.`,
      bytesWritten: bytes.byteLength,
    };
  },
};

export const KANZEN_SINK: SinkDescriptor = {
  id: 'kanzen',
  name: 'Push to KanZen board',
  description: 'Generate a KanZen import JSON: each row → one card.',
  // No typeId-based requires here: KanZen needs a "title-class" string,
  // which isn't a semantic type. Custom check covers it.
  customBlockReason: (_result, assignments) => {
    const hasTitle = assignments.some((a) => isTitleClass(a));
    if (!hasTitle) return 'Need a string column for the card title (3–200 chars).';
    return null;
  },
  async execute({ engine, cellId, cellName, result, columnAssignments }) {
    void engine;
    void cellId;
    const cards = mapToKanzenCards(result, columnAssignments);
    const json = JSON.stringify(
      { format: 'kanzen-import', version: '1', origin: 'lens', cards },
      null,
      2,
    );
    const suggested = `${cellName ?? `cell-${cellId}`}-kanzen-${stamp()}.json`;
    const file = await pickSaveFile(suggested, '.json', 'application/json');
    if (!file) throw new SinkError('Save cancelled.');
    const bytes = new TextEncoder().encode(json);
    await writeBytes(file, bytes);
    return { message: `Wrote ${cards.length} cards.`, bytesWritten: bytes.byteLength };
  },
};

export const BAHI_SINK: SinkDescriptor = {
  id: 'bahi',
  name: 'Push to Bahi journal proposal',
  description: 'Generate a Bahi journal proposal (auto_post: false).',
  requires: [
    { any: ['iso_date'], label: 'date' },
    { any: ['amount'], label: 'amount' },
    { any: ['vendor_name', 'gl_account'], label: 'vendor or account' },
  ],
  async execute({ cellId, cellName, result, columnAssignments }) {
    const entries = mapToBahiJournal(result, columnAssignments);
    const json = JSON.stringify(
      {
        format: 'bahi-journal-proposal',
        version: '1',
        origin: 'lens',
        auto_post: false,
        entries,
      },
      null,
      2,
    );
    const suggested = `${cellName ?? `cell-${cellId}`}-bahi-${stamp()}.json`;
    const file = await pickSaveFile(suggested, '.json', 'application/json');
    if (!file) throw new SinkError('Save cancelled.');
    const bytes = new TextEncoder().encode(json);
    await writeBytes(file, bytes);
    return { message: `Wrote ${entries.length} journal entries.`, bytesWritten: bytes.byteLength };
  },
};

export const ANONYMIZE_SINK: SinkDescriptor = {
  id: 'anonymize',
  name: 'Export anonymized',
  description:
    'Hash / redact / bucket / drop sensitive columns based on their taxonomy badges. CSV + Parquet output; manifest alongside.',
  async execute({ engine, cellId, cellName, result, columnAssignments }) {
    // Look up sensitivity per column from the taxonomy bundle + user types.
    const bundle = getTaxonomyClient().getBundle();
    const sensitivityOf = (typeId: string | null): TypeSensitivity | null => {
      if (!typeId) return null;
      const fromBundle = bundle?.types.find((t) => t.id === typeId);
      if (fromBundle) return fromBundle.sensitivity ?? 'public';
      // UserType (per-workspace taxonomy extension) doesn't carry a
      // sensitivity badge today — they default to unbadged. If a future
      // workbook starts saving sensitivity on UserType, extend here.
      return null;
    };
    const assignByCol = new Map(columnAssignments.map((a) => [a.columnName, a]));
    const initialPlan: AnonColumnPlan[] = result.columns.map((col) => {
      const a = assignByCol.get(col);
      const typeId = a?.assigned?.typeId ?? null;
      const sensitivity = sensitivityOf(typeId);
      return {
        columnName: col,
        sqlType: a?.sqlType ?? 'VARCHAR',
        sensitivity,
        typeId,
        strategy: defaultStrategyForSensitivity(sensitivity ?? undefined),
      };
    });
    const generatedSalt = generateSalt();
    const result_ = await openAnonymizeModal({ initialPlan, generatedSalt });
    if (!result_) throw new SinkError('Anonymized export cancelled.');
    const { plan, salt, saltOrigin } = result_;
    // Build the projection + COPY-to-temp + read back. Mirrors the
    // csvBytes / parquetBytes pattern below (sqlName escapes `'`).
    const viewName = `cell_${cellId}`;
    const projection = buildAnonymizedProjection(plan, salt);
    if (projection === 'NULL AS _empty') {
      throw new SinkError(
        'Every column has strategy `drop`. Pick at least one column to keep, hash, redact, or bucket.',
      );
    }
    const rawName = `tmp_anon_${cellId}.csv`;
    const sqlName = rawName.replace(/'/g, "''");
    await engine.exec(
      `COPY (SELECT ${projection} FROM ${quoteIdent(viewName)}) TO '${sqlName}' (HEADER, DELIMITER ',')`,
    );
    const bytes = await readDuckDbFile(engine, rawName);

    // Write the data file first, then the manifest.
    const suggested = `${cellName ?? `cell-${cellId}`}-anonymized-${stamp()}.csv`;
    const file = await pickSaveFile(suggested, '.csv', 'text/csv');
    if (!file) throw new SinkError('Save cancelled.');
    await writeBytes(file, bytes);

    const manifest = buildManifest({
      plan,
      taxonomyVersion: bundle?.version ?? 'unknown',
      saltUsed: true,
    });
    const manifestSuggested = suggested.replace(/\.csv$/, '.manifest.json');
    const manifestFile = await pickSaveFile(manifestSuggested, '.json', 'application/json');
    if (manifestFile) {
      const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
      await writeBytes(manifestFile, manifestBytes);
    }

    const kept = plan.filter((c) => c.strategy !== 'drop').length;
    const dropped = plan.length - kept;
    return {
      message: `Exported ${kept} columns (${dropped} dropped) via ${saltOrigin} salt. Save the salt if you want re-runnable hashed output.`,
      bytesWritten: bytes.byteLength,
    };
  },
};

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export const NAKLIPOSTER_SINK: SinkDescriptor = {
  id: 'nakliposter',
  name: 'Push to NakliPoster collection',
  description: 'Parametrize a template per row (you provide the template JSON).',
  async execute({ cellId, cellName, result }) {
    const templateText = window.prompt(
      'Paste a NakliPoster request template JSON. Use ${col_name} for row values.',
      '{"method":"GET","url":"https://api.example.com/${id}"}',
    );
    if (!templateText) throw new SinkError('Template missing.');
    const requests = mapToNakliPoster(templateText, result);
    const json = JSON.stringify(
      { format: 'nakliposter-collection', version: '1', origin: 'lens', requests },
      null,
      2,
    );
    const suggested = `${cellName ?? `cell-${cellId}`}-nakliposter-${stamp()}.json`;
    const file = await pickSaveFile(suggested, '.json', 'application/json');
    if (!file) throw new SinkError('Save cancelled.');
    const bytes = new TextEncoder().encode(json);
    await writeBytes(file, bytes);
    return {
      message: `Wrote ${requests.length} parametrized requests.`,
      bytesWritten: bytes.byteLength,
    };
  },
};

export const SINKS: SinkDescriptor[] = [
  CSV_SINK,
  PARQUET_SINK,
  ANONYMIZE_SINK,
  KANZEN_SINK,
  BAHI_SINK,
  NAKLIPOSTER_SINK,
];

// ---- helpers ------------------------------------------------------------

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

async function csvBytes(engine: Engine, cellId: string, result: SqlResult): Promise<Uint8Array> {
  // Prefer DuckDB COPY for fidelity on big results; fall back to in-JS for the
  // small case. Threshold: 5000 rows.
  if (result.rowCount > 5000) {
    const viewName = `cell_${cellId}`;
    // Forward-pass L7 (2026-06-02): escape `'` in cellId before
    // interpolating into the SQL string literal. Codex review of
    // v1.2.1..HEAD caught the first pass — it doubled the quote in
    // BOTH the SQL literal AND the readDuckDbFile lookup, so DuckDB
    // wrote `a'b.csv` but our code tried to read `a''b.csv`. The two
    // representations must stay distinct: `rawName` is the actual
    // filename on DuckDB's MEMFS; `sqlName` is the SQL-escaped form.
    const rawName = `tmp_export_${cellId}.csv`;
    const sqlName = rawName.replace(/'/g, "''");
    await engine.exec(`COPY (SELECT * FROM "${viewName}") TO '${sqlName}' (HEADER, DELIMITER ',')`);
    return await readDuckDbFile(engine, rawName);
  }
  const parts: string[] = [];
  parts.push(result.columns.map(csvEscape).join(','));
  for (const row of result.rows) {
    parts.push(result.columns.map((c) => csvEscape(formatCsvValue(row[c]))).join(','));
  }
  parts.push('');
  return new TextEncoder().encode(parts.join('\n'));
}

async function parquetBytes(engine: Engine, cellId: string): Promise<Uint8Array> {
  const viewName = `cell_${cellId}`;
  // Forward-pass L7 + codex review: rawName / sqlName must be distinct
  // — see csvBytes comment above. DuckDB writes the file under
  // `rawName`; `sqlName` only quotes inside the SQL string literal.
  const rawName = `tmp_export_${cellId}.parquet`;
  const sqlName = rawName.replace(/'/g, "''");
  await engine.exec(`COPY (SELECT * FROM "${viewName}") TO '${sqlName}' (FORMAT PARQUET)`);
  return await readDuckDbFile(engine, rawName);
}

async function readDuckDbFile(engine: Engine, name: string): Promise<Uint8Array> {
  try {
    const bytes = await engine.exportFileBytes(name);
    void engine.removeFile(name);
    return bytes;
  } catch (err) {
    throw new SinkError(
      `Failed to read exported file: ${err instanceof Error ? err.message : err}`,
    );
  }
}

function csvEscape(v: string): string {
  if (v.includes(',') || v.includes('"') || v.includes('\n') || v.includes('\r')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function formatCsvValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

async function pickSaveFile(
  suggestedName: string,
  ext: string,
  mime: string,
): Promise<{ name: string; write: (bytes: Uint8Array) => Promise<void> } | null> {
  type Picker = (opts: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandle>;
  const picker = (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker;
  if (typeof picker === 'function') {
    try {
      const handle = await picker({
        suggestedName,
        types: [{ description: ext.replace('.', '').toUpperCase(), accept: { [mime]: [ext] } }],
      });
      return {
        name: handle.name,
        write: async (bytes) => {
          const w = await handle.createWritable();
          await w.write(new Blob([new Uint8Array(bytes)]));
          await w.close();
        },
      };
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return null;
      throw err;
    }
  }
  // Fallback: trigger a download.
  return {
    name: suggestedName,
    write: async (bytes) => {
      const blob = new Blob([new Uint8Array(bytes)], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = suggestedName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
  };
}

async function writeBytes(
  file: { write: (bytes: Uint8Array) => Promise<void> },
  bytes: Uint8Array,
): Promise<void> {
  await file.write(bytes);
}

// ---- type-class predicates (lightweight v1.0 mapping) -------------------

function isTitleClass(a: ColumnAssignment): boolean {
  if (a.sqlType.toUpperCase() !== 'VARCHAR') return false;
  // Lengths bounded by spec §3.4: 3–200 chars. The classifier doesn't surface
  // length stats yet, so accept any string column for v1.0; tighten later.
  return true;
}

function isDate(a: ColumnAssignment): boolean {
  return a.assigned.typeId === 'iso_date' || a.sqlType.toUpperCase().includes('DATE');
}

function isAmount(a: ColumnAssignment): boolean {
  return a.assigned.typeId === 'amount';
}

function isParty(a: ColumnAssignment): boolean {
  return a.assigned.typeId === 'vendor_name' || a.assigned.typeId === 'gl_account';
}

// ---- mappers ------------------------------------------------------------

function mapToKanzenCards(
  result: SqlResult,
  assignments: ColumnAssignment[],
): Array<Record<string, unknown>> {
  const titleCol = assignments.find((a) => isTitleClass(a))?.columnName ?? result.columns[0];
  const cards: Array<Record<string, unknown>> = [];
  for (const row of result.rows) {
    const card: Record<string, unknown> = {
      title: String(row[titleCol ?? ''] ?? '').slice(0, 200),
    };
    for (const a of assignments) {
      if (a.columnName === titleCol) continue;
      const v = row[a.columnName];
      if (v === null || v === undefined) continue;
      if (a.assigned.typeId === 'iso_date') card.due_date = v;
      else if (a.sqlType.toUpperCase() === 'VARCHAR' && card.description == null) {
        card.description = v;
      }
    }
    cards.push(card);
  }
  return cards;
}

function mapToBahiJournal(
  result: SqlResult,
  assignments: ColumnAssignment[],
): Array<Record<string, unknown>> {
  const dateCol = assignments.find((a) => isDate(a))?.columnName;
  const amountCol = assignments.find((a) => isAmount(a))?.columnName;
  const partyCol = assignments.find((a) => isParty(a))?.columnName;
  const gstinCol = assignments.find((a) => a.assigned.typeId === 'gstin')?.columnName;
  const hsnCol = assignments.find((a) => a.assigned.typeId === 'hsn_code')?.columnName;
  const entries: Array<Record<string, unknown>> = [];
  for (const row of result.rows) {
    if (!dateCol || !amountCol) continue;
    const entry: Record<string, unknown> = {
      date: row[dateCol],
      amount: Number(row[amountCol]) || 0,
    };
    if (partyCol) entry.party = row[partyCol];
    if (gstinCol) entry.gstin = row[gstinCol];
    if (hsnCol) entry.hsn_code = row[hsnCol];
    entries.push(entry);
  }
  return entries;
}

function mapToNakliPoster(template: string, result: SqlResult): Array<Record<string, unknown>> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(template);
  } catch {
    throw new SinkError('Template is not valid JSON.');
  }
  const out: Array<Record<string, unknown>> = [];
  for (const row of result.rows) {
    const inst: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed)) {
      inst[k] = substituteVars(v, row, result.columns);
    }
    out.push(inst);
  }
  return out;
}

function substituteVars(value: unknown, row: Record<string, unknown>, _cols: string[]): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => {
      const v = row[name];
      return v === null || v === undefined ? '' : String(v);
    });
  }
  if (Array.isArray(value)) return value.map((v) => substituteVars(v, row, _cols));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = substituteVars(v, row, _cols);
    return out;
  }
  return value;
}
