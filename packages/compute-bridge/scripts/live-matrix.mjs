import { pathToFileURL } from 'node:url';
import { tableFromIPC } from 'apache-arrow';

const MATRIX_ID = 'naklidata-compute-bridge-live';
const MATRIX_VERSION = 1;
const JSON_LIMIT_BYTES = 1024 * 1024;
const DEFAULT_ARROW_LIMIT_BYTES = 64 * 1024 * 1024;

export class LiveMatrixError extends Error {
  constructor(message, code = 'matrix_error', status = null) {
    super(message);
    this.name = 'LiveMatrixError';
    this.code = code;
    this.status = status;
  }
}

export function configFromEnvironment(env = process.env) {
  const mode = optionalText(env.BRIDGE_LIVE_MODE) ?? 'baseline';
  if (mode !== 'baseline' && mode !== 'expect-error') {
    throw new LiveMatrixError('BRIDGE_LIVE_MODE is unsupported.', 'invalid_config');
  }
  const baseUrl = liveBaseUrl(requiredText(env.BRIDGE_LIVE_URL, 'BRIDGE_LIVE_URL'));
  const origin = liveOrigin(requiredText(env.BRIDGE_LIVE_ORIGIN, 'BRIDGE_LIVE_ORIGIN'));
  const adapter = requiredText(env.BRIDGE_LIVE_ADAPTER, 'BRIDGE_LIVE_ADAPTER');
  const config = {
    mode,
    baseUrl,
    origin,
    adapter,
    expectedVersion: optionalText(env.BRIDGE_LIVE_EXPECTED_VERSION),
    token: secretText(env.BRIDGE_LIVE_AUTH_TOKEN, 'BRIDGE_LIVE_AUTH_TOKEN'),
    rowLimit: optionalPositiveInteger(env.BRIDGE_LIVE_ROW_LIMIT, 'BRIDGE_LIVE_ROW_LIMIT') ?? 5,
    maxArrowBytes:
      optionalPositiveInteger(env.BRIDGE_LIVE_MAX_ARROW_BYTES, 'BRIDGE_LIVE_MAX_ARROW_BYTES') ??
      DEFAULT_ARROW_LIMIT_BYTES,
  };

  if (mode === 'expect-error') {
    return {
      ...config,
      expectedErrorSql: requiredText(
        env.BRIDGE_LIVE_EXPECT_ERROR_SQL,
        'BRIDGE_LIVE_EXPECT_ERROR_SQL',
      ),
      expectedErrorCode: requiredText(
        env.BRIDGE_LIVE_EXPECT_ERROR_CODE,
        'BRIDGE_LIVE_EXPECT_ERROR_CODE',
      ),
      expectedErrorStatus: requiredPositiveInteger(
        env.BRIDGE_LIVE_EXPECT_ERROR_STATUS,
        'BRIDGE_LIVE_EXPECT_ERROR_STATUS',
      ),
    };
  }

  return {
    ...config,
    tableId: requiredText(env.BRIDGE_LIVE_TABLE_ID, 'BRIDGE_LIVE_TABLE_ID'),
    directSql: requiredText(env.BRIDGE_LIVE_DIRECT_SQL, 'BRIDGE_LIVE_DIRECT_SQL'),
    disconnectSql: optionalText(env.BRIDGE_LIVE_DISCONNECT_SQL),
    recoverySql: optionalText(env.BRIDGE_LIVE_RECOVERY_SQL),
    disconnectAfterMs:
      optionalPositiveInteger(
        env.BRIDGE_LIVE_DISCONNECT_AFTER_MS,
        'BRIDGE_LIVE_DISCONNECT_AFTER_MS',
      ) ?? 50,
    limitSql: optionalText(env.BRIDGE_LIVE_LIMIT_SQL),
    limitExpectedCode: optionalText(env.BRIDGE_LIVE_LIMIT_EXPECTED_CODE) ?? 'result_limit',
    limitExpectedStatus:
      optionalPositiveInteger(
        env.BRIDGE_LIVE_LIMIT_EXPECTED_STATUS,
        'BRIDGE_LIVE_LIMIT_EXPECTED_STATUS',
      ) ?? 502,
  };
}

