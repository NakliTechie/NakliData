import assert from 'node:assert/strict';
import test from 'node:test';
import { tableFromArrays, tableToIPC } from 'apache-arrow';
import { LiveMatrixError, configFromEnvironment, runLiveMatrix } from './live-matrix.mjs';

const TOKEN = 'fixture-bridge-token-long-enough';
const ADAPTER = 'databricks-sql-warehouse';
const ORIGIN = 'https://workbench.example.test';
const ARROW = tableToIPC(tableFromArrays({ order_id: [101, 102, 103] }), 'stream');

function baselineConfig(overrides = {}) {
  return {
    mode: 'baseline',
    baseUrl: new URL('http://127.0.0.1:8787/'),
    origin: ORIGIN,
    adapter: ADAPTER,
    token: TOKEN,
    rowLimit: 5,
    maxArrowBytes: 1024 * 1024,
    tableId: 'orders-v1',
    directSql: 'SELECT order_id FROM main.analytics.orders',
    disconnectSql: null,
    recoverySql: null,
    disconnectAfterMs: 5,
    limitSql: null,
    limitExpectedCode: 'result_limit',
    limitExpectedStatus: 502,
    ...overrides,
  };
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function arrow() {
  return new Response(ARROW, {
    headers: {
      'content-type': 'application/vnd.apache.arrow.stream',
      'x-naklidata-row-count': '3',
    },
  });
}

function fixtureFetch(options = {}) {
  const requests = [];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ path: url.pathname, body, signal: init.signal });
    assert.equal(init.headers.get('authorization'), `Bearer ${TOKEN}`);
    assert.equal(init.headers.get('origin'), ORIGIN);

    if (url.pathname === '/v1/health') {
      return json({
        protocol: 'naklidata-compute-bridge',
        protocol_version: 2,
        auth: 'bearer',
        single_tenant: true,
        capabilities: ['arrow-ipc', 'query', 'table-query', 'tables'],
        ready: true,
        adapter: ADAPTER,
      });
    }
    if (url.pathname === '/v1/ready') {
      return json({
        ready: true,
        limits: {
          max_request_bytes: 4096,
          max_result_bytes: 1024 * 1024,
          max_query_milliseconds: 5000,
          max_row_limit: 100,
        },
      });
    }
    if (url.pathname === '/v1/tables') {
      return json({ tables: [{ qualified_name: 'orders-v1' }] });
    }
    if (options.errorSql && body?.sql === options.errorSql) {
      return json(
        { error: { code: options.errorCode, message: `SECRET=${TOKEN}; row=101` } },
        options.errorStatus,
      );
    }
    if (options.disconnectSql && body?.sql === options.disconnectSql) {
      return await new Promise((_, reject) => {
        init.signal.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true },
        );
      });
    }
    return arrow();
  };
  return { fetchImpl, requests };
}

test('runs the bounded baseline without emitting SQL, secrets, or row values', async () => {
  const fixture = fixtureFetch({
    errorSql: 'SELECT * FROM main.analytics.orders',
    errorCode: 'result_limit',
    errorStatus: 502,
  });
  const result = await runLiveMatrix(
    baselineConfig({ limitSql: 'SELECT * FROM main.analytics.orders' }),
    { fetchImpl: fixture.fetchImpl },
  );
  assert.equal(result.checks.inventory.count, 1);
  assert.equal(result.checks.tableQuery.arrowRows, 3);
  assert.deepEqual(result.checks.resultLimit, { status: 502, code: 'result_limit' });
  assert.equal(result.privacy.rowValuesEmitted, false);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(TOKEN), false);
  assert.equal(serialized.includes('SELECT'), false);
  assert.equal(serialized.includes('101'), false);
});

test('proves client abort and a bounded recovery while retaining the vendor-state caveat', async () => {
  const disconnectSql =
    'SELECT order_id FROM main.analytics.orders CROSS JOIN main.analytics.orders';
  const fixture = fixtureFetch({ disconnectSql });
  const result = await runLiveMatrix(
    baselineConfig({
      disconnectSql,
      recoverySql: 'SELECT order_id FROM main.analytics.orders',
    }),
    { fetchImpl: fixture.fetchImpl },
  );
  assert.equal(result.checks.disconnect.clientAborted, true);
  assert.equal(result.checks.disconnect.recovery.rowCount, 3);
  assert.equal(result.checks.disconnect.vendorTerminalStateRequired, true);
  assert.equal(fixture.requests.filter((request) => request.path === '/v1/query').length, 3);
});

for (const expectation of [
  { code: 'credential_rejected', status: 401 },
  { code: 'rate_limited', status: 429 },
]) {
  test(`records only the ${expectation.code} classification`, async () => {
    const expectedErrorSql = 'SELECT order_id FROM main.analytics.orders';
    const fixture = fixtureFetch({
      errorSql: expectedErrorSql,
      errorCode: expectation.code,
      errorStatus: expectation.status,
    });
    const result = await runLiveMatrix(
      {
        ...baselineConfig(),
        mode: 'expect-error',
        expectedErrorSql,
        expectedErrorCode: expectation.code,
        expectedErrorStatus: expectation.status,
      },
      { fetchImpl: fixture.fetchImpl },
    );
    assert.deepEqual(result.checks.expectedError, expectation);
    assert.equal(JSON.stringify(result).includes(TOKEN), false);
    assert.equal(JSON.stringify(result).includes('row=101'), false);
  });
}

test('rejects non-loopback HTTP and incomplete configuration before a request', () => {
  assert.throws(
    () =>
      configFromEnvironment({
        BRIDGE_LIVE_URL: 'http://bridge.example.test',
        BRIDGE_LIVE_ORIGIN: ORIGIN,
        BRIDGE_LIVE_ADAPTER: ADAPTER,
        BRIDGE_LIVE_AUTH_TOKEN: TOKEN,
        BRIDGE_LIVE_TABLE_ID: 'orders-v1',
        BRIDGE_LIVE_DIRECT_SQL: 'SELECT order_id FROM main.analytics.orders',
      }),
    (error) => error instanceof LiveMatrixError && error.code === 'invalid_config',
  );
});
