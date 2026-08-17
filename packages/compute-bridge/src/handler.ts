import {
  BRIDGE_CAPABILITIES,
  BRIDGE_PROTOCOL_ID,
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_QUERY_ROW_CAP_DEFAULT,
  type BridgeTable,
} from '../../../src/core/bridge/protocol.ts';
import { WarehouseAdapterError } from '../../../src/core/bridge/warehouse-adapter-core.ts';
import { requireBearer } from './auth.ts';
import { type BridgeBackend, BridgeServerError } from './backend.ts';
import type { BridgeRuntimeConfig } from './config.ts';

interface AuditEvent {
  event: 'bridge_request';
  requestId: string;
  method: string;
  route: string;
  status: number;
  durationMs: number;
  adapter: string;
}

export interface BridgeHandlerOptions {
  config: BridgeRuntimeConfig;
  backend: BridgeBackend | null;
  audit?: (event: AuditEvent) => void;
}

export interface BridgeHandler {
  fetch(request: Request): Promise<Response>;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' } as const;
const ARROW_CONTENT_TYPE = 'application/vnd.apache.arrow.stream';

export function createBridgeHandler(options: BridgeHandlerOptions): BridgeHandler {
  return {
    async fetch(request: Request): Promise<Response> {
      const requestId = crypto.randomUUID();
      const started = performance.now();
      const url = new URL(request.url);
      let status = 500;
      try {
        const response = await routeRequest(request, url, requestId, options);
        status = response.status;
        return secureResponse(response, request, options.config.allowedOrigins, requestId);
      } catch (error) {
        const normalized = normalizeError(error, request.signal);
        status = normalized.status;
        return secureResponse(
          json(
            {
              error: { code: normalized.code, message: normalized.message },
              request_id: requestId,
            },
            normalized.status,
          ),
          request,
          options.config.allowedOrigins,
          requestId,
        );
      } finally {
        const event: AuditEvent = {
          event: 'bridge_request',
          requestId,
          method: request.method,
          route: url.pathname,
          status,
          durationMs: Math.max(0, Math.round(performance.now() - started)),
          adapter: options.backend?.id ?? 'unconfigured',
        };
        if (options.audit) options.audit(event);
        else console.log(JSON.stringify(event));
      }
    },
  };
}

async function routeRequest(
  request: Request,
  url: URL,
  requestId: string,
  options: BridgeHandlerOptions,
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    assertAllowedOrigin(request, options.config.allowedOrigins);
    return new Response(null, { status: 204 });
  }
  assertAllowedOrigin(request, options.config.allowedOrigins);
  await requireBearer(request, options.config.authToken);

  if (url.pathname === '/v1/health' && request.method === 'GET') {
    const readiness = await withDeadline(
      request.signal,
      options.config.maxQueryMilliseconds,
      (signal) => backendReadiness(options.backend, signal),
    );
    return json({
      protocol: BRIDGE_PROTOCOL_ID,
      protocol_version: BRIDGE_PROTOCOL_VERSION,
      name: options.config.name,
      version: options.config.version,
      auth: 'bearer',
      single_tenant: true,
      capabilities: readiness.ready ? (options.backend?.capabilities ?? []) : [],
      ready: readiness.ready,
      adapter: options.backend?.id ?? null,
    });
  }

  if (url.pathname === '/v1/ready' && request.method === 'GET') {
    const readiness = await withDeadline(
      request.signal,
      options.config.maxQueryMilliseconds,
      (signal) => backendReadiness(options.backend, signal),
    );
    return json(
      {
        ready: readiness.ready,
        adapter: options.backend?.id ?? null,
        detail: readiness.detail,
        limits: {
          max_request_bytes: options.config.maxRequestBytes,
          max_result_bytes: options.config.maxResultBytes,
          max_query_milliseconds: options.config.maxQueryMilliseconds,
          max_row_limit: options.config.maxRowLimit,
        },
      },
      readiness.ready ? 200 : 503,
    );
  }

