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

export type FileFormat =
  | 'csv'
  | 'tsv'
  | 'jsonl'
  | 'parquet'
  | 'sqlite'
  | 'duckdb'
  | 'xlsx'
  | 'arrow'
  | 'sav'
  | 'dta'
  | 'sas7bdat'
  | 'xpt'
  | 'geojson'
  | 'kml';

export type SourceKind = 'example-bundle' | 'fsa-folder' | 'fsa-file' | 'http' | 's3-endpoint';

/**
 * Per-source kind metadata that travels alongside `MountedSource` for
 * kinds that need more than a single `ref` string. Optional — kinds
 * that fit in `ref` (example-bundle, fsa-folder, fsa-file, http) leave
 * this undefined.
 */
export interface S3EndpointConfig {
  endpoint: string; // host without scheme, e.g. 's3.amazonaws.com'
  region: string;
  bucket: string;
  pathPrefix: string; // e.g. 'data/2026/' (no leading slash, may be empty)
  urlStyle: 'vhost' | 'path';
}

/** Canonical secret names for the s3-endpoint kind. */
export const S3_SECRET_NAMES = ['access_key_id', 'secret_access_key'] as const;

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
  /** Wave 2 slice 2 — populated for `kind: 's3-endpoint'`. */
  s3?: S3EndpointConfig;
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
  if (lower.endsWith('.arrow') || lower.endsWith('.feather')) return 'arrow';
  if (lower.endsWith('.duckdb')) return 'duckdb';
  if (lower.endsWith('.db') || lower.endsWith('.sqlite') || lower.endsWith('.sqlite3'))
    return 'sqlite';
  if (lower.endsWith('.xlsx')) return 'xlsx';
  if (lower.endsWith('.sav') || lower.endsWith('.zsav') || lower.endsWith('.por')) return 'sav';
  if (lower.endsWith('.dta')) return 'dta';
  if (lower.endsWith('.sas7bdat')) return 'sas7bdat';
  if (lower.endsWith('.xpt')) return 'xpt';
  if (lower.endsWith('.geojson') || lower.endsWith('.geo.json')) return 'geojson';
  if (lower.endsWith('.kml')) return 'kml';
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

/**
 * Register a file with DuckDB and return the list of table/view names
 * that resulted. Single-file formats return a 1-element array; multi-table
 * formats (SQLite, DuckDB attach, multi-sheet xlsx) return one entry per
 * table.
 */
