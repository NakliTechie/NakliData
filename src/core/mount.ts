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

export type SourceKind =
  | 'example-bundle'
  | 'fsa-folder'
  | 'fsa-file'
  | 'http'
  | 's3-endpoint'
  | 'iceberg-table'
  | 'iceberg-catalog'
  | 'compute-bridge'
  | 'compute-bridge-catalog';

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

/** Canonical secret names for the iceberg-table kind (slice 3a — Bearer only). */
export const ICEBERG_SECRET_NAMES = ['bearer_token'] as const;

/** Canonical secret names for the compute-bridge kind (W3.4a — Bearer only). */
export const BRIDGE_SECRET_NAMES = ['bearer_token'] as const;

/**
 * W3.4a metadata for `kind: 'compute-bridge'`. A bridge mount is a
 * materialized result from a SQL query against the Compute Bridge —
 * the bridge does the heavy scan in-VPC, returns a (small) Arrow IPC
 * stream, and NakliData registers it as a local DuckDB table.
 *
 * On reload the SQL re-runs against the bridge (fresh data); the
 * Bearer token (if required) is looked up via source-secrets.
 */
export interface BridgeConfig {
  bridgeUrl: string;
  /** SQL the bridge executes; result becomes the local table. */
  sql: string;
  /** Local DuckDB table name the result is registered as. */
  tableName: string;
  /** Whether to send a Bearer token to the bridge. */
  requiresBearer: boolean;
}

/**
 * W3.4b metadata for `kind: 'compute-bridge-catalog'`. The catalog
 * mount fetches `/v1/tables` from the bridge once, lets the user pick N
 * tables, and materialises each as `SELECT * FROM <name> LIMIT
 * <rowCap>` against the bridge. Each picked table lands as its own
 * local DuckDB table under one MountedSource.
 *
 * Persistence shape diverges from `BridgeConfig` (single-SQL) — a
 * catalog source tracks the per-table selection + cap, not a raw SQL
 * string. On reload, the bridge is re-probed via `/v1/health` and each
 * remembered table is re-pulled.
 */
export interface BridgeCatalogConfig {
  bridgeUrl: string;
  /** Tables selected from `/v1/tables` and their row caps. */
  tables: Array<{
    /** Table name as the bridge reports it (server-side identifier). */
    name: string;
    /** Local DuckDB table name; defaults to a sanitised `name`. */
    localName: string;
    /** Bounded fetch cap — the result has to fit in the tab. */
    rowCap: number;
  }>;
  /** Whether to send a Bearer token to the bridge. */
  requiresBearer: boolean;
}

/**
 * Slice 3a metadata for `kind: 'iceberg-table'`. The Iceberg table is
 * identified by its `metadata.json` URL (or a directory URL whose
 * latest snapshot DuckDB resolves automatically).
 */
export interface IcebergTableConfig {
  /** URL of the table's metadata.json (or its directory). */
  metadataUrl: string;
  /** Whether to send a Bearer token (looked up via source-secrets). */
  requiresBearer: boolean;
}

/**
 * Slice 3b metadata for `kind: 'iceberg-catalog'`. A catalog-mounted
 * table tracks the catalog URL + namespace + table name (rather than
 * the metadata URL directly), so re-mount re-resolves via the catalog
 * and picks up new snapshots automatically.
 */