  const backend = await requireReadyBackend(
    options.backend,
    request.signal,
    options.config.maxQueryMilliseconds,
  );
  if (url.pathname === '/v1/tables' && request.method === 'GET') {
    const tables = await withDeadline(
      request.signal,
      options.config.maxQueryMilliseconds,
      (signal) => backend.listTables(signal),
    );
    return json({ tables: tables.map(tableToWire) });
  }

  if (url.pathname === '/v1/query' && request.method === 'POST') {
    const body = objectBody(await readBoundedJson(request, options.config.maxRequestBytes));
    assertExactKeys(body, ['sql', 'row_limit']);
    const sql = requiredString(body.sql, 'sql');
    const rowLimit = rowLimitValue(body.row_limit, options.config.maxRowLimit);
    const result = await withDeadline(
      request.signal,
      options.config.maxQueryMilliseconds,
      (signal) => backend.query({ requestId, sql, rowLimit, signal }),
    );
    return arrowResponse(result.arrow, result.rowCount, rowLimit, options.config.maxResultBytes);
  }

  if (url.pathname === '/v1/table-query' && request.method === 'POST') {
    const body = objectBody(await readBoundedJson(request, options.config.maxRequestBytes));
    assertExactKeys(body, ['qualified_name', 'row_limit']);
    const qualifiedName = requiredString(body.qualified_name, 'qualified_name');
    const rowLimit = rowLimitValue(body.row_limit, options.config.maxRowLimit);
    const result = await withDeadline(
      request.signal,
      options.config.maxQueryMilliseconds,
      (signal) => backend.queryTable({ requestId, qualifiedName, rowLimit, signal }),
    );
    return arrowResponse(result.arrow, result.rowCount, rowLimit, options.config.maxResultBytes);
  }

  throw new BridgeServerError('Bridge route not found.', 'not_found', 404);
}

async function backendReadiness(
  backend: BridgeBackend | null,
  signal: AbortSignal,
): Promise<{ ready: boolean; detail: string | null }> {
  if (!backend) {
    return { ready: false, detail: 'No warehouse adapter is configured.' };
  }
  if (
    !backend.security.readOnlyIdentity ||
    !backend.security.objectAllowlist ||
    !backend.security.downstreamCancellation
  ) {
    return {
      ready: false,
      detail: 'Warehouse adapter security prerequisites are not satisfied.',
    };
  }
  return await backend.readiness(signal);
}

async function requireReadyBackend(
  backend: BridgeBackend | null,
  signal: AbortSignal,
  milliseconds: number,
): Promise<BridgeBackend> {
  const readiness = await withDeadline(signal, milliseconds, (deadlineSignal) =>
    backendReadiness(backend, deadlineSignal),
  );
  if (!backend || !readiness.ready) {
    throw new BridgeServerError(
      readiness.detail ?? 'Warehouse adapter is not ready.',
      'not_ready',
      503,
    );
  }
  return backend;
}

function tableToWire(table: BridgeTable): Record<string, unknown> {
  return {
    name: table.name,
    qualified_name: table.qualifiedName,
    catalog: table.catalog,
    namespace: table.namespace,
    kind: table.kind,
    source: table.source,
    schema: table.schema,
  };
}

function arrowResponse(
  bytes: Uint8Array,
  rowCount: number,
  rowLimit: number,
  maxResultBytes: number,
): Response {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > maxResultBytes) {
    throw new BridgeServerError('Warehouse result exceeds the byte boundary.', 'result_limit', 502);
  }
  if (!Number.isSafeInteger(rowCount) || rowCount < 0 || rowCount > rowLimit) {
    throw new BridgeServerError('Warehouse result exceeds the row boundary.', 'result_limit', 502);
  }
  return new Response(bytes, {
    headers: {
      'content-type': ARROW_CONTENT_TYPE,
      'content-length': String(bytes.byteLength),
      'x-naklidata-row-count': String(rowCount),
    },
  });
}

