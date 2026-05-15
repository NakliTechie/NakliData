// Mount layer: turns a "source" (FSA folder, FSA file, URL, example bundle)
// into a set of registered DuckDB tables.
//
// Spec refs:
//   §3.1 — source mounting (FSA folder/file; multi-root; file-to-table mapping)
//   §3.5 — example data bundle ("Browse example data" CTA)

import type { Engine, RegisterFileOptions } from './engine.ts';
import {
  type AnyHandle,
  PermissionLostError,
  ensureReadPermission,
  newHandleId,
  putHandle,
} from './handles.ts';

export type FileFormat = 'csv' | 'tsv' | 'jsonl' | 'parquet' | 'sqlite' | 'xlsx';

export type SourceKind = 'example-bundle' | 'fsa-folder' | 'fsa-file' | 'http';

export interface MountedTable {
  id: string;
  sourceId: string;
  name: string;
  format: FileFormat;
  /** Where the bytes came from (display only). */
  origin: string;
  rowCount: number;
  registered: boolean;
}

export interface MountedSource {
  id: string;
  kind: SourceKind;
  label: string;
  /** For example-bundle: bundle id; for FSA: handle id; for http: URL. */
  ref?: string;
  tables: MountedTable[];
}

export interface ExampleBundleManifest {
  bundle: string;
  version: string;
  sources: Array<{
    id: string;
    label: string;
    description?: string;
    files: Array<{ path: string; table: string; format: FileFormat }>;
  }>;
}

