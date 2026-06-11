// `.naklidata` save/load. Spec §5 + handoff §3.9.
//
// JSON-on-disk via FSA. Contains source mounts, schema assignments, notebook
// cells, user-defined types. Never source data. On load, sources are
// re-attempted; failures show a "Reconnect needed" banner (handled by the
// caller).
//
// v1.0 limits:
//   - Only example-bundle and single-file FSA sources persist their ref.
//     FSA folder handles (build-order step 3) round-trip via IndexedDB later.

import type { CellState } from '../ui/cells/types.ts';
import type { ColumnAssignment } from '../ui/schema-panel.ts';
import type { AssociationsFile } from './associations.ts';
import type { LineageGraph } from './lineage-store.ts';
import type { MeasuresFile } from './measures-store.ts';
import type { MountedSource } from './mount.ts';
import type { SelectionsFile } from './selections.ts';
import type { OverrideRule, UserType } from './workbook.ts';

export const NAKLIDATA_VERSION = '1.0';

export interface NakliDataFile {
  format: 'naklidata';
  version: string;
  created: string;
  modified: string;
  name: string;
  sources: PersistedSource[];
  assignments: PersistedAssignment[];
  cells: PersistedCell[];
  /** User-defined semantic types. Wave 3 (2026-05-18) — was a placeholder. */
  user_types: UserType[];
  /**
   * "Always treat columns named X as type Y" rules. Theme 4 wave 2
   * (2026-05-21). Defaults to `[]` on load when missing — pre-existing
   * v1.0 files round-trip without bumping the version number.
   */
  override_rules?: OverrideRule[];
  /**
   * Cell lineage graph (M2 — v1.2 Lakehouse Parity). Describes the
   * upstream sources / cells each cell read from. Optional — files
   * saved before M2 (and notebooks that have never run a cell) round-
   * trip without bumping the version number.
   */
  lineage?: LineageGraph;
  /**
   * Measures (v1.3 M2 — Prior Art). Named, versioned semantic
   * metrics referenced via `MEASURE(name)` in SQL cells. Optional —
   * pre-M2 files round-trip cleanly.
   */
  measures?: MeasuresFile;
  /**
   * Selections (v1.3 M1 — Associative Cross-Filter). Per-(table,
   * column) value sets used by the grey-out compute. Optional —
   * pre-M1 files round-trip cleanly.
   */
  selections?: SelectionsFile;
  /**
   * Associations (v1.3 M1 Phase 2 — cross-table links). Pairs of
   * (table, column) keys declared the same field; drive inter-cell
   * cross-filter. Optional — pre-Phase-2 files round-trip cleanly.
   */
  associations?: AssociationsFile;
  settings: { auto_accept_threshold: number };
}

export interface PersistedSource {
  id: string;
  kind: MountedSource['kind'];
  label: string;
  ref: string | null;
  tables: Array<{ id: string; name: string; format: string; origin: string; rowCount: number }>;
  /** Wave 2 slice 2 — present when kind is 's3-endpoint'. Secrets are NOT persisted. */
  s3?: {
    endpoint: string;
    region: string;
    bucket: string;
    path_prefix: string;
    url_style: 'vhost' | 'path';
  };
  /** Wave 2 slice 3a — present when kind is 'iceberg-table'. Bearer token (if any) is NOT persisted. */
  iceberg?: {
    metadata_url: string;
    requires_bearer: boolean;
  };
  /** Wave 2 slice 3b — present when kind is 'iceberg-catalog'. Bearer token (if any) is NOT persisted. */
  iceberg_catalog?: {
    catalog_url: string;
    namespace: string;
    table: string;
    requires_bearer: boolean;
  };
  /** Wave 3 W3.4a — present when kind is 'compute-bridge'. Bearer token (if any) is NOT persisted. */
  bridge?: {
    bridge_url: string;
    sql: string;
    table_name: string;
    requires_bearer: boolean;
  };
  /** Wave 3 W3.4b — present when kind is 'compute-bridge-catalog'. Bearer token (if any) is NOT persisted. */
  bridge_catalog?: {
    bridge_url: string;
    tables: Array<{ name: string; local_name: string; row_cap: number }>;
    requires_bearer: boolean;
  };
}