export async function runLiveMatrix(config, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const health = await requestJson(config, fetchImpl, '/v1/health');
  const bridgeVersion = assertHealth(health, config.adapter, config.expectedVersion);

  if (config.mode === 'expect-error') {
    const failure = await expectQueryError(config, fetchImpl, {
      sql: config.expectedErrorSql,
      code: config.expectedErrorCode,
      status: config.expectedErrorStatus,
    });
    return summary(config.adapter, {
      health: {
        protocolVersion: health.protocol_version,
        bridgeVersion,
        ready: health.ready,
      },
      expectedError: failure,
    });
  }

  const ready = await requestJson(config, fetchImpl, '/v1/ready');
  const limits = assertReady(ready, config.rowLimit);
  const inventory = await requestJson(config, fetchImpl, '/v1/tables');
  const inventoryCount = assertInventory(inventory, config.tableId);
  const arrowLimit = Math.min(limits.maxResultBytes, config.maxArrowBytes);
  const tableQuery = await requestArrow(
    config,
    fetchImpl,
    '/v1/table-query',
    { qualified_name: config.tableId, row_limit: config.rowLimit },
    arrowLimit,
  );
  const directQuery = await requestArrow(
    config,
    fetchImpl,
    '/v1/query',
    { sql: config.directSql, row_limit: config.rowLimit },
    arrowLimit,
  );

  const checks = {
    health: { protocolVersion: health.protocol_version, bridgeVersion, ready: health.ready },
    ready: {
      maxRequestBytes: limits.maxRequestBytes,
      maxResultBytes: limits.maxResultBytes,
      maxQueryMilliseconds: limits.maxQueryMilliseconds,
      maxRowLimit: limits.maxRowLimit,
    },
    inventory: { count: inventoryCount, expectedObjectFound: true },
    tableQuery,
    directQuery,
  };

  if (config.limitSql) {
    checks.resultLimit = await expectQueryError(config, fetchImpl, {
      sql: config.limitSql,
      code: config.limitExpectedCode,
      status: config.limitExpectedStatus,
    });
  }
  if (config.disconnectSql) {
    checks.disconnect = await runDisconnect(config, fetchImpl, arrowLimit);
  }
  return summary(config.adapter, checks);
}

function summary(adapter, checks) {
  return {
    matrix: MATRIX_ID,
    version: MATRIX_VERSION,
    adapter,
    checks,
    privacy: {
      rowValuesEmitted: false,
      sqlEmitted: false,
      secretsEmitted: false,
    },
  };
}

async function runDisconnect(config, fetchImpl, arrowLimit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.disconnectAfterMs);
  let clientAborted = false;
  try {
    const response = await rawRequest(
      config,
      fetchImpl,
      '/v1/query',
      { sql: config.disconnectSql, row_limit: config.rowLimit },
      controller.signal,
    );
    await response.body?.cancel();
  } catch (error) {
    clientAborted = controller.signal.aborted && isAbortError(error);
  } finally {
    clearTimeout(timer);
  }
  if (!clientAborted) {
    throw new LiveMatrixError('Disconnect probe completed before client abort.', 'not_aborted');
  }
  const recoverySql = config.recoverySql ?? config.directSql;
  const recovery = await requestArrow(
    config,
    fetchImpl,
    '/v1/query',
    { sql: recoverySql, row_limit: config.rowLimit },
    arrowLimit,
  );
  return {
    clientAborted: true,
    recovery,
    vendorTerminalStateRequired: true,
  };
}

