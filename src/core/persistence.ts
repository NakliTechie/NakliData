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
import type { DimensionsFile } from './dimensions.ts';
import { loadChunk } from './lazy-loader.ts';
import { type LineageGraph, lineageGraphFromJson } from './lineage-store.ts';
import type { MeasuresFile } from './measures-store.ts';
import type { MountedSource } from './mount.ts';
import type { SegmentsFile } from './segments.ts';
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
  /**
   * Dimensions (v1.4 F1 — named non-aggregate SQL fragments referenced
   * via `DIM(name)`). Optional — pre-F1 files round-trip cleanly.
   */
  dimensions?: DimensionsFile;
  /**
   * Segments (Resolve M2 — named WHERE predicates referenced via
   * `SEGMENT(name)`). Optional — pre-M2 files round-trip cleanly.
   */
  segments?: SegmentsFile;
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
  /** v1.4 F1 — dimensions snapshot. Optional. */
  dimensions?: DimensionsFile;
  /** Resolve M2 — segments snapshot. Optional. */
  segments?: SegmentsFile;
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
    ...(input.dimensions ? { dimensions: input.dimensions } : {}),
    ...(input.segments ? { segments: input.segments } : {}),
    settings: { auto_accept_threshold: input.autoAcceptThreshold },
  };
}

/** Strip transient runtime state (results, errors) before persisting. */
function cellWithoutResults(c: CellState): CellState {
  if (c.kind === 'sql') {
    // Tier-2 result snapshots live in a separate per-session IDB store, never
    // the shared/exported file — omit `resultMeta` entirely (not set to null,
    // to keep the file lean + byte-identical to pre-snapshot files).
    const { resultMeta: _drop, ...rest } = c;
    return { ...rest, status: 'idle', lastError: null, lastResult: null };
  }
  if (c.kind === 'cohort' || c.kind === 'assertion') {
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
  if (c.kind === 'python' || c.kind === 'r') {
    // The preview is a head snapshot re-derived on Run; the durable artifact
    // is the re-registered DuckDB table. Keep the code + input binding; drop
    // the snapshot so `.naklidata` stays lean.
    return {
      ...c,
      status: 'idle',
      loadPhase: null,
      lastError: null,
      preview: null,
    };
  }
  return c;
}

export function parse(text: string): NakliDataFile {
  return validateNakliDataFile(JSON.parse(text));
}

type JsonObject = Record<string, unknown>;

function objectValue(value: unknown, path: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Malformed .naklidata: ${path} must be an object.`);
  }
  return value as JsonObject;
}

function arrayValue(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Malformed .naklidata: ${path} must be an array.`);
  }
  return value;
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Malformed .naklidata: ${path} must be a string.`);
  }
  return value;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Malformed .naklidata: ${path} must be a finite number.`);
  }
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  if (value === undefined || value === null) return null;
  return stringValue(value, path);
}

function stringArray(value: unknown, path: string): string[] {
  return arrayValue(value, path).map((item, index) => stringValue(item, `${path}[${index}]`));
}

function oneOf<T extends string>(value: unknown, allowed: ReadonlyArray<T>, path: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`Malformed .naklidata: ${path} has an unsupported value.`);
  }
  return value as T;
}

const SOURCE_KINDS = [
  'example-bundle',
  'fsa-folder',
  'fsa-file',
  'http',
  's3-endpoint',
  'iceberg-table',
  'iceberg-catalog',
  'compute-bridge',
  'compute-bridge-catalog',
] as const;

const FILE_FORMATS = [
  'csv',
  'tsv',
  'jsonl',
  'parquet',
  'sqlite',
  'duckdb',
  'xlsx',
  'arrow',
  'sav',
  'dta',
  'sas7bdat',
  'xpt',
  'geojson',
  'kml',
] as const;

