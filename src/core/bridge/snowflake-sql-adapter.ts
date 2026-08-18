import { validateReadOnlySql } from '../agent/sql-validator.ts';
import { isSafeBearerToken } from '../bearer-token.ts';
import {
  WAREHOUSE_POLL_INTERVAL_DEFAULT_MS,
  WAREHOUSE_POLL_LIMIT_DEFAULT,
  WAREHOUSE_REQUEST_TIMEOUT_DEFAULT_MS,
  WAREHOUSE_RESULT_BYTES_DEFAULT,
  WarehouseAdapterError,
  type WarehouseAdapterRuntime,
  type WarehouseReadAuthorizer,
  type WarehouseReadRequest,
  arrayValue,
  authorizeWarehouseRead,
  boundedJsonWithSize,
  fetchWithDeadline,
  httpsBaseUrl,
  normalizeWarehouseRead,
  objectValue,
  optionalString,
  positiveInteger,
  requireWarehouseReadAuthorizer,
  safeInteger,
  sameOriginVendorUrl,
  stringValue,
  vendorFailure,
  waitForNextPoll,
} from './warehouse-adapter-core.ts';

export type SnowflakeTokenType = 'KEYPAIR_JWT' | 'OAUTH' | 'PROGRAMMATIC_ACCESS_TOKEN';

export interface SnowflakeJsonColumn {
  name: string;
  type: string;
  nullable: boolean | null;
  precision: number | null;
  scale: number | null;
}

export interface SnowflakeJsonV2Encoder {
  encode(
    columns: readonly SnowflakeJsonColumn[],
    rows: readonly (readonly (string | null)[])[],
  ): Promise<Uint8Array>;
}

export interface SnowflakeSqlAdapterConfig extends WarehouseAdapterRuntime {
  accountUrl: string;
  bearerToken: string;
  tokenType: SnowflakeTokenType;
  userAgent: string;
  warehouse?: string;
  database?: string;
  schema?: string;
  role?: string;
  statementTimeoutSeconds?: number;
  maxResultBytes?: number;
  requestTimeoutMs?: number;
  pollIntervalMs?: number;
  maxPolls?: number;
  jsonV2Encoder: SnowflakeJsonV2Encoder;
  readAuthorizer: WarehouseReadAuthorizer;
}

export interface SnowflakeStatementResult {
  statementHandle: string;
  rowCount: number;
  arrow: Uint8Array;
}

interface PendingStatement {
  handle: string;
  statusUrl: URL;
}

const PENDING_HTTP_STATUSES = new Set([202, 429]);
const TOKEN_TYPES = new Set<SnowflakeTokenType>([
  'KEYPAIR_JWT',
  'OAUTH',
  'PROGRAMMATIC_ACCESS_TOKEN',
]);

/**
 * Dependency-free protocol core for a future server-side Snowflake Compute
 * Bridge adapter. Authentication, Arrow encoding, and HTTP serving remain
 * deployment concerns; this class owns the bounded read state machine.
 */
export class SnowflakeSqlAdapter {
  private readonly base: URL;
  private readonly token: string;
  private readonly tokenType: SnowflakeTokenType;
  private readonly userAgent: string;
  private readonly warehouse: string | null;
  private readonly database: string | null;
  private readonly schema: string | null;
  private readonly role: string | null;
  private readonly statementTimeoutSeconds: number;
  private readonly maxResultBytes: number;
  private readonly requestTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly maxPolls: number;
  private readonly fetchImpl: typeof fetch;
  private readonly runtime: WarehouseAdapterRuntime;
  private readonly encoder: SnowflakeJsonV2Encoder;
  private readonly readAuthorizer: WarehouseReadAuthorizer;