async function registerFileByFormat(
  engine: Engine,
  format: FileFormat,
  opts: RegisterFileOptions,
): Promise<string[]> {
  switch (format) {
    case 'csv':
      await engine.registerCsv(opts);
      return [opts.tableName];
    case 'tsv':
      await engine.registerTsv(opts);
      return [opts.tableName];
    case 'jsonl':
      await engine.registerJsonl(opts);
      return [opts.tableName];
    case 'parquet':
      await engine.registerParquet(opts);
      return [opts.tableName];
    case 'sqlite':
      return await engine.registerSqlite(opts);
    case 'duckdb':
      return await engine.registerDuckdb(opts);
    case 'xlsx':
      return await engine.registerXlsx(opts);
    case 'arrow':
      return await engine.registerArrow(opts);
    case 'sav':
    case 'dta':
    case 'sas7bdat':
    case 'xpt':
      return await engine.registerReadStat(opts);
    case 'geojson':
    case 'kml':
      return await engine.registerSpatial(opts);
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
  const failed: string[] = [];
  for (const src of manifest.sources) {
    const source: MountedSource = {
      id: genId('src'),
      kind: 'example-bundle',
      label: src.label,
      ref: src.id,
      tables: [],
    };
    for (const f of src.files) {
      try {
        const fileUrl = `${base}${f.path}`;
        const fileRes = await fetch(fileUrl);
        if (!fileRes.ok) {
          throw new MountError(`Example file fetch failed: ${fileUrl} → HTTP ${fileRes.status}`);
        }
        const blob = await fileRes.blob();
        const filename = f.path.split('/').pop() ?? 'data';
        const file = new File([blob], filename, { type: blob.type });
        const tableLabel = sanitizeTableName(f.table);
        const registered = await registerFileByFormat(engine, f.format, {
          tableName: tableLabel,
          file,
        });
        for (const tableName of registered) {
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
      } catch (err) {
        // A single failing file shouldn't abort the whole bundle — log it
        // and continue so the user still gets the rest. Common cause: the
        // DuckDB JSON extension can't be fetched (extensions.duckdb.org).
        console.warn(`[mount] failed to register ${f.path}:`, err);
        failed.push(f.path);
      }
    }
    if (source.tables.length > 0) out.push(source);
  }
  if (failed.length > 0) {
    console.warn(`[mount] ${failed.length} example file(s) skipped: ${failed.join(', ')}`);
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
    if (!format) continue;
    const fileHandle = entry as FileSystemFileHandle;
    const file = await fileHandle.getFile();
    const tableLabel = sanitizeTableName(name);
    try {
      const registered = await registerFileByFormat(engine, format, {
        tableName: tableLabel,
        file,
      });
      for (const tableName of registered) {
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
      }
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
  const tableLabel = opts.tableName ?? sanitizeTableName(file.name);
  const registered = await registerFileByFormat(engine, format, {
    tableName: tableLabel,
    file,
  });
  const sourceId = genId('src');
  const tables: MountedTable[] = [];
  for (const tableName of registered) {
    const rowCount = await getRowCount(engine, tableName);
    tables.push({
      id: genId('tbl'),
      sourceId,
      name: tableName,
      format,
      origin: file.name,
      rowCount,
      registered: true,
    });
  }
  if (tables.length === 0) {
    throw new MountError(`No tables found in ${file.name}.`);
  }
  return {
    id: sourceId,
    kind: 'fsa-file',
    label: opts.sourceLabel ?? file.name,
    tables,
  };
}

/**
 * Wave 2 slice 1 — mount a remote URL as a table. DuckDB-wasm reads the
 * bytes directly via the browser's fetch; no httpfs extension needed for
 * plain HTTPS reads. The view is created over `read_<format>('<url>')`,
 * so SELECTs against the table re-fetch ranges on demand (DuckDB respects
 * HTTP range requests where the server supports them, e.g. for Parquet).
 *
 * Supported formats: csv, tsv, jsonl, parquet — the four whose readers
 * ship in DuckDB-wasm without an extension load. Other formats throw a
 * MountError pointing the user at the file-mount path instead.
 */
export async function mountUrl(
  engine: Engine,
  opts: { url: string; label?: string; tableName?: string },
): Promise<MountedSource> {
  const url = opts.url.trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new MountError(
      'URL must start with http:// or https://. (https:// is required for cross-origin reads.)',
    );
  }
  const lastSegment = url.split(/[?#]/)[0]?.split('/').pop() ?? '';
  const format = detectFormat(lastSegment);
  if (!format) {
    throw new MountError(
      'Could not infer a supported format from the URL. Filename should end in .csv, .tsv, .jsonl/.ndjson, or .parquet (slice 1 — Excel / SQLite / DuckDB / stats formats via URL are queued for Wave 2 slice 2+).',
    );
  }
  if (format !== 'csv' && format !== 'tsv' && format !== 'jsonl' && format !== 'parquet') {
    throw new MountError(
      `Format "${format}" can be mounted from disk but not yet via a public URL. Use Add file / Add folder for now.`,
    );
  }
  const sourceId = genId('src');
  const tableLabel = opts.tableName ?? sanitizeTableName(lastSegment || 'remote');
  await engine.registerUrl({ tableName: tableLabel, url, format });
  const rowCount = await getRowCount(engine, tableLabel);
  return {
    id: sourceId,
    kind: 'http',
    label: opts.label ?? (lastSegment || url),
    ref: url,
    tables: [
      {
        id: genId('tbl'),
        sourceId,
        name: tableLabel,
        format,
        origin: url,
        rowCount,
        registered: true,
      },
    ],
  };
}

/**
 * Wave 2 slice 2 — mount an S3-compatible bucket as a table. Works
 * against AWS S3, MinIO, Cloudflare R2, Backblaze B2, Wasabi, and any
 * other DuckDB httpfs-compatible endpoint.
 *
 * Caller is expected to have already persisted the credentials via
 * `source-secrets.ts` against the sourceId we return — but we accept
 * them inline here so the engine call can wire them immediately. The
 * sourceId is generated up-front so the caller knows which key to
 * persist secrets under.
 *
 * Path-vs-vhost URL style is the user's call; default to 'vhost' (AWS
 * native). MinIO / R2-via-API typically need 'path'.
 *
 * Limitation: DuckDB's `SET s3_*` is connection-wide, so a session can
 * only hold one set of S3 credentials at a time. Mounting a second
 * s3-endpoint with different credentials will clobber the first. The
 * UI surfaces this; a future enhancement can move to `CREATE SECRET`.
 */
export async function mountS3Endpoint(
  engine: Engine,
  opts: {
    label: string;
    endpoint: string;
    region: string;
    bucket: string;
    pathPrefix: string;
    urlStyle: 'vhost' | 'path';
    accessKeyId: string;
    secretAccessKey: string;
  },
): Promise<MountedSource> {
  if (!opts.endpoint.trim()) throw new MountError('S3 endpoint is required.');
  if (!opts.bucket.trim()) throw new MountError('Bucket is required.');
  if (!opts.accessKeyId.trim() || !opts.secretAccessKey.trim()) {
    throw new MountError('Access key ID and secret access key are required.');
  }
  const pathPrefix = opts.pathPrefix.trim().replace(/^\/+/, '');
  // Format inference: the path prefix must point at a specific file, a
  // glob pattern, or end in a slash + we'll add a default glob. Slice 2
  // requires the user to supply a file or glob; multi-format listing
  // (LIST → SCAN each shard) is a future enhancement.
  const last = pathPrefix.split(/[?#]/)[0]?.split('/').pop() ?? '';
  const format = detectFormat(last);
  if (!format) {
    throw new MountError(
      'Could not infer a supported format from the path prefix. End the prefix with a filename (e.g. "data/vendors.parquet") or a glob ("data/*.parquet").',
    );
  }
  if (format !== 'csv' && format !== 'tsv' && format !== 'jsonl' && format !== 'parquet') {
    throw new MountError(
      `Format "${format}" can be mounted from disk but not yet via an S3 endpoint. Slice 2 ships csv / tsv / jsonl / parquet only.`,
    );
  }
  // Normalise the endpoint: strip scheme + trailing slash. DuckDB's
  // s3_endpoint wants the host-only form (e.g. 's3.amazonaws.com').
  const endpointHost = opts.endpoint
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  await engine.configureS3({
    endpoint: endpointHost,
    region: opts.region.trim() || 'us-east-1',
    accessKeyId: opts.accessKeyId,
    secretAccessKey: opts.secretAccessKey,
    urlStyle: opts.urlStyle,
  });
  const sourceId = genId('src');
  const tableLabel = sanitizeTableName(last || opts.bucket);
  const s3Url = `s3://${opts.bucket.trim()}/${pathPrefix}`;
  await engine.registerS3Url({ tableName: tableLabel, s3Url, format });
  const rowCount = await getRowCount(engine, tableLabel);
  return {
    id: sourceId,
    kind: 's3-endpoint',
    label: opts.label.trim() || `${opts.bucket}/${pathPrefix}`,
    ref: s3Url,
    s3: {
      endpoint: endpointHost,
      region: opts.region.trim() || 'us-east-1',
      bucket: opts.bucket.trim(),
      pathPrefix,
      urlStyle: opts.urlStyle,
    },
    tables: [
      {
        id: genId('tbl'),
        sourceId,
        name: tableLabel,
        format,
        origin: s3Url,
        rowCount,
        registered: true,
      },
    ],
  };
}