let nextId = 1;
const genId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${nextId++}`;

export function detectFormat(filename: string): FileFormat | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.tsv')) return 'tsv';
  if (lower.endsWith('.jsonl') || lower.endsWith('.ndjson')) return 'jsonl';
  if (lower.endsWith('.parquet') || lower.endsWith('.pq')) return 'parquet';
  if (lower.endsWith('.db') || lower.endsWith('.sqlite') || lower.endsWith('.sqlite3'))
    return 'sqlite';
  if (lower.endsWith('.xlsx')) return 'xlsx';
  return null;
}

export function sanitizeTableName(filenameOrStem: string): string {
  // Strip extension, lower-case, replace non-ident with _, dedupe _.
  const stem = filenameOrStem.replace(/\.[^.]+$/, '');
  let out = stem
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_');
  out = out.replace(/^_+|_+$/g, '');
  if (!out) out = 't';
  if (/^[0-9]/.test(out)) out = `t_${out}`;
  return out;
}

async function registerFileByFormat(
  engine: Engine,
  format: FileFormat,
  opts: RegisterFileOptions,
): Promise<void> {
  switch (format) {
    case 'csv':
      await engine.registerCsv(opts);
      return;
    case 'tsv':
      await engine.registerTsv(opts);
      return;
    case 'jsonl':
      await engine.registerJsonl(opts);
      return;
    case 'parquet':
      await engine.registerParquet(opts);
      return;
    case 'sqlite':
    case 'xlsx':
      throw new MountError(`Format ${format} not yet supported in v1.0 (build-order steps 12+)`);
  }
}

export class MountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MountError';
  }
}

/**
 * Fetch + register the bundled example data. Returns a single MountedSource
 * per logical example (finance, logs). Caller appends to the workbook state.
 */
export async function mountExampleBundle(
  engine: Engine,
  manifestUrl = '/examples/manifest.json',
): Promise<MountedSource[]> {
  const res = await fetch(manifestUrl);
  if (!res.ok) {
    throw new MountError(`Manifest fetch failed: HTTP ${res.status} ${manifestUrl}`);
  }
  const manifest = (await res.json()) as ExampleBundleManifest;
  const base = manifestUrl.replace(/[^/]+$/, '');

  const out: MountedSource[] = [];
  for (const src of manifest.sources) {
    const source: MountedSource = {
      id: genId('src'),
      kind: 'example-bundle',
      label: src.label,
      ref: src.id,
      tables: [],
    };
    for (const f of src.files) {
      const fileUrl = `${base}${f.path}`;
      const fileRes = await fetch(fileUrl);
      if (!fileRes.ok) {
        throw new MountError(`Example file fetch failed: ${fileUrl} → HTTP ${fileRes.status}`);
      }
      const blob = await fileRes.blob();
      const filename = f.path.split('/').pop() ?? 'data';
      const file = new File([blob], filename, { type: blob.type });
      const tableName = sanitizeTableName(f.table);
      await registerFileByFormat(engine, f.format, { tableName, file });
      const rowCount = await getRowCount(engine, tableName);
      source.tables.push({
        id: genId('tbl'),
        sourceId: source.id,
        name: tableName,
        format: f.format,
        origin: `examples/${f.path}`,
        rowCount,
        registered: true,
      });
    }
    out.push(source);
  }
  return out;
}

async function getRowCount(engine: Engine, tableName: string): Promise<number> {
  const safe = tableName.replace(/"/g, '""');
  const rows = await engine.query<{ n: bigint | number }>(
    `SELECT COUNT(*)::BIGINT AS n FROM "${safe}"`,
  );
  const v = rows[0]?.n;
  return typeof v === 'bigint' ? Number(v) : (v ?? 0);
}

/**
 * Mount a directory via FSA. Iterates the supported files at the top level
 * and registers each as a table. Persists the directory handle in IndexedDB
 * so a future session can re-attach (subject to permission re-grant).
 */
export async function mountFolder(
  engine: Engine,
  dirHandle: FileSystemDirectoryHandle,
  opts: { label?: string } = {},
): Promise<MountedSource> {
  const granted = await ensureReadPermission(dirHandle as AnyHandle);
  if (!granted) throw new MountError('Read permission was not granted on the folder.');
  const handleId = newHandleId();
  await putHandle(handleId, dirHandle as AnyHandle);
  const sourceId = genId('src');
  const source: MountedSource = {
    id: sourceId,
    kind: 'fsa-folder',
    label: opts.label ?? dirHandle.name,
    ref: handleId,
    tables: [],
  };
  // Walk the top-level entries; ignore subdirs in v1.0.
  for await (const [name, entry] of (
    dirHandle as unknown as { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }
  ).entries()) {
    if (entry.kind !== 'file') continue;
    const format = detectFormat(name);
    if (!format || format === 'sqlite' || format === 'xlsx') continue;
    const fileHandle = entry as FileSystemFileHandle;
    const file = await fileHandle.getFile();
    const tableName = sanitizeTableName(name);
    try {
      await registerFileByFormat(engine, format, { tableName, file });
      const rowCount = await getRowCount(engine, tableName);
      source.tables.push({
        id: genId('tbl'),
        sourceId,
        name: tableName,
        format,
        origin: `${dirHandle.name}/${name}`,
        rowCount,
        registered: true,
      });
    } catch (err) {
      console.warn(`[mount] could not register ${name}:`, err);
    }
  }
  if (source.tables.length === 0) {
    throw new MountError(`No supported files found in "${dirHandle.name}".`);
  }
  return source;
}

/**
 * Attempt to re-attach a previously persisted folder handle. Returns null
 * if the handle is gone or permission was denied — caller surfaces a
 * "Reconnect needed" banner.
 */
export async function remountFolderFromHandle(
  engine: Engine,
  handle: FileSystemDirectoryHandle,
  handleId: string,
  label: string,
  sourceId: string,
): Promise<MountedSource> {
  const granted = await ensureReadPermission(handle as AnyHandle);
  if (!granted) throw new PermissionLostError(handleId);
  const source = await mountFolder(engine, handle, { label });
  // Preserve the persisted sourceId so assignment keys still resolve.
  return { ...source, id: sourceId, ref: handleId };
}

/**
 * Mount a single File (from `<input type="file">` or showOpenFilePicker).
 * Sources can hold multiple files via repeated calls.
 */
export async function mountFile(
  engine: Engine,
  file: File,
  opts: { tableName?: string; sourceLabel?: string } = {},
): Promise<MountedSource> {
  const format = detectFormat(file.name);
  if (!format) {
    throw new MountError(`Unsupported file extension: ${file.name}`);
  }
  const tableName = opts.tableName ?? sanitizeTableName(file.name);
  await registerFileByFormat(engine, format, { tableName, file });
  const rowCount = await getRowCount(engine, tableName);
  const sourceId = genId('src');
  return {
    id: sourceId,
    kind: 'fsa-file',
    label: opts.sourceLabel ?? file.name,
    tables: [
      {
        id: genId('tbl'),
        sourceId,
        name: tableName,
        format,
        origin: file.name,
        rowCount,
        registered: true,
      },
    ],
  };
}