function validateSource(value: unknown, index: number): PersistedSource {
  const path = `sources[${index}]`;
  const source = objectValue(value, path);
  const tables = arrayValue(source.tables, `${path}.tables`).map((item, tableIndex) => {
    const tablePath = `${path}.tables[${tableIndex}]`;
    const table = objectValue(item, tablePath);
    return {
      id: stringValue(table.id, `${tablePath}.id`),
      name: stringValue(table.name, `${tablePath}.name`),
      format: oneOf(table.format, FILE_FORMATS, `${tablePath}.format`),
      origin: stringValue(table.origin, `${tablePath}.origin`),
      rowCount: finiteNumber(table.rowCount, `${tablePath}.rowCount`),
    };
  });
  const out: PersistedSource = {
    id: stringValue(source.id, `${path}.id`),
    kind: oneOf(source.kind, SOURCE_KINDS, `${path}.kind`),
    label: stringValue(source.label, `${path}.label`),
    ref: nullableString(source.ref, `${path}.ref`),
    tables,
  };
  if (source.s3 !== undefined) {
    const s3 = objectValue(source.s3, `${path}.s3`);
    out.s3 = {
      endpoint: stringValue(s3.endpoint, `${path}.s3.endpoint`),
      region: stringValue(s3.region, `${path}.s3.region`),
      bucket: stringValue(s3.bucket, `${path}.s3.bucket`),
      path_prefix: stringValue(s3.path_prefix, `${path}.s3.path_prefix`),
      url_style: oneOf(s3.url_style, ['vhost', 'path'], `${path}.s3.url_style`),
    };
  }
  if (source.iceberg !== undefined) {
    const iceberg = objectValue(source.iceberg, `${path}.iceberg`);
    if (typeof iceberg.requires_bearer !== 'boolean') {
      throw new Error(`Malformed .naklidata: ${path}.iceberg.requires_bearer must be boolean.`);
    }
    out.iceberg = {
      metadata_url: stringValue(iceberg.metadata_url, `${path}.iceberg.metadata_url`),
      requires_bearer: iceberg.requires_bearer,
    };
  }
  if (source.iceberg_catalog !== undefined) {
    const catalog = objectValue(source.iceberg_catalog, `${path}.iceberg_catalog`);
    if (typeof catalog.requires_bearer !== 'boolean') {
      throw new Error(
        `Malformed .naklidata: ${path}.iceberg_catalog.requires_bearer must be boolean.`,
      );
    }
    out.iceberg_catalog = {
      catalog_url: stringValue(catalog.catalog_url, `${path}.iceberg_catalog.catalog_url`),
      namespace: stringValue(catalog.namespace, `${path}.iceberg_catalog.namespace`),
      table: stringValue(catalog.table, `${path}.iceberg_catalog.table`),
      requires_bearer: catalog.requires_bearer,
    };
  }
  if (source.bridge !== undefined) {
    const bridge = objectValue(source.bridge, `${path}.bridge`);
    if (typeof bridge.requires_bearer !== 'boolean') {
      throw new Error(`Malformed .naklidata: ${path}.bridge.requires_bearer must be boolean.`);
    }
    out.bridge = {
      bridge_url: stringValue(bridge.bridge_url, `${path}.bridge.bridge_url`),
      sql: stringValue(bridge.sql, `${path}.bridge.sql`),
      table_name: stringValue(bridge.table_name, `${path}.bridge.table_name`),
      requires_bearer: bridge.requires_bearer,
    };
  }
  if (source.bridge_catalog !== undefined) {
    const catalog = objectValue(source.bridge_catalog, `${path}.bridge_catalog`);
    if (typeof catalog.requires_bearer !== 'boolean') {
      throw new Error(
        `Malformed .naklidata: ${path}.bridge_catalog.requires_bearer must be boolean.`,
      );
    }
    out.bridge_catalog = {
      bridge_url: stringValue(catalog.bridge_url, `${path}.bridge_catalog.bridge_url`),
      tables: arrayValue(catalog.tables, `${path}.bridge_catalog.tables`).map(
        (item, tableIndex) => {
          const tablePath = `${path}.bridge_catalog.tables[${tableIndex}]`;
          const table = objectValue(item, tablePath);
          return {
            name: stringValue(table.name, `${tablePath}.name`),
            local_name: stringValue(table.local_name, `${tablePath}.local_name`),
            row_cap: finiteNumber(table.row_cap, `${tablePath}.row_cap`),
          };
        },
      ),
      requires_bearer: catalog.requires_bearer,
    };
  }
  return out;
}

