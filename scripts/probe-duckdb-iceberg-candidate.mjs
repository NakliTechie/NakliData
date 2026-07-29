#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const execFileAsync = promisify(execFile);

const CANDIDATE = {
  packageVersion: '1.32.0',
  duckdbVersion: 'v1.4.3',
  tarballUrl: 'https://registry.npmjs.org/@duckdb/duckdb-wasm/-/duckdb-wasm-1.32.0.tgz',
  tarballIntegrity:
    'sha512-IewXTNYEjsZCPE9weUWgtjGxUlMRo7qhX0GF6tq/KjK8bnY+RAl4cyUdYUfcdzbyb4b9ZxPC+FOsCcxgaKFWMg==',
  coreFiles: {
    'duckdb-browser-eh.worker.js':
      '6b6439c0f7cc247ae2c3de83df186d9329bcdd24f5d715089ba7b6eeaf5ddefe3290fa92cde63b5825cae824e5245c1b',
    'duckdb-browser-mvp.worker.js':
      '001078405814a10a9f88c46fe0499edb4442a3eacefff38110e25f8946e26450511ffe13e31cbc55cbb884b5e03f1434',
    'duckdb-eh.wasm':
      '870dc68de25963941aa50f26c2a3075c13d59932cefa32a6e5d943c241ac11f8f2bbf1dc5f1d5dd11c25aff6404a18ea',
    'duckdb-mvp.wasm':
      '68fc439ada2f350c8c4f2f12ef3a25354887a1036fb642c639625d3ed4295b54f9d8342ea9e1aeb6611d6f4c9c06836c',
  },
};

const EXTENSIONS = {
  wasm_eh: {
    httpfs:
      '82cf73b3c093f2cda14c843dd4561d07479f6169f14fa95d2adc47dc0cdd46116fd6e92dd2be00b8e2539510f7d261ad',
    iceberg:
      'e1fee67dd6bbce713fb30cc60be0e2784b794dc50d1415ceadb082ad18394abdb8c940a65c0120228ee7165bd4284db6',
    parquet:
      '04e43345195622506c82e462338947dcdbc0f869756827d82752233a3c9a503d39eba483ecde89a384e74f42e6295bec',
    avro: '9c22895b0aac67d7eaebbcb1c0b22bc3b145c053ab3f1c950eaedb8f92e5a0902a2b09c5043f9c2cab097e075829d016',
  },
  wasm_mvp: {
    httpfs:
      '90285ab5ee27cc9e2581af5ae70c2617dddb3eaa63f6c51960aa72446e7ca3ca75776fd5d4e4882c66afa8202a56babf',
    iceberg:
      '558d3624b6f5240c63ff857f44488077130229b3d213997c4d9279695ada500a85de9ae7ebfd73608b4e525095b3d771',
    parquet:
      '62fe0eb44ff51278846bd4dfc0abb86f309e8dddf7c5fa05d542329e1e52dc82bb75641f3758c7866141d7655187d5fd',
    avro: '8ced489ba9f0e60a8ece59d2952066857edaa46caef7843b91abaa3100bfbd24c722341b76953800c209dbb0c46ec95c',
  },
};

const FIXTURE = {
  url: 'https://duckdb.org/data/iceberg_data.zip',
  sha384:
    'a845422c72559d1023fb564ffca1a9b3fd40c6045ef698d94a75ff6825678184dcc765c5dbba27961973b82cd5d32404',
};

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

function digest(bytes, algorithm, encoding = 'hex') {
  return createHash(algorithm).update(bytes).digest(encoding);
}

function verifyDigest(bytes, expected, algorithm, label) {
  const actual =
    expected.startsWith(`${algorithm}-`) && algorithm === 'sha512'
      ? `sha512-${digest(bytes, algorithm, 'base64')}`
      : digest(bytes, algorithm);
  assert(actual === expected, `${label} hash mismatch\nexpected: ${expected}\nactual:   ${actual}`);
}

