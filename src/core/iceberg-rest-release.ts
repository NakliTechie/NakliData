export type CatalogProfileReadiness = 'verification-pending' | 'verified';

export interface IcebergRestSupportProfile {
  id: 'databricks-unity-catalog-aws' | 'snowflake-open-catalog-s3' | 'snowflake-open-catalog-gcs';
  label: string;
  provider: 'databricks' | 'snowflake';
  storage: 's3' | 'gcs';
  readiness: CatalogProfileReadiness;
}

/**
 * Exact claim units for generated product truth and release review. Runtime
 * code consumes only the drift-checked boolean in product-capabilities.ts so
 * these labels do not occupy the browser shell.
 */
export const ICEBERG_REST_SUPPORT_PROFILES: readonly IcebergRestSupportProfile[] = [
  {
    id: 'databricks-unity-catalog-aws',
    label: 'Databricks Unity Catalog on AWS',
    provider: 'databricks',
    storage: 's3',
    readiness: 'verification-pending',
  },
  {
    id: 'snowflake-open-catalog-s3',
    label: 'Snowflake Open Catalog on S3',
    provider: 'snowflake',
    storage: 's3',
    readiness: 'verification-pending',
  },
  {
    id: 'snowflake-open-catalog-gcs',
    label: 'Snowflake Open Catalog on GCS',
    provider: 'snowflake',
    storage: 'gcs',
    readiness: 'verification-pending',
  },
] as const;