export interface PersistedAssignment {
  key: string; // sourceId::tableId::columnName
  columnName: string;
  sqlType: string;
  typeId: string | null;
  origin: ColumnAssignment['assigned']['origin'];
  confidence: number;
  /** Persist the candidate list so the schema panel re-renders evidence on load. */
  candidates: ColumnAssignment['candidates'];
  resolutionKind: ColumnAssignment['resolution']['kind'];
}

export type PersistedCell = CellState;

export interface SerializeInput {
  notebookName: string;
  sources: MountedSource[];
  assignments: Record<string, ColumnAssignment>;
  cells: CellState[];
  autoAcceptThreshold: number;
  /** User-defined types from the workbook. Defaults to empty when omitted. */
  userTypes?: UserType[];
  /** Override rules from the workbook (Theme 4 wave 2). Defaults to empty. */
  overrideRules?: OverrideRule[];
  /** M2 — cell lineage graph snapshot. Optional. */
  lineage?: LineageGraph;
  /** v1.3 M2 — measures snapshot. Optional. */
  measures?: MeasuresFile;
  /** v1.3 M1 — selections snapshot. Optional. */
  selections?: SelectionsFile;
  /** v1.3 M1 Phase 2 — associations snapshot. Optional. */
  associations?: AssociationsFile;
}

export function serialize(input: SerializeInput): NakliDataFile {
  const now = new Date().toISOString();
  return {
    format: 'naklidata',
    version: NAKLIDATA_VERSION,
    created: now,
    modified: now,
    name: input.notebookName,
    sources: input.sources.map((s) => ({
      id: s.id,
      kind: s.kind,
      label: s.label,
      ref: s.ref ?? null,
      tables: s.tables.map((t) => ({
        id: t.id,
        name: t.name,
        format: t.format,
        origin: t.origin,
        rowCount: t.rowCount,
      })),
      // Wave 2 slice 2 — s3-endpoint config travels alongside the source.
      // Secrets (access key, secret access key) are NOT persisted here;
      // they live in source-secrets.ts and the user re-grants them on
      // reload (or restores from IDB if they had opted in).
      ...(s.s3
        ? {
            s3: {
              endpoint: s.s3.endpoint,
              region: s.s3.region,
              bucket: s.s3.bucket,
              path_prefix: s.s3.pathPrefix,
              url_style: s.s3.urlStyle,
            },
          }
        : {}),
      // Wave 2 slice 3a — iceberg-table config. Bearer token (if any)
      // lives in source-secrets and is NOT persisted here.
      ...(s.iceberg
        ? {
            iceberg: {
              metadata_url: s.iceberg.metadataUrl,
              requires_bearer: s.iceberg.requiresBearer,
            },
          }
        : {}),
      // Wave 2 slice 3b — iceberg-catalog. Bearer token NOT persisted.
      ...(s.icebergCatalog
        ? {
            iceberg_catalog: {
              catalog_url: s.icebergCatalog.catalogUrl,
              namespace: s.icebergCatalog.namespace,
              table: s.icebergCatalog.table,
              requires_bearer: s.icebergCatalog.requiresBearer,
            },
          }
        : {}),
      // Wave 3 W3.4a — compute-bridge. Bearer token NOT persisted.
      ...(s.bridge
        ? {
            bridge: {
              bridge_url: s.bridge.bridgeUrl,
              sql: s.bridge.sql,
              table_name: s.bridge.tableName,
              requires_bearer: s.bridge.requiresBearer,
            },
          }
        : {}),
      // Wave 3 W3.4b — compute-bridge-catalog. Bearer token NOT persisted.
      ...(s.bridgeCatalog
        ? {
            bridge_catalog: {
              bridge_url: s.bridgeCatalog.bridgeUrl,
              tables: s.bridgeCatalog.tables.map((t) => ({
                name: t.name,
                local_name: t.localName,
                row_cap: t.rowCap,
              })),
              requires_bearer: s.bridgeCatalog.requiresBearer,
            },
          }
        : {}),
    })),
    assignments: Object.entries(input.assignments).map(([key, a]) => ({
      key,
      columnName: a.columnName,
      sqlType: a.sqlType,
      typeId: a.assigned.typeId,
      origin: a.assigned.origin,
      confidence: a.assigned.confidence,
      candidates: a.candidates,
      resolutionKind: a.resolution.kind,
    })),
    cells: input.cells.map(cellWithoutResults),
    user_types: input.userTypes ?? [],
    override_rules: input.overrideRules ?? [],
    ...(input.lineage ? { lineage: input.lineage } : {}),
    ...(input.measures ? { measures: input.measures } : {}),
    ...(input.selections ? { selections: input.selections } : {}),
    ...(input.associations ? { associations: input.associations } : {}),
    settings: { auto_accept_threshold: input.autoAcceptThreshold },
  };
}