async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new BridgeServerError(
      'Request content type must be application/json.',
      'invalid_request',
      415,
    );
  }
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new BridgeServerError(
      'Request body exceeds the byte boundary.',
      'request_too_large',
      413,
    );
  }
  const reader = request.body?.getReader();
  if (!reader) throw new BridgeServerError('Request body is required.', 'invalid_request', 400);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel('request body too large');
      throw new BridgeServerError(
        'Request body exceeds the byte boundary.',
        'request_too_large',
        413,
      );
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new BridgeServerError('Request body is not valid JSON.', 'invalid_request', 400);
  }
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BridgeServerError('Request body must be a JSON object.', 'invalid_request', 400);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(body).some((key) => !allowedSet.has(key))) {
    throw new BridgeServerError(
      'Request body contains unsupported fields.',
      'invalid_request',
      400,
    );
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 64 * 1024) {
    throw new BridgeServerError(
      `${field} must be a bounded non-empty string.`,
      'invalid_request',
      400,
    );
  }
  return value.trim();
}

function rowLimitValue(value: unknown, maximum: number): number {
  const normalized = value ?? BRIDGE_QUERY_ROW_CAP_DEFAULT;
  if (
    !Number.isSafeInteger(normalized) ||
    (normalized as number) < 1 ||
    (normalized as number) > maximum
  ) {
    throw new BridgeServerError(
      `row_limit must be an integer from 1 to ${maximum}.`,
      'invalid_request',
      400,
    );
  }
  return normalized as number;
}

async function withDeadline<T>(
  requestSignal: AbortSignal,
  milliseconds: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort('client disconnected');
  if (requestSignal.aborted) onAbort();
  else requestSignal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort('bridge deadline exceeded');
  }, milliseconds);
  try {
    if (controller.signal.aborted) {
      throw new BridgeServerError('Bridge query cancelled.', 'cancelled', 499);
    }
    return await run(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new BridgeServerError(
        timedOut ? 'Bridge query deadline exceeded.' : 'Bridge query cancelled.',
        timedOut ? 'timeout' : 'cancelled',
        timedOut ? 504 : 499,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
    requestSignal.removeEventListener('abort', onAbort);
  }
}

function assertAllowedOrigin(request: Request, allowedOrigins: ReadonlySet<string>): void {
  const origin = request.headers.get('origin');
  if (origin && !allowedOrigins.has(origin)) {
    throw new BridgeServerError('Request origin is not allowed.', 'origin_denied', 403);
  }
}

function secureResponse(
  response: Response,
  request: Request,
  allowedOrigins: ReadonlySet<string>,
  requestId: string,
): Response {
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('x-naklidata-request-id', requestId);
  headers.set('vary', 'Origin');
  const origin = request.headers.get('origin');
  if (origin && allowedOrigins.has(origin)) {
    headers.set('access-control-allow-origin', origin);
    headers.set('access-control-allow-methods', 'GET, POST, OPTIONS');
    headers.set('access-control-allow-headers', 'Authorization, Content-Type');
    headers.set('access-control-max-age', '600');
  }
  return new Response(response.body, { status: response.status, headers });
}

function normalizeError(error: unknown, requestSignal: AbortSignal): BridgeServerError {
  if (error instanceof BridgeServerError) return error;
  if (error instanceof WarehouseAdapterError) {
    const statusByCode: Readonly<Record<string, number>> = {
      unsafe_query: 400,
      invalid_query: 400,
      cancelled: 499,
      timeout: 504,
      result_limit: 502,
      rate_limited: 429,
    };
    return new BridgeServerError(
      error.message,
      error.code,
      statusByCode[error.code] ?? (error.status >= 400 && error.status <= 599 ? 502 : 500),
    );
  }
  if (requestSignal.aborted) {
    return new BridgeServerError('Bridge query cancelled.', 'cancelled', 499);
  }
  return new BridgeServerError('Bridge request failed.', 'internal_error', 500);
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}

export const REQUIRED_QUERY_CAPABILITIES = [
  BRIDGE_CAPABILITIES.query,
  BRIDGE_CAPABILITIES.arrowIpc,
];