function validateAssignment(value: unknown, index: number): PersistedAssignment {
  const path = `assignments[${index}]`;
  const assignment = objectValue(value, path);
  const typeId = nullableString(assignment.typeId, `${path}.typeId`);
  const origin = oneOf(
    assignment.origin ?? (typeId ? 'detector' : 'unknown'),
    ['detector', 'user_accept', 'user_override', 'unknown'],
    `${path}.origin`,
  );
  const candidates = arrayValue(assignment.candidates ?? [], `${path}.candidates`).map(
    (value, candidateIndex) => {
      const candidatePath = `${path}.candidates[${candidateIndex}]`;
      const candidate = objectValue(value, candidatePath);
      return {
        typeId: stringValue(candidate.typeId, `${candidatePath}.typeId`),
        displayName: stringValue(candidate.displayName, `${candidatePath}.displayName`),
        confidence: finiteNumber(candidate.confidence, `${candidatePath}.confidence`),
        evidence: stringArray(candidate.evidence, `${candidatePath}.evidence`),
      };
    },
  );
  return {
    key: stringValue(assignment.key, `${path}.key`),
    columnName: stringValue(assignment.columnName, `${path}.columnName`),
    sqlType: stringValue(assignment.sqlType, `${path}.sqlType`),
    typeId,
    origin,
    confidence: finiteNumber(assignment.confidence ?? 0, `${path}.confidence`),
    candidates,
    resolutionKind: oneOf(
      assignment.resolutionKind ?? (typeId ? 'auto_accept' : 'unknown'),
      ['auto_accept', 'ambiguous', 'unknown'],
      `${path}.resolutionKind`,
    ),
  };
}

function validateSelection(value: unknown, path: string): unknown {
  if (value === undefined || value === null) return null;
  const selection = objectValue(value, path);
  const kind = oneOf(selection.kind, ['timeRange', 'numRange', 'valueSet'], `${path}.kind`);
  const col = stringValue(selection.col, `${path}.col`);
  if (kind === 'valueSet') {
    return { kind, col, values: stringArray(selection.values, `${path}.values`) };
  }
  return {
    kind,
    col,
    lo: finiteNumber(selection.lo, `${path}.lo`),
    hi: finiteNumber(selection.hi, `${path}.hi`),
  };
}

function validateReportDefinition(value: unknown, path: string): unknown {
  const definition = objectValue(value, path);
  const margins = objectValue(definition.margins, `${path}.margins`);
  const items = arrayValue(definition.items, `${path}.items`).map((value, index) => {
    const itemPath = `${path}.items[${index}]`;
    const item = objectValue(value, itemPath);
    const kind = oneOf(
      item.kind,
      ['kpi-row', 'cell-ref', 'page-break', 'spacer'],
      `${itemPath}.kind`,
    );
    if (kind === 'cell-ref') {
      return { kind, cellName: stringValue(item.cellName, `${itemPath}.cellName`) };
    }
    if (kind === 'spacer') {
      return { kind, height: finiteNumber(item.height, `${itemPath}.height`) };
    }
    if (kind === 'page-break') return { kind };
    return {
      kind,
      tiles: arrayValue(item.tiles, `${itemPath}.tiles`).map((value, tileIndex) => {
        const tilePath = `${itemPath}.tiles[${tileIndex}]`;
        const tile = objectValue(value, tilePath);
        return {
          measure: stringValue(tile.measure, `${tilePath}.measure`),
          label: stringValue(tile.label, `${tilePath}.label`),
          ...(tile.value === undefined
            ? {}
            : { value: stringValue(tile.value, `${tilePath}.value`) }),
        };
      }),
      ...(item.sourceCell === undefined
        ? {}
        : { sourceCell: stringValue(item.sourceCell, `${itemPath}.sourceCell`) }),
      ...(item.valueColumn === undefined
        ? {}
        : { valueColumn: stringValue(item.valueColumn, `${itemPath}.valueColumn`) }),
    };
  });
  return {
    title: stringValue(definition.title, `${path}.title`),
    pageSize: oneOf(definition.pageSize, ['A4', 'Letter'], `${path}.pageSize`),
    margins: {
      top: finiteNumber(margins.top, `${path}.margins.top`),
      right: finiteNumber(margins.right, `${path}.margins.right`),
      bottom: finiteNumber(margins.bottom, `${path}.margins.bottom`),
      left: finiteNumber(margins.left, `${path}.margins.left`),
    },
    ...(definition.subtitle === undefined
      ? {}
      : { subtitle: stringValue(definition.subtitle, `${path}.subtitle`) }),
    items,
  };
}

