import { assertSafeBearerToken } from '../core/bearer-token.ts';
import {
  BRIDGE_PROTOCOL_ID,
  BRIDGE_PROTOCOL_VERSION,
  type BridgeColumn,
  BridgeError,
  type BridgeHealth,
  type BridgeHealthOptions,
  type BridgeRequestOptions,
  type BridgeTable,
} from '../core/bridge/protocol.ts';
import {
  RemoteResponseError,
  readBoundedBytes,
  readBoundedJson,
  readBoundedText,
  requireContentType,
} from '../core/remote-response.ts';
import { redactSecrets } from '../core/sidecar/providers/redact.ts';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_JSON_LIMIT = 2 * 1024 * 1024;
const DEFAULT_ARROW_LIMIT = 256 * 1024 * 1024;
const ERROR_BODY_LIMIT = 16 * 1024;

export interface BridgeClientOptions {
  bridgeUrl: string;
  bearerToken: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxJsonBytes?: number;
  maxArrowBytes?: number;
}

export { BridgeError } from '../core/bridge/protocol.ts';
export type {
  BridgeColumn,
  BridgeHealth,
  BridgeHealthOptions,
  BridgeRequestOptions,
  BridgeTable,
} from '../core/bridge/protocol.ts';

export class BridgeClient {
  private readonly bridgeUrl: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxJsonBytes: number;
  private readonly maxArrowBytes: number;

  constructor(opts: BridgeClientOptions) {
    if (!opts.bridgeUrl.trim()) throw new Error('Bridge URL is required.');
    this.bridgeUrl = opts.bridgeUrl.trim().replace(/\/+$/, '');
    this.headers = { Accept: 'application/json' };
    if (opts.bearerToken) {
      assertSafeBearerToken(opts.bearerToken);
      this.headers.Authorization = `Bearer ${opts.bearerToken}`;
    }
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
    this.timeoutMs = positiveLimit(opts.timeoutMs, DEFAULT_TIMEOUT_MS);
    this.maxJsonBytes = positiveLimit(opts.maxJsonBytes, DEFAULT_JSON_LIMIT);
    this.maxArrowBytes = positiveLimit(opts.maxArrowBytes, DEFAULT_ARROW_LIMIT);
  }

  async health(options: BridgeHealthOptions = {}): Promise<BridgeHealth> {
    const data = objectValue(await this.getJson('/v1/health', options), 'Bridge health response');
    const protocol = stringValue(data.protocol, 'protocol');
    const protocolVersion = numberValue(
      data.protocol_version ?? data.protocolVersion,
      'protocol_version',
    );
    if (protocol !== BRIDGE_PROTOCOL_ID || protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
      throw new BridgeError(
        `Unsupported bridge protocol ${protocol}@${protocolVersion}; expected ${BRIDGE_PROTOCOL_ID}@${BRIDGE_PROTOCOL_VERSION}.`,
        200,
        'protocol_mismatch',
      );
    }
    const auth = stringValue(data.auth, 'auth');
    if (auth !== 'bearer' && auth !== 'oauth2' && auth !== 'none') {
      throw new BridgeError(`Unsupported bridge auth mode "${auth}".`, 200, 'protocol_mismatch');
    }
    const capabilities = stringArray(data.capabilities, 'capabilities');
    const missing = (options.requiredCapabilities ?? []).filter(
      (capability) => !capabilities.includes(capability),
    );
    if (missing.length) {
      throw new BridgeError(
        `Bridge is missing required capability: ${missing.join(', ')}.`,
        200,
        'missing_capability',
      );
    }
    return {
      protocol: BRIDGE_PROTOCOL_ID,
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      name: stringValue(data.name, 'name'),
      version: stringValue(data.version, 'version'),
      auth,
      singleTenant: booleanValue(data.single_tenant ?? data.singleTenant, 'single_tenant'),
      capabilities,
    };
  }

  async listTables(options: BridgeRequestOptions = {}): Promise<BridgeTable[]> {
    const data = objectValue(await this.getJson('/v1/tables', options), 'Bridge catalog response');
    if (!Array.isArray(data.tables)) {
      throw new BridgeError('Bridge catalog response is missing tables[].', 200, 'invalid_catalog');
    }
    return data.tables.map((value, index) => parseTable(value, index));
  }