export interface IcebergCatalogConfig {
  catalogUrl: string;
  namespace: string;
  table: string;
  /** Whether to send a Bearer token to the catalog + storage. */
  requiresBearer: boolean;
}

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
  /** Wave 2 slice 3a — populated for `kind: 'iceberg-table'`. */
  iceberg?: IcebergTableConfig;
  /** Wave 2 slice 3b — populated for `kind: 'iceberg-catalog'`. */
  icebergCatalog?: IcebergCatalogConfig;
  /** Wave 3 W3.4a — populated for `kind: 'compute-bridge'`. */
  bridge?: BridgeConfig;
  /** Wave 3 W3.4b — populated for `kind: 'compute-bridge-catalog'`. */
  bridgeCatalog?: BridgeCatalogConfig;
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
  if (
    lower.endsWith('.db') ||
    lower.endsWith('.db3') ||
    lower.endsWith('.sqlite') ||
    lower.endsWith('.sqlite3')
  )
    return 'sqlite';
  if (lower.endsWith('.xlsx')) return 'xlsx';
  // Statistical formats: `.sav`/`.zsav`/`.por` (SPSS) share the `sav`
  // FileFormat; the engine's `registerReadStat` re-derives `.por` vs
  // `.sav`/`.zsav` from the extension for ReadStat. F3 dropped these
  // (DECISIONS CA) when the DuckDB `read_stat` ext proved unpublished for
  // wasm; restored once we vendored our own ReadStat-wasm reader
  // (Polyglot-Workbench Fork 1 — see src/lazy/readstat-reader.ts).
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
 * M3: return `base`, or `base_2`, `base_3`, … if already taken. Used to keep
 * view names unique within a folder mount so a second file doesn't clobber a
 * first via CREATE OR REPLACE VIEW.
 */
function uniquifyName(base: string, used: ReadonlySet<string>): string {
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
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
 * M30/SB2 (DECISIONS 2026-07-09): the DuckDB `iceberg` extension has NO
 * wasm_eh build until DuckDB core v1.3.1; our pin is v1.1.1 (duckdb-wasm
 * 1.29.0). `INSTALL iceberg` / `LOAD iceberg` therefore 404 against the
 * extension repo — and the default offline boot pins that repo to the
 * local vendored dir where iceberg is (and cannot be) present. Rather
 * than let `configureIceberg → ensureExtension('iceberg')` throw a raw
 * ExtensionLoadError deep in the mount, both iceberg mount kinds fail
 * fast here with an honest, actionable message — the same F3 posture the
 * stat-format readers took when `read_stat` proved unpublished for wasm
 * (DECISIONS CA). Shipping iceberg needs a DuckDB-wasm bump to a core
 * that publishes iceberg/wasm_eh (≥ v1.3.1) — a separate, larger effort
 * (new bundle + fallback mirror + re-vendored/re-hashed extensions).
 */
export const ICEBERG_UNAVAILABLE_MESSAGE =
  'Iceberg mounts are not available in this build. The DuckDB iceberg ' +
  'extension has no browser (wasm) build for the engine version NakliData ' +
  'currently ships (DuckDB 1.1.1); a wasm build first appears in DuckDB ' +
  '1.3.1. This is tracked and will land with a DuckDB-wasm upgrade. For ' +
  'now, export the Iceberg table to Parquet and mount that via Add file ' +
  'or an S3 bucket.';

/**
 * Fail-fast guard for the iceberg mount kinds. Declared `: void` (not the
 * inferred `never`) on purpose: it always throws, but typing it `void`
 * keeps the mount functions' bodies statically reachable so the parsing +
 * catalog-navigation logic stays wired and lint-clean, ready to re-enable
 * the moment the DuckDB-wasm pin gains an iceberg/wasm_eh build. This is
 * a feature-flag-off, not dead code — see ICEBERG_UNAVAILABLE_MESSAGE.
 */
function assertIcebergMountSupported(): void {
  throw new MountError(ICEBERG_UNAVAILABLE_MESSAGE);
}

/**
 * Turn a raw File System Access read failure into a message that says what to
 * do about it. Chrome's `NotReadableError` ("…permission problems that have
 * occurred after a reference to a file was acquired") fires when the file
 * changed or got locked between being picked and being read — the classic
 * case is a live SQLite database that keeps mutating as it's read. Returns null
 * for errors we don't have a better message for (caller falls back to raw).
 */
export function describeReadFailure(err: unknown, filename: string): string | null {
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  const msg = err instanceof Error ? err.message : String(err);
  if (name === 'NotReadableError' || /could not be read/i.test(msg)) {
    return `"${filename}" could not be read — it's likely open or being written by another program (common with a live SQLite database, whose file changes as it's read). Close any app using it, or copy the file and mount the copy.`;
  }
  if (name === 'NotFoundError') {
    return `"${filename}" was moved or deleted after it was picked — re-select it.`;
  }
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return `Permission to read "${filename}" was denied — re-pick it and allow access.`;
  }
  return null;
}

