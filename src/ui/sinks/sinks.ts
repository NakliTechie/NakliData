// Action sinks per spec §3.4. Type-gated menu of "Send to..." destinations.
//
// v1.0 sinks (5 total):
//   1. Write CSV to FSA folder (no type req)
//   2. Write Parquet to FSA folder (no type req)
//   3. Push to KanZen board (requires title-class string column)
//   4. Push to Bahi journal proposal (requires date + amount + vendor/account)
//   5. Push to NakliPoster collection (requires user-supplied template)

import type { Engine } from '../../core/engine.ts';
import type { SqlResult } from '../cells/types.ts';
import type { ColumnAssignment } from '../schema-panel.ts';

export interface SinkDescriptor {
  id: string;
  name: string;
  description: string;
  /** Returns null if compatible; returns a human-readable reason if blocked. */
  blockReason: (result: SqlResult, columnAssignments: ColumnAssignment[]) => string | null;
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
  blockReason: () => null,
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
  blockReason: () => null,
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
  blockReason: (_result, assignments) => {
    const hasTitle = assignments.some((a) => isTitleClass(a));
    if (!hasTitle) return 'Need a title-class string column (3-200 chars).';
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
  blockReason: (_result, assignments) => {
    const hasDate = assignments.some((a) => isDate(a));
    const hasAmount = assignments.some((a) => isAmount(a));
    const hasParty = assignments.some((a) => isParty(a));
    if (!hasDate) return 'Need a date-typed column.';
    if (!hasAmount) return 'Need an amount column.';
    if (!hasParty) return 'Need a vendor / account column.';
    return null;
  },
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

export const NAKLIPOSTER_SINK: SinkDescriptor = {
  id: 'nakliposter',
  name: 'Push to NakliPoster collection',
  description: 'Parametrize a template per row (you provide the template JSON).',
  blockReason: () => null,
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
    const tmpName = `tmp_export_${cellId}.csv`;
    await engine.exec(`COPY (SELECT * FROM "${viewName}") TO '${tmpName}' (HEADER, DELIMITER ',')`);
    return await readDuckDbFile(engine, tmpName);
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
  const tmpName = `tmp_export_${cellId}.parquet`;
  await engine.exec(`COPY (SELECT * FROM "${viewName}") TO '${tmpName}' (FORMAT PARQUET)`);
  return await readDuckDbFile(engine, tmpName);
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