  constructor(config: SnowflakeSqlAdapterConfig) {
    this.base = httpsBaseUrl(config.accountUrl, 'Snowflake account URL');
    this.token = requiredToken(config.bearerToken);
    if (!TOKEN_TYPES.has(config.tokenType)) {
      throw new WarehouseAdapterError(
        'Snowflake authorization token type is unsupported.',
        'invalid_config',
      );
    }
    this.tokenType = config.tokenType;
    this.userAgent = requiredHeader(config.userAgent, 'Snowflake User-Agent');
    this.warehouse = optionalConfig(config.warehouse);
    this.database = optionalConfig(config.database);
    this.schema = optionalConfig(config.schema);
    this.role = optionalConfig(config.role);
    this.statementTimeoutSeconds = boundedPositiveInteger(
      config.statementTimeoutSeconds,
      60,
      'Snowflake statement timeout',
      604_800,
    );
    this.maxResultBytes = positiveInteger(
      config.maxResultBytes,
      WAREHOUSE_RESULT_BYTES_DEFAULT,
      'Snowflake result byte limit',
    );
    this.requestTimeoutMs = positiveInteger(
      config.requestTimeoutMs,
      WAREHOUSE_REQUEST_TIMEOUT_DEFAULT_MS,
      'Snowflake request timeout',
    );
    this.pollIntervalMs = positiveInteger(
      config.pollIntervalMs,
      WAREHOUSE_POLL_INTERVAL_DEFAULT_MS,
      'Snowflake poll interval',
    );
    this.maxPolls = positiveInteger(
      config.maxPolls,
      WAREHOUSE_POLL_LIMIT_DEFAULT,
      'Snowflake poll limit',
    );
    this.fetchImpl = config.fetchImpl ?? fetch.bind(globalThis);
    this.runtime = { ...(config.wait ? { wait: config.wait } : {}) };
    this.encoder = config.jsonV2Encoder;
    this.readAuthorizer = requireWarehouseReadAuthorizer(config.readAuthorizer);
  }

  toJSON(): Record<string, unknown> {
    return {
      adapter: 'snowflake-sql-api',
      accountOrigin: this.base.origin,
      tokenType: this.tokenType,
      warehouseConfigured: this.warehouse !== null,
      databaseConfigured: this.database !== null,
      schemaConfigured: this.schema !== null,
      roleConfigured: this.role !== null,
      maxResultBytes: this.maxResultBytes,
    };
  }

  async execute(request: WarehouseReadRequest): Promise<SnowflakeStatementResult> {
    const { sql, rowLimit } = normalizeWarehouseRead(request);
    const validation = validateReadOnlySql(sql);
    if (!validation.ok || !isSnowflakeWrappableRead(sql)) {
      throw new WarehouseAdapterError(
        validation.ok
          ? 'Snowflake bounded reads must begin with SELECT or WITH.'
          : validation.reason,
        'unsafe_query',
      );
    }
    authorizeWarehouseRead(this.readAuthorizer, sql, [this.token]);

    let pending: PendingStatement | null = null;
    let terminal = false;
    try {
      let response = await this.request(
        '/api/v2/statements?async=true',
        {
          method: 'POST',
          headers: this.headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            statement: boundedSql(sql, rowLimit),
            timeout: this.statementTimeoutSeconds,
            parameters: { MULTI_STATEMENT_COUNT: '1' },
            ...(this.warehouse ? { warehouse: this.warehouse } : {}),
            ...(this.database ? { database: this.database } : {}),
            ...(this.schema ? { schema: this.schema } : {}),
            ...(this.role ? { role: this.role } : {}),
          }),
        },
        request.signal,
      );