/** Wrap a read/registration failure in a MountError with actionable text. */
function enrichMountError(err: unknown, filename: string): MountError {
  if (err instanceof MountError) return err;
  const friendly = describeReadFailure(err, filename);
  return new MountError(friendly ?? (err instanceof Error ? err.message : String(err)));
}

/**
 * Fetch + register the bundled example data. Returns a single MountedSource
 * per logical example (finance, logs). Caller appends to the workbook state.
 */
export async function mountExampleBundle(
  engine: Engine,
  manifestUrl = './examples/manifest.json',
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
  try {
    const rows = await engine.query<{ n: bigint | number }>(
      `SELECT COUNT(*)::BIGINT AS n FROM "${safe}"`,
    );
    const v = rows[0]?.n;
    return typeof v === 'bigint' ? Number(v) : (v ?? 0);
  } catch (err) {
    // A table we can't even COUNT is broken — drop it so a failed mount
    // doesn't leave an orphaned view/table behind for the next
    // CREATE OR REPLACE / engine.drop to trip over (forward-pass M29).
    try {
      await engine.drop(tableName);
    } catch {
      /* best-effort cleanup */
    }
    throw err;
  }
}

/**
 * Mount a directory via FSA. Iterates the supported files at the top level
 * and registers each as a table. Persists the directory handle in IndexedDB
 * so a future session can re-attach (subject to permission re-grant).
 */
