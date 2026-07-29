import { assertSafeBearerToken } from '../bearer-token.ts';
import { readBoundedBytes, readBoundedJson, requireContentType } from '../remote-response.ts';
import { redactSecrets } from '../sidecar/providers/redact.ts';
import { BRIDGE_QUERY_ROW_CAP_DEFAULT, BRIDGE_QUERY_ROW_CAP_MAX } from './protocol.ts';

export const WAREHOUSE_CONTROL_BYTES_MAX = 2 * 1024 * 1024;
export const WAREHOUSE_RESULT_BYTES_DEFAULT = 256 * 1024 * 1024;
export const WAREHOUSE_REQUEST_TIMEOUT_DEFAULT_MS = 30_000;
export const WAREHOUSE_POLL_LIMIT_DEFAULT = 120;
export const WAREHOUSE_POLL_INTERVAL_DEFAULT_MS = 1_000;

export interface WarehouseReadRequest {
  sql: string;
  rowLimit?: number;
  signal?: AbortSignal;
}

export interface WarehouseAdapterRuntime {
  fetchImpl?: typeof fetch;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export class WarehouseAdapterError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 0) {
    super(redactSecrets(message).slice(0, 320));
    this.name = 'WarehouseAdapterError';
    this.code = code;
    this.status = status;
  }
}

export function normalizeWarehouseRead(request: WarehouseReadRequest): {
  sql: string;
  rowLimit: number;
} {
  const sql = request.sql.trim().replace(/;+\s*$/, '');
  if (!sql) throw new WarehouseAdapterError('Warehouse SQL is required.', 'invalid_query');
  const rowLimit = request.rowLimit ?? BRIDGE_QUERY_ROW_CAP_DEFAULT;
  if (!Number.isSafeInteger(rowLimit) || rowLimit < 1 || rowLimit > BRIDGE_QUERY_ROW_CAP_MAX) {
    throw new WarehouseAdapterError(
      `Warehouse row limit must be an integer from 1 to ${BRIDGE_QUERY_ROW_CAP_MAX}.`,
      'invalid_query',
    );
  }
  return { sql, rowLimit };
}

export function httpsBaseUrl(raw: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WarehouseAdapterError(`${label} must be a valid HTTPS URL.`, 'invalid_config');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '' && url.pathname !== '/')
  ) {
    throw new WarehouseAdapterError(`${label} must be an HTTPS origin URL.`, 'invalid_config');
  }
  url.pathname = '/';
  return url;
}

export function sameOriginVendorUrl(base: URL, path: string, label: string): URL {
  let resolved: URL;
  try {
    resolved = new URL(path, base);
  } catch {
    throw new WarehouseAdapterError(`${label} is not a valid URL.`, 'protocol_mismatch');
  }
  if (
    resolved.origin !== base.origin ||
    resolved.protocol !== 'https:' ||
    resolved.username ||
    resolved.password ||
    resolved.hash
  ) {
    throw new WarehouseAdapterError(
      `${label} must stay on the configured warehouse origin.`,
      'protocol_mismatch',
    );
  }
  return resolved;
}

export function bearerHeaders(
  token: string,
  extras: Readonly<Record<string, string>> = {},
): Record<string, string> {
  assertSafeBearerToken(token);
  return { Accept: 'application/json', Authorization: `Bearer ${token}`, ...extras };
}

export async function fetchWithDeadline(
  fetchImpl: typeof fetch,
  url: URL | string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromExternal = () => controller.abort('caller cancelled');
  if (externalSignal?.aborted) abortFromExternal();
  else externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
  const timer = setTimeout(
    () => {
      timedOut = true;
      controller.abort('warehouse deadline exceeded');
    },
    positiveInteger(timeoutMs, WAREHOUSE_REQUEST_TIMEOUT_DEFAULT_MS, 'request timeout'),
  );
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new WarehouseAdapterError(
        timedOut ? 'Warehouse request deadline exceeded.' : 'Warehouse request cancelled.',
        timedOut ? 'timeout' : 'cancelled',
      );
    }
    // Fetch errors can contain the request URL. Some result URLs are signed
    // bearer capabilities, so never reflect the underlying message.
    throw new WarehouseAdapterError('Warehouse network request failed.', 'network_error');
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', abortFromExternal);
  }
}

export async function boundedJson(
  response: Response,
  maxBytes = WAREHOUSE_CONTROL_BYTES_MAX,
): Promise<unknown> {
  try {
    return await readBoundedJson(response, maxBytes);
  } catch (error) {
    throw new WarehouseAdapterError(
      `Warehouse JSON response rejected: ${error instanceof Error ? error.message : String(error)}`,
      'protocol_mismatch',
      response.status,
    );
  }
}

export async function boundedArrowBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  try {
    requireContentType(response, [
      'application/vnd.apache.arrow.stream',
      'application/octet-stream',
    ]);
    return await readBoundedBytes(response, maxBytes);
  } catch (error) {
    throw new WarehouseAdapterError(
      `Warehouse Arrow response rejected: ${error instanceof Error ? error.message : String(error)}`,
      'invalid_result',
      response.status,
    );
  }
}

export function vendorFailure(
  body: unknown,
  status: number,
  fallback: string,
  code = 'vendor_error',
): WarehouseAdapterError {
  const object = optionalObject(body);
  const statusObject = optionalObject(object?.status);
  const errorObject = optionalObject(statusObject?.error) ?? optionalObject(object?.error);
  const message =
    optionalString(errorObject?.message) ??
    optionalString(object?.message) ??
    optionalString(object?.detail) ??
    fallback;
  return new WarehouseAdapterError(message, code, status);
}

export function objectValue(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WarehouseAdapterError(`${path} must be an object.`, 'protocol_mismatch');
  }
  return value as Record<string, unknown>;
}

export function arrayValue(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new WarehouseAdapterError(`${path} must be an array.`, 'protocol_mismatch');
  }
  return value;
}

export function stringValue(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new WarehouseAdapterError(`${path} must be a non-empty string.`, 'protocol_mismatch');
  }
  return value;
}

export function safeInteger(value: unknown, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new WarehouseAdapterError(`${path} must be a safe integer.`, 'protocol_mismatch');
  }
  return value as number;
}

export function positiveInteger(
  value: number | undefined,
  fallback: number,
  label: string,
): number {
  const normalized = value ?? fallback;
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw new WarehouseAdapterError(`${label} must be a positive integer.`, 'invalid_config');
  }
  return normalized;
}

export function optionalObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export async function waitForNextPoll(
  runtime: WarehouseAdapterRuntime,
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (runtime.wait) {
    await runtime.wait(milliseconds, signal);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new WarehouseAdapterError('Warehouse request cancelled.', 'cancelled'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new WarehouseAdapterError('Warehouse request cancelled.', 'cancelled'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
