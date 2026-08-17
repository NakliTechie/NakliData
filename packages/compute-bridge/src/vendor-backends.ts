import {
  DatabricksStatementAdapter,
  type DatabricksStatementAdapterConfig,
} from '../../../src/core/bridge/databricks-statement-adapter.ts';
import { BRIDGE_CAPABILITIES, type BridgeTable } from '../../../src/core/bridge/protocol.ts';
import {
  SnowflakeSqlAdapter,
  type SnowflakeSqlAdapterConfig,
} from '../../../src/core/bridge/snowflake-sql-adapter.ts';
import { ApacheArrowChunkAssembler, ApacheArrowJsonV2Encoder } from './arrow.ts';
import type {
  BridgeBackend,
  BridgeDirectQueryRequest,
  BridgeResult,
  BridgeTableQueryRequest,
} from './backend.ts';
import { BridgeServerError } from './backend.ts';
import { createParsedReadAuthorizer } from './sql-authorizer.ts';

export interface BridgeAllowedObject {
  table: BridgeTable;
  /** Server-only SQL identifier. Never returned as the opaque inventory ID. */
  sqlName: string;
}

interface CommonVendorBackendConfig {
  allowedObjects: readonly BridgeAllowedObject[];
  readOnlyIdentityVerified: boolean;
}

export interface DatabricksBackendConfig extends CommonVendorBackendConfig {
  workspaceUrl: string;
  warehouseId: string;
  bearerToken: string;
  catalog?: string;
  schema?: string;
  maxResultBytes?: number;
  requestTimeoutMs?: number;
  pollIntervalMs?: number;
  maxPolls?: number;
  fetchImpl?: typeof fetch;
  wait?: DatabricksStatementAdapterConfig['wait'];
}

export interface SnowflakeBackendConfig extends CommonVendorBackendConfig {
  accountUrl: string;
  bearerToken: string;
  tokenType: SnowflakeSqlAdapterConfig['tokenType'];
  warehouse?: string;
  database?: string;
  schema?: string;
  role?: string;
  statementTimeoutSeconds?: number;
  maxResultBytes?: number;
  requestTimeoutMs?: number;
  pollIntervalMs?: number;
  maxPolls?: number;
  fetchImpl?: typeof fetch;
  wait?: SnowflakeSqlAdapterConfig['wait'];
}

const CAPABILITIES = Object.freeze(Object.values(BRIDGE_CAPABILITIES));

export function createDatabricksBackend(config: DatabricksBackendConfig): BridgeBackend {
  const inventory = prepareInventory(config.allowedObjects, 'databricks');
  const adapter = new DatabricksStatementAdapter({
    workspaceUrl: config.workspaceUrl,
    warehouseId: config.warehouseId,
    bearerToken: config.bearerToken,
    arrowAssembler: new ApacheArrowChunkAssembler(),
    readAuthorizer: createParsedReadAuthorizer({
      dialect: 'databricks',
      allowedTables: inventory.map((entry) => entry.sqlName),
    }),
    ...(config.catalog ? { catalog: config.catalog } : {}),
    ...(config.schema ? { schema: config.schema } : {}),
    ...(config.maxResultBytes ? { maxResultBytes: config.maxResultBytes } : {}),
    ...(config.requestTimeoutMs ? { requestTimeoutMs: config.requestTimeoutMs } : {}),
    ...(config.pollIntervalMs ? { pollIntervalMs: config.pollIntervalMs } : {}),
    ...(config.maxPolls ? { maxPolls: config.maxPolls } : {}),
    ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
    ...(config.wait ? { wait: config.wait } : {}),
  });
  return vendorBackend(
    'databricks-sql-warehouse',
    'databricks',
    inventory,
    config.readOnlyIdentityVerified,
    (request) => adapter.execute(request),
  );
}