      for (let poll = 0; ; poll++) {
        const payload = await boundedJsonWithSize(response, this.maxResultBytes);
        const body = payload.value;
        if (response.status === 200) {
          terminal = true;
          const handle = statementHandle(body, pending?.handle);
          return await this.collectResult(
            body,
            handle,
            rowLimit,
            payload.byteLength,
            request.signal,
          );
        }
        if (response.status === 422) {
          terminal = true;
          throw vendorFailure(body, 422, 'Snowflake statement failed.', 'query_failed', [
            this.token,
          ]);
        }
        if (response.status === 408) {
          terminal = true;
          throw vendorFailure(
            body,
            408,
            'Snowflake statement exceeded its timeout and was cancelled.',
            'timeout',
            [this.token],
          );
        }
        if (!PENDING_HTTP_STATUSES.has(response.status)) {
          const code =
            response.status === 401
              ? 'credential_rejected'
              : response.status === 403
                ? 'authorization_denied'
                : 'vendor_error';
          throw vendorFailure(
            body,
            response.status,
            `Snowflake SQL API returned HTTP ${response.status}.`,
            code,
            [this.token],
          );
        }
        const pendingBody = objectValue(body, 'Snowflake pending response');
        if (
          response.status === 429 &&
          (!optionalString(pendingBody.statementHandle) ||
            !optionalString(pendingBody.statementStatusUrl))
        ) {
          throw vendorFailure(body, 429, 'Snowflake SQL API rate limit exceeded.', 'rate_limited', [
            this.token,
          ]);
        }
        rejectMultipleStatements(pendingBody);
        const handle = statementHandle(pendingBody, pending?.handle);
        // Establish a safe cancellation target before validating vendor control
        // data, so a malformed status URL cannot leave compute running.
        pending = {
          handle,
          statusUrl: sameOriginVendorUrl(
            this.base,
            `/api/v2/statements/${encodeURIComponent(handle)}`,
            'Snowflake statement status URL',
          ),
        };
        pending = {
          handle,
          statusUrl: sameOriginVendorUrl(
            this.base,
            stringValue(pendingBody.statementStatusUrl, 'Snowflake statementStatusUrl'),
            'Snowflake statement status URL',
          ),
        };
        if (poll >= this.maxPolls) {
          throw new WarehouseAdapterError(
            'Snowflake statement exceeded the bounded poll limit.',
            'poll_limit',
          );
        }
        await waitForNextPoll(this.runtime, this.pollIntervalMs, request.signal);
        response = await this.request(
          pending.statusUrl,
          { method: 'GET', headers: this.headers() },
          request.signal,
        );
      }
    } catch (error) {
      const normalized =
        error instanceof WarehouseAdapterError
          ? error
          : new WarehouseAdapterError('Snowflake adapter failed.', 'adapter_error');
      if (pending && !terminal) {
        try {
          await this.cancelToTerminal(pending);
        } catch (cancelError) {
          throw new WarehouseAdapterError(
            `Snowflake statement cancellation could not be confirmed: ${
              cancelError instanceof Error ? cancelError.message : String(cancelError)
            }`,
            'cancellation_unconfirmed',
          );
        }
      }
      throw normalized;
    }
  }

  private async collectResult(
    value: unknown,
    handle: string,
    rowLimit: number,
    initialResponseBytes: number,
    signal?: AbortSignal,
  ): Promise<SnowflakeStatementResult> {
    const body = objectValue(value, 'Snowflake result');
    rejectMultipleStatements(body);
    const metadata = objectValue(body.resultSetMetaData, 'Snowflake resultSetMetaData');
    if (stringValue(metadata.format, 'Snowflake result format').toLowerCase() !== 'jsonv2') {
      throw new WarehouseAdapterError('Snowflake result must use JSONv2.', 'protocol_mismatch');
    }
    const rowCount = safeInteger(metadata.numRows, 'Snowflake result numRows');
    if (rowCount > rowLimit) {
      throw new WarehouseAdapterError(
        'Snowflake result exceeds the requested row boundary.',
        'result_limit',
      );
    }
    const columns = parseColumns(metadata.rowType);
    const partitions = parsePartitions(metadata.partitionInfo, rowCount);
    const declaredBytes = partitions.reduce(
      (sum, partition) => sum + partition.uncompressedSize,
      0,
    );
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > this.maxResultBytes) {
      throw new WarehouseAdapterError(
        'Snowflake result exceeds the configured byte boundary.',
        'result_limit',
      );
    }
    const rows: (string | null)[][] = [];
    let actualResponseBytes = initialResponseBytes;
    appendRows(rows, body.data, columns.length, partitions[0]?.rowCount ?? rowCount);

    for (let index = 1; index < partitions.length; index++) {
      const remainingBytes = this.maxResultBytes - actualResponseBytes;
      if (remainingBytes < 1) {
        throw new WarehouseAdapterError(
          'Snowflake result exceeds the configured byte boundary.',
          'result_limit',
        );
      }
      const partitionUrl = sameOriginVendorUrl(
        this.base,
        `/api/v2/statements/${encodeURIComponent(handle)}`,
        'Snowflake partition URL',
      );
      partitionUrl.searchParams.set('partition', String(index));
      const response = await this.request(
        partitionUrl,
        { method: 'GET', headers: this.headers() },
        signal,
      );
      const partitionPayload = await boundedJsonWithSize(response, remainingBytes);
      actualResponseBytes += partitionPayload.byteLength;
      const partitionBody = partitionPayload.value;
      if (!response.ok) {
        throw vendorFailure(
          partitionBody,
          response.status,
          `Snowflake partition ${index} failed.`,
          'result_download_failed',
          [this.token],
        );
      }
      const partitionObject = objectValue(partitionBody, `Snowflake partition ${index}`);
      rejectMultipleStatements(partitionObject);
      appendRows(rows, partitionObject.data, columns.length, partitions[index]?.rowCount ?? 0);
    }
    if (rows.length !== rowCount) {
      throw new WarehouseAdapterError(
        'Snowflake result row count is inconsistent.',
        'protocol_mismatch',
      );
    }
    const arrow = await this.encoder.encode(columns, rows);
    if (
      !(arrow instanceof Uint8Array) ||
      arrow.byteLength < 1 ||
      arrow.byteLength > this.maxResultBytes
    ) {
      throw new WarehouseAdapterError(
        'Snowflake JSONv2 encoder returned an invalid result.',
        'invalid_result',
      );
    }
    return { statementHandle: handle, rowCount, arrow };
  }

  private async cancelToTerminal(pending: PendingStatement): Promise<void> {
    const cancelUrl = sameOriginVendorUrl(
      this.base,
      `/api/v2/statements/${encodeURIComponent(pending.handle)}/cancel`,
      'Snowflake cancel URL',
    );
    await this.request(cancelUrl, {
      method: 'POST',
      headers: this.headers(),
    }).catch(() => undefined);

    for (let poll = 0; poll <= this.maxPolls; poll++) {
      const response = await this.request(pending.statusUrl, {
        method: 'GET',
        headers: this.headers(),
      });
      if (response.status === 200 || response.status === 408 || response.status === 422) return;
      if (!PENDING_HTTP_STATUSES.has(response.status)) {
        throw new WarehouseAdapterError(
          `Snowflake cancellation status returned HTTP ${response.status}.`,
          'cancellation_unconfirmed',
          response.status,
        );
      }
      if (poll === this.maxPolls) break;
      await waitForNextPoll(this.runtime, this.pollIntervalMs);
    }
    throw new WarehouseAdapterError(
      'Snowflake cancellation did not reach a terminal state.',
      'cancellation_unconfirmed',
    );
  }

  private headers(extras: Readonly<Record<string, string>> = {}): Record<string, string> {
    return {
      Accept: 'application/json',
      Authorization: `Bearer ${this.token}`,
      'User-Agent': this.userAgent,
      'X-Snowflake-Authorization-Token-Type': this.tokenType,
      ...extras,
    };
  }

  private async request(
    path: string | URL,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<Response> {
    const url =
      path instanceof URL
        ? sameOriginVendorUrl(this.base, path.href, 'Snowflake API link')
        : sameOriginVendorUrl(this.base, path, 'Snowflake API path');
    return await fetchWithDeadline(this.fetchImpl, url, init, this.requestTimeoutMs, signal);
  }
}