export async function mountFolder(
  engine: Engine,
  dirHandle: FileSystemDirectoryHandle,
  opts: { label?: string; reuseHandleId?: string } = {},
): Promise<MountedSource> {
  const granted = await ensureReadPermission(dirHandle as AnyHandle);
  if (!granted) throw new MountError('Read permission was not granted on the folder.');
  // M8: on a boot-time remount the handle is already persisted in IDB — reuse
  // its id instead of minting + storing a fresh one (which orphaned a handle
  // record on every restore, since remountFolderFromHandle then discarded it).
  let handleId: string;
  if (opts.reuseHandleId) {
    handleId = opts.reuseHandleId;
  } else {
    handleId = newHandleId();
    await putHandle(handleId, dirHandle as AnyHandle);
  }
  const sourceId = genId('src');
  const source: MountedSource = {
    id: sourceId,
    kind: 'fsa-folder',
    label: opts.label ?? dirHandle.name,
    ref: handleId,
    tables: [],
  };
  // Walk the top-level entries; ignore subdirs in v1.0. Cap the walk at
  // 5000 entries so a pathological folder (a node_modules, a media dump)
  // can't hang the mount indefinitely (forward-pass M16).
  const MAX_FOLDER_ENTRIES = 5000;
  let walked = 0;
  // M3: view names registered so far in this folder mount, to avoid collisions.
  const usedTableNames = new Set<string>();
  // Diagnostics so an empty result gives an honest reason, not a blanket
  // "no supported files" (which hides read failures + the no-recursion limit).
  let subdirCount = 0; // subfolders skipped (the scan is intentionally flat)
  let detectedButFailed = 0; // files we recognised but couldn't load (e.g. read errors)
  let firstFailure: string | null = null; // the first such failure, for the message
  for await (const [name, entry] of (
    dirHandle as unknown as { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }
  ).entries()) {
    if (++walked > MAX_FOLDER_ENTRIES) {
      console.warn(
        `[naklidata] folder mount stopped at ${MAX_FOLDER_ENTRIES} entries — remaining files skipped.`,
      );
      break;
    }
    if (entry.kind !== 'file') {
      if (entry.kind === 'directory') subdirCount += 1;
      continue;
    }
    const format = detectFormat(name);
    if (!format) continue;
    const fileHandle = entry as FileSystemFileHandle;
    // M3: two files that sanitize to the same view name (data.csv +
    // data.parquet, or "a b.csv" + "a-b.csv") would otherwise clobber each
    // other via CREATE OR REPLACE VIEW. Suffix collisions (data, data_2).
    // Deterministic in folder-iteration order, so a reload reproduces the
    // same names → assignment keys still resolve.
    const tableLabel = uniquifyName(sanitizeTableName(name), usedTableNames);
    try {
      // getFile() is inside the try — it can throw NotFoundError if the file
      // vanished after the folder was picked.
      const file = await fileHandle.getFile();
      const registered = await registerFileByFormat(engine, format, {
        tableName: tableLabel,
        file,
      });
      for (const tableName of registered) {
        usedTableNames.add(tableName);
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
      detectedButFailed += 1;
      if (!firstFailure) {
        firstFailure =
          describeReadFailure(err, name) ?? (err instanceof Error ? err.message : String(err));
      }
      console.warn(`[mount] could not register ${name}:`, err);
    }
  }
  if (source.tables.length === 0) {
    // Recognised files but every one failed to load → surface the real reason
    // (this is what "SQLite files in a folder that won't mount" actually is —
    // a read failure, not an unsupported format).
    if (detectedButFailed > 0) {
      throw new MountError(
        `Found ${detectedButFailed} supported file(s) in "${dirHandle.name}" but none could be loaded. ${firstFailure}`,
      );
    }
    // Nothing recognised at all. Name the formats we look for, and flag the
    // no-recursion limit if there were subfolders (a common miss).
    const subHint =
      subdirCount > 0
        ? ` Folder mount doesn't look inside subfolders — ${subdirCount} were skipped; mount the subfolder directly.`
        : '';
    throw new MountError(
      `No supported files found in "${dirHandle.name}" (looked for CSV, TSV, JSONL, Parquet, Arrow, Excel, SQLite/DuckDB, SPSS/Stata/SAS, and GeoJSON/KML).${subHint}`,
    );
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
  // M8: reuse the already-persisted handle id instead of orphaning a fresh one.
  const source = await mountFolder(engine, handle, { label, reuseHandleId: handleId });
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
    // F5 (DECISIONS BX): name the supported set rather than a bare
    // "unsupported" — the actionable message a user dragging a .dta / .mdb /
    // .txt needs. Every listed format works in BOTH online and offline modes
    // (F1 vendored parquet+spatial; xlsx/sqlite/arrow ship as vendored lazy
    // chunks), so there's no mode-conditional gating to do.
    throw new MountError(
      `Unsupported file type: "${file.name}". NakliData mounts CSV, TSV, JSONL/NDJSON, Parquet, Arrow/Feather, Excel (.xlsx), SQLite, DuckDB, SPSS/Stata/SAS (.sav/.dta/.sas7bdat/.xpt), and GeoJSON/KML files.`,
    );
  }
  const tableLabel = opts.tableName ?? sanitizeTableName(file.name);
  let registered: string[];
  try {
    registered = await registerFileByFormat(engine, format, {
      tableName: tableLabel,
      file,
    });
  } catch (err) {
    throw enrichMountError(err, file.name);
  }
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
      'Could not infer a supported format from the URL. Filename should end in .csv, .tsv, .jsonl/.ndjson, or .parquet (slice 1 — Excel / SQLite / DuckDB via URL are queued for Wave 2 slice 2+).',
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

/**
 * Wave 2 slice 3b — mount an Apache Iceberg table via a REST Catalog.
 * The catalog navigates from a (catalog URL, namespace, table) triple
 * to the table's current metadata-location, then we hand off to the
 * same `iceberg_scan` path slice 3a uses.
 *
 * Re-mounts re-resolve via the catalog — a fresh snapshot picks up
 * automatically. The catalog client is injected so tests can supply
 * a fake fetch.
 *
 * Slice 3b ships Bearer auth only. OAuth2 device flow and AWS SigV4
 * are queued for v1.3 (separate sitting).
 */
export async function mountIcebergCatalog(
  engine: Engine,
  opts: {
    label: string;
    catalogUrl: string;
    namespace: string;
    table: string;
    bearerToken: string | null;
    fetchImpl?: typeof fetch;
  },
): Promise<MountedSource> {
  // Fail fast before any catalog network round-trip — the engine can't
  // scan an Iceberg table without the (unavailable) iceberg extension.
  assertIcebergMountSupported();
  if (!opts.catalogUrl.trim()) throw new MountError('Catalog URL is required.');
  if (!opts.namespace.trim()) throw new MountError('Namespace is required.');
  if (!opts.table.trim()) throw new MountError('Table is required.');
  const bearerToken = opts.bearerToken?.trim() || null;
  // Resolve the metadata-location via the REST catalog.
  const { IcebergCatalogClient } = await import('./iceberg/rest-client.ts');
  const client = new IcebergCatalogClient({
    catalogUrl: opts.catalogUrl.trim(),
    bearerToken,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  });
  let metadataLocation: string;
  try {
    const result = await client.loadTable(opts.namespace.trim(), opts.table.trim());
    metadataLocation = result.metadataLocation;
  } catch (err) {
    if (err instanceof Error) {
      throw new MountError(`Iceberg catalog: ${err.message}`);
    }
    throw err;
  }
  // Re-validate the catalog-returned metadata URL. The intent (H8 and
  // the user-typed-URL path in `mountIcebergTable`) is `https://` or
  // `s3://` only. Codex review of v1.2.1..HEAD caught the original
  // regex `^https?://|^s3://` — which permits BOTH `http://` and
  // `https://`, undermining the whole point of the check: a malicious
  // catalog returning `http://internal/...` slipped through.
  // (Note: `mountIcebergTable` has the same `^https?://` regex on
  // user-typed input; that path was the intentional "I'm using this
  // for local testing" allowance. Catalog-returned URLs must be
  // strictly https — the user didn't see them.)
  if (!/^https:\/\/|^s3:\/\//i.test(metadataLocation)) {
    throw new MountError(
      `Iceberg catalog returned an unsupported metadata location (must be https:// or s3://): ${metadataLocation}`,
    );
  }
  // Use the same engine path as slice 3a. Bearer is set for any
  // subsequent storage-host requests (some catalogs require the same
  // token for the data tier; harmless for catalogs that don't).
  await engine.configureIceberg({ bearerToken });
  const sourceId = genId('src');
  const tableLabel = sanitizeTableName(opts.table.trim());
  await engine.registerIcebergTable({
    tableName: tableLabel,
    metadataUrl: metadataLocation,
  });
  const rowCount = await getRowCount(engine, tableLabel);
  return {
    id: sourceId,
    kind: 'iceberg-catalog',
    label: opts.label.trim() || `${opts.namespace.trim()}.${opts.table.trim()}`,
    ref: metadataLocation, // the resolved URL, useful for display
    icebergCatalog: {
      catalogUrl: opts.catalogUrl.trim(),
      namespace: opts.namespace.trim(),
      table: opts.table.trim(),
      requiresBearer: bearerToken !== null,
    },
    tables: [
      {
        id: genId('tbl'),
        sourceId,
        name: tableLabel,
        format: 'parquet',
        origin: `${opts.namespace.trim()}.${opts.table.trim()} (catalog: ${opts.catalogUrl.trim()})`,
        rowCount,
        registered: true,
      },
    ],
  };
}

/**
 * Wave 2 slice 3a — mount an Apache Iceberg table by URL. The user
 * supplies the metadata.json URL (or a directory whose latest snapshot
 * DuckDB resolves) and optionally a Bearer token. DuckDB's iceberg
 * extension reads the table's metadata + manifest list and resolves
 * the data-file URLs; httpfs's `extra_http_headers` carries the Bearer.
 *
 * Slice 3b (queued) will add REST catalog navigation + OAuth2 device
 * flow + AWS SigV4 (for Glue). For now the user must already know the
 * direct URL of their table's metadata — covered in the modal hint.
 */
export async function mountIcebergTable(
  engine: Engine,
  opts: {
    label: string;
    metadataUrl: string;
    bearerToken: string | null;
    tableName?: string;
  },
): Promise<MountedSource> {
  // Fail fast — see assertIcebergMountSupported / ICEBERG_UNAVAILABLE_MESSAGE.
  assertIcebergMountSupported();
  const metadataUrl = opts.metadataUrl.trim();
  if (!metadataUrl) throw new MountError('Iceberg metadata URL is required.');
  if (!/^https?:\/\/|^s3:\/\//i.test(metadataUrl)) {
    throw new MountError(
      'Iceberg metadata URL must start with https:// or s3://. (For s3:// URLs, configure your S3 credentials via the Mount bucket flow first — they share the same connection-wide config.)',
    );
  }
  const bearerToken = opts.bearerToken?.trim() || null;
  await engine.configureIceberg({ bearerToken });
  const sourceId = genId('src');
  // Derive a default table name from the URL. Iceberg's typical layout
  // is `.../<table>/metadata/v<N>.metadata.json`, so when the parent
  // of the json file is literally "metadata" we walk up another level.
  // Also handles `.../<table>/metadata.json` (no metadata/ dir) and bare
  // directory URLs `.../<table>/`.
  const fallbackName = (() => {
    const stripped = metadataUrl.split(/[?#]/)[0] ?? metadataUrl;
    const parts = stripped.replace(/\/+$/, '').split('/');
    const last = parts.at(-1) ?? '';
    if (/\.json$/i.test(last) || /^v\d+\.metadata\.json$/i.test(last)) {
      const parent = parts.at(-2) ?? '';
      if (parent.toLowerCase() === 'metadata') {
        return parts.at(-3) ?? 'iceberg_table';
      }
      return parent || 'iceberg_table';
    }
    return last || 'iceberg_table';
  })();
  const tableLabel = opts.tableName ?? sanitizeTableName(fallbackName);
  await engine.registerIcebergTable({ tableName: tableLabel, metadataUrl });
  const rowCount = await getRowCount(engine, tableLabel);
  return {
    id: sourceId,
    kind: 'iceberg-table',
    label: opts.label.trim() || fallbackName,
    ref: metadataUrl,
    iceberg: {
      metadataUrl,
      requiresBearer: bearerToken !== null,
    },
    tables: [
      {
        id: genId('tbl'),
        sourceId,
        name: tableLabel,
        format: 'parquet', // Iceberg tables are Parquet-backed by spec
        origin: metadataUrl,
        rowCount,
        registered: true,
      },
    ],
  };
}

/**
 * Wave 3 W3.4a — mount the result of a SQL query against a Compute
 * Bridge as a local DuckDB table. The bridge runs the heavy scan
 * inside the customer's VPC and returns the (small) result set as an
 * Arrow IPC stream; we register those bytes via the existing
 * `insertArrowFromIPCStream` path (Engine.registerArrowBuffer). Bytes
 * never cross out of the customer's cloud except the rows the
 * analyst's query actually returns.
 *
 * Reachability is probed via `/v1/health` first so a misconfigured /
 * unreachable bridge surfaces a clear error before we send any SQL,
 * and so reload-time failures route to `reconnectNeeded` rather than
 * tanking the whole load.
 *
 * Slice W3.4a ships Bearer-only auth (matching the bridge's v1.3 MVP).
 * OAuth2 / mTLS land with the bridge's v1.4.
 */
export async function mountComputeBridge(
  engine: Engine,
  opts: {
    label: string;
    bridgeUrl: string;
    sql: string;
    tableName: string;
    bearerToken: string | null;
    fetchImpl?: typeof fetch;
  },
): Promise<MountedSource> {
  if (!opts.bridgeUrl.trim()) throw new MountError('Compute Bridge URL is required.');
  if (!opts.sql.trim()) throw new MountError('SQL is required.');
  if (!opts.tableName.trim()) throw new MountError('Local table name is required.');
  if (!/^https?:\/\//i.test(opts.bridgeUrl.trim())) {
    throw new MountError(
      'Compute Bridge URL must start with https:// (http:// only works for localhost via a tunnel — CSP blocks plain http otherwise).',
    );
  }
  const bearerToken = opts.bearerToken?.trim() || null;
  const { BridgeClient } = await import('./bridge/bridge-client.ts');
  const client = new BridgeClient({
    bridgeUrl: opts.bridgeUrl.trim(),
    bearerToken,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  });
  // 1) Reachability + auth probe. Surfaces a clear "unreachable / 401"
  // before we send the SQL.
  try {
    await client.health();
  } catch (err) {
    if (err instanceof Error) {
      throw new MountError(`Compute Bridge: ${err.message}`);
    }
    throw err;
  }
  // 2) Run the user's SQL on the bridge; receive Arrow IPC bytes.
  let bytes: Uint8Array;
  try {
    const buffer = await client.query(opts.sql.trim());
    bytes = new Uint8Array(buffer);
  } catch (err) {
    if (err instanceof Error) {
      throw new MountError(`Compute Bridge query failed: ${err.message}`);
    }
    throw err;
  }
  // 3) Register the result as a local DuckDB table.
  const sourceId = genId('src');
  const tableLabel = sanitizeTableName(opts.tableName.trim());
  await engine.registerArrowBuffer({ tableName: tableLabel, bytes });
  const rowCount = await getRowCount(engine, tableLabel);
  return {
    id: sourceId,
    kind: 'compute-bridge',
    label: opts.label.trim() || `${opts.tableName.trim()} (bridge)`,
    ref: opts.bridgeUrl.trim(),
    bridge: {
      bridgeUrl: opts.bridgeUrl.trim(),
      sql: opts.sql.trim(),
      tableName: tableLabel,
      requiresBearer: bearerToken !== null,
    },
    tables: [
      {
        id: genId('tbl'),
        sourceId,
        name: tableLabel,
        format: 'arrow',
        origin: `${opts.bridgeUrl.trim()} :: ${opts.sql.trim().slice(0, 60)}${opts.sql.trim().length > 60 ? '…' : ''}`,
        rowCount,
        registered: true,
      },
    ],
  };
}

/**
 * Row-cap floor/ceiling for compute-bridge-catalog table picks. The
 * floor is a sanity guard (no-op cap is suspicious); the ceiling is a
 * heuristic — browser DuckDB starts to feel sluggish around 1M rows
 * depending on column count + types.
 */
export const BRIDGE_CATALOG_ROW_CAP_MIN = 100;
export const BRIDGE_CATALOG_ROW_CAP_MAX = 1_000_000;
export const BRIDGE_CATALOG_ROW_CAP_DEFAULT = 100_000;

/**
 * Quote an identifier for safe inclusion in SQL sent to the bridge.
 * DuckDB / Postgres convention: wrap in `"..."` and double any internal
 * `"`. The bridge is trusted to interpret quoted identifiers
 * consistently — listTables returns names verbatim.
 */
function quoteBridgeIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Wave 3 W3.4b — Compute Bridge catalog mount. Lists the bridge's
 * tables (`/v1/tables`), takes the user's multi-select + per-table row
 * caps, and materialises each table locally via
 * `SELECT * FROM <name> LIMIT <cap>` against the bridge. Each picked
 * table becomes a `MountedTable` under one `MountedSource`.
 *
 * Mirrors `mountComputeBridge` on the wire (HTTP + Arrow IPC, health
 * probe before queries, Bearer auth via source-secrets). Differs in
 * persistence shape: the catalog tracks `tables[]` + `rowCap` rather
 * than a raw SQL string, so reload re-fetches the same selection at
 * the (then-)current bridge state.
 *
 * Per-table failures are caught + reported; the source still mounts
 * with the tables that succeeded. The caller may surface partial
 * failures (a future hook — for now a `MountError` lists the names).
 */
export async function mountComputeBridgeCatalog(
  engine: Engine,
  opts: {
    label: string;
    bridgeUrl: string;
    bearerToken: string | null;
    tables: Array<{ name: string; localName?: string; rowCap?: number }>;
    fetchImpl?: typeof fetch;
  },
): Promise<MountedSource> {
  if (!opts.bridgeUrl.trim()) throw new MountError('Compute Bridge URL is required.');
  if (!/^https?:\/\//i.test(opts.bridgeUrl.trim())) {
    throw new MountError(
      'Compute Bridge URL must start with https:// (http:// only works for localhost via a tunnel — CSP blocks plain http otherwise).',
    );
  }
  if (!opts.tables.length) {
    throw new MountError('Pick at least one table to mount.');
  }
  const bearerToken = opts.bearerToken?.trim() || null;
  const { BridgeClient } = await import('./bridge/bridge-client.ts');
  const client = new BridgeClient({
    bridgeUrl: opts.bridgeUrl.trim(),
    bearerToken,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  });
  // 1) Reachability + auth probe.
  try {
    await client.health();
  } catch (err) {
    if (err instanceof Error) throw new MountError(`Compute Bridge: ${err.message}`);
    throw err;
  }
  // 2) Materialise each picked table.
  const sourceId = genId('src');
  const mountedTables: MountedTable[] = [];
  const persistedTables: BridgeCatalogConfig['tables'] = [];
  const failures: Array<{ name: string; reason: string }> = [];
  for (const pick of opts.tables) {
    if (!pick.name.trim()) continue;
    const cap = clampRowCap(pick.rowCap);
    const localName = sanitizeTableName(pick.localName?.trim() || pick.name.trim());
    const sql = `SELECT * FROM ${quoteBridgeIdent(pick.name.trim())} LIMIT ${cap}`;
    try {
      const buffer = await client.query(sql);
      const bytes = new Uint8Array(buffer);
      await engine.registerArrowBuffer({ tableName: localName, bytes });
      const rowCount = await getRowCount(engine, localName);
      mountedTables.push({
        id: genId('tbl'),
        sourceId,
        name: localName,
        format: 'arrow',
        origin: `${opts.bridgeUrl.trim()} :: ${pick.name.trim()} (≤${cap.toLocaleString()})`,
        rowCount,
        registered: true,
      });
      persistedTables.push({ name: pick.name.trim(), localName, rowCap: cap });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failures.push({ name: pick.name, reason });
    }
  }
  if (!mountedTables.length) {
    const detail = failures.map((f) => `${f.name}: ${f.reason}`).join('; ');
    throw new MountError(`No tables mounted. ${detail || 'No usable tables in selection.'}`);
  }
  // Partial-failure reporting is intentionally non-fatal — the caller
  // surfaces the list to the user; the successful mounts already
  // landed.
  if (failures.length) {
    console.warn(
      `[mountComputeBridgeCatalog] ${failures.length} table(s) failed: ${failures
        .map((f) => f.name)
        .join(', ')}`,
    );
  }
  return {
    id: sourceId,
    kind: 'compute-bridge-catalog',
    label: opts.label.trim() || `${new URL(opts.bridgeUrl.trim()).hostname} (bridge catalog)`,
    ref: opts.bridgeUrl.trim(),
    bridgeCatalog: {
      bridgeUrl: opts.bridgeUrl.trim(),
      tables: persistedTables,
      requiresBearer: bearerToken !== null,
    },
    tables: mountedTables,
  };
}

function clampRowCap(n: number | undefined): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return BRIDGE_CATALOG_ROW_CAP_DEFAULT;
  const i = Math.floor(n);
  if (i < BRIDGE_CATALOG_ROW_CAP_MIN) return BRIDGE_CATALOG_ROW_CAP_MIN;
  if (i > BRIDGE_CATALOG_ROW_CAP_MAX) return BRIDGE_CATALOG_ROW_CAP_MAX;
  return i;
}
