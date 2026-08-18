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

const SOURCE_GROUP_DEFINITIONS = [
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
    description: 'Apache Iceberg table and REST access are independently release-gated.',
  },
  {
    id: 'warehouse-compute',
    label: 'Warehouse compute',
    description: 'Advanced—bring your own compatible bridge endpoint.',
  },
] as const;

export type SourceGroupId = (typeof SOURCE_GROUP_DEFINITIONS)[number]['id'];
export type SourceReadiness = 'available' | 'advanced' | 'unavailable';

export interface SourceGroup {
  id: SourceGroupId;
  label: string;
  description: string;
}

export interface SourceReleaseFlags {
  icebergTable: boolean;
  icebergRest: boolean;
}

/**
 * Independent, fail-closed product release switches. A later release may turn
 * on Iceberg REST only after at least one exact support profile is marked
 * verified. Turning either flag off is the source-card rollback path.
 */
export const SOURCE_RELEASE_FLAGS: Readonly<SourceReleaseFlags> = Object.freeze({
  icebergTable: true,
  icebergRest: false,
});

/** Must equal whether iceberg-rest-release.ts contains a verified profile. */
export const HAS_VERIFIED_ICEBERG_REST_PROFILE = false;

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

export const ICEBERG_REST_ROLLBACK_REASON =
  'Unavailable in this build: the Iceberg REST release switch is off.';

export const ICEBERG_TABLE_ROLLBACK_REASON =
  'Unavailable in this build: the public Iceberg table release switch is off.';

const SOURCE_OPTION_DEFINITIONS: readonly SourceOption[] = [
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

export function resolveSourceOptions(
  flags: Readonly<SourceReleaseFlags> = SOURCE_RELEASE_FLAGS,
  hasVerifiedRestProfile: boolean = HAS_VERIFIED_ICEBERG_REST_PROFILE,
): readonly SourceOption[] {
  return SOURCE_OPTION_DEFINITIONS.map((option) => {
    if (option.id === 'iceberg-table' && !flags.icebergTable) {
      return {
        ...option,
        hint: 'Unavailable—release switch off.',
        title: ICEBERG_TABLE_ROLLBACK_REASON,
        readiness: 'unavailable',
        unavailableReason: ICEBERG_TABLE_ROLLBACK_REASON,
      };
    }
    if (option.id !== 'iceberg-rest') return option;
    if (!hasVerifiedRestProfile) return option;
    if (!flags.icebergRest) {
      return {
        ...option,
        hint: 'Unavailable—release switch off.',
        title: ICEBERG_REST_ROLLBACK_REASON,
        readiness: 'unavailable',
        unavailableReason: ICEBERG_REST_ROLLBACK_REASON,
      };
    }
    return {
      ...option,
      hint: 'Verified profiles only; see support matrix.',
      title: 'Mount a live-verified Apache Iceberg REST Catalog profile',
      readiness: 'available',
      unavailableReason: null,
    };
  });
}

export const SOURCE_OPTIONS: readonly SourceOption[] = resolveSourceOptions();

export function resolveSourceGroups(
  options: readonly SourceOption[] = SOURCE_OPTIONS,
): readonly SourceGroup[] {
  const tableReady = options.find((option) => option.id === 'iceberg-table')?.readiness;
  const restReady = options.find((option) => option.id === 'iceberg-rest')?.readiness;
  return SOURCE_GROUP_DEFINITIONS.map((group) => {
    if (group.id !== 'catalogs') return group;
    const description =
      tableReady === 'available'
        ? restReady === 'available'
          ? 'Iceberg tables and live-verified REST Catalog profiles are available.'
          : 'Public Iceberg tables are available; REST catalogs remain verification-gated.'
        : restReady === 'available'
          ? 'Live-verified Iceberg REST profiles are available; public table access is disabled.'
          : 'Iceberg table and REST entry points are unavailable in this build.';
    return { ...group, description };
  });
}

export const SOURCE_GROUPS: readonly SourceGroup[] = resolveSourceGroups();

export function sourceOptionForAction(action: string): SourceOption | null {
  return SOURCE_OPTIONS.find((option) => option.action === action) ?? null;
}