export function createSnowflakeBackend(config: SnowflakeBackendConfig): BridgeBackend {
  const inventory = prepareInventory(config.allowedObjects, 'snowflake');
  const adapter = new SnowflakeSqlAdapter({
    accountUrl: config.accountUrl,
    bearerToken: config.bearerToken,
    tokenType: config.tokenType,
    userAgent: 'NakliData-Compute-Bridge/0.1.0',
    jsonV2Encoder: new ApacheArrowJsonV2Encoder(),
    readAuthorizer: createParsedReadAuthorizer({
      dialect: 'snowflake',
      allowedTables: inventory.map((entry) => entry.sqlName),
    }),
    ...(config.warehouse ? { warehouse: config.warehouse } : {}),
    ...(config.database ? { database: config.database } : {}),
    ...(config.schema ? { schema: config.schema } : {}),
    ...(config.role ? { role: config.role } : {}),
    ...(config.statementTimeoutSeconds
      ? { statementTimeoutSeconds: config.statementTimeoutSeconds }
      : {}),
    ...(config.maxResultBytes ? { maxResultBytes: config.maxResultBytes } : {}),
    ...(config.requestTimeoutMs ? { requestTimeoutMs: config.requestTimeoutMs } : {}),
    ...(config.pollIntervalMs ? { pollIntervalMs: config.pollIntervalMs } : {}),
    ...(config.maxPolls ? { maxPolls: config.maxPolls } : {}),
    ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
    ...(config.wait ? { wait: config.wait } : {}),
  });
  return vendorBackend(
    'snowflake-virtual-warehouse',
    'snowflake',
    inventory,
    config.readOnlyIdentityVerified,
    (request) => adapter.execute(request),
  );
}

function vendorBackend(
  id: string,
  source: string,
  inventory: readonly BridgeAllowedObject[],
  readOnlyIdentityVerified: boolean,
  execute: (request: {
    sql: string;
    rowLimit: number;
    signal?: AbortSignal;
  }) => Promise<{ arrow: Uint8Array; rowCount: number }>,
): BridgeBackend {
  const byOpaqueName = new Map(inventory.map((entry) => [entry.table.qualifiedName, entry]));
  const run = async (request: BridgeDirectQueryRequest): Promise<BridgeResult> => {
    return await execute({ sql: request.sql, rowLimit: request.rowLimit, signal: request.signal });
  };
  return {
    id,
    source,
    capabilities: CAPABILITIES,
    security: {
      readOnlyIdentity: readOnlyIdentityVerified,
      objectAllowlist: true,
      downstreamCancellation: true,
    },
    readiness: async () => ({ ready: true, detail: null }),
    listTables: async () => inventory.map((entry) => structuredClone(entry.table)),
    query: run,
    queryTable: async (request: BridgeTableQueryRequest) => {
      const entry = byOpaqueName.get(request.qualifiedName);
      if (!entry) {
        throw new BridgeServerError(
          'Requested warehouse object is outside the bridge inventory.',
          'object_denied',
          403,
        );
      }
      return await run({ ...request, sql: `SELECT * FROM ${entry.sqlName}` });
    },
  };
}

function prepareInventory(
  objects: readonly BridgeAllowedObject[],
  source: string,
): BridgeAllowedObject[] {
  if (objects.length === 0 || objects.length > 1_000) {
    throw new BridgeServerError(
      'Warehouse inventory must contain from 1 to 1,000 objects.',
      'invalid_config',
      503,
    );
  }
  const ids = new Set<string>();
  const sqlNames = new Set<string>();
  return objects.map((entry) => {
    const id = boundedText(entry.table.qualifiedName, 'Warehouse object ID', 512);
    const sqlName = validatedSqlName(entry.sqlName);
    if (ids.has(id) || sqlNames.has(sqlName.toLowerCase())) {
      throw new BridgeServerError(
        'Warehouse inventory contains a duplicate object.',
        'invalid_config',
        503,
      );
    }
    ids.add(id);
    sqlNames.add(sqlName.toLowerCase());
    return {
      sqlName,
      table: {
        name: boundedText(entry.table.name, 'Warehouse object name', 256),
        qualifiedName: id,
        catalog: entry.table.catalog,
        namespace: [...entry.table.namespace],
        kind: entry.table.kind,
        source,
        schema: entry.table.schema.map((column) => ({ ...column })),
      },
    };
  });
}

function validatedSqlName(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_$]*(?:\.[A-Za-z_][A-Za-z0-9_$]*){1,2}$/.test(normalized)) {
    throw new BridgeServerError(
      'Warehouse SQL names must use two- or three-part unquoted identifiers.',
      'invalid_config',
      503,
    );
  }
  return normalized;
}

function boundedText(value: string, label: string, maximum: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new BridgeServerError(`${label} is invalid.`, 'invalid_config', 503);
  }
  return normalized;
}