async function download(url, maxBytes) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  assert(response.ok, `${url} returned HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length') ?? '0');
  assert(
    !Number.isFinite(declared) || declared <= maxBytes,
    `${url} declares ${declared} bytes, above the ${maxBytes}-byte ceiling`,
  );
  assert(response.body, `${url} returned no response body`);
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    assert(total <= maxBytes, `${url} exceeded the ${maxBytes}-byte ceiling`);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, total);
}

function assertSafeArchivePaths(entries, expectedPrefix = '') {
  assert(entries.length > 0, 'archive contains no entries');
  for (const entry of entries) {
    assert(!entry.startsWith('/') && !entry.startsWith('\\'), `unsafe absolute path: ${entry}`);
    assert(!entry.includes('\\'), `unsafe backslash path: ${entry}`);
    assert(!entry.split('/').includes('..'), `unsafe parent traversal path: ${entry}`);
    if (expectedPrefix) {
      assert(entry.startsWith(expectedPrefix), `unexpected archive root: ${entry}`);
    }
  }
}

async function extractCandidate(archive, destination) {
  const { stdout } = await execFileAsync('tar', ['-tzf', archive], {
    maxBuffer: 8 * 1024 * 1024,
  });
  assertSafeArchivePaths(stdout.split('\n').filter(Boolean), 'package/');
  await mkdir(destination, { recursive: true });
  await execFileAsync('tar', ['-xzf', archive, '-C', destination, '--strip-components=1']);
}

async function extractFixture(archive, destination) {
  const { stdout } = await execFileAsync('unzip', ['-Z1', archive], {
    maxBuffer: 8 * 1024 * 1024,
  });
  assertSafeArchivePaths(stdout.split('\n').filter(Boolean), 'data/');
  await mkdir(destination, { recursive: true });
  await execFileAsync('unzip', ['-q', archive, '-d', destination]);
}

function resolveWithin(root, requestPath) {
  const decoded = decodeURIComponent(requestPath);
  const candidate = resolve(root, `.${decoded.startsWith('/') ? decoded : `/${decoded}`}`);
  const rel = relative(root, candidate);
  assert(rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..'), 'path escaped server root');
  return candidate;
}

function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return { invalid: true };
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { invalid: true };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start > end ||
    end >= size
  ) {
    return { invalid: true };
  }
  return { start, end };
}

async function startStaticServer({
  root,
  cors,
  honorRange,
  landingPage = false,
  rewrite = (pathname) => pathname,
  missing = () => false,
}) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (landingPage && pathname === '/') {
      response.writeHead(200, {
        'content-type': MIME['.html'],
        'cache-control': 'no-store',
      });
      response.end('<!doctype html><title>NakliData Iceberg candidate probe</title>');
      requests.push({ pathname, method: request.method, range: null, status: 200 });
      return;
    }
    const mapped = rewrite(pathname);
    if (missing(mapped, pathname)) {
      response.writeHead(404, { 'cache-control': 'no-store' });
      response.end();
      requests.push({
        pathname,
        method: request.method,
        range: request.headers.range ?? null,
        status: 404,
      });
      return;
    }
    try {
      const filePath = resolveWithin(root, mapped);
      const bytes = await readFile(filePath);
      const requestedRange = parseRange(request.headers.range, bytes.byteLength);
      if (requestedRange?.invalid) {
        response.writeHead(416, {
          'content-range': `bytes */${bytes.byteLength}`,
          'cache-control': 'no-store',
          ...(cors ? { 'access-control-allow-origin': '*' } : {}),
        });
        response.end();
        requests.push({
          pathname,
          method: request.method,
          range: request.headers.range ?? null,
          status: 416,
        });
        return;
      }
      const selected = honorRange ? requestedRange : null;
      const start = selected?.start ?? 0;
      const end = selected?.end ?? bytes.byteLength - 1;
      const body = bytes.subarray(start, end + 1);
      const status = selected ? 206 : 200;
      response.writeHead(status, {
        'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
        'content-length': String(body.byteLength),
        'accept-ranges': 'bytes',
        'cache-control': 'no-store',
        ...(selected ? { 'content-range': `bytes ${start}-${end}/${bytes.byteLength}` } : {}),
        ...(cors ? { 'access-control-allow-origin': '*' } : {}),
      });
      response.end(request.method === 'HEAD' ? undefined : body);
      requests.push({
        pathname,
        method: request.method,
        range: request.headers.range ?? null,
        status,
      });
    } catch {
      response.writeHead(404, {
        'cache-control': 'no-store',
        ...(cors ? { 'access-control-allow-origin': '*' } : {}),
      });
      response.end();
      requests.push({
        pathname,
        method: request.method,
        range: request.headers.range ?? null,
        status: 404,
      });
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
    requests,
    close: () =>
      new Promise((resolvePromise, reject) =>
        server.close((error) => (error ? reject(error) : resolvePromise())),
      ),
  };
}

async function stageCandidate(workRoot) {
  const archive = join(workRoot, 'duckdb-wasm.tgz');
  const packageRoot = join(workRoot, 'package');
  const webRoot = join(workRoot, 'web');
  const packageBytes = await download(CANDIDATE.tarballUrl, 40 * 1024 * 1024);
  verifyDigest(packageBytes, CANDIDATE.tarballIntegrity, 'sha512', 'candidate package');
  await writeFile(archive, packageBytes);
  await extractCandidate(archive, packageRoot);

  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  assert(
    manifest.version === CANDIDATE.packageVersion,
    `candidate manifest version is ${manifest.version}, expected ${CANDIDATE.packageVersion}`,
  );

  await mkdir(webRoot, { recursive: true });
  const packageDist = join(packageRoot, 'dist');
  for (const [name, expected] of Object.entries(CANDIDATE.coreFiles)) {
    const bytes = await readFile(join(packageDist, name));
    verifyDigest(bytes, expected, 'sha384', name);
    await writeFile(join(webRoot, name), bytes);
  }

  await build({
    entryPoints: [join(packageDist, 'duckdb-browser.mjs')],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    outfile: join(webRoot, 'duckdb.js'),
    nodePaths: [resolve('node_modules')],
    logLevel: 'silent',
  });

  await Promise.all(
    Object.entries(EXTENSIONS).flatMap(([platform, extensions]) =>
      Object.entries(extensions).map(async ([name, expected]) => {
        const url = `https://extensions.duckdb.org/${CANDIDATE.duckdbVersion}/${platform}/${name}.duckdb_extension.wasm`;
        const bytes = await download(url, 8 * 1024 * 1024);
        verifyDigest(bytes, expected, 'sha384', `${platform}/${name}`);
        const destination = join(
          webRoot,
          'extensions',
          CANDIDATE.duckdbVersion,
          platform,
          `${name}.duckdb_extension.wasm`,
        );
        await mkdir(resolve(destination, '..'), { recursive: true });
        await writeFile(destination, bytes);
      }),
    ),
  );
  return webRoot;
}

