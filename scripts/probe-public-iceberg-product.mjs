#!/usr/bin/env node

import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const ROOT = resolve('.');
const PUBLIC_ROOT = resolve('public');
const FIXTURE = 'https://motherduck-demo.s3.amazonaws.com/iceberg/lineitem_iceberg';
const EXPECTED_SAMPLE = [
  { l_orderkey: 1, l_partkey: 22, l_quantity: 28 },
  { l_orderkey: 1, l_partkey: 157, l_quantity: 32 },
  { l_orderkey: 1, l_partkey: 241, l_quantity: 24 },
  { l_orderkey: 1, l_partkey: 637, l_quantity: 8 },
  { l_orderkey: 1, l_partkey: 674, l_quantity: 36 },
];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function bundleHarness() {
  const result = await build({
    stdin: {
      contents: `
        import { Engine } from './src/core/engine.ts';
        import { mountIcebergTable, releaseMountedTableNames } from './src/core/mount.ts';
        const engine = new Engine();
        window.probe = {
          boot: async () => await engine.boot({ offline: true, verifyIntegrity: true }),
          mount: async (url, sourceId, signal) => {
            const source = await mountIcebergTable(engine, {
              label: 'Official public Iceberg fixture',
              metadataUrl: url,
              bearerToken: null,
              sourceId,
              ...(signal ? { signal } : {}),
            });
            const tableName = source.tables[0].name.replaceAll('"', '""');
            const sample = await engine.query(
              'SELECT l_orderkey, l_partkey, l_quantity FROM "' + tableName + '" ORDER BY l_orderkey, l_partkey LIMIT 5',
            );
            return { source, sample };
          },
          cancelBeforeMount: async (url) => {
            const controller = new AbortController();
            controller.abort('probe cancellation');
            try {
              await mountIcebergTable(engine, {
                label: '', metadataUrl: url, bearerToken: null, signal: controller.signal,
              });
            } catch (error) {
              return error instanceof Error ? error.message : String(error);
            }
            return null;
          },
          drop: async (name) => {
            await engine.drop(name);
            releaseMountedTableNames(engine, [name]);
          },
          close: async () => await engine.close(),
        };
      `,
      resolveDir: ROOT,
      sourcefile: 'public-iceberg-product-probe.ts',
      loader: 'ts',
    },
    bundle: true,
    platform: 'browser',
    format: 'esm',
    write: false,
    logLevel: 'silent',
  });
  const output = result.outputFiles?.[0];
  assert(output, 'probe harness did not bundle');
  return output.contents;
}

async function startServer(harness) {
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    try {
      if (pathname === '/' || pathname === '/index.html') {
        response.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
        response.end('<!doctype html><script type="module" src="/harness.js"></script>');
        return;
      }
      if (pathname === '/harness.js') {
        response.writeHead(200, { 'content-type': MIME['.js'], 'cache-control': 'no-store' });
        response.end(harness);
        return;
      }
      if (pathname.startsWith('/redirect-fixture')) {
        const suffix = pathname.slice('/redirect-fixture'.length);
        response.writeHead(302, {
          location: `${FIXTURE}${suffix}`,
          'access-control-allow-origin': '*',
          'cache-control': 'no-store',
        });
        response.end();
        return;
      }
      const path = resolve(PUBLIC_ROOT, `.${pathname}`);
      assert(path.startsWith(`${PUBLIC_ROOT}/`), 'unsafe static path');
      const bytes = await readFile(path);
      response.writeHead(200, {
        'content-type': MIME[extname(path)] ?? 'application/octet-stream',
        'content-length': String(bytes.byteLength),
        'cache-control': 'no-store',
      });
      response.end(bytes);
    } catch {
      response.writeHead(404, { 'cache-control': 'no-store' });
      response.end();
    }
  });
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  assert(address && typeof address !== 'string', 'probe server did not bind');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolvePromise) => server.close(resolvePromise)),
  };
}