function validateCell(value: unknown, index: number): PersistedCell {
  const path = `cells[${index}]`;
  const cell = objectValue(value, path);
  const id = stringValue(cell.id, `${path}.id`);
  const kind = stringValue(cell.kind, `${path}.kind`) as CellState['kind'];
  const order = cell.order === undefined ? index : finiteNumber(cell.order, `${path}.order`);
  const name = nullableString(cell.name, `${path}.name`);
  const base = { id, kind, order, name };
  const inputCell = () => nullableString(cell.inputCell, `${path}.inputCell`);
  switch (kind) {
    case 'sql':
    case 'cohort':
    case 'assertion':
      return {
        ...base,
        kind,
        code: stringValue(cell.code, `${path}.code`),
        status: 'idle',
        lastError: null,
        lastResult: null,
      };
    case 'markdown':
      return { ...base, kind, code: stringValue(cell.code, `${path}.code`) };
    case 'chart':
      return {
        ...base,
        kind,
        inputCell: inputCell(),
        chartType: oneOf(
          cell.chartType,
          [
            'bar',
            'line',
            'area',
            'scatter',
            'table',
            'stat',
            'histogram',
            'pie',
            'stacked-bar',
            'area-stacked',
            'heatmap',
            'funnel',
            'path',
          ],
          `${path}.chartType`,
        ),
        x: nullableString(cell.x, `${path}.x`),
        y: nullableString(cell.y, `${path}.y`),
        facet: nullableString(cell.facet, `${path}.facet`),
      };
    case 'pivot':
      return {
        ...base,
        kind,
        inputCell: inputCell(),
        rowCol: nullableString(cell.rowCol, `${path}.rowCol`),
        colCol: nullableString(cell.colCol, `${path}.colCol`),
        valueCol: nullableString(cell.valueCol, `${path}.valueCol`),
        agg: oneOf(cell.agg, ['sum', 'avg', 'min', 'max', 'count'], `${path}.agg`),
      };
    case 'map':
      return {
        ...base,
        kind,
        inputCell: inputCell(),
        geometryCol: nullableString(cell.geometryCol, `${path}.geometryCol`),
        colorBy: nullableString(cell.colorBy, `${path}.colorBy`),
      };
    case 'embedding':
      return {
        ...base,
        kind,
        inputCell: inputCell(),
        xCol: nullableString(cell.xCol, `${path}.xCol`),
        yCol: nullableString(cell.yCol, `${path}.yCol`),
        colorBy: nullableString(cell.colorBy, `${path}.colorBy`),
        labelCol: nullableString(cell.labelCol, `${path}.labelCol`),
        embCol: nullableString(cell.embCol, `${path}.embCol`),
      };
    case 'network':
      return {
        ...base,
        kind,
        inputCell: inputCell(),
        sourceCol: nullableString(cell.sourceCol, `${path}.sourceCol`),
        targetCol: nullableString(cell.targetCol, `${path}.targetCol`),
        edgeColorCol: nullableString(cell.edgeColorCol, `${path}.edgeColorCol`),
        edgeWidthCol: nullableString(cell.edgeWidthCol, `${path}.edgeWidthCol`),
        nodeMetric:
          cell.nodeMetric === undefined || cell.nodeMetric === null
            ? null
            : (oneOf(
                cell.nodeMetric,
                ['degree', 'pagerank', 'betweenness', 'community'],
                `${path}.nodeMetric`,
              ) as 'degree' | 'pagerank' | 'betweenness' | 'community'),
      };
    case 'temporal':
      return {
        ...base,
        kind,
        inputCell: inputCell(),
        timeCol: nullableString(cell.timeCol, `${path}.timeCol`),
        selection: validateSelection(cell.selection, `${path}.selection`) as never,
      };
    case 'distribution':
      return {
        ...base,
        kind,
        inputCell: inputCell(),
        column: nullableString(cell.column, `${path}.column`),
        selection: validateSelection(cell.selection, `${path}.selection`) as never,
      };
    case 'input':
      return {
        ...base,
        kind,
        label: nullableString(cell.label, `${path}.label`),
        inputType: oneOf(cell.inputType, ['text', 'number', 'date', 'select'], `${path}.inputType`),
        value: stringValue(cell.value, `${path}.value`),
        options: stringArray(cell.options, `${path}.options`),
      };
    case 'dashboard':
      return {
        ...base,
        kind,
        columns: finiteNumber(cell.columns, `${path}.columns`),
        items: stringArray(cell.items, `${path}.items`),
      };
    case 'stats':
      return {
        ...base,
        kind,
        inputCell: inputCell(),
        descriptives: null,
        correlations: null,
        status: 'idle',
        lastError: null,
      };
    case 'python':
    case 'r':
      return {
        ...base,
        kind,
        inputCell: inputCell(),
        code: stringValue(cell.code, `${path}.code`),
        preview: null,
        status: 'idle',
        loadPhase: null,
        lastError: null,
      };
    case 'report':
      return {
        ...base,
        kind,
        definition: validateReportDefinition(cell.definition, `${path}.definition`) as never,
      };
    default:
      throw new Error(`Malformed .naklidata: ${path}.kind "${kind}" is not supported.`);
  }
}

