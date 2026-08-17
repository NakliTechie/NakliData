/**
 * Product-facing capability registry.
 *
 * Keep source-picker readiness and file-format identifiers here so the UI,
 * mount layer, tests, and product-truth documentation share one vocabulary.
 * A capability is "available" only when this build has an end-to-end verified
 * path—not merely dormant implementation code.
 */

export const PRIVACY_POSTURE_COPY =
  'Data and compute stay in your browser unless you explicitly connect a remote source, enable the OSM basemap, or invoke a cloud sidecar action. Before each cloud action, NakliData shows the provider and payload categories.';

export const SUPPORTED_FILE_FORMATS = [
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

export type FileFormat = (typeof SUPPORTED_FILE_FORMATS)[number];

export const SOURCE_GROUPS = [
  {
    id: 'local',
    label: 'Local data',
    description: 'Files and folders on this device.',
  },
  {
    id: 'object-storage',
    label: 'Object storage',
    description: 'Explicit network reads from your browser.',
  },
  {
    id: 'catalogs',
    label: 'Catalogs',
    description: 'Public Iceberg tables are available; REST catalogs remain verification-gated.',
  },
  {
    id: 'warehouse-compute',
    label: 'Warehouse compute',
    description: 'Advanced—bring your own compatible bridge endpoint.',
  },
] as const;

export type SourceGroupId = (typeof SOURCE_GROUPS)[number]['id'];
export type SourceReadiness = 'available' | 'advanced' | 'unavailable';

export interface SourceOption {
  id: string;
  group: SourceGroupId;
  action: string;
  label: string;
  hint: string;
  title: string;
  readiness: SourceReadiness;
  unavailableReason: string | null;
}

export const ICEBERG_UNAVAILABLE_REASON =
  'Unavailable in this build: Iceberg REST Catalog remains disabled until real catalog endpoints pass the release matrix.';

export const SOURCE_OPTIONS: readonly SourceOption[] = [
  {
    id: 'folder',
    group: 'local',
    action: 'mount-folder',
    label: 'Add folder',
    hint: 'Multi-file. Recommended.',
    title: 'Mount a local folder using browser file-system access',
    readiness: 'available',
    unavailableReason: null,
  },
  {
    id: 'file',
    group: 'local',
    action: 'mount-file',
    label: 'Add file',
    hint: 'CSV, Parquet, Excel, SQLite, and more.',
    title: 'Mount one local file',
    readiness: 'available',
    unavailableReason: null,
  },
  {
    id: 'https',
    group: 'object-storage',
    action: 'mount-url',
    label: 'HTTPS URL',
    hint: 'Public CSV, TSV, JSONL, or Parquet.',
    title: 'Mount a public HTTPS URL from this browser',
    readiness: 'available',
    unavailableReason: null,
  },
  {
    id: 's3',
    group: 'object-storage',
    action: 'mount-s3',
    label: 'S3-compatible',
    hint: 'AWS, R2, B2, MinIO, or Wasabi.',
    title: 'Mount an S3-compatible object through this browser',
    readiness: 'available',
    unavailableReason: null,
  },
  {
    id: 'iceberg-table',
    group: 'catalogs',
    action: 'mount-iceberg',
    label: 'Iceberg table',
    hint: 'Public HTTPS metadata or table directory.',
    title: 'Mount a public Apache Iceberg table through the browser',
    readiness: 'available',
    unavailableReason: null,
  },
  {
    id: 'iceberg-rest',
    group: 'catalogs',
    action: 'mount-iceberg-catalog',
    label: 'Iceberg REST',
    hint: 'Unavailable—verification pending.',
    title: ICEBERG_UNAVAILABLE_REASON,
    readiness: 'unavailable',
    unavailableReason: ICEBERG_UNAVAILABLE_REASON,
  },
  {
    id: 'bridge-query',
    group: 'warehouse-compute',
    action: 'mount-compute-bridge',
    label: 'Advanced: SQL bridge',
    hint: 'BYO compatible endpoint; bounded result.',
    title:
      'Advanced—run SQL through your own compatible Compute Bridge endpoint; NakliData does not ship the bridge server',
    readiness: 'advanced',
    unavailableReason: null,
  },
  {
    id: 'bridge-catalog',
    group: 'warehouse-compute',
    action: 'mount-compute-bridge-catalog',
    label: 'Advanced: bridge catalog',
    hint: 'BYO compatible endpoint; pick tables.',
    title:
      'Advanced—browse tables through your own compatible Compute Bridge endpoint; NakliData does not ship the bridge server',
    readiness: 'advanced',
    unavailableReason: null,
  },
] as const;

export function sourceOptionForAction(action: string): SourceOption | null {
  return SOURCE_OPTIONS.find((option) => option.action === action) ?? null;
}