async function requestJson(config, fetchImpl, path) {
  const response = await rawRequest(config, fetchImpl, path);
  if (!response.ok) throw await responseError(response, path);
  const bytes = await readBounded(response, JSON_LIMIT_BYTES);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new LiveMatrixError(`Bridge ${path} returned invalid JSON.`, 'invalid_response');
  }
}

async function requestArrow(config, fetchImpl, path, body, maximumBytes) {
  const response = await rawRequest(config, fetchImpl, path, body);
  if (!response.ok) throw await responseError(response, path);
  if (response.headers.get('content-type') !== 'application/vnd.apache.arrow.stream') {
    throw new LiveMatrixError(`Bridge ${path} returned an invalid media type.`, 'invalid_response');
  }
  const rowCount = positiveOrZeroHeader(response, 'x-naklidata-row-count');
  const bytes = await readBounded(response, maximumBytes);
  let parsedRows;
  try {
    parsedRows = tableFromIPC(bytes).numRows;
  } catch {
    throw new LiveMatrixError(`Bridge ${path} returned invalid Arrow IPC.`, 'invalid_response');
  }
  if (parsedRows !== rowCount || rowCount > body.row_limit) {
    throw new LiveMatrixError(
      `Bridge ${path} returned inconsistent row metadata.`,
      'invalid_response',
    );
  }
  return { rowCount, byteCount: bytes.byteLength, arrowRows: parsedRows };
}

async function expectQueryError(config, fetchImpl, expectation) {
  const response = await rawRequest(config, fetchImpl, '/v1/query', {
    sql: expectation.sql,
    row_limit: config.rowLimit,
  });
  const error = await responseError(response, '/v1/query');
  if (response.status !== expectation.status || error.code !== expectation.code) {
    throw new LiveMatrixError(
      'Bridge query returned an unexpected error classification.',
      'unexpected_error',
      response.status,
    );
  }
  return { status: response.status, code: error.code };
}

async function rawRequest(config, fetchImpl, path, body = null, signal = undefined) {
  const headers = new Headers({
    authorization: `Bearer ${config.token}`,
    origin: config.origin,
  });
  const init = { headers, signal };
  if (body !== null) {
    headers.set('content-type', 'application/json');
    init.method = 'POST';
    init.body = JSON.stringify(body);
  }
  return await fetchImpl(new URL(path, config.baseUrl), init);
}

async function responseError(response, path) {
  let code = 'bridge_error';
  try {
    const bytes = await readBounded(response, JSON_LIMIT_BYTES);
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof body?.error?.code === 'string' && body.error.code.length <= 128) {
      code = body.error.code;
    }
  } catch {
    code = 'invalid_error_response';
  }
  return new LiveMatrixError(
    `Bridge ${path} failed with HTTP ${response.status}.`,
    code,
    response.status,
  );
}