function validateUserType(value: unknown, index: number): UserType {
  const path = `user_types[${index}]`;
  const userType = objectValue(value, path);
  return {
    id: stringValue(userType.id, `${path}.id`),
    display_name: stringValue(userType.display_name, `${path}.display_name`),
    category: stringValue(userType.category, `${path}.category`),
    regex: stringValue(userType.regex, `${path}.regex`),
    created: stringValue(userType.created, `${path}.created`),
    ...(userType.note === undefined ? {} : { note: stringValue(userType.note, `${path}.note`) }),
  };
}

function validateOverrideRule(value: unknown, index: number): OverrideRule {
  const path = `override_rules[${index}]`;
  const rule = objectValue(value, path);
  return {
    columnName: stringValue(rule.columnName, `${path}.columnName`),
    typeId: stringValue(rule.typeId, `${path}.typeId`),
    created: stringValue(rule.created, `${path}.created`),
    ...(rule.note === undefined ? {} : { note: stringValue(rule.note, `${path}.note`) }),
  };
}

function validateVersionedCollection(
  value: unknown,
  path: string,
  collectionKey: string,
  validateItem: (item: unknown, path: string) => unknown,
): JsonObject {
  const file = objectValue(value, path);
  if (file.version !== 1) {
    throw new Error(`Malformed .naklidata: ${path}.version must be 1.`);
  }
  return {
    version: 1,
    [collectionKey]: arrayValue(file[collectionKey], `${path}.${collectionKey}`).map(
      (item, index) => validateItem(item, `${path}.${collectionKey}[${index}]`),
    ),
  };
}

function validateNamedExpression(item: unknown, path: string): JsonObject {
  const value = objectValue(item, path);
  if (value.version !== 1) {
    throw new Error(`Malformed .naklidata: ${path}.version must be 1.`);
  }
  return {
    name: stringValue(value.name, `${path}.name`),
    expression: stringValue(value.expression, `${path}.expression`),
    description: stringValue(value.description, `${path}.description`),
    version: 1,
    ...(value.format === undefined
      ? {}
      : {
          format: oneOf(
            value.format,
            ['number', 'currency_inr', 'currency_usd', 'currency_eur', 'percent', 'count'],
            `${path}.format`,
          ),
        }),
    ...(value.requiredTypes === undefined
      ? {}
      : { requiredTypes: stringArray(value.requiredTypes, `${path}.requiredTypes`) }),
  };
}

/**
 * Fully validate and normalize an attacker-controlled `.naklidata` value before
 * any live workbook/engine mutation. Every external entry point (file, lens,
 * IDB snapshot, and apply) routes through this function.
 */