function boundedSql(sql: string, rowLimit: number): string {
  return `SELECT * FROM (${sql}) AS "__naklidata_bounded" LIMIT ${rowLimit}`;
}

function isSnowflakeWrappableRead(sql: string): boolean {
  const withoutComments = sql.replace(/^(?:\s|--[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)*/, '');
  return /^(?:select|with)\b/i.test(withoutComments);
}

function statementHandle(value: unknown, expected?: string): string {
  const body = objectValue(value, 'Snowflake statement response');
  rejectMultipleStatements(body);
  const handle = optionalString(body.statementHandle) ?? expected;
  if (!handle) {
    throw new WarehouseAdapterError('Snowflake statement handle is missing.', 'protocol_mismatch');
  }
  if (expected && handle !== expected) {
    throw new WarehouseAdapterError(
      'Snowflake statement handle changed while polling.',
      'protocol_mismatch',
    );
  }
  return handle;
}

function rejectMultipleStatements(body: Record<string, unknown>): void {
  if (body.statementHandles !== undefined) {
    throw new WarehouseAdapterError(
      'Snowflake returned multiple statement handles.',
      'protocol_mismatch',
    );
  }
}

function parseColumns(value: unknown): SnowflakeJsonColumn[] {
  return arrayValue(value, 'Snowflake rowType').map((entry) => {
    const column = objectValue(entry, 'Snowflake rowType column');
    return {
      name: stringValue(column.name, 'Snowflake column name'),
      type: stringValue(column.type, 'Snowflake column type'),
      nullable: nullableBoolean(column.nullable, 'Snowflake column nullable'),
      precision: nullableInteger(column.precision, 'Snowflake column precision'),
      scale: nullableInteger(column.scale, 'Snowflake column scale'),
    };
  });
}

function parsePartitions(
  value: unknown,
  totalRows: number,
): { rowCount: number; uncompressedSize: number }[] {
  const partitions = arrayValue(value, 'Snowflake partitionInfo').map((entry) => {
    const partition = objectValue(entry, 'Snowflake partition');
    return {
      rowCount: safeInteger(partition.rowCount, 'Snowflake partition rowCount'),
      uncompressedSize: safeInteger(
        partition.uncompressedSize,
        'Snowflake partition uncompressedSize',
      ),
    };
  });
  if (partitions.length === 0) {
    if (totalRows === 0) return [{ rowCount: 0, uncompressedSize: 0 }];
    throw new WarehouseAdapterError(
      'Snowflake partition metadata is missing.',
      'protocol_mismatch',
    );
  }
  const partitionRows = partitions.reduce((sum, partition) => sum + partition.rowCount, 0);
  if (partitionRows !== totalRows) {
    throw new WarehouseAdapterError(
      'Snowflake partition row counts are inconsistent.',
      'protocol_mismatch',
    );
  }
  return partitions;
}

function appendRows(
  output: (string | null)[][],
  value: unknown,
  width: number,
  expectedRows: number,
): void {
  const rows = arrayValue(value, 'Snowflake data');
  if (rows.length !== expectedRows) {
    throw new WarehouseAdapterError(
      'Snowflake partition row count is inconsistent.',
      'protocol_mismatch',
    );
  }
  for (const value of rows) {
    const row = arrayValue(value, 'Snowflake data row');
    if (row.length !== width || row.some((cell) => cell !== null && typeof cell !== 'string')) {
      throw new WarehouseAdapterError(
        'Snowflake JSONv2 rows must contain one string-or-null value per column.',
        'protocol_mismatch',
      );
    }
    output.push(row as (string | null)[]);
  }
}

function nullableBoolean(value: unknown, path: string): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'boolean') {
    throw new WarehouseAdapterError(`${path} must be a boolean.`, 'protocol_mismatch');
  }
  return value;
}