async function readBounded(response, maximumBytes) {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new LiveMatrixError(
          'Bridge response exceeded the matrix byte boundary.',
          'response_limit',
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function assertHealth(value, expectedAdapter, expectedVersion) {
  const actualVersion = isObject(value) ? optionalText(value.version) : null;
  if (
    !isObject(value) ||
    value.protocol !== 'naklidata-compute-bridge' ||
    value.protocol_version !== 2 ||
    value.auth !== 'bearer' ||
    value.single_tenant !== true ||
    value.ready !== true ||
    value.adapter !== expectedAdapter ||
    !actualVersion ||
    !Array.isArray(value.capabilities)
  ) {
    throw new LiveMatrixError('Bridge health contract is not ready for this adapter.', 'not_ready');
  }
  if (expectedVersion && actualVersion !== expectedVersion) {
    throw new LiveMatrixError(
      'Bridge version does not match the release candidate.',
      'version_mismatch',
    );
  }
  return actualVersion;
}

function assertReady(value, requestedRows) {
  if (!isObject(value) || value.ready !== true || !isObject(value.limits)) {
    throw new LiveMatrixError('Bridge readiness contract is invalid.', 'not_ready');
  }
  const limits = {
    maxRequestBytes: positiveInteger(value.limits.max_request_bytes, 'max_request_bytes'),
    maxResultBytes: positiveInteger(value.limits.max_result_bytes, 'max_result_bytes'),
    maxQueryMilliseconds: positiveInteger(
      value.limits.max_query_milliseconds,
      'max_query_milliseconds',
    ),
    maxRowLimit: positiveInteger(value.limits.max_row_limit, 'max_row_limit'),
  };
  if (requestedRows > limits.maxRowLimit) {
    throw new LiveMatrixError('Requested row limit exceeds bridge readiness.', 'invalid_config');
  }
  return limits;
}

function assertInventory(value, expectedTableId) {
  if (!isObject(value) || !Array.isArray(value.tables) || value.tables.length < 1) {
    throw new LiveMatrixError('Bridge inventory is empty or invalid.', 'invalid_response');
  }
  const found = value.tables.some(
    (table) => isObject(table) && table.qualified_name === expectedTableId,
  );
  if (!found) {
    throw new LiveMatrixError(
      'Expected opaque object is absent from bridge inventory.',
      'object_missing',
    );
  }
  return value.tables.length;
}

function positiveOrZeroHeader(response, name) {
  const value = response.headers.get(name);
  if (!/^\d+$/.test(value ?? '')) {
    throw new LiveMatrixError(`Bridge response is missing ${name}.`, 'invalid_response');
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new LiveMatrixError(`Bridge response has invalid ${name}.`, 'invalid_response');
  }
  return number;
}

function liveBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new LiveMatrixError('BRIDGE_LIVE_URL is invalid.', 'invalid_config');
  }
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
    url.username ||
    url.password
  ) {
    throw new LiveMatrixError('BRIDGE_LIVE_URL must use HTTPS or loopback HTTP.', 'invalid_config');
  }
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url;
}

function liveOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new LiveMatrixError('BRIDGE_LIVE_ORIGIN is invalid.', 'invalid_config');
  }
  if (url.origin !== value || url.protocol !== 'https:') {
    throw new LiveMatrixError(
      'BRIDGE_LIVE_ORIGIN must be an exact HTTPS origin.',
      'invalid_config',
    );
  }
  return value;
}

function requiredText(value, name) {
  const text = optionalText(value);
  if (!text) throw new LiveMatrixError(`${name} is required.`, 'invalid_config');
  return text;
}

function secretText(value, name) {
  const text = requiredText(value, name);
  if (text.length < 24 || text.startsWith('replace-')) {
    throw new LiveMatrixError(`${name} is not configured.`, 'invalid_config');
  }
  return text;
}

function optionalText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > 16_384) return null;
  return text;
}

function requiredPositiveInteger(value, name) {
  const number = optionalPositiveInteger(value, name);
  if (number === null) throw new LiveMatrixError(`${name} is required.`, 'invalid_config');
  return number;
}

function optionalPositiveInteger(value, name) {
  if (value === undefined) return null;
  if (!/^\d+$/.test(String(value))) {
    throw new LiveMatrixError(`${name} must be a positive integer.`, 'invalid_config');
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new LiveMatrixError(`${name} must be a positive integer.`, 'invalid_config');
  }
  return number;
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new LiveMatrixError(`Bridge ${name} is invalid.`, 'invalid_response');
  }
  return value;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isAbortError(error) {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : isObject(error) && error.name === 'AbortError';
}

async function main() {
  try {
    const result = await runLiveMatrix(configFromEnvironment());
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const normalized =
      error instanceof LiveMatrixError
        ? error
        : new LiveMatrixError('Live matrix runner failed.', 'runner_error');
    process.stderr.write(
      `${JSON.stringify({
        matrix: MATRIX_ID,
        version: MATRIX_VERSION,
        ok: false,
        status: normalized.status,
        errorCode: normalized.code,
      })}\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