/** Strip transient runtime state (results, errors) before persisting. */
function cellWithoutResults(c: CellState): CellState {
  if (c.kind === 'sql' || c.kind === 'cohort' || c.kind === 'assertion') {
    return {
      ...c,
      status: 'idle',
      lastError: null,
      lastResult: null,
    };
  }
  if (c.kind === 'stats') {
    // Descriptives + correlations are engine snapshots — recomputed on Run
    // from the upstream cell. Don't persist them (forward-pass H9); a
    // loaded notebook re-derives them when the stats cell runs.
    return {
      ...c,
      status: 'idle',
      lastError: null,
      descriptives: null,
      correlations: null,
    };
  }
  return c;
}

export function parse(text: string): NakliDataFile {
  const obj = JSON.parse(text) as Partial<NakliDataFile>;
  if (obj.format !== 'naklidata') throw new Error('Not a .naklidata file.');
  if (!obj.version) throw new Error('Missing version.');
  // Validate the version shape before comparing — a malformed string like
  // "1.x" makes compareVersion return NaN, and `NaN > 0` is false, so a
  // forged version would slip past the "saved by a newer NakliData" guard
  // (forward-pass M25).
  if (!/^\d+(\.\d+)*$/.test(obj.version)) {
    throw new Error(`Invalid version string: ${obj.version}`);
  }
  if (compareVersion(obj.version, NAKLIDATA_VERSION) > 0) {
    throw new Error(
      `This notebook was saved with a newer version of NakliData (${obj.version}). Please update.`,
    );
  }
  // Trivial migration path for v1.0 — just trust the shape.
  return obj as NakliDataFile;
}

function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

export function defaultFilename(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'NakliData'}.naklidata`;
}

export async function saveToFile(file: NakliDataFile): Promise<{ name: string }> {
  const json = JSON.stringify(file, null, 2);
  const bytes = new TextEncoder().encode(json);
  const suggested = defaultFilename(file.name);
  type Picker = (opts: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandle>;
  const picker = (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker;
  if (typeof picker === 'function') {
    const handle = await picker({
      suggestedName: suggested,
      types: [
        {
          description: '.naklidata file',
          accept: { 'application/json': ['.naklidata', '.json'] },
        },
      ],
    });
    const w = await handle.createWritable();
    await w.write(new Blob([new Uint8Array(bytes)]));
    await w.close();
    return { name: handle.name };
  }
  // Fallback download.
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggested;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { name: suggested };
}

export async function loadFromFile(): Promise<NakliDataFile | null> {
  type Picker = (opts: {
    multiple: boolean;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandle[]>;
  const picker = (window as unknown as { showOpenFilePicker?: Picker }).showOpenFilePicker;
  if (typeof picker === 'function') {
    try {
      const [handle] = await picker({
        multiple: false,
        types: [
          {
            description: '.naklidata',
            accept: { 'application/json': ['.naklidata', '.json'] },
          },
        ],
      });
      if (!handle) return null;
      const file = await handle.getFile();
      const text = await file.text();
      return parse(text);
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return null;
      throw err;
    }
  }
  return await new Promise<NakliDataFile | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.naklidata,.json,application/json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) {
        resolve(null);
        return;
      }
      const text = await f.text();
      resolve(parse(text));
    };
    input.click();
  });
}

// IDB workbook snapshot (auto-save / auto-restore) moved to
// `src/core/sessions.ts` (each session owns its own snapshot at
// `sessions/<id>/snapshot`). The legacy `workbook/current` key is
// migrated on first multi-session boot and then deleted.
