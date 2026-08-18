import type { BridgeTable } from '../../../src/core/bridge/protocol.ts';
import { BridgeServerError } from './backend.ts';
import {
  type BridgeAllowedObject,
  createDatabricksBackend,
  createSnowflakeBackend,
} from './vendor-backends.ts';

export interface VendorRuntimeBounds {
  maxResultBytes: number;
  requestTimeoutMs: number;
}

export function backendFromEnvironment(env: Env, bounds: VendorRuntimeBounds) {
  const adapterId: string = env.BRIDGE_ADAPTER;
  if (adapterId === 'unconfigured') return null;
  if (adapterId !== 'databricks-sql-warehouse' && adapterId !== 'snowflake-virtual-warehouse') {
    throw invalidConfig('BRIDGE_ADAPTER is unsupported.');
  }
  const config = objectValue(parseJson(env.BRIDGE_VENDOR_CONFIG_JSON), 'bridge vendor config');
  const allowedObjects = allowedObjectValues(config.allowed_objects);
  const readOnlyIdentityVerified = config.read_only_identity_verified === true;
  if (adapterId === 'databricks-sql-warehouse') {
    return createDatabricksBackend({
      workspaceUrl: stringValue(config.workspace_url, 'workspace_url'),
      warehouseId: stringValue(config.warehouse_id, 'warehouse_id'),
      bearerToken: secretValue(env.DATABRICKS_TOKEN, 'DATABRICKS_TOKEN'),
      allowedObjects,
      readOnlyIdentityVerified,
      maxResultBytes: bounds.maxResultBytes,
      requestTimeoutMs: bounds.requestTimeoutMs,
      ...optionalStringProperty(config, 'catalog'),
      ...optionalStringProperty(config, 'schema'),
    });
  }
  if (adapterId === 'snowflake-virtual-warehouse') {
    const tokenType = stringValue(config.token_type, 'token_type');
    if (!['KEYPAIR_JWT', 'OAUTH', 'PROGRAMMATIC_ACCESS_TOKEN'].includes(tokenType)) {
      throw invalidConfig('token_type is unsupported.');
    }
    return createSnowflakeBackend({
      accountUrl: stringValue(config.account_url, 'account_url'),
      bearerToken: secretValue(env.SNOWFLAKE_TOKEN, 'SNOWFLAKE_TOKEN'),
      tokenType: tokenType as 'KEYPAIR_JWT' | 'OAUTH' | 'PROGRAMMATIC_ACCESS_TOKEN',
      allowedObjects,
      readOnlyIdentityVerified,
      maxResultBytes: bounds.maxResultBytes,
      requestTimeoutMs: bounds.requestTimeoutMs,
      ...optionalStringProperty(config, 'warehouse'),
      ...optionalStringProperty(config, 'database'),
      ...optionalStringProperty(config, 'schema'),
      ...optionalStringProperty(config, 'role'),
    });
  }
  return null;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw invalidConfig('BRIDGE_VENDOR_CONFIG_JSON is not valid JSON.');
  }
}

function allowedObjectValues(value: unknown): BridgeAllowedObject[] {
  if (!Array.isArray(value)) throw invalidConfig('allowed_objects must be an array.');
  return value.map((item, index) => {
    const object = objectValue(item, `allowed_objects[${index}]`);
    const namespace = arrayValue(object.namespace, `allowed_objects[${index}].namespace`).map(
      (entry) => stringValue(entry, `allowed_objects[${index}].namespace value`),
    );
    const columns = arrayValue(object.schema, `allowed_objects[${index}].schema`).map(
      (entry, columnIndex) => {
        const column = objectValue(entry, `allowed_objects[${index}].schema[${columnIndex}]`);
        return {
          name: stringValue(column.name, 'column name'),
          type: stringValue(column.type, 'column type'),
        };
      },
    );
    const kind = stringValue(object.kind, `allowed_objects[${index}].kind`);
    if (kind !== 'table' && kind !== 'view') {
      throw invalidConfig(`allowed_objects[${index}].kind is unsupported.`);
    }
    const table: BridgeTable = {
      name: stringValue(object.name, `allowed_objects[${index}].name`),
      qualifiedName: stringValue(object.id, `allowed_objects[${index}].id`),
      catalog: nullableString(object.catalog, `allowed_objects[${index}].catalog`),
      namespace,
      kind,
      source: null,
      schema: columns,
    };
    return {
      table,
      sqlName: stringValue(object.sql_name, `allowed_objects[${index}].sql_name`),
    };
  });
}

function optionalStringProperty(
  object: Record<string, unknown>,
  key: string,
): Record<string, string> {
  const value = object[key];
  return value === undefined || value === null ? {} : { [key]: stringValue(value, key) };
}

function secretValue(value: string, name: string): string {
  if (!value?.trim() || value.startsWith('replace-')) {
    throw invalidConfig(`${name} secret is not configured.`);
  }
  return value;
}

function objectValue(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidConfig(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw invalidConfig(`${path} must be an array.`);
  return value;
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2_048) {
    throw invalidConfig(`${path} must be a bounded non-empty string.`);
  }
  return value.trim();
}

function nullableString(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null;
  return stringValue(value, path);
}

function invalidConfig(message: string): BridgeServerError {
  return new BridgeServerError(message, 'invalid_config', 503);
}