async function stageFixture(workRoot) {
  const archive = join(workRoot, 'iceberg_data.zip');
  const fixtureRoot = join(workRoot, 'fixture');
  const bytes = await download(FIXTURE.url, 4 * 1024 * 1024);
  verifyDigest(bytes, FIXTURE.sha384, 'sha384', 'official Iceberg fixture');
  await writeFile(archive, bytes);
  await extractFixture(archive, fixtureRoot);
  return fixtureRoot;
}

function simplifyError(error, origins) {
  let message = error instanceof Error ? error.message : String(error);
  for (const [label, origin] of Object.entries(origins)) {
    message = message.replaceAll(origin, `<${label}>`);
  }
  return message.replace(/\s+/g, ' ').slice(0, 500);
}

async function runScan({ browser, assetOrigin, fixtureOrigin, variant, repositoryPath }) {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  try {
    await page.goto(assetOrigin, { waitUntil: 'domcontentloaded' });
    const result = await page.evaluate(
      async ({ assetOrigin, fixtureOrigin, variant, repositoryPath }) => {
        const duckdb = await import('/duckdb.js');
        const worker = new Worker(`/duckdb-browser-${variant}.worker.js`);
        const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
        try {
          await db.instantiate(`/duckdb-${variant}.wasm`);
          const connection = await db.connect();
          try {
            const repository = `${assetOrigin}${repositoryPath}`;
            const escapedRepository = repository.replaceAll("'", "''");
            await connection.query(`SET custom_extension_repository = '${escapedRepository}'`);
            await connection.query(`SET autoinstall_extension_repository = '${escapedRepository}'`);
            await connection.query('INSTALL httpfs');
            await connection.query('LOAD httpfs');
            await connection.query('INSTALL iceberg');
            await connection.query('LOAD iceberg');
            const fixture = `${fixtureOrigin}/data/iceberg/lineitem_iceberg`;
            const sample = (
              await connection.query(`
                SELECT l_orderkey, l_partkey, l_quantity
                FROM iceberg_scan('${fixture.replaceAll("'", "''")}', allow_moved_paths = true)
                ORDER BY l_orderkey, l_partkey
                LIMIT 5
              `)
            )
              .toArray()
              .map((row) => row.toJSON());
            return {
              engineVersion: await db.getVersion(),
              sample,
            };
          } finally {
            await connection.close();
          }
        } finally {
          await db.terminate();
        }
      },
      { assetOrigin, fixtureOrigin, variant, repositoryPath },
    );
    return { variant, ...result, consoleErrors };
  } finally {
    await page.close();
  }
}