async function main() {
  const server = await startServer(await bundleHarness());
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const requests = [];
  const responses = [];
  page.on('request', (request) => {
    if (request.url().startsWith(FIXTURE)) {
      requests.push({ method: request.method(), url: request.url() });
    }
  });
  page.on('response', async (response) => {
    if (response.url().startsWith(FIXTURE)) {
      responses.push({
        status: response.status(),
        url: response.url(),
        cors: (await response.allHeaders())['access-control-allow-origin'] ?? null,
      });
    }
  });
  try {
    await page.goto(server.origin, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.probe?.boot === 'function');
    await page.evaluate(async () => await window.probe.boot());

    let blocked = true;
    await page.route(`${FIXTURE}/**`, async (route) => {
      if (blocked) await route.abort('internetdisconnected');
      else await route.continue();
    });
    const offlineError = await page.evaluate(async (url) => {
      try {
        await window.probe.mount(url, 'src_offline');
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }, FIXTURE);
    assert(offlineError, 'offline mount unexpectedly succeeded');

    blocked = false;
    const opened = await page.evaluate(
      async ({ url, sourceId }) => await window.probe.mount(url, sourceId),
      { url: FIXTURE, sourceId: 'src_public' },
    );
    assert(opened.source.tables[0]?.rowCount > 0, 'public fixture returned no rows');
    assert(
      JSON.stringify(opened.sample) === JSON.stringify(EXPECTED_SAMPLE),
      'public fixture sample changed',
    );
    const persisted = JSON.parse(JSON.stringify(opened.source));
    assert(persisted.ref === FIXTURE, 'source identity did not survive JSON persistence');
    assert(!JSON.stringify(persisted).toLowerCase().includes('token'), 'source persisted a token');

    const cancelError = await page.evaluate(async (url) => await window.probe.cancelBeforeMount(url), FIXTURE);
    assert(cancelError?.toLowerCase().includes('abort'), 'pre-start cancellation was not enforced');

    await page.evaluate(async (name) => await window.probe.drop(name), opened.source.tables[0].name);
    const remounted = await page.evaluate(
      async ({ url, sourceId }) => await window.probe.mount(url, sourceId),
      { url: FIXTURE, sourceId: 'src_public' },
    );
    assert(
      JSON.stringify(remounted.sample) === JSON.stringify(EXPECTED_SAMPLE),
      'remount sample changed',
    );
    await page.evaluate(async (name) => await window.probe.drop(name), remounted.source.tables[0].name);

    const redirected = await page.evaluate(
      async ({ url, sourceId }) => await window.probe.mount(url, sourceId),
      { url: `${server.origin}/redirect-fixture`, sourceId: 'src_redirect' },
    );
    assert(
      JSON.stringify(redirected.sample) === JSON.stringify(EXPECTED_SAMPLE),
      'redirected fixture sample changed',
    );
    await page.evaluate(async (name) => await window.probe.drop(name), redirected.source.tables[0].name);
    await page.evaluate(async () => await window.probe.close());

    assert(requests.length > 0, 'public fixture produced no network requests');
    assert(requests.every((request) => ['GET', 'HEAD'].includes(request.method)), 'probe issued a remote write');
    assert(
      responses.every((response) => response.cors === '*' || response.cors === server.origin),
      'fixture response omitted CORS permission',
    );
    const rangeResponse = await fetch(`${FIXTURE}/metadata/v2.metadata.json`, {
      headers: { Origin: server.origin, Range: 'bytes=0-9' },
      signal: AbortSignal.timeout(15_000),
    });
    assert(rangeResponse.status === 206, 'fixture rejected an explicit byte-range request');
    assert(
      rangeResponse.headers.get('access-control-allow-origin') === '*',
      'fixture range response omitted CORS permission',
    );
    process.stdout.write(
      `${JSON.stringify(
        {
          fixture: FIXTURE,
          rowCount: opened.source.tables[0].rowCount,
          sample: opened.sample,
          offlineRetry: true,
          cancelledBeforeStart: true,
          persistedWithoutCredentials: true,
          remounted: true,
          redirected: true,
          removedAndClosed: true,
          remoteMethods: [...new Set(requests.map((request) => request.method))],
          rangedResponses: responses.filter((response) => response.status === 206).length,
          explicitRangeStatus: rangeResponse.status,
          corsResponses: responses.filter((response) => response.cors !== null).length,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await page.close();
    await browser.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(`[naklidata] public Iceberg product probe failed: ${error.stack ?? error.message}`);
  process.exit(1);
});