function nullableInteger(value: unknown, path: string): number | null {
  if (value === undefined || value === null) return null;
  return safeInteger(value, path);
}

function requiredConfig(value: string, label: string): string {
  if (!value.trim()) {
    throw new WarehouseAdapterError(`${label} is required.`, 'invalid_config');
  }
  return value.trim();
}

function requiredHeader(value: string, label: string): string {
  const normalized = requiredConfig(value, label);
  if (!/^[\x20-\x7e]+$/.test(normalized)) {
    throw new WarehouseAdapterError(
      `${label} must contain printable ASCII without line breaks.`,
      'invalid_config',
    );
  }
  return normalized;
}

function boundedPositiveInteger(
  value: number | undefined,
  fallback: number,
  label: string,
  maximum: number,
): number {
  const normalized = positiveInteger(value, fallback, label);
  if (normalized > maximum) {
    throw new WarehouseAdapterError(`${label} must not exceed ${maximum}.`, 'invalid_config');
  }
  return normalized;
}

function optionalConfig(value: string | undefined): string | null {
  return value?.trim() || null;
}

function requiredToken(value: string): string {
  if (!value || !isSafeBearerToken(value)) {
    throw new WarehouseAdapterError(
      'Snowflake bearer token is required and must be a safe bearer token.',
      'invalid_config',
    );
  }
  return value;
}