async function expectFailure(name, action, evidence) {
  try {
    await action();
  } catch (error) {
    assert(evidence(), `${name} failed, but the expected network evidence was absent`);
    return error;
  }
  throw new Error(`${name} unexpectedly succeeded`);
}

async function main() {
  const workRoot = await mkdtemp(join(tmpdir(), 'naklidata-iceberg-candidate-'));
  const servers = [];
  let browser = null;
  try {
    const [webRoot, fixtureRoot] = await Promise.all([
      stageCandidate(workRoot),
      stageFixture(workRoot),
    ]);
    const assetServer = await startStaticServer({
      root: webRoot,
      cors: true,
      honorRange: true,
      landingPage: true,
      rewrite(pathname) {
        if (pathname.startsWith('/extensions-no-iceberg/')) {
          return pathname.replace('/extensions-no-iceberg/', '/extensions/');
        }
        return pathname;
      },
      missing(_mapped, pathname) {
        return (
          pathname.startsWith('/extensions-no-iceberg/') &&
          pathname.endsWith('/iceberg.duckdb_extension.wasm') &&
          pathname.includes(`/${CANDIDATE.duckdbVersion}/`)
        );
      },
    });
    servers.push(assetServer);

    const fixtureServer = await startStaticServer({
      root: fixtureRoot,
      cors: true,
      honorRange: true,
    });
    const noRangeServer = await startStaticServer({
      root: fixtureRoot,
      cors: true,
      honorRange: false,
    });
    const noCorsServer = await startStaticServer({
      root: fixtureRoot,
      cors: false,
      honorRange: true,
    });
    const missingMetadataServer = await startStaticServer({
      root: fixtureRoot,
      cors: true,
      honorRange: true,
      missing: (pathname) => pathname.endsWith('/metadata/v2.metadata.json'),
    });
    const missingDataServer = await startStaticServer({
      root: fixtureRoot,
      cors: true,
      honorRange: true,
      missing: (pathname) => pathname.endsWith('.parquet'),
    });
    servers.push(
      fixtureServer,
      noRangeServer,
      noCorsServer,
      missingMetadataServer,
      missingDataServer,
    );

    browser = await chromium.launch({ headless: true });
    const success = [];
    for (const variant of ['eh', 'mvp']) {
      const result = await runScan({
        browser,
        assetOrigin: assetServer.origin,
        fixtureOrigin: fixtureServer.origin,
        variant,
        repositoryPath: '/extensions',
      });
      assert(
        result.engineVersion === CANDIDATE.duckdbVersion,
        `${variant} reported ${result.engineVersion}, expected ${CANDIDATE.duckdbVersion}`,
      );
      assert(
        JSON.stringify(result.sample) === JSON.stringify(EXPECTED_SAMPLE),
        `${variant} returned an unexpected bounded sample`,
      );
      assert(result.consoleErrors.length === 0, `${variant} emitted browser console errors`);
      success.push(result);
    }

    const extensionPaths = assetServer.requests
      .filter((request) => request.pathname.includes('/extensions/'))
      .map((request) => request.pathname);
    for (const platform of Object.keys(EXTENSIONS)) {
      for (const name of Object.keys(EXTENSIONS[platform])) {
        assert(
          extensionPaths.includes(
            `/extensions/${CANDIDATE.duckdbVersion}/${platform}/${name}.duckdb_extension.wasm`,
          ),
          `successful scan did not request ${platform}/${name}`,
        );
      }
    }
    assert(
      fixtureServer.requests.some((request) => request.status === 206 && request.range !== null),
      'successful remote scan did not exercise byte ranges',
    );
    for (const suffix of ['.metadata.json', '.avro', '.parquet']) {
      assert(
        fixtureServer.requests.some((request) => request.pathname.endsWith(suffix)),
        `successful remote scan did not request ${suffix}`,
      );
    }

    const origins = {
      assets: assetServer.origin,
      fixture: fixtureServer.origin,
      'no-range': noRangeServer.origin,
      'no-cors': noCorsServer.origin,
      'missing-metadata': missingMetadataServer.origin,
      'missing-data': missingDataServer.origin,
    };
    const negative = [];
    const missingExtensionError = await expectFailure(
      'missing Iceberg extension',
      () =>
        runScan({
          browser,
          assetOrigin: assetServer.origin,
          fixtureOrigin: fixtureServer.origin,
          variant: 'eh',
          repositoryPath: '/extensions-no-iceberg',
        }),
      () =>
        assetServer.requests.some(
          (request) =>
            request.pathname.includes('/extensions-no-iceberg/') &&
            request.pathname.endsWith('/iceberg.duckdb_extension.wasm') &&
            request.status === 404,
        ),
    );
    negative.push({
      case: 'missing-extension',
      error: simplifyError(missingExtensionError, origins),
    });

    const noRangeError = await expectFailure(
      'range-ignorant fixture',
      () =>
        runScan({
          browser,
          assetOrigin: assetServer.origin,
          fixtureOrigin: noRangeServer.origin,
          variant: 'eh',
          repositoryPath: '/extensions',
        }),
      () =>
        noRangeServer.requests.some((request) => request.range !== null && request.status === 200),
    );
    negative.push({ case: 'range-ignored', error: simplifyError(noRangeError, origins) });

    const noCorsError = await expectFailure(
      'missing CORS permission',
      () =>
        runScan({
          browser,
          assetOrigin: assetServer.origin,
          fixtureOrigin: noCorsServer.origin,
          variant: 'eh',
          repositoryPath: '/extensions',
        }),
      () => noCorsServer.requests.length > 0,
    );
    negative.push({ case: 'cors-denied', error: simplifyError(noCorsError, origins) });

    const metadataError = await expectFailure(
      'missing metadata',
      () =>
        runScan({
          browser,
          assetOrigin: assetServer.origin,
          fixtureOrigin: missingMetadataServer.origin,
          variant: 'eh',
          repositoryPath: '/extensions',
        }),
      () => missingMetadataServer.requests.some((request) => request.status === 404),
    );
    negative.push({
      case: 'metadata-missing',
      error: simplifyError(metadataError, origins),
    });

    const dataError = await expectFailure(
      'missing data file',
      () =>
        runScan({
          browser,
          assetOrigin: assetServer.origin,
          fixtureOrigin: missingDataServer.origin,
          variant: 'eh',
          repositoryPath: '/extensions',
        }),
      () =>
        missingDataServer.requests.some(
          (request) => request.pathname.endsWith('.parquet') && request.status === 404,
        ),
    );
    negative.push({ case: 'data-missing', error: simplifyError(dataError, origins) });

    process.stdout.write(
      `${JSON.stringify(
        {
          candidate: {
            package: `@duckdb/duckdb-wasm@${CANDIDATE.packageVersion}`,
            engine: CANDIDATE.duckdbVersion,
          },
          success,
          negative,
          evidence: {
            hashesVerified: 14,
            extensionArtifacts: extensionPaths.length,
            rangedFixtureResponses: fixtureServer.requests.filter(
              (request) => request.status === 206,
            ).length,
            negativeCases: negative.length,
            fixtureKinds: ['metadata-json', 'avro', 'parquet'],
          },
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    if (browser) await browser.close();
    await Promise.allSettled(servers.map((server) => server.close()));
    if (process.env.NAKLIDATA_KEEP_ICEBERG_PROBE === '1') {
      console.error(`[iceberg-candidate] retained temporary workspace: ${workRoot}`);
    } else {
      await rm(workRoot, { recursive: true, force: true });
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(`[iceberg-candidate] ${error instanceof Error ? error.stack : error}`);
    process.exitCode = 1;
  });
}