export function validateNakliDataFile(value: unknown): NakliDataFile {
  const obj = objectValue(value, 'root');
  if (obj.format !== 'naklidata') throw new Error('Not a .naklidata file.');
  if (typeof obj.version !== 'string' || obj.version === '') throw new Error('Missing version.');
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
  const sources = arrayValue(obj.sources, 'sources').map(validateSource);
  const assignments = arrayValue(obj.assignments ?? [], 'assignments').map(validateAssignment);
  const cells = arrayValue(obj.cells, 'cells').map(validateCell);
  const duplicate = (values: string[], path: string) => {
    const seen = new Set<string>();
    for (const item of values) {
      if (seen.has(item)) throw new Error(`Malformed .naklidata: duplicate ${path} "${item}".`);
      seen.add(item);
    }
  };
  duplicate(
    sources.map((source) => source.id),
    'source id',
  );
  duplicate(
    sources.flatMap((source) => source.tables.map((table) => table.id)),
    'table id',
  );
  duplicate(
    assignments.map((assignment) => assignment.key),
    'assignment key',
  );
  duplicate(
    cells.map((cell) => cell.id),
    'cell id',
  );

  const settings = obj.settings === undefined ? {} : objectValue(obj.settings, 'settings');
  const threshold = finiteNumber(
    settings.auto_accept_threshold ?? 0.9,
    'settings.auto_accept_threshold',
  );
  if (threshold < 0 || threshold > 1) {
    throw new Error(
      'Malformed .naklidata: settings.auto_accept_threshold must be between 0 and 1.',
    );
  }
  const now = new Date().toISOString();
  const file: NakliDataFile = {
    format: 'naklidata',
    version: obj.version,
    created: obj.created === undefined ? now : stringValue(obj.created, 'created'),
    modified: obj.modified === undefined ? now : stringValue(obj.modified, 'modified'),
    name: obj.name === undefined ? 'Untitled' : stringValue(obj.name, 'name'),
    sources,
    assignments,
    cells,
    user_types: arrayValue(obj.user_types ?? [], 'user_types').map(validateUserType),
    settings: { auto_accept_threshold: threshold },
  };
  if (obj.override_rules !== undefined) {
    file.override_rules = arrayValue(obj.override_rules, 'override_rules').map(
      validateOverrideRule,
    );
  }
  if (obj.lineage !== undefined) {
    file.lineage = lineageGraphFromJson(obj.lineage);
  }
  if (obj.measures !== undefined) {
    file.measures = validateVersionedCollection(
      obj.measures,
      'measures',
      'measures',
      validateNamedExpression,
    ) as never;
  }
  if (obj.dimensions !== undefined) {
    file.dimensions = validateVersionedCollection(
      obj.dimensions,
      'dimensions',
      'dimensions',
      validateNamedExpression,
    ) as never;
  }
  if (obj.segments !== undefined) {
    file.segments = validateVersionedCollection(
      obj.segments,
      'segments',
      'segments',
      validateNamedExpression,
    ) as never;
  }
  if (obj.selections !== undefined) {
    file.selections = validateVersionedCollection(
      obj.selections,
      'selections',
      'entries',
      (item, path) => {
        const entry = objectValue(item, path);
        return {
          table: stringValue(entry.table, `${path}.table`),
          column: stringValue(entry.column, `${path}.column`),
          values: stringArray(entry.values, `${path}.values`),
          ...(entry.type === undefined
            ? {}
            : {
                type: oneOf(entry.type, ['string', 'number', 'date', 'boolean'], `${path}.type`),
              }),
        };
      },
    ) as never;
  }
  if (obj.associations !== undefined) {
    file.associations = validateVersionedCollection(
      obj.associations,
      'associations',
      'links',
      (item, path) => {
        const link = objectValue(item, path);
        const key = (value: unknown, keyPath: string) => {
          const record = objectValue(value, keyPath);
          return {
            table: stringValue(record.table, `${keyPath}.table`),
            column: stringValue(record.column, `${keyPath}.column`),
          };
        };
        return { a: key(link.a, `${path}.a`), b: key(link.b, `${path}.b`) };
      },
    ) as never;
  }
  return file;
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

/** Sentinel returned when the user cancels the Save dialog (L4) — callers
 *  should treat this as a no-op, not an error. */
export const SAVE_CANCELLED = { name: null } as const;

export async function saveToFile(
  file: NakliDataFile,
): Promise<{ name: string } | typeof SAVE_CANCELLED> {
  const json = JSON.stringify(file, null, 2);
  const bytes = new TextEncoder().encode(json);
  const suggested = defaultFilename(file.name);
  type Picker = (opts: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandle>;
  const picker = (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker;
  if (typeof picker === 'function') {
    let handle: FileSystemFileHandle;
    try {
      handle = await picker({
        suggestedName: suggested,
        types: [
          {
            description: '.naklidata file',
            accept: { 'application/json': ['.naklidata', '.json'] },
          },
        ],
      });
    } catch (err) {
      // L4: cancelling the picker throws AbortError — that's a no-op, not a
      // "Save failed" error toast.
      if ((err as DOMException)?.name === 'AbortError') return SAVE_CANCELLED;
      throw err;
    }
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
      const validator = await loadChunk('persistence-validation');
      return validator.parse(text);
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return null;
      throw err;
    }
  }
  return await new Promise<NakliDataFile | null>((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.naklidata,.json,application/json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) {
        resolve(null);
        return;
      }
      // L5: without this try/catch a parse() throw becomes an unhandled
      // rejection and the promise never settles — the load silently hangs.
      try {
        const text = await f.text();
        const validator = await loadChunk('persistence-validation');
        resolve(validator.parse(text));
      } catch (err) {
        reject(err);
      }
    };
    // Resolve(null) if the dialog is dismissed so the caller doesn't hang.
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

// IDB workbook snapshot (auto-save / auto-restore) moved to
// `src/core/sessions.ts` (each session owns its own snapshot at
// `sessions/<id>/snapshot`). The legacy `workbook/current` key is
// migrated on first multi-session boot and then deleted.