  async query(sql: string, options: BridgeRequestOptions = {}): Promise<ArrayBuffer> {
    if (!sql.trim()) throw new BridgeError('Bridge query SQL is required.', 0, 'invalid_query');
    return await this.withResponse(
      '/v1/query',
      {
        method: 'POST',
        headers: { ...this.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: sql.trim() }),
        ...signalInit(options.signal),
      },
      async (response) => {
        if (!response.ok) throw await this.toBridgeError(response);
        try {
          requireContentType(response, ['application/vnd.apache.arrow.stream']);
          const bytes = await readBoundedBytes(response, this.maxArrowBytes);
          return Uint8Array.from(bytes).buffer as ArrayBuffer;
        } catch (error) {
          throw this.responseError(error, response.status);
        }
      },
    );
  }

  private async getJson(path: string, options: BridgeRequestOptions): Promise<unknown> {
    return await this.withResponse(
      path,
      {
        method: 'GET',
        headers: this.headers,
        ...signalInit(options.signal),
      },
      async (response) => {
        if (!response.ok) throw await this.toBridgeError(response);
        try {
          return await readBoundedJson(response, this.maxJsonBytes);
        } catch (error) {
          throw this.responseError(error, response.status);
        }
      },
    );
  }

  private async withResponse<T>(
    path: string,
    init: RequestInit,
    consume: (response: Response) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const external = init.signal;
    let timedOut = false;
    const abortFromExternal = () => controller.abort(external?.reason);
    if (external?.aborted) abortFromExternal();
    else external?.addEventListener('abort', abortFromExternal, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort('deadline exceeded');
    }, this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.bridgeUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });
      return await consume(response);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new BridgeError(
          timedOut ? `Bridge request exceeded ${this.timeoutMs} ms.` : 'Bridge request cancelled.',
          0,
          timedOut ? 'timeout' : 'cancelled',
        );
      }
      if (error instanceof BridgeError) throw error;
      throw new BridgeError(
        `Bridge network error: ${error instanceof Error ? error.message : String(error)}`,
        0,
        'network_error',
      );
    } finally {
      clearTimeout(timer);
      external?.removeEventListener('abort', abortFromExternal);
    }
  }

  private responseError(error: unknown, status: number): BridgeError {
    if (error instanceof BridgeError) return error;
    if (error instanceof RemoteResponseError) {
      return new BridgeError(`Bridge response rejected: ${error.message}`, status, error.code);
    }
    return new BridgeError(
      `Bridge response failed: ${error instanceof Error ? error.message : String(error)}`,
      status,
      'bridge_error',
    );
  }

  private async toBridgeError(response: Response): Promise<BridgeError> {
    let code = 'bridge_error';
    let message = `Bridge ${response.status}: ${response.statusText || 'request failed'}`;
    try {
      const text = await readBoundedText(response, ERROR_BODY_LIMIT);
      if (text) {
        try {
          const body = JSON.parse(text) as { error?: { code?: unknown; message?: unknown } };
          if (typeof body.error?.code === 'string') code = body.error.code;
          if (typeof body.error?.message === 'string' && body.error.message.trim()) {
            message = `Bridge ${response.status}: ${redactSecrets(body.error.message.slice(0, 240))}`;
          }
        } catch {
          message = `Bridge ${response.status}: ${redactSecrets(text.slice(0, 240)) || response.statusText}`;
        }
      }
    } catch {
      // Keep the status-only error when the body cannot be read safely.
    }
    return new BridgeError(message, response.status, code);
  }
}

function parseTable(value: unknown, index: number): BridgeTable {
  const table = objectValue(value, `tables[${index}]`);
  const name = stringValue(table.name, `tables[${index}].name`);
  const catalog =
    table.catalog === null || table.catalog === undefined
      ? null
      : stringValue(table.catalog, `tables[${index}].catalog`);
  const namespace = parseNamespace(table.namespace, `tables[${index}].namespace`);
  const kindValue = table.kind ?? 'table';
  if (kindValue !== 'table' && kindValue !== 'view') {
    throw new BridgeError(
      `Bridge catalog tables[${index}].kind must be "table" or "view".`,
      200,
      'invalid_catalog',
    );
  }
  const source =
    table.source === null || table.source === undefined
      ? null
      : stringValue(table.source, `tables[${index}].source`);
  const schemaValue = table.schema ?? [];
  if (!Array.isArray(schemaValue)) {
    throw new BridgeError(
      `Bridge catalog tables[${index}].schema must be an array.`,
      200,
      'invalid_catalog',
    );
  }
  const schema: BridgeColumn[] = schemaValue.map((value, columnIndex) => {
    const column = objectValue(value, `tables[${index}].schema[${columnIndex}]`);
    return {
      name: stringValue(column.name, `tables[${index}].schema[${columnIndex}].name`),
      type: stringValue(column.type, `tables[${index}].schema[${columnIndex}].type`),
    };
  });
  const derived = [...(catalog ? [catalog] : []), ...namespace, name].join('.');
  const qualifiedName =
    table.qualified_name === undefined && table.qualifiedName === undefined
      ? derived
      : stringValue(table.qualified_name ?? table.qualifiedName, `tables[${index}].qualified_name`);
  return { name, qualifiedName, catalog, namespace, kind: kindValue, source, schema };
}

function parseNamespace(value: unknown, path: string): string[] {
  if (value === null || value === undefined || value === '') return [];
  if (typeof value === 'string') {
    return value
      .split('.')
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return stringArray(value, path);
}

function objectValue(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BridgeError(`${path} must be an object.`, 200, 'protocol_mismatch');
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BridgeError(
      `Bridge response ${path} must be a non-empty string.`,
      200,
      'protocol_mismatch',
    );
  }
  return value.trim();
}

function numberValue(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new BridgeError(`Bridge response ${path} must be an integer.`, 200, 'protocol_mismatch');
  }
  return value;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new BridgeError(`Bridge response ${path} must be boolean.`, 200, 'protocol_mismatch');
  }
  return value;
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new BridgeError(
      `Bridge response ${path} must be an array of strings.`,
      200,
      'protocol_mismatch',
    );
  }
  return value.map((item) => (item as string).trim());
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function signalInit(signal: AbortSignal | undefined): Pick<RequestInit, 'signal'> | object {
  return signal ? { signal } : {};
}
