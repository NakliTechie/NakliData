#!/usr/bin/env node
// Headless browser smoke test against the built dist/.
// Boots a tiny static server on a random port, opens dist/index.html in
// Chromium via Playwright, and exercises the v1.0 smoke-test scenario
// (handoff §6) as far as a headless run permits.
//
// Browser dialogs (FSA pickers) are not exercised — those require a real
// user gesture in a real browser. We exercise everything else: engine
// boot, example-bundle mount, schema panel render, classifier results,
// notebook seed, SQL run, chart cell, template instantiation, .naklidata
// serialize round-trip.

import { readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import initSqlJs from 'sql.js';

/**
 * Build a tiny in-memory SQLite database (2 tables) and return its bytes as
 * base64 — used to exercise the sql.js-backed SQLite mount path headlessly
 * (real-data test fixes #1 + #2). Generated at runtime so no binary fixture
 * is committed.
 */
async function makeSqliteFixtureBase64() {
  const SQL = await initSqlJs({
    locateFile: () => resolve('node_modules/sql.js/dist/sql-wasm.wasm'),
  });
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE regions (region TEXT, target REAL);
    INSERT INTO regions VALUES ('West', 1000.5), ('East', 2000.0), ('North', 1500.25);
    CREATE TABLE reps (rep TEXT, region TEXT, sales REAL);
    INSERT INTO reps VALUES ('Ana', 'West', 500.0), ('Ben', 'East', 750.5);
  `);
  const bytes = db.export();
  db.close();
  return Buffer.from(bytes).toString('base64');
}

const ROOT = resolve('dist');
const CHROME = process.env.PLAYWRIGHT_CHROMIUM_PATH;

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.jsonl': 'application/x-ndjson',
  '.csv': 'text/csv',
  '.parquet': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.zip': 'application/zip',
  '.whl': 'application/octet-stream',
};

const log = (...a) => console.log('[smoke]', ...a);
const fail = (msg) => {
  console.error('[smoke] FAIL:', msg);
  process.exit(1);
};

async function startServer() {
  return await new Promise((resolveListen) => {
    const server = createServer(async (req, res) => {
      try {
        const parsedUrl = new URL(req.url ?? '/', 'http://smoke.local');
        const reqUrl = parsedUrl.pathname;
        const url = reqUrl === '/' ? '/index.html' : reqUrl;
        const filePath = join(ROOT, url);
        const st = await stat(filePath);
        if (!st.isFile()) {
          res.writeHead(404);
          res.end('not found');
          return;
        }
        const body = await readFile(filePath);
        const partial = parsedUrl.searchParams.has('__partial');
        const responseHeaders = {
          'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
          // Cross-origin isolation (matches the deploy _headers) — enables
          // SharedArrayBuffer for WebR + @antv/layout-wasm. credentialless lets
          // the cross-origin DuckDB mirror + public CDN fetches through.
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'credentialless',
        };
        if (parsedUrl.searchParams.has('__private')) {
          responseHeaders['cache-control'] = 'private, no-store';
        }
        if (partial) {
          responseHeaders['content-range'] = `bytes 0-3/${body.byteLength}`;
        }
        res.writeHead(partial ? 206 : 200, responseHeaders);
        res.end(partial ? body.subarray(0, 4) : body);
      } catch {
        res.writeHead(404);
        res.end('not found');
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolveListen({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  // Cleaning-surface fixture: a CSV with whitespace-dirty values. Written into
  // dist/ at run time (NOT into public/) so it is served same-origin for the
  // mount-by-URL path without shipping a fixture to production.
  await writeFile(
    join(ROOT, '__smoke_dirty.csv'),
    'city,note,revenue_2023,revenue_2024\n  Mumbai,ok,10,12\nDelhi  ,ok,20,21\nPune,ok,30,32\n  Kochi ,ok,40,43\n',
    'utf8',
  );
  // KAG-01 regression: valid Latin-1 bytes from an ordinary origin with no
  // byte-range support. The public-URL path must fetch once, normalize the
  // encoding, and return the same exact three rows on repeated scans.
  await writeFile(
    join(ROOT, '__smoke_latin1.csv'),
    Buffer.from(
      'sku,description,amount\n1,"Tea, boxed",£10\n2,"Quoted ""item""",£20\n3,Café,£30\n',
      'latin1',
    ),
  );
  log('starting server');
  const { server, url } = await startServer();

  log('launching headless chromium');
  const browser = await chromium.launch({
    ...(CHROME ? { executablePath: CHROME } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  const consoleErrors = [];
  const consoleWarnings = [];
  let sawIntegrityVerified = false; // H6: the now-default DuckDB SHA-384 preflight ran + passed
  // Dedicated workers the page spawns. The Facet metric leg asserts against this:
  // a metric that silently fell back to the main thread would still paint a
  // canvas, so "a graph-metrics worker was actually created" is the only proof
  // that the off-thread path (not just the picker) ran.
  const spawnedWorkers = [];
  page.on('worker', (w) => spawnedWorkers.push(w.url()));
  page.on('console', (msg) => {
    const type = msg.type();
    if (msg.text().includes('DuckDB integrity verified')) sawIntegrityVerified = true;
    if (type === 'error') {
      consoleErrors.push(msg.text());
      log(`console error: ${msg.text()}`);
    } else if (type === 'warning') {
      consoleWarnings.push(msg.text());
      log(`console warning: ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => {
    consoleErrors.push(err.message);
    log(`page error: ${err.message}`);
  });

  // Egress in this sandbox blocks cdn.jsdelivr.net, so force the vendored
  // fallback path (?offline=1) for the smoke test.
  const targetUrl = `${url}/index.html?offline=1&webmcp=1`;
  log(`loading ${targetUrl}`);
  // 'load' (not 'domcontentloaded'): the app hydrates after DOMContentLoaded,
  // so waiting for the full load event reduces flake on slower CI runners.
  await page.goto(targetUrl, { waitUntil: 'load' });
  const nativeWebMcpPresent = await page.evaluate(() => 'modelContext' in document);

  // 1. The shell mounted.
  await page.waitForSelector('.shell-header', { timeout: 5000 });
  const brand = await page.textContent('.brand');
  if (!brand || !brand.includes('NakliData')) fail(`brand not found: ${brand}`);
  const headerAt1280 = await page.evaluate(() => {
    const header = document.querySelector('.shell-header');
    const visible = (selector) => {
      const el = document.querySelector(selector);
      if (!(el instanceof HTMLElement)) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= innerWidth;
    };
    return {
      noOverflow: !!header && header.scrollWidth <= header.clientWidth,
      primariesVisible: [
        '[data-action="load"]',
        '[data-action="save"]',
        '[data-action="open-settings"]',
        '[data-action="open-help"]',
      ].every(visible),
      menus: Array.from(document.querySelectorAll('.header-menu > summary')).map(
        (summary) => summary.textContent?.trim() ?? '',
      ),
    };
  });
  if (!headerAt1280.noOverflow || !headerAt1280.primariesVisible) {
    fail(`1280px header overflow/visibility regression: ${JSON.stringify(headerAt1280)}`);
  }
  if (JSON.stringify(headerAt1280.menus) !== JSON.stringify(['Workbook', 'Explore', 'Model'])) {
    fail(`header information architecture drifted: ${JSON.stringify(headerAt1280.menus)}`);
  }
  log('✓ 1280×720 header: primary actions visible; Workbook/Explore/Model menus fit');
  const railWidths = [];
  for (const action of ['toggle-sources-rail', 'toggle-schema-rail']) {
    const before = await page
      .locator('.center')
      .evaluate((node) => node.getBoundingClientRect().width);
    await page.click(`[data-action="${action}"]`);
    const collapsed = await page
      .locator('.center')
      .evaluate((node) => node.getBoundingClientRect().width);
    await page.click(`[data-action="${action}"]`);
    const restored = await page
      .locator('.center')
      .evaluate((node) => node.getBoundingClientRect().width);
    railWidths.push({ action, before, collapsed, restored });
  }
  if (
    railWidths.some(
      ({ before, collapsed, restored }) => collapsed <= before || Math.abs(restored - before) > 1,
    )
  ) {
    fail(`rail collapse/restore regression: ${JSON.stringify(railWidths)}`);
  }
  log('✓ Sources and Schema rails collapse and restore notebook width');
  log('✓ shell mounted');

  // 2. Engine boots — wait for the footer to read "ready". This pulls
  // DuckDB-wasm from jsDelivr; allow up to 60 s in case CDN is slow.
  log('waiting for engine boot (CDN load)');
  await page.waitForFunction(
    () => document.querySelector('[data-region="engine-status"]')?.textContent === 'Engine: ready',
    null,
    { timeout: 90000 },
  );
  log('✓ engine ready');

  // 2-bis. H6 (DECISIONS DY): the DuckDB SHA-384 integrity preflight is now ON BY
  // DEFAULT for the same-origin vendored path (smoke boots ?offline=1). Assert it
  // actually ran + passed — the engine booted, so a present-and-matching manifest
  // was verified; a regression (skipped check, or a fail-closed break) fails here.
  if (!sawIntegrityVerified) {
    fail(
      'H6: DuckDB integrity preflight did NOT run by default (?offline=1) — expected the verify marker',
    );
  }
  log('✓ H6: DuckDB integrity preflight ran + passed by default (same-origin vendored path)');

  // 3. Empty state is visible.
  const heading = await page.textContent('.empty-state h1');
  if (!heading?.includes('What do you have?')) fail(`empty-state heading: ${heading}`);
  log('✓ empty state visible');

  // 3w. First-run welcome splash. A fresh browser context has no
  // `naklidata.welcomed` flag, so the splash auto-opens at the end of boot()
  // and overlays the empty state — it MUST be dismissed before the mount
  // buttons underneath are clickable. Assert it appeared and links the guide,
  // then dismiss it (which persists the seen-flag for the rest of the run).
  await page.waitForSelector('.help-overlay', { timeout: 15000 });
  const splashGuideHref = await page.getAttribute(
    '.help-overlay a[href*="guide/index.html"]',
    'href',
  );
  if (!splashGuideHref?.includes('guide/index.html')) {
    fail(`welcome splash is missing the guide link (got: ${splashGuideHref})`);
  }
  await page.click('.help-overlay [data-close]');
  await page.waitForFunction(() => document.querySelector('.help-overlay') === null, null, {
    timeout: 5000,
  });
  log('✓ first-run welcome splash: appears, links the guide, dismisses cleanly');

  // 3h. Header Help button → help modal, which also links the full guide.
  await page.click('[data-action="open-help"]');
  await page.waitForSelector('.help-overlay', { timeout: 5000 });
  const helpGuideHref = await page.getAttribute(
    '.help-overlay a[href*="guide/index.html"]',
    'href',
  );
  if (!helpGuideHref?.includes('guide/index.html')) {
    fail(`help modal is missing the guide link (got: ${helpGuideHref})`);
  }
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.help-overlay') === null, null, {
    timeout: 5000,
  });
  log('✓ Help button → help modal links the guide + Escape-closes');

  // 3a. Remote-source mount buttons open + close cleanly without
  // console errors. Spec gates for Wave 2/3 modal hygiene — each modal
  // should mount, accept Escape, tear down cleanly.
  const REMOTE_MODALS = [
    { trigger: 'mount-url', overlay: '.mount-url-overlay' },
    { trigger: 'mount-s3', overlay: '.mount-s3-overlay' },
    { trigger: 'mount-iceberg', overlay: '.mount-iceberg-overlay' },
    { trigger: 'mount-compute-bridge', overlay: '.mount-bridge-overlay' },
    { trigger: 'mount-compute-bridge-catalog', overlay: '.mount-bridge-catalog-overlay' },
  ];
  const errorsBeforeModalCycle = consoleErrors.length;
  for (const m of REMOTE_MODALS) {
    await page.click(`[data-action="${m.trigger}"]`);
    await page.waitForSelector(m.overlay, { timeout: 3000 });
    await page.keyboard.press('Escape');
    await page.waitForFunction((sel) => document.querySelector(sel) === null, m.overlay, {
      timeout: 2000,
    });
  }
  const modalCycleErrors = consoleErrors.length - errorsBeforeModalCycle;
  if (modalCycleErrors > 0) {
    fail(`remote-source modal open/close cycle produced ${modalCycleErrors} console error(s)`);
  }
  log(`✓ remote-source modals open + Escape-close cleanly (${REMOTE_MODALS.length} modals)`);

  const sourcePickerTruth = await page.evaluate(() => {
    const groupLabels = Array.from(document.querySelectorAll('.source-option-group h2')).map(
      (el) => el.textContent?.trim() ?? '',
    );
    const iceberg = document.querySelector('[data-action="mount-iceberg"]');
    const catalog = document.querySelector('[data-action="mount-iceberg-catalog"]');
    const bridge = document.querySelector('[data-action="mount-compute-bridge"]');
    const demo = document.querySelector('[data-action="browse-examples"]');
    return {
      groupLabels,
      icebergDisabled: iceberg instanceof HTMLButtonElement && iceberg.disabled,
      catalogDisabled: catalog instanceof HTMLButtonElement && catalog.disabled,
      icebergHint: iceberg?.textContent ?? '',
      bridgeCopy: bridge?.textContent ?? '',
      demoCopy: demo?.textContent ?? '',
      version: document.querySelector('.shell-header .crumb')?.textContent ?? '',
    };
  });
  const expectedGroups = ['Local data', 'Object storage', 'Catalogs', 'Warehouse compute'];
  if (JSON.stringify(sourcePickerTruth.groupLabels) !== JSON.stringify(expectedGroups)) {
    fail(`source picker groups drifted: ${JSON.stringify(sourcePickerTruth.groupLabels)}`);
  }
  if (sourcePickerTruth.icebergDisabled || !sourcePickerTruth.catalogDisabled) {
    fail('source picker Iceberg readiness does not match the public-only release boundary');
  }
  if (!/Public HTTPS/i.test(sourcePickerTruth.icebergHint)) {
    fail(`Iceberg table card lacks the public-only boundary: ${sourcePickerTruth.icebergHint}`);
  }
  if (!/Advanced/i.test(sourcePickerTruth.bridgeCopy)) {
    fail(`Compute Bridge is not labelled advanced/BYO: ${sourcePickerTruth.bridgeCopy}`);
  }
  if (!/Try the demo/i.test(sourcePickerTruth.demoCopy)) {
    fail(`demo CTA still uses stale wording: ${sourcePickerTruth.demoCopy}`);
  }
  if (!/^v\d+\.\d+\.\d+-\d+-g[0-9a-f]+(?:-dirty)?$/.test(sourcePickerTruth.version)) {
    fail(`header does not show a real git-derived build: ${sourcePickerTruth.version}`);
  }
  log('✓ source picker readiness: public Iceberg table enabled, REST gated, Bridge advanced');

  // 3b. Real remote-mount attempts (M30/SB2, DECISIONS 2026-07-09) — these
  // exercise the mount *machinery*, not just modal open/close, guarding two
  // regressions the hygiene leg above cannot see:
  //   (i)  An S3 mount must LOAD the httpfs extension from the vendored
  //        offline dir and reach the network layer. Before httpfs was
  //        vendored into scripts/fetch-duckdb-extensions.mjs, the default
  //        offline boot pinned the extension repo local, so INSTALL/LOAD
  //        httpfs 404'd → ExtensionLoadError → every S3 mount died. We
  //        point the form at an unreachable endpoint and assert the mount
  //        fails at the *network* stage (some IO error), NOT at extension
  //        load ("Could not load DuckDB extension"). Reaching the network
  //        stage proves httpfs loaded.
  // Iceberg is deliberately absent from this machinery leg: its cards are
  // disabled above until real URL + REST Catalog endpoints pass release smoke.
  const s3Host = new URL(url).host;
  await page.click('[data-action="mount-s3"]');
  await page.waitForSelector('.mount-s3-overlay', { timeout: 3000 });
  await page.fill('.mount-s3-overlay [data-region="endpoint-input"]', s3Host);
  await page.fill('.mount-s3-overlay [data-region="region-input"]', 'us-east-1');
  await page.fill('.mount-s3-overlay [data-region="bucket-input"]', 'smoke-bucket');
  await page.selectOption('.mount-s3-overlay [data-region="url-style-input"]', 'path');
  await page.fill('.mount-s3-overlay [data-region="path-prefix-input"]', 'data/x.parquet');
  await page.fill('.mount-s3-overlay [data-region="access-key-input"]', 'AKIAEXAMPLE');
  await page.fill('.mount-s3-overlay [data-region="secret-key-input"]', 'secretexample123');
  await page.click('.mount-s3-overlay [data-action="confirm-mount-s3"]');
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.mount-s3-overlay [data-region="error"]');
      return !!el && !el.hidden && (el.textContent ?? '').trim().length > 0;
    },
    null,
    { timeout: 45000 },
  );
  const s3Error = await page.evaluate(
    () => document.querySelector('.mount-s3-overlay [data-region="error"]')?.textContent ?? '',
  );
  if (/could not load duckdb extension/i.test(s3Error)) {
    fail(`S3 mount died at extension load — httpfs not vendored/loadable offline: ${s3Error}`);
  }
  log(`✓ S3 mount loaded httpfs from vendored bytes, failed at network as expected`);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.mount-s3-overlay') === null, null, {
    timeout: 2000,
  });

  // 4. Click "Try the demo" to mount the bundled sources.
  await page.click('[data-action="browse-examples"]');
  log('clicked browse-examples');

  // Wait for sources panel to populate.
  await page.waitForFunction(() => document.querySelectorAll('.source-row').length > 0, null, {
    timeout: 30000,
  });
  const sourceRowCount = await page.evaluate(() => document.querySelectorAll('.source-row').length);
  log(`✓ sources mounted (${sourceRowCount} tables in sources panel)`);
  // We expect 4 tables: 3 CSVs (vendors, invoices, payments) + the JSONL
  // access log. Theme 1 wave 3 (2026-05-23) vendored the json extension
  // into `public/duckdb-extensions/` so the JSONL load works fully
  // offline; before that landed, this assertion was a tolerant `>= 3`.
  if (sourceRowCount < 4) fail(`expected ≥4 tables, got ${sourceRowCount}`);
  await page.waitForSelector('.cell[data-cell-id="demo_vendor_spend"] .result-table tbody tr', {
    timeout: 30000,
  });
  await page.waitForSelector('.cell[data-cell-id="demo_vendor_chart"] svg', { timeout: 30000 });
  await page.waitForSelector('.cell[data-cell-id="demo_quality"] .assertion-verdict--pass', {
    timeout: 30000,
  });
  const demoNumber = await page.evaluate(() => {
    const cell = document.querySelector('.cell[data-cell-id="demo_vendor_spend"]');
    const columns = Array.from(cell?.querySelectorAll('th') ?? []).map(
      (header) => header.textContent?.trim() ?? '',
    );
    const idx = columns.indexOf('total_billed');
    const td = idx >= 0 ? cell?.querySelector(`tbody tr td:nth-child(${idx + 1})`) : null;
    return { text: td?.textContent ?? '', title: td?.getAttribute('title') ?? '' };
  });
  if (!demoNumber.text.includes(',') || !/exact value:/i.test(demoNumber.title)) {
    fail(`demo analytical number formatting regressed: ${JSON.stringify(demoNumber)}`);
  }
  log('✓ deterministic demo produced vendor-spend result, chart, PASS check, and formatted totals');

  // 5. Wait for the schema panel to classify at least some columns.
  log('waiting for classification');
  await page.waitForFunction(() => document.querySelectorAll('.schema-column').length >= 10, null, {
    timeout: 60000,
  });
  const colsTotal = await page.evaluate(() => document.querySelectorAll('.schema-column').length);
  log(`✓ schema panel rendered ${colsTotal} column rows`);

  const classified = await page.evaluate(() => {
    const cols = Array.from(document.querySelectorAll('.schema-column'));
    let typed = 0;
    let highConf = 0;
    let unknown = 0;
    for (const c of cols) {
      const pill = c.querySelector('.type-pill span:nth-of-type(2)');
      const pct = c.querySelector('.confidence-pct')?.textContent ?? '';
      const num = Number.parseInt(pct, 10);
      const label = pill?.textContent ?? '';
      if (label.startsWith('unknown<')) unknown++;
      else {
        typed++;
        if (num >= 80) highConf++;
      }
    }
    return { typed, highConf, unknown, total: cols.length };
  });
  log(
    `classification: typed=${classified.typed} highConf(≥80%)=${classified.highConf} unknown=${classified.unknown} total=${classified.total}`,
  );
  if (classified.typed < 15) {
    fail(`expected ≥15 typed columns, got ${classified.typed}`);
  }
  log('✓ ≥15 columns assigned a semantic type');
  const evidencePresentation = await page.evaluate(() => {
    const first = document.querySelector('.schema-column');
    first?.querySelector('[data-action="evidence"]')?.click();
    return {
      summary: first?.querySelector('.evidence-bullets li > span')?.textContent?.trim() ?? '',
      technical: first?.querySelector('.evidence-technical code')?.textContent?.trim() ?? '',
    };
  });
  if (
    !evidencePresentation.summary ||
    /header ==|regex match|value-set|cardinality|length∈/.test(evidencePresentation.summary) ||
    !evidencePresentation.technical
  ) {
    fail(`classification evidence presentation regressed: ${JSON.stringify(evidencePresentation)}`);
  }
  log('✓ classification evidence leads with plain language and preserves technical detail');

  // 5b. Cleaning surface (C0). The fixture is clean, so EJ-3 says the panel
  // must show NOTHING — that silence is the feature, and a regression that
  // sprouts advice on every column would be invisible without this check.
  // Then force a dirty column through the real registry + real click path and
  // assert EJ-1: it emits an UN-RUN cell, and never a mutation.
  const cleanPanel = await page.evaluate(() => ({
    fixes: [...document.querySelectorAll('[data-action="apply-fix"], [data-action="apply-table-fix"]')].map(
      (b) => ({
        col: b.dataset.column,
        fix: b.dataset.fixId,
        why: (b.getAttribute('title') || '').slice(0, 120),
      }),
    ),
    counts: [...document.querySelectorAll('.schema-clean-count')].map((el) =>
      (el.textContent || '').trim(),
    ),
  }));
  if (cleanPanel.fixes.length !== 0 || cleanPanel.counts.some((count) => count !== 'Clean 0')) {
    fail(
      `cleaning: clean fixture roll-up regressed — EJ-3 says Clean 0 with no actions: ${JSON.stringify(cleanPanel)}`,
    );
  }
  // Now the dirty path, driven for real: mount a CSV whose values carry
  // whitespace (written into dist/ by this script, so nothing ships to
  // production), let classification sample it, and assert the suggestion
  // appears and that clicking it emits an UN-RUN cell.
  const cellsBeforeFix = await page.evaluate(
    () => document.querySelectorAll('.cell[data-cell-kind="sql"]').length,
  );
  // A source is already mounted by now, so the empty-state option cards are
  // gone — the mount picker lives behind "+ Add source".
  if ((await page.locator('[data-action="mount-url"]').count()) === 0) {
    await page.click('[data-action="add-source"]');
    await page.waitForSelector('[data-action="mount-url"]', { timeout: 10000 });
  }
  await page.click('[data-action="mount-url"]');
  await page.waitForSelector('.mount-url-overlay', { timeout: 10000 });
  await page.fill('[data-region="url-input"]', `${url}/__smoke_dirty.csv`);
  await page.click('[data-action="confirm-mount-url"]');
  await page.waitForFunction(() => !document.querySelector('.mount-url-overlay'), null, {
    timeout: 60000,
  });
  // Wait for the suggestion to appear (classification is async).
  await page.waitForSelector('.schema-column [data-action="apply-fix"][data-fix-id="trim"]', {
    timeout: 60000,
    state: 'attached',
  });
  const suggestion = await page.evaluate(() => {
    const b = document.querySelector(
      '.schema-column [data-action="apply-fix"][data-fix-id="trim"]',
    );
    const summary = b?.closest('.schema-table')?.querySelector('.schema-clean-summary');
    if (summary instanceof HTMLDetailsElement) summary.open = true;
    return {
      label: (b?.textContent || '').trim(),
      title: b?.getAttribute('title') || '',
      count: (summary?.querySelector('summary')?.textContent || '').trim(),
      grouped: Boolean(summary?.querySelector('[data-action="apply-fix"][data-fix-id="trim"]')),
      copy: (summary?.querySelector('p')?.textContent || '').trim(),
    };
  });
  if (!/whitespace/i.test(suggestion.title)) {
    fail(`cleaning: fix has no rationale in its tooltip (${suggestion.title})`);
  }
  if (!/^Clean [1-9]\d*$/.test(suggestion.count) || !suggestion.grouped || !/editable, un-run/i.test(suggestion.copy)) {
    fail(`cleaning: table roll-up did not expose grouped suggestions: ${JSON.stringify(suggestion)}`);
  }
  await page.evaluate(() => {
    const button = document.querySelector(
      '.schema-clean-summary [data-action="apply-fix"][data-fix-id="trim"]',
    );
    if (!(button instanceof HTMLElement)) throw new Error('Grouped trim action missing.');
    button.click();
  });
  await page.waitForFunction(
    (n) => document.querySelectorAll('.cell[data-cell-kind="sql"]').length > n,
    cellsBeforeFix,
    { timeout: 15000 },
  );
  const emitted = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.cell[data-cell-kind="sql"]')];
    const last = cells[cells.length - 1];
    return {
      code: (last.querySelector('.cm-content, textarea')?.textContent || '').trim(),
      // EJ-1: the emitted cell must be UN-RUN — no result table yet.
      hasResult: !!last.querySelector('table td'),
    };
  });
  if (!/TRIM\(/i.test(emitted.code) || !/SELECT \* REPLACE/i.test(emitted.code)) {
    fail(`cleaning: emitted cell is not the trim fix (${emitted.code.slice(0, 90)})`);
  }
  if (/\b(UPDATE|DELETE|CREATE|ALTER|DROP|INSERT)\b/i.test(emitted.code)) {
    fail(
      `cleaning: emitted cell contains a mutation — EJ-1 forbids it (${emitted.code.slice(0, 90)})`,
    );
  }
  if (emitted.hasResult) {
    fail('cleaning: the emitted cell already ran — EJ-1 says propose, the human runs it');
  }
  log(
    `✓ Cleaning surface: clean fixture reports Clean 0 · grouped dirty suggestion "${suggestion.label}" emitted an UN-RUN trim cell`,
  );

  // Agent value access is explicit and per-tab. Prove both sensitive scopes
  // start denied, then grant only values for the bounded read checks below.
  await page.click('[data-action="open-settings"]');
  await page.waitForSelector('[data-agent-scope="values:read"]', { timeout: 10000 });
  const initialValueGrant = page.locator('[data-agent-scope="values:read"]');
  const initialProposalGrant = page.locator('[data-agent-scope="workspace:propose"]');
  if ((await initialValueGrant.isChecked()) || (await initialProposalGrant.isChecked())) {
    fail('agent access: sensitive scopes were not denied by default');
  }
  await initialValueGrant.check();
  await page.click('[data-action="close-settings"]');

  // KAG-01: mount a no-range Latin-1 response through the production public-URL
  // UI, then query the owned relation twice through the bounded read surface.
  await page.click('[data-action="add-source"]');
  await page.waitForSelector('[data-action="mount-url"]', { timeout: 10000 });
  await page.click('[data-action="mount-url"]');
  await page.waitForSelector('.mount-url-overlay', { timeout: 10000 });
  await page.fill('[data-region="url-input"]', `${url}/__smoke_latin1.csv`);
  await page.click('[data-action="confirm-mount-url"]');
  await page.waitForFunction(() => !document.querySelector('.mount-url-overlay'), null, {
    timeout: 60000,
  });
  const remoteDelimited = await page.evaluate(async () => {
    const nd = window.naklidata;
    if (!nd) return { error: 'window.naklidata is not bound' };
    const listed = await nd.listTables();
    if (!listed?.ok) return { error: listed?.error ?? 'listTables failed' };
    const table = listed.data.find((item) => item.name === 'smoke_latin1');
    if (!table) return { error: 'materialized table was not listed' };
    const first = await nd.query({ sql: 'SELECT sku FROM smoke_latin1' });
    const second = await nd.query({ sql: 'SELECT sku FROM smoke_latin1' });
    const card = Array.from(document.querySelectorAll('.source-card')).find((item) =>
      item.textContent?.includes('__smoke_latin1.csv'),
    );
    return {
      first: first.ok ? first.data.rowCount : -1,
      second: second.ok ? second.data.rowCount : -1,
      firstError: first.ok ? null : first.error,
      secondError: second.ok ? null : second.error,
      provenance: card?.querySelector('strong')?.getAttribute('title') ?? '',
    };
  });
  if (remoteDelimited.error) fail(`remote CSV materialization: ${remoteDelimited.error}`);
  if (remoteDelimited.first !== 3 || remoteDelimited.second !== 3) {
    fail(`remote CSV materialization returned unstable counts: ${JSON.stringify(remoteDelimited)}`);
  }
  if (!/materialized once.*Windows-1252/i.test(remoteDelimited.provenance)) {
    fail(`remote CSV provenance is incomplete: ${remoteDelimited.provenance}`);
  }
  log('✓ public CSV: no-range Latin-1 response materialized once · repeated scans = 3 rows');

  // 6. Templates panel: "Vendor concentration" should be applicable.
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('.template-card strong')).some(
        (n) => n.textContent === 'Vendor concentration',
      ),
    null,
    { timeout: 10000 },
  );
  log('✓ "Vendor concentration" template is applicable');

  // 7. Click "Add" on Vendor concentration. Then run all cells.
  await page.evaluate(() => {
    const card = Array.from(document.querySelectorAll('.template-card')).find(
      (c) => c.querySelector('strong')?.textContent === 'Vendor concentration',
    );
    card?.querySelector('[data-action="instantiate"]')?.click();
  });
  log('instantiated Vendor concentration template');

  // Wait for the SQL cell to appear with code (the template adds an MD + SQL + chart).
  // The editor may be a textarea (initial render) OR CodeMirror 6 (after the
  // lazy chunk loads); look for the SQL text in either.
  await page.waitForFunction(
    () => {
      const sqlCells = document.querySelectorAll('.cell[data-cell-kind="sql"]');
      return Array.from(sqlCells).some((c) => {
        const ta = c.querySelector('textarea');
        if (ta && /vendor/i.test(ta.value)) return true;
        const cm = c.querySelector('.cm-content');
        if (cm && /vendor/i.test(cm.textContent ?? '')) return true;
        return false;
      });
    },
    null,
    { timeout: 10000 },
  );
  log('✓ template cells inserted');

  // 8. Run all. We click the toolbar "Run all" button.
  await page.click('[data-nb-action="run-all"]');
  log('clicked run-all');

  // Wait for the SQL cell to have a result row.
  await page.waitForFunction(
    () => {
      const tables = document.querySelectorAll(
        '.cell[data-cell-kind="sql"] .result-table tbody tr',
      );
      return tables.length > 0;
    },
    null,
    { timeout: 30000 },
  );
  const resultRows = await page.evaluate(
    () => document.querySelectorAll('.cell[data-cell-kind="sql"] .result-table tbody tr').length,
  );
  log(`✓ SQL cell ran (${resultRows} result rows visible)`);

  // 9. The chart cell renders an SVG (bar chart) once the SQL cell has results.
  await page.waitForFunction(
    () => document.querySelectorAll('.cell[data-cell-kind="chart"] svg').length > 0,
    null,
    { timeout: 30000 },
  );
  log('✓ chart cell rendered SVG');

  // 9aa. Resolve M1 — the "Cluster" chip opens the fuzzy-merge modal, running
  // the chip → handler → engine GROUP BY → core clustering → CASE-emitter path
  // end-to-end in the real browser. tsc + vitest can't catch the live GROUP BY
  // query or the modal's DOM wiring; only a real run does.
  await page.click('.cell[data-cell-kind="sql"] [data-action="cluster-result"]');
  await page.waitForSelector('.cluster-overlay', { timeout: 10000 });
  const clusterModal = await page.evaluate(() => {
    const overlay = document.querySelector('.cluster-overlay');
    if (!overlay) return { ok: false };
    const preview = overlay.querySelector('[data-region="cl-preview"]')?.textContent ?? '';
    return {
      ok: true,
      hasColumn: !!overlay.querySelector('[data-region="cl-column"]'),
      hasMethod: !!overlay.querySelector('[data-action="cl-method-key"]'),
      // The emitter ran with the real result column: preview has the merged alias.
      emitsMergedAlias: /AS\s+"[^"]+__merged"/.test(preview),
    };
  });
  if (
    !clusterModal.ok ||
    !clusterModal.hasColumn ||
    !clusterModal.hasMethod ||
    !clusterModal.emitsMergedAlias
  ) {
    throw new Error(`cluster modal did not render correctly: ${JSON.stringify(clusterModal)}`);
  }
  await page.click('.cluster-overlay [data-action="cl-close"]');
  await page.waitForFunction(() => document.querySelector('.cluster-overlay') === null, null, {
    timeout: 5000,
  });
  log('✓ Cluster modal: chip → GROUP BY → core → CASE-emit path renders + closes');

  // 9ab. Resolve M2 — the Semantic panel now manages Segments (SEGMENT(name))
  // alongside measures + dimensions. Verify the section + add-form render.
  await page.click('[data-header-menu="model"] > summary');
  await page.click('[data-action="open-measures"]');
  await page.waitForSelector('.measures-overlay', { timeout: 10000 });
  const semanticPanel = await page.evaluate(() => {
    const overlay = document.querySelector('.measures-overlay');
    if (!overlay) return { ok: false };
    const text = overlay.textContent ?? '';
    return {
      ok: true,
      hasSegments: text.includes('SEGMENT(name)'),
      hasSegForm: !!overlay.querySelector('[data-region="s-name"]'),
    };
  });
  if (!semanticPanel.ok || !semanticPanel.hasSegments || !semanticPanel.hasSegForm) {
    throw new Error(
      `Semantic panel missing the Segments section: ${JSON.stringify(semanticPanel)}`,
    );
  }
  await page.click('.measures-overlay [data-action="measures-close"]');
  await page.waitForFunction(() => document.querySelector('.measures-overlay') === null, null, {
    timeout: 5000,
  });
  log('✓ Semantic panel renders the Segments section (SEGMENT macro) + add-form');

  // 9ac. Resolve M3 — the golden-table sink collapses to one row per canonical
  // entity with survivorship rules. Verify the sink is registered on the result
  // and its modal (entity picker + live survivorship SQL preview) opens.
  const goldenOpened = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.cell[data-cell-kind="sql"] button'));
    const btn = btns.find((b) => b.textContent?.trim() === 'Export golden table');
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!goldenOpened) throw new Error('golden-table sink button not found on the SQL result');
  await page.waitForSelector('.golden-overlay', { timeout: 10000 });
  const goldenModal = await page.evaluate(() => {
    const overlay = document.querySelector('.golden-overlay');
    if (!overlay) return { ok: false };
    const preview = overlay.querySelector('[data-region="g-preview"]')?.textContent ?? '';
    return {
      ok: true,
      hasEntity: !!overlay.querySelector('[data-region="g-entity"]'),
      emitsGroupBy: /GROUP BY/.test(preview),
    };
  });
  if (!goldenModal.ok || !goldenModal.hasEntity || !goldenModal.emitsGroupBy) {
    throw new Error(`golden modal did not render correctly: ${JSON.stringify(goldenModal)}`);
  }
  await page.click('.golden-overlay [data-action="g-cancel"]');
  await page.waitForFunction(() => document.querySelector('.golden-overlay') === null, null, {
    timeout: 5000,
  });
  log('✓ Golden-table sink: modal opens (entity picker + survivorship SQL preview with GROUP BY)');

  // 9a. M2 lineage — the template's SQL cell reads a mounted example source
  // (a CSV registered as a VIEW over read_csv_auto). Source→cell lineage must
  // be recorded. Regression guard for the empty-lineage bug: duckdb-wasm
  // 1.29.0 inlines the view and emits trailing-space op names with no file
  // path, so a plan-only walk returned [] and the panel stayed empty. The
  // catalog-filtered SQL sniff (unioned with the plan walk) recovers the
  // mounted table, which lineage resolves to the stable source id + source
  // label. This whole class slips past tsc + vitest — only a live run catches
  // it.
  // recordLineageForCell is fire-and-forget after the result ships (notebook
  // .ts), and the panel renders a snapshot at open time — so poll by
  // reopening until lineage lands (the EXPLAIN + information_schema sniff
  // finishes shortly after the rows render). ~6 s budget.
  let lineage = { empty: true, hasSource: false };
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await page.click('[data-header-menu="explore"] > summary');
    await page.click('[data-action="open-lineage"]');
    await page.waitForSelector('.lineage-list', { timeout: 5000 });
    lineage = await page.evaluate(() => {
      const txt = document.querySelector('.lineage-list')?.textContent ?? '';
      return {
        empty: txt.includes('No lineage recorded yet'),
        hasSource:
          document.querySelector('.lineage-list .lineage-row-source .lineage-kind-source') !== null,
      };
    });
    if (!lineage.empty && lineage.hasSource) break;
    await page.click('[data-action="close-lineage"]').catch(() => {});
    await page
      .waitForSelector('.lineage-list', { state: 'detached', timeout: 5000 })
      .catch(() => {});
    await page.waitForTimeout(500);
  }
  if (lineage.empty) fail('lineage panel is empty after running a source-reading SQL cell');
  if (!lineage.hasSource)
    fail('lineage panel recorded no mounted-source node (source→cell edge missing)');
  log('✓ source→cell lineage recorded (panel shows a mounted-source node)');
  const annotations = page.locator('[data-action="toggle-lineage-edit"]');
  if (!(await annotations.isVisible()))
    fail('lineage visual-annotation control is missing for a populated graph');
  if ((await annotations.textContent())?.trim() !== 'Annotations')
    fail('lineage graph edits are not labeled as visual annotations');
  await annotations.click();
  const annotationHint = await page.locator('.lineage-edit-hint').textContent();
  if (!annotationHint?.includes('do not create or delete notebook cells, sources, or data'))
    fail('lineage annotation surface does not disclose its visual-only scope');
  log('✓ lineage mutations are disclosed as visual-only annotations');
  // Close the panel so it doesn't overlay later steps.
  await page.click('[data-action="close-lineage"]').catch(() => {});
  await page.waitForSelector('.lineage-list', { state: 'detached', timeout: 5000 }).catch(() => {});

  // 9b. Prepare the Cloud-BYOK sidecar path against a MOCKED
  //     transport. The local-model provider can't run headless (needs
  //     WebGPU + a multi-GB download), and we never put a real BYOK key in
  //     CI (secrets/telemetry are Hard NOTs). So we monkeypatch
  //     `window.fetch` to return a canned chat-completion (a JS-returned
  //     Response makes no real request — CSP-clean), set a dummy key, and
  //     drive the syntax-error job below through the WHOLE path we own:
  //     disclosure → consent → dispatch → provider call → parse → render.
  //     This is what catches a regression
  //     in that wiring; the live network/auth leg stays a manual BYOK check.
  //     Handles both the Anthropic + OpenAI response shapes so it works
  //     against whatever the default provider is. (Added 2026-06-13 after
  //     the cloud path was asserted-but-not-verified — DECISIONS AU.)
  await page.evaluate(() => {
    const CANNED = JSON.stringify({
      explanation: 'SMOKE_SIDECAR_OK — use SELECT instead of SELEKT.',
      suggested_fix: 'SELECT * FROM invoices LIMIT 1',
    });
    window.__origFetch = window.fetch.bind(window);
    window.__origConfirm = window.confirm.bind(window);
    window.__cloudSidecarDisclosure = '';
    window.confirm = (message) => {
      window.__cloudSidecarDisclosure = String(message);
      return true;
    };
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (/api\.anthropic\.com|\/v1\/messages/i.test(url)) {
        return Promise.resolve(
          new Response(JSON.stringify({ content: [{ type: 'text', text: CANNED }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      if (/api\.openai\.com|chat\/completions/i.test(url)) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ choices: [{ message: { content: CANNED }, finish_reason: 'stop' }] }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      return window.__origFetch(input, init);
    };
    // Dummy BYOK keys (sessionStorage is where loadKey looks first). No
    // real secret — the mocked fetch never validates them.
    sessionStorage.setItem('naklidata.byok.anthropic', 'sk-ant-smoke-dummy');
    sessionStorage.setItem('naklidata.byok.openai', 'sk-smoke-dummy');
  });
  // Enable the sidecar (keeps the default provider) via the Settings UI.
  await page.click('[data-action="open-settings"]');
  await page.waitForSelector('[data-action="settings-enable"]', { timeout: 5000 });
  const settingsGroups = await page.locator('.settings-group > h2').allTextContents();
  if (
    JSON.stringify(settingsGroups) !==
    JSON.stringify([
      'AI sidecar',
      'Privacy and display',
      'Connections and credentials',
      'Advanced / agents',
    ])
  ) {
    fail(`settings information architecture regressed: ${JSON.stringify(settingsGroups)}`);
  }
  const settingsCopy = await page.locator('.settings-modal').textContent();
  if (
    !settingsCopy?.includes('ask for confirmation before sending') ||
    !settingsCopy.includes('makes no basemap request')
  ) {
    fail('settings: cloud/basemap disclosure copy is missing');
  }
  await page.waitForSelector('[data-agent-scope="values:read"]', { timeout: 10000 });
  const agentValueToggle = page.locator('[data-agent-scope="values:read"]');
  const agentProposalToggle = page.locator('[data-agent-scope="workspace:propose"]');
  if (
    (await agentValueToggle.count()) !== 1 ||
    (await agentProposalToggle.count()) !== 1 ||
    !(await agentValueToggle.isChecked()) ||
    (await agentProposalToggle.isChecked())
  ) {
    fail('settings: per-tab value grant did not survive this workspace or proposal default changed');
  }
  await page.evaluate(() => {
    const en = document.querySelector('[data-action="settings-enable"]');
    if (en && !en.checked) {
      en.checked = true;
      en.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await page.click('[data-action="close-settings"]').catch(() => {});
  await delay(300);

  // 10. Add a SQL cell with a syntax error to verify error UX.
  const sqlCellCountBefore = await page.evaluate(
    () => document.querySelectorAll('.cell[data-cell-kind="sql"]').length,
  );
  await page.click('[data-nb-action="add-sql"]');
  await page.waitForFunction(
    (before) => document.querySelectorAll('.cell[data-cell-kind="sql"]').length > before,
    sqlCellCountBefore,
    { timeout: 5000 },
  );
  await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('.cell[data-cell-kind="sql"]'));
    const last = cells[cells.length - 1];
    if (!last) return;
    // Two paths: textarea (no CM6 yet) OR CM6 contenteditable. For CM6 we
    // dispatch a beforeinput event with the typo SQL — closest equivalent
    // to programmatic typing.
    const ta = last.querySelector('textarea');
    if (ta) {
      ta.value = 'SELEKT * FROM invoices LIMIT 1';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      const cm = last.querySelector('.cm-content');
      if (cm) {
        cm.textContent = 'SELEKT * FROM invoices LIMIT 1';
        cm.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    last.querySelector('[data-action="cell-run"]')?.click();
  });
  await page.waitForFunction(
    () => document.querySelector('.cell.errored .cell-output-error') !== null,
    null,
    { timeout: 10000 },
  );
  const errText = await page.textContent('.cell.errored .cell-output-error');
  log(`✓ syntax error surfaced inline: "${errText?.slice(0, 60)}…"`);
  await page.click('.cell.errored [data-action="explain-error"]');
  await page.waitForFunction(() => document.body.innerText.includes('SMOKE_SIDECAR_OK'), null, {
    timeout: 15000,
  });
  const cloudDisclosure = await page.evaluate(() => window.__cloudSidecarDisclosure ?? '');
  if (
    !/Provider: (anthropic|openai)/.test(cloudDisclosure) ||
    !/Payload: SQL text, error message, table and column names/.test(cloudDisclosure) ||
    !/still a network request/.test(cloudDisclosure)
  ) {
    fail(`cloud sidecar disclosure was missing or incomplete: ${cloudDisclosure}`);
  }
  await page.evaluate(() => {
    if (window.__origFetch) window.fetch = window.__origFetch;
    if (window.__origConfirm) window.confirm = window.__origConfirm;
  });
  log(
    '✓ cloud-BYOK sidecar: provider/payload disclosure → consent → mocked explain → parsed → rendered',
  );

  // 10b. Facet Embedding cell — add via the toolbar, verify the button wires
  // through addCell → renderEmbeddingCell and the column-picker chrome renders.
  // (The deck.gl scatter itself needs WebGL, not asserted headlessly.)
  await page.click('[data-nb-action="add-embedding"]');
  await page.waitForFunction(
    () => document.querySelector('.cell[data-cell-kind="embedding"]') !== null,
    null,
    { timeout: 5000 },
  );
  const embedOk = await page.evaluate(() => {
    const cell = document.querySelector('.cell[data-cell-kind="embedding"]');
    return (
      !!cell &&
      cell.querySelector('[data-action="embed-input"]') !== null &&
      (cell.textContent ?? '').includes('EMBED')
    );
  });
  if (!embedOk) throw new Error('embedding cell did not render its picker chrome');
  log('✓ Facet Embedding cell: add-embedding → cell + input picker rendered');

  // 10c. Embedding PCA path end-to-end: a real SQL cell emits a DOUBLE[]
  // embedding column; picking it as `emb` (no x/y) must coerce the Arrow
  // list values and PCA-project them. This is the integration seam unit
  // tests can't cover — what DuckDB-wasm actually returns for list columns.
  const embSqlBefore = await page.evaluate(
    () => document.querySelectorAll('.cell[data-cell-kind="sql"]').length,
  );
  await page.click('[data-nb-action="add-sql"]');
  await page.waitForFunction(
    (before) => document.querySelectorAll('.cell[data-cell-kind="sql"]').length > before,
    embSqlBefore,
    { timeout: 5000 },
  );
  // Type through the real input pipeline (CM6 ignores textContent swaps —
  // the step-10 injection trick garbles a doc that has to PARSE correctly).
  const embSqlCell = page.locator('.cell[data-cell-kind="sql"]').last();
  await embSqlCell.locator('.cm-content, textarea').first().click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(
    "SELECT i::VARCHAR AS label, CASE WHEN i % 2 = 0 THEN 'even' ELSE 'odd' END AS grp, " +
      '[cos(i*0.3), sin(i*0.3), (i % 5)::DOUBLE, ((i*7) % 11)::DOUBLE] AS emb FROM range(40) t(i)',
  );
  await embSqlCell.locator('[data-action="cell-run"]').click();
  try {
    await page.waitForFunction(
      () => {
        const cells = Array.from(document.querySelectorAll('.cell[data-cell-kind="sql"]'));
        const last = cells[cells.length - 1];
        return (
          !!last && !last.classList.contains('errored') && last.querySelector('table') !== null
        );
      },
      null,
      { timeout: 15000 },
    );
  } catch (e) {
    const dbg = await page.evaluate(() => {
      const cells = Array.from(document.querySelectorAll('.cell[data-cell-kind="sql"]'));
      const last = cells[cells.length - 1];
      return {
        cls: last?.className,
        text: (last?.textContent ?? '').slice(0, 300),
      };
    });
    log(`DEBUG emb sql cell: ${JSON.stringify(dbg)}`);
    throw e;
  }
  // Wire the embedding cell: input = the emb SQL cell, then emb = the array col.
  await page.evaluate(() => {
    const embed = document.querySelector('.cell[data-cell-kind="embedding"]');
    const sqlCells = Array.from(document.querySelectorAll('.cell[data-cell-kind="sql"]'));
    const src = sqlCells[sqlCells.length - 1];
    const sel = embed?.querySelector('[data-action="embed-input"]');
    if (!sel || !src) return;
    sel.value = src.dataset.cellId ?? '';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(
    () =>
      document
        .querySelector('.cell[data-cell-kind="embedding"]')
        ?.querySelector('[data-action="embed-emb"]') !== null,
    null,
    { timeout: 5000 },
  );
  await page.evaluate(() => {
    const embed = document.querySelector('.cell[data-cell-kind="embedding"]');
    const sel = embed?.querySelector('[data-action="embed-emb"]');
    if (!sel) return;
    sel.value = 'emb';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  // Success = the PCA path ran on real Arrow list values: either a deck.gl
  // canvas mounted (WebGL available) or the render-stage error appeared.
  // Coercion/projection failures ("No embedding vectors…", a stuck
  // "Projecting…", "Couldn't project…") are the regressions this catches.
  await page.waitForFunction(
    () => {
      const mountEl = document
        .querySelector('.cell[data-cell-kind="embedding"]')
        ?.querySelector('[data-region="embed-canvas"]');
      if (!mountEl) return false;
      if (mountEl.querySelector('canvas')) return true;
      const text = mountEl.textContent ?? '';
      if (text.includes('No embedding vectors') || text.includes("Couldn't project")) {
        throw new Error(`embedding PCA path failed: ${text.slice(0, 120)}`);
      }
      return text.includes("Couldn't render embedding map");
    },
    null,
    { timeout: 15000 },
  );
  const embPcaState = await page.evaluate(() => {
    const mountEl = document
      .querySelector('.cell[data-cell-kind="embedding"]')
      ?.querySelector('[data-region="embed-canvas"]');
    return mountEl?.querySelector('canvas') ? 'canvas' : (mountEl?.textContent ?? '').slice(0, 80);
  });
  log(`✓ Facet Embedding PCA path: DOUBLE[] column → coerce → project → ${embPcaState}`);

  // 10d. Find-similar via the automation seam: real GPU picking through
  // handle.simulateClick (synthetic pointer events can't reach deck.gl's
  // input manager). Grid-scan for a point, assert the tip pins with the
  // neighbour summary, then a background click clears it.
  if (embPcaState === 'canvas') {
    const similar = await page.evaluate(() => {
      const embed = document.querySelector('.cell[data-cell-kind="embedding"]');
      const mountEl = embed?.querySelector('[data-region="embed-canvas"]');
      const tip = embed?.querySelector('[data-region="embed-tip"]');
      const handle = mountEl?.__embedScatter;
      if (!handle) return { err: 'no __embedScatter seam on the mount' };
      const canvas = mountEl.querySelector('canvas');
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      let hit = null;
      outer: for (let gy = 1; gy < 10; gy++) {
        for (let gx = 1; gx < 10; gx++) {
          const idx = handle.simulateClick((w * gx) / 10, (h * gy) / 10, 12);
          if (idx !== null) {
            hit = idx;
            break outer;
          }
        }
      }
      if (hit === null) return { err: 'grid scan picked no point' };
      const pinnedTip = tip?.textContent ?? '';
      const pinned = tip?.dataset.pinned === '1';
      handle.simulateClick(1, 1, 0); // corner, radius 0 → background → clear
      return {
        hit,
        pinned,
        pinnedTip,
        clearedTip: tip?.textContent ?? '',
        cleared: tip?.dataset.pinned !== '1',
      };
    });
    if (similar.err) throw new Error(`embedding find-similar failed: ${similar.err}`);
    if (!similar.pinned || !/similar to/.test(similar.pinnedTip)) {
      throw new Error(
        `embedding find-similar: tip did not pin with neighbours ("${similar.pinnedTip}")`,
      );
    }
    if (!similar.cleared || similar.clearedTip !== '') {
      throw new Error('embedding find-similar: background click did not clear the selection');
    }
    log(
      `✓ Facet find-similar: picked #${similar.hit} → "${similar.pinnedTip.slice(0, 60)}…" → cleared`,
    );
  } else {
    log('~ Facet find-similar skipped (no WebGL canvas in this environment)');
  }

  // 10e. Facet Network cell — a real SQL edge list → in-house synchronous force
  // layout (core/force-layout: CSP-clean, no rAF stall) → deck.gl force-graph.
  // The layout runs under the app's real CSP, which the GPU-layout path can't
  // (new Function). Two 30-node communities so the layout is instant.
  const netSqlBefore = await page.evaluate(
    () => document.querySelectorAll('.cell[data-cell-kind="sql"]').length,
  );
  await page.click('[data-nb-action="add-sql"]');
  await page.waitForFunction(
    (before) => document.querySelectorAll('.cell[data-cell-kind="sql"]').length > before,
    netSqlBefore,
    { timeout: 5000 },
  );
  const netSqlCell = page.locator('.cell[data-cell-kind="sql"]').last();
  await netSqlCell.locator('.cm-content, textarea').first().click();
  await page.keyboard.press('ControlOrMeta+a');
  // Edge rows carry a categorical relation type (`rel` → edge colour + legend,
  // the Knowledge-graph view) and a numeric weight (`w` → edge width, the
  // Weighted view) so this leg exercises the attributed-edge path too.
  await page.keyboard.insertText(
    'WITH n AS (SELECT i, (i // 30) AS c FROM range(60) t(i)), ' +
      'e AS (SELECT a.i AS s, b.i AS d FROM n a JOIN n b ON a.c = b.c AND a.i < b.i ' +
      'AND (a.i * 7 + b.i * 13) % 5 < 2 UNION ALL SELECT 0, 30) ' +
      'SELECT s::VARCHAR AS src, d::VARCHAR AS tgt, ' +
      "CASE WHEN (s + d) % 3 = 0 THEN 'cites' WHEN (s + d) % 3 = 1 THEN 'authored' ELSE 'funded' END AS rel, " +
      '(1 + (s * 7 + d) % 9) AS w FROM e',
  );
  await netSqlCell.locator('[data-action="cell-run"]').click();
  await page.waitForFunction(
    () => {
      const cells = Array.from(document.querySelectorAll('.cell[data-cell-kind="sql"]'));
      const last = cells[cells.length - 1];
      return !!last && !last.classList.contains('errored') && last.querySelector('table') !== null;
    },
    null,
    { timeout: 15000 },
  );
  // Add the Network cell + wire input / source / target.
  await page.click('[data-nb-action="add-network"]');
  await page.waitForFunction(
    () => document.querySelector('.cell[data-cell-kind="network"]') !== null,
    null,
    { timeout: 5000 },
  );
  await page.evaluate(() => {
    const net = document.querySelector('.cell[data-cell-kind="network"]');
    const sqlCells = Array.from(document.querySelectorAll('.cell[data-cell-kind="sql"]'));
    const src = sqlCells[sqlCells.length - 1];
    const sel = net?.querySelector('[data-action="net-input"]');
    if (sel && src) {
      sel.value = src.dataset.cellId ?? '';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await page.waitForFunction(
    () =>
      document
        .querySelector('.cell[data-cell-kind="network"]')
        ?.querySelector('[data-action="net-source"]') !== null,
    null,
    { timeout: 5000 },
  );
  await page.evaluate(() => {
    const net = document.querySelector('.cell[data-cell-kind="network"]');
    const s = net?.querySelector('[data-action="net-source"]');
    if (s) {
      s.value = 'src';
      s.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await page.evaluate(() => {
    const net = document.querySelector('.cell[data-cell-kind="network"]');
    const t = net?.querySelector('[data-action="net-target"]');
    if (t) {
      t.value = 'tgt';
      t.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  // Attributed edges: colour by `rel` (→ legend) + width by `w`.
  await page.evaluate(() => {
    const net = document.querySelector('.cell[data-cell-kind="network"]');
    const c = net?.querySelector('[data-action="net-edge-color"]');
    if (c) {
      c.value = 'rel';
      c.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await page.evaluate(() => {
    const net = document.querySelector('.cell[data-cell-kind="network"]');
    const w = net?.querySelector('[data-action="net-edge-width"]');
    if (w) {
      w.value = 'w';
      w.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  // Success = deck.gl canvas mounted (layout ran under CSP + rendered), or the
  // graceful render-stage error. A stuck "Laying out…" or a CSP eval failure
  // (the GPU-path regression this guards) fails the wait.
  await page.waitForFunction(
    () => {
      const mountEl = document
        .querySelector('.cell[data-cell-kind="network"]')
        ?.querySelector('[data-region="net-canvas"]');
      if (!mountEl) return false;
      if (mountEl.querySelector('canvas')) return true;
      const text = mountEl.textContent ?? '';
      if (text.includes('Force layout failed') || text.includes('violates')) {
        throw new Error(`network layout failed: ${text.slice(0, 120)}`);
      }
      return text.includes("Couldn't render the graph");
    },
    null,
    { timeout: 20000 },
  );
  // Exercise find-neighbours through the pick seam when a canvas mounted.
  const netState = await page.evaluate(() => {
    const mountEl = document
      .querySelector('.cell[data-cell-kind="network"]')
      ?.querySelector('[data-region="net-canvas"]');
    const canvas = mountEl?.querySelector('canvas');
    if (!canvas) return { canvas: false };
    const handle = mountEl.__networkGraph;
    const tip = document
      .querySelector('.cell[data-cell-kind="network"]')
      ?.querySelector('[data-region="net-tip"]');
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    let hit = null;
    outer: for (let gy = 1; gy < 12; gy++) {
      for (let gx = 1; gx < 12; gx++) {
        const idx = handle?.simulateClick((w * gx) / 12, (h * gy) / 12, 12);
        if (idx !== null && idx !== undefined) {
          hit = idx;
          break outer;
        }
      }
    }
    const pinnedTip = tip?.textContent ?? '';
    const pinned = tip?.dataset.pinned === '1';
    handle?.simulateClick(1, 1, 0);
    return {
      canvas: true,
      hit,
      pinned,
      pinnedTip,
      cleared: tip?.dataset.pinned !== '1',
    };
  });
  if (netState.canvas) {
    if (
      netState.hit === null ||
      !netState.pinned ||
      !/neighbours highlighted/.test(netState.pinnedTip)
    ) {
      throw new Error(`network find-neighbours: no pinned highlight ("${netState.pinnedTip}")`);
    }
    if (!netState.cleared) {
      throw new Error('network find-neighbours: background click did not clear');
    }
    log(
      `✓ Facet Network cell: edge list → force layout → canvas → find-neighbours ("${netState.pinnedTip.slice(0, 50)}…") → cleared`,
    );

    // 10f. Attributed edges (Knowledge-graph + Weighted): the `rel` column
    // drives a categorical legend (cites / authored / funded), clicking a
    // swatch applies an edge-type filter (dims the others).
    const legend = await page.evaluate(() => {
      const net = document.querySelector('.cell[data-cell-kind="network"]');
      const legendEl = net?.querySelector('[data-region="net-legend"]');
      const swatches = Array.from(legendEl?.querySelectorAll('[data-legend-value]') ?? []);
      const values = swatches.map((s) => s.dataset.legendValue);
      // Click the first swatch → filter engages (others dim to 0.4 opacity).
      let dimmedAfterClick = null;
      if (swatches[0]) {
        swatches[0].click();
        dimmedAfterClick = swatches
          .slice(1)
          .every((s) => Math.abs(Number.parseFloat(s.style.opacity) - 0.4) < 0.01);
      }
      return { count: swatches.length, values, dimmedAfterClick };
    });
    if (legend.count < 2) {
      throw new Error(
        `attributed edges: expected an edge-type legend, got ${legend.count} swatches`,
      );
    }
    if (!legend.dimmedAfterClick) {
      throw new Error('attributed edges: clicking a legend swatch did not filter (dim others)');
    }
    log(`✓ Facet attributed edges: legend [${legend.values.join(', ')}] → swatch click filters`);

    // 10f-2. The "color/size by" metric picker → the graph-metrics WORKER.
    // Each non-degree metric is computed off the main thread; if the worker
    // can't answer (404 under a deploy prefix, throw, cap exceeded) the cell
    // degrades to degree and says so in the tip. So assert three things per
    // metric: the canvas comes back, the tip carries NO fallback note, and —
    // below — that a graph-metrics worker was really spawned.
    for (const metric of ['pagerank', 'community', 'betweenness']) {
      await page.evaluate((m) => {
        const net = document.querySelector('.cell[data-cell-kind="network"]');
        const sel = net?.querySelector('[data-action="net-metric"]');
        if (sel) {
          sel.value = m;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, metric);
      // The cell re-renders from scratch (Building graph… → Computing <metric>…
      // → canvas), so waiting on the canvas can't observe the previous metric's.
      await page.waitForFunction(
        () => {
          const mountEl = document
            .querySelector('.cell[data-cell-kind="network"]')
            ?.querySelector('[data-region="net-canvas"]');
          if (!mountEl) return false;
          const text = mountEl.textContent ?? '';
          if (text.includes('Force layout failed') || text.includes("Couldn't render")) {
            throw new Error(`network re-render failed: ${text.slice(0, 120)}`);
          }
          return mountEl.querySelector('canvas') !== null;
        },
        null,
        { timeout: 30000 },
      );
      const note = await page.evaluate(
        () =>
          document
            .querySelector('.cell[data-cell-kind="network"]')
            ?.querySelector('[data-region="net-tip"]')?.textContent ?? '',
      );
      if (/showing degree|couldn't compute/i.test(note)) {
        throw new Error(`metric picker "${metric}" degraded to degree: ${note}`);
      }
      const persisted = await page.evaluate(
        () =>
          document
            .querySelector('.cell[data-cell-kind="network"]')
            ?.querySelector('[data-action="net-metric"]')?.value ?? '',
      );
      if (persisted !== metric) {
        throw new Error(`metric picker "${metric}" did not persist (picker shows "${persisted}")`);
      }
    }
    if (!spawnedWorkers.some((u) => u.includes('graph-metrics.worker.js'))) {
      throw new Error(
        `metric picker: no graph-metrics worker was spawned — metrics ran on the main thread. Workers seen: ${spawnedWorkers.join(', ') || 'none'}`,
      );
    }
    log(
      '✓ Facet metric picker: pagerank / community / betweenness each render via the graph-metrics worker (no degree fallback)',
    );

    // 10f-3. Correlation-graph synthesis (Phase 1b) — the "turn a table into a
    // graph" result action. Numeric COLUMNS become nodes and strong pairwise
    // corr() becomes weighted edges, so one click must insert a named edge-list
    // SQL cell, RUN it, and wire a Network cell at it. Previously verified only
    // structurally + unit (the SQL generator); this drives the actual button.
    const corrSqlBefore = await page.evaluate(
      () => document.querySelectorAll('.cell[data-cell-kind="sql"]').length,
    );
    await page.click('[data-nb-action="add-sql"]');
    await page.waitForFunction(
      (before) => document.querySelectorAll('.cell[data-cell-kind="sql"]').length > before,
      corrSqlBefore,
      { timeout: 5000 },
    );
    const corrCell = page.locator('.cell[data-cell-kind="sql"]').last();
    // Deliberately left unnamed: setting the name fires a change → notebook
    // re-render that re-mounts CodeMirror from state, racing the keystrokes
    // below. The handler falls back to `result_<id>_correlations`, so match the
    // derived cell on the suffix instead.
    await corrCell.locator('.cm-content, textarea').first().click();
    await page.keyboard.press('ControlOrMeta+a');
    // Four numeric columns, deliberately all |corr| = 1 (b/c rise with a, d falls):
    // every pair clears the 0.5 threshold, so the edge list is non-empty regardless
    // of float wobble — this leg tests the plumbing, not the statistics.
    await page.keyboard.insertText(
      'SELECT i::DOUBLE AS a, (i*2)::DOUBLE AS b, (i*3+1)::DOUBLE AS c, (100-i)::DOUBLE AS d ' +
        'FROM range(50) t(i)',
    );
    await corrCell.locator('[data-action="cell-run"]').click();
    await page.waitForFunction(
      () => {
        const cells = Array.from(document.querySelectorAll('.cell[data-cell-kind="sql"]'));
        const last = cells[cells.length - 1];
        return (
          !!last && !last.classList.contains('errored') && last.querySelector('table') !== null
        );
      },
      null,
      { timeout: 15000 },
    );
    await corrCell.locator('[data-action="correlation-graph"]').click();
    // The handler inserts the edge SQL cell, runs it, then adds the Network cell.
    await page.waitForFunction(
      () => {
        const sql = Array.from(document.querySelectorAll('.cell[data-cell-kind="sql"]'));
        const edgeCell = sql.find((c) =>
          /_correlations$/.test(c.querySelector('[data-region="cell-name"]')?.value ?? ''),
        );
        if (!edgeCell) return false;
        if (edgeCell.classList.contains('errored')) {
          throw new Error('correlation edge-list cell errored');
        }
        if (!edgeCell.querySelector('table')) return false;
        return document.querySelectorAll('.cell[data-cell-kind="network"]').length >= 2;
      },
      null,
      { timeout: 30000 },
    );
    const corrGraph = await page.evaluate(() => {
      const nets = Array.from(document.querySelectorAll('.cell[data-cell-kind="network"]'));
      const net = nets[nets.length - 1];
      const val = (a) => net?.querySelector(`[data-action="${a}"]`)?.value ?? null;
      const edgeRows =
        Array.from(document.querySelectorAll('.cell[data-cell-kind="sql"]'))
          .find((c) =>
            /_correlations$/.test(c.querySelector('[data-region="cell-name"]')?.value ?? ''),
          )
          ?.querySelectorAll('tbody tr').length ?? 0;
      return {
        edgeRows,
        source: val('net-source'),
        target: val('net-target'),
        width: val('net-edge-width'),
        metric: val('net-metric'),
      };
    });
    // 4 numeric columns, all pairs correlated → C(4,2) = 6 undirected edges.
    if (corrGraph.edgeRows !== 6) {
      throw new Error(`correlation graph: expected 6 edge rows, got ${corrGraph.edgeRows}`);
    }
    if (
      corrGraph.source !== 'source' ||
      corrGraph.target !== 'target' ||
      corrGraph.width !== 'weight' ||
      corrGraph.metric !== 'community'
    ) {
      throw new Error(`correlation graph: Network cell mis-wired: ${JSON.stringify(corrGraph)}`);
    }
    await page.waitForFunction(
      () => {
        const nets = Array.from(document.querySelectorAll('.cell[data-cell-kind="network"]'));
        const mountEl = nets[nets.length - 1]?.querySelector('[data-region="net-canvas"]');
        return !!mountEl?.querySelector('canvas');
      },
      null,
      { timeout: 30000 },
    );
    log(
      '✓ Facet correlation graph: 4 numeric cols → 6 corr() edges → Network cell (source/target/weight, community) → canvas',
    );
  } else {
    log('~ Facet Network cell rendered (no WebGL canvas in this environment)');
  }

  // 10g. Facet Temporal cell — a SQL cell with a timestamp column → bucketed
  // SVG timeline (core/temporal), then brush a window via the seam and assert
  // the readout reports an in-window row count.
  const tempSqlBefore = await page.evaluate(
    () => document.querySelectorAll('.cell[data-cell-kind="sql"]').length,
  );
  await page.click('[data-nb-action="add-sql"]');
  await page.waitForFunction(
    (before) => document.querySelectorAll('.cell[data-cell-kind="sql"]').length > before,
    tempSqlBefore,
    { timeout: 5000 },
  );
  const tempSqlCell = page.locator('.cell[data-cell-kind="sql"]').last();
  await tempSqlCell.locator('.cm-content, textarea').first().click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(
    "SELECT TIMESTAMP '2020-01-01' + INTERVAL (i) DAY AS ts, i AS n FROM range(120) t(i)",
  );
  await tempSqlCell.locator('[data-action="cell-run"]').click();
  await page.waitForFunction(
    () => {
      const cells = Array.from(document.querySelectorAll('.cell[data-cell-kind="sql"]'));
      const last = cells[cells.length - 1];
      return !!last && !last.classList.contains('errored') && last.querySelector('table') !== null;
    },
    null,
    { timeout: 15000 },
  );
  await page.click('[data-nb-action="add-temporal"]');
  await page.waitForFunction(
    () => document.querySelector('.cell[data-cell-kind="temporal"]') !== null,
    null,
    { timeout: 15000 },
  );
  await page.evaluate(() => {
    const cell = document.querySelector('.cell[data-cell-kind="temporal"]');
    const sqlCells = Array.from(document.querySelectorAll('.cell[data-cell-kind="sql"]'));
    const src = sqlCells[sqlCells.length - 1];
    const sel = cell?.querySelector('[data-action="temporal-input"]');
    if (sel && src) {
      sel.value = src.dataset.cellId ?? '';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await page.waitForFunction(
    () =>
      document
        .querySelector('.cell[data-cell-kind="temporal"]')
        ?.querySelector('[data-action="temporal-time"]') !== null,
    null,
    { timeout: 15000 },
  );
  await page.evaluate(() => {
    const cell = document.querySelector('.cell[data-cell-kind="temporal"]');
    const t = cell?.querySelector('[data-action="temporal-time"]');
    if (t) {
      t.value = 'ts';
      t.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await page.waitForFunction(
    () =>
      (document
        .querySelector('.cell[data-cell-kind="temporal"]')
        ?.querySelectorAll('[data-region="temporal-svg"] rect').length ?? 0) > 2,
    null,
    { timeout: 20000 },
  );
  const temporal = await page.evaluate(() => {
    const cell = document.querySelector('.cell[data-cell-kind="temporal"]');
    const mountEl = cell?.querySelector('[data-region="temporal-canvas"]');
    const bars = mountEl?.querySelectorAll('[data-region="temporal-svg"] rect').length ?? 0;
    const seam = mountEl?.__temporalBrush;
    if (!seam) return { bars, brushed: false };
    // Brush the middle third of the time range.
    const [lo, hi] = seam.range;
    seam.brushTimeWindow(lo + (hi - lo) * 0.33, lo + (hi - lo) * 0.66);
    const readout = cell?.querySelector('[data-region="temporal-readout"]');
    return {
      bars,
      brushed: true,
      count: readout?.dataset.windowCount ? Number(readout.dataset.windowCount) : null,
      text: readout?.textContent ?? '',
    };
  });
  if (temporal.bars < 3) {
    throw new Error(`temporal: expected an SVG bar timeline, got ${temporal.bars} rects`);
  }
  if (
    !temporal.brushed ||
    temporal.count === null ||
    temporal.count <= 0 ||
    temporal.count >= 120
  ) {
    throw new Error(
      `temporal: brushing a window did not report a partial count (${temporal.count})`,
    );
  }
  log(
    `✓ Facet Temporal cell: timeline (${temporal.bars} bars) → brush window → ${temporal.count}/120 rows in range`,
  );

  // 10h. Facet Distribution cell — reuse the same timestamp SQL cell; summarize
  // the numeric `n` column into a histogram, then click a bar via the seam and
  // assert the readout reports that bar's row share.
  await page.click('[data-nb-action="add-distribution"]');
  await page.waitForFunction(
    () => document.querySelector('.cell[data-cell-kind="distribution"]') !== null,
    null,
    { timeout: 15000 },
  );
  await page.evaluate(() => {
    const cell = document.querySelector('.cell[data-cell-kind="distribution"]');
    const sqlCells = Array.from(document.querySelectorAll('.cell[data-cell-kind="sql"]'));
    // The timestamp SQL cell (has numeric `n`) is the second-to-last SQL cell
    // (the last is the edge-list one); find one whose result has an `n` column.
    const src = sqlCells.find((c) => c.querySelector('.result-table thead th'));
    const sel = cell?.querySelector('[data-action="dist-input"]');
    if (sel && src) {
      sel.value = src.dataset.cellId ?? '';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  // Point it at the numeric `n` column from the timestamp SQL cell.
  await page.evaluate(() => {
    const cell = document.querySelector('.cell[data-cell-kind="distribution"]');
    const col = cell?.querySelector('[data-action="dist-column"]');
    if (col) {
      const hasN = Array.from(col.options).some((o) => o.value === 'n');
      col.value = hasN ? 'n' : (col.options[1]?.value ?? '');
      col.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await page.waitForFunction(
    () =>
      (document
        .querySelector('.cell[data-cell-kind="distribution"]')
        ?.querySelectorAll('[data-region="dist-svg"] [data-bar]').length ?? 0) > 1,
    null,
    { timeout: 20000 },
  );
  const dist = await page.evaluate(() => {
    const cell = document.querySelector('.cell[data-cell-kind="distribution"]');
    const mountEl = cell?.querySelector('[data-region="dist-canvas"]');
    const bars = mountEl?.querySelectorAll('[data-region="dist-svg"] [data-bar]').length ?? 0;
    const seam = mountEl?.__distributionSelect;
    if (!seam) return { bars, selected: false };
    seam.selectBar(0);
    const readout = cell?.querySelector('[data-region="dist-readout"]');
    return {
      bars,
      selected: true,
      count: readout?.dataset.selectedCount ? Number(readout.dataset.selectedCount) : null,
      text: readout?.textContent ?? '',
    };
  });
  if (dist.bars < 2) {
    throw new Error(`distribution: expected bars, got ${dist.bars}`);
  }
  if (!dist.selected || !dist.count || dist.count <= 0) {
    throw new Error(`distribution: selecting a bar did not report a count (${dist.count})`);
  }
  log(
    `✓ Facet Distribution cell: ${dist.bars} bars → select bar → ${dist.count} rows ("${dist.text.slice(0, 40)}…")`,
  );

  // 10i. Facet crossfilter propagation — name the Temporal cell, add a downstream
  // SQL cell that filters on CROSSFILTER(<name>), then brush a full vs. a narrow
  // window and assert the downstream COUNT tracks the brush (the whole point of
  // crossfilter). Exercises: cell.selection persistence, buildCrossfilterMap, the
  // CROSSFILTER macro expansion, and the applyCrossfilter → runAll propagation.
  await page.evaluate(() => {
    const cell = document.querySelector('.cell[data-cell-kind="temporal"]');
    const nameInput = cell?.querySelector('[data-region="cell-name"]');
    if (nameInput) {
      nameInput.value = 'twin';
      nameInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  const xfSqlBefore = await page.evaluate(
    () => document.querySelectorAll('.cell[data-cell-kind="sql"]').length,
  );
  await page.click('[data-nb-action="add-sql"]');
  await page.waitForFunction(
    (before) => document.querySelectorAll('.cell[data-cell-kind="sql"]').length > before,
    xfSqlBefore,
    { timeout: 5000 },
  );
  const xfCell = page.locator('.cell[data-cell-kind="sql"]').last();
  await xfCell.locator('.cm-content, textarea').first().click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(
    "SELECT COUNT(*) AS c FROM (SELECT TIMESTAMP '2020-01-01' + INTERVAL (i) DAY AS ts, i AS n FROM range(120) t(i)) sub WHERE CROSSFILTER(twin)",
  );
  const xfCellId = await xfCell.evaluate((el) => el.dataset.cellId);
  // Brush the full range via the seam → onSelect → applyCrossfilter → runAll runs
  // the downstream cell; CROSSFILTER(twin) should keep (nearly) all 120 rows.
  await page.evaluate(() => {
    const seam = document.querySelector(
      '.cell[data-cell-kind="temporal"] [data-region="temporal-canvas"]',
    )?.__temporalBrush;
    const [lo, hi] = seam.range;
    seam.brushTimeWindow(lo, hi);
  });
  // `applyCrossfilter` re-runs only the crossfilter's affected subgraph
  // (`crossfilterRunOrder`), not the whole notebook. This wait is deliberately
  // back at the original 15s budget: it needed 45s while a brush triggered a
  // full ~30-cell Run-all, so passing at 15s is the end-to-end proof that the
  // scoping works (the cell's own query is ~2.5s).
  await page.waitForFunction(
    (id) => {
      const td = document.querySelector(`.cell[data-cell-id="${id}"] table td`);
      return !!td && Number(td.textContent) > 0;
    },
    xfCellId,
    { timeout: 15000 },
  );
  const xfCountFull = await page.evaluate((id) => {
    const td = document.querySelector(`.cell[data-cell-id="${id}"] table td`);
    return td ? Number(td.textContent) : null;
  }, xfCellId);
  // Now brush a narrow middle window → downstream count must drop.
  await page.evaluate(() => {
    const seam = document.querySelector(
      '.cell[data-cell-kind="temporal"] [data-region="temporal-canvas"]',
    )?.__temporalBrush;
    const [lo, hi] = seam.range;
    seam.brushTimeWindow(lo + (hi - lo) * 0.4, lo + (hi - lo) * 0.6);
  });
  await page.waitForFunction(
    (args) => {
      const [id, full] = args;
      const td = document.querySelector(`.cell[data-cell-id="${id}"] table td`);
      return !!td && Number(td.textContent) < full;
    },
    [xfCellId, xfCountFull],
    { timeout: 15000 },
  );
  const xfCountNarrow = await page.evaluate((id) => {
    const td = document.querySelector(`.cell[data-cell-id="${id}"] table td`);
    return td ? Number(td.textContent) : null;
  }, xfCellId);
  if (!(xfCountFull > 0 && xfCountNarrow > 0 && xfCountNarrow < xfCountFull)) {
    throw new Error(
      `crossfilter: brush did not propagate downstream (full=${xfCountFull}, narrow=${xfCountNarrow})`,
    );
  }
  log(
    `✓ Facet crossfilter: brush → downstream CROSSFILTER(twin) count ${xfCountFull} → ${xfCountNarrow}`,
  );

  // 10j. Agent surfaces — drive `window.naklidata` end-to-end (DECISIONS EE).
  // The whole point is that the semantic layer is the agent surface, so this
  // exercises the real binding in the real browser: the verb catalogue, a valid
  // read query after the explicit per-tab value grant, the read-only
  // validator's loud rejection of a write, table scoping, and the separate
  // default-off proposal gate.
  const agent = await page.evaluate(async () => {
    const nd = window.naklidata;
    if (!nd) return { error: 'window.naklidata is not bound' };
    const tools = (await nd.listTools()).map((t) => t.name).sort();
    const okQuery = await nd.query({ sql: 'SELECT endpoint FROM access_logs LIMIT 1' });
    const sensitiveQuery = await nd.query({
      sql: 'SELECT contact_email FROM vendors LIMIT 1',
    });
    const aliasQuery = await nd.query({
      sql: 'SELECT contact_email AS e FROM vendors LIMIT 1',
    });
    const write = await nd.query({ sql: 'DROP TABLE something' });
    const scoped = await nd.query({ sql: 'SELECT * FROM definitely_not_a_mounted_table' });
    const fileScan = await nd.query({ sql: "SELECT * FROM 'file:///etc/passwd'" });
    const gated = await nd.proposeCell({ sql: 'SELECT 1' });
    const describe = await nd.describe();
    const v3Tools = (await nd.v3.listTools()).map((tool) => tool.name).sort();
    const v3Capabilities = await nd.v3.invoke('getCapabilities');
    const v3Query = await nd.v3.invoke('query', {
      sql: 'SELECT contact_email FROM vendors LIMIT 1',
    });
    const v3ProposalDenied = await nd.v3.invoke('proposeSqlCell', { sql: 'SELECT 1' });
    const v3CleaningDenied = await nd.v3.invoke('proposeCleaningStep');
    // Chunk 4 enrichment: envelope version + per-table provenance + column stats.
    let describeEnriched = false;
    if (describe.ok === true && describe.data.tables.length > 0) {
      const firstTable = describe.data.tables[0];
      const anyCol = describe.data.tables.flatMap((t) => t.columns);
      describeEnriched =
        describe.data.version === '1' &&
        !!firstTable.provenance &&
        typeof firstTable.provenance.sourceLabel === 'string' &&
        anyCol.some(
          (c) => typeof c.nullFraction === 'number' || typeof c.distinctCount === 'number',
        );
    }
    return {
      version: nd.version,
      v3Version: nd.v3.version,
      tools,
      v3Tools,
      v3Capabilities,
      v3Query,
      v3ProposalDenied,
      v3CleaningDenied,
      okQuery,
      sensitiveQuery,
      aliasRejected: aliasQuery.ok === false ? aliasQuery.error : '(NOT REJECTED)',
      writeRejected: write.ok === false ? write.error : '(NOT REJECTED)',
      scopedRejected: scoped.ok === false ? scoped.error : '(NOT REJECTED)',
      fileScanRejected: fileScan.ok === false ? fileScan.error : '(NOT REJECTED)',
      gated,
      runCellExposed: typeof nd.runCell === 'function',
      describeOk: describe.ok === true && Array.isArray(describe.data.tables),
      describeTableCount: describe.ok === true ? describe.data.tables.length : 0,
      describeEnriched,
    };
  });
  if (agent.error) fail(`agent surface: ${agent.error}`);
  if (agent.version !== '2')
    fail(`agent surface: expected proposal-only contract v2, got v${agent.version}`);
  if (agent.v3Version !== '3')
    fail(`agent surface: expected nested contract v3, got v${agent.v3Version}`);
  const expectVerbs = ['describe', 'listCells', 'listTables', 'proposeCell', 'query'];
  if (JSON.stringify(agent.tools) !== JSON.stringify(expectVerbs)) {
    fail(`agent surface: verbs ${JSON.stringify(agent.tools)} != ${JSON.stringify(expectVerbs)}`);
  }
  const expectV3Verbs = [
    'describe',
    'exportDataDictionary',
    'getCapabilities',
    'getLineage',
    'listCells',
    'listTables',
    'proposeChart',
    'proposeCleaningStep',
    'proposeQualityCheck',
    'proposeSqlCell',
    'query',
    'validateArtifact',
  ];
  if (JSON.stringify(agent.v3Tools) !== JSON.stringify(expectV3Verbs)) {
    fail(
      `agent surface: v3 verbs ${JSON.stringify(agent.v3Tools)} != ${JSON.stringify(expectV3Verbs)}`,
    );
  }
  if (
    !agent.v3Capabilities.ok ||
    agent.v3Capabilities.version !== '3' ||
    agent.v3Capabilities.data.executionScope !== null ||
    Object.keys(agent.v3Capabilities.data.deferredTools).length !== 0 ||
    agent.v3Capabilities.data.standards.length !== 5 ||
    agent.v3Capabilities.data.standards.some(
      (capability) => capability.readiness !== 'release-gated' || capability.enabled !== false,
    )
  ) {
    fail(`agent surface: v3 capabilities are incomplete (${JSON.stringify(agent.v3Capabilities)})`);
  }
  if (
    !agent.v3Query.ok ||
    agent.v3Query.scope !== 'values:read' ||
    agent.v3Query.data.rows[0]?.contact_email !== '[redacted:pii]' ||
    agent.v3Query.meta.redaction.columns[0] !== 'contact_email' ||
    agent.v3Query.meta.provenance.sourceIds.length !== 1 ||
    agent.v3Query.meta.provenance.tableIds.length !== 1
  ) {
    fail(`agent surface: v3 value envelope is unsafe/incomplete (${JSON.stringify(agent.v3Query)})`);
  }
  if (
    agent.v3ProposalDenied.ok !== false ||
    agent.v3ProposalDenied.error.code !== 'permission_denied'
  ) {
    fail(
      `agent surface: v3 proposal was not independently permission-gated (${JSON.stringify(agent.v3ProposalDenied)})`,
    );
  }
  if (
    agent.v3CleaningDenied.ok !== false ||
    agent.v3CleaningDenied.error.code !== 'permission_denied'
  ) {
    fail(
      `agent surface: cleaning proposal was not independently permission-gated (${JSON.stringify(agent.v3CleaningDenied)})`,
    );
  }
  if (
    !(
      agent.okQuery.ok &&
      agent.okQuery.data.rows.length === 1 &&
      typeof agent.okQuery.data.rows[0].endpoint === 'string' &&
      !agent.okQuery.data.redactedColumns.includes('endpoint')
    )
  ) {
    fail(
      `agent surface: read query did not return the expected row (${JSON.stringify(agent.okQuery)})`,
    );
  }
  if (
    !(
      agent.sensitiveQuery.ok &&
      agent.sensitiveQuery.data.rows.length === 1 &&
      agent.sensitiveQuery.data.rows[0].contact_email === '[redacted:pii]' &&
      agent.sensitiveQuery.data.redactedColumns.includes('contact_email')
    )
  ) {
    fail(
      `agent surface: direct sensitive value was not redacted (${JSON.stringify(agent.sensitiveQuery)})`,
    );
  }
  if (agent.aliasRejected === '(NOT REJECTED)') {
    fail('agent surface: an aliased sensitive projection was NOT rejected');
  }
  if (agent.writeRejected === '(NOT REJECTED)')
    fail('agent surface: a write query was NOT rejected');
  if (agent.scopedRejected === '(NOT REJECTED)')
    fail('agent surface: an out-of-scope table was NOT rejected');
  if (agent.fileScanRejected === '(NOT REJECTED)')
    fail('agent surface: a file-scan query was NOT rejected');
  if (agent.gated.ok !== false) fail('agent surface: proposeCell was NOT gated off by default');
  if (agent.runCellExposed) fail('agent surface: runCell execution verb is still exposed');
  if (!agent.describeOk) fail('agent surface: describe did not return a tables array');
  if (agent.describeTableCount > 0 && !agent.describeEnriched) {
    fail('agent surface: describe was not enriched (version/provenance/column stats missing)');
  }
  log(
    `✓ Agent surface: v2 compatibility (${agent.tools.length} verbs) + nested v3 (${agent.v3Tools.length} tools) · no execution scope/verb · v3 provenance+redaction envelope · proposals independently gated · describe ok (${agent.describeTableCount} tables${agent.describeEnriched ? ', enriched: version+provenance+stats' : ''})`,
  );

  // Grant proposal authority explicitly, add one v3 SQL proposal, inspect its
  // idle/editable state, then revoke all sensitive access and prove the next
  // proposal is denied. The activity ledger must name the tool without storing
  // the proposed SQL text.
  await page.click('[data-action="open-settings"]');
  const proposalToggle = page.locator('[data-agent-scope="workspace:propose"]');
  await proposalToggle.check();
  await page.click('[data-action="close-settings"]');
  const proposedSql = 'SELECT 42 AS agent_proposal';
  const proposal = await page.evaluate(
    async (sql) => window.naklidata?.v3.invoke('proposeSqlCell', { sql }),
    proposedSql,
  );
  if (!proposal?.ok || proposal.data.createdCell.status !== 'un-run') {
    fail(`agent access: v3 SQL proposal failed (${JSON.stringify(proposal)})`);
  }
  const cleaningProposal = await page.evaluate(async () => {
    const button = document.querySelector('[data-action="apply-table-fix"]');
    if (!(button instanceof HTMLElement)) return { error: 'table suggestion missing' };
    return await window.naklidata?.v3.invoke('proposeCleaningStep', {
      sourceId: button.dataset.sourceId,
      tableId: button.dataset.tableId,
      suggestionId: button.dataset.fixId,
    });
  });
  if (
    !cleaningProposal?.ok ||
    cleaningProposal.data.proposalType !== 'cleaning-step' ||
    cleaningProposal.data.createdCell.status !== 'un-run'
  ) {
    fail(`agent access: cleaning proposal failed (${JSON.stringify(cleaningProposal)})`);
  }
  const proposedCellState = await page.evaluate((id) => {
    const cell = document.querySelector(`.cell[data-cell-id="${id}"]`);
    return {
      exists: !!cell,
      code: (cell?.querySelector('.cm-content, textarea')?.textContent ?? '').trim(),
      hasResult: !!cell?.querySelector('.result-table tbody tr'),
    };
  }, proposal.data.createdCell.id);
  if (
    !proposedCellState.exists ||
    proposedCellState.code !== proposedSql ||
    proposedCellState.hasResult
  ) {
    fail(`agent access: proposed SQL was not editable and idle (${JSON.stringify(proposedCellState)})`);
  }
  await page.click('[data-action="open-settings"]');
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-region="agent-access"]')
        ?.textContent?.includes('proposeCleaningStep') === true,
    null,
    { timeout: 5000 },
  );
  const activityCopy = await page.locator('[data-region="agent-access"]').textContent();
  if (
    !activityCopy?.includes('proposeSqlCell') ||
    !activityCopy.includes('proposeCleaningStep') ||
    activityCopy.includes(proposedSql)
  ) {
    fail('agent access: activity ledger omitted the tool or retained proposed SQL');
  }
  await page.click('[data-agent-action="revoke"]');
  if (
    (await page.locator('[data-agent-scope="values:read"]').isChecked()) ||
    (await page.locator('[data-agent-scope="workspace:propose"]').isChecked())
  ) {
    fail('agent access: revoke-all did not clear both sensitive scopes');
  }
  await page.click('[data-action="close-settings"]');
  const proposalAfterRevoke = await page.evaluate(
    async () => window.naklidata?.v3.invoke('proposeSqlCell', { sql: 'SELECT 99' }),
  );
  if (
    proposalAfterRevoke?.ok !== false ||
    proposalAfterRevoke.error.code !== 'permission_denied'
  ) {
    fail(`agent access: proposal survived revoke (${JSON.stringify(proposalAfterRevoke)})`);
  }
  log('✓ Agent access UX: explicit proposal grant → editable un-run cell → metadata-only activity → revoke-all → stable denial');

  // 10k. Accessibility legibility (Chunk 6). A DOM/ARIA-driving agent (Operator,
  // Atlas, Claude-in-Chrome) reads the accessibility tree, not our data-action
  // layer — so every interactive control must expose an accessible NAME. Audit
  // the fully-populated app for interactive elements with no name (aria-label /
  // title / text / aria-labelledby) and assert none remain.
  const a11y = await page.evaluate(() => {
    const accessibleName = (el) => {
      const aria = el.getAttribute('aria-label');
      if (aria && aria.trim()) return true;
      if (el.getAttribute('aria-labelledby')) return true;
      const title = el.getAttribute('title');
      if (title && title.trim()) return true;
      if ((el.textContent || '').trim()) return true;
      // A <select> is named by its options / associated label; a titled/labelled
      // wrapper counts too.
      if (el.tagName === 'SELECT' && el.closest('label')) return true;
      const ph = el.getAttribute('placeholder');
      if (ph && ph.trim()) return true;
      return false;
    };
    const isVisible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const interactive = [
      ...document.querySelectorAll(
        'button, a[href], [role="button"], select, input:not([type="hidden"])',
      ),
    ].filter(isVisible);
    const unnamed = interactive
      .filter((el) => !accessibleName(el))
      .map((el) => {
        const cls = (el.className || '').toString().slice(0, 30);
        return `${el.tagName.toLowerCase()}${el.dataset.action ? `[${el.dataset.action}]` : ''}${cls ? `.${cls}` : ''}`;
      });
    // Landmark roles — a DOM agent orients by them.
    const landmarks = {
      main: !!document.querySelector('main, [role="main"]'),
    };
    // Canvas cells are WebGL — a DOM agent can't see them, so a rendered Facet
    // graph canvas must carry a role=img + descriptive aria-label (Chunk 6).
    const netCanvas = document.querySelector(
      '.cell[data-cell-kind="network"] [data-region="net-canvas"]',
    );
    const netCanvasDesc =
      netCanvas && netCanvas.getAttribute('role') === 'img'
        ? netCanvas.getAttribute('aria-label')
        : null;
    return { total: interactive.length, unnamed, landmarks, netCanvasDesc };
  });
  log(
    `[a11y] ${a11y.total} interactive · ${a11y.unnamed.length} unnamed · main-landmark=${a11y.landmarks.main}`,
  );
  if (a11y.unnamed.length > 0) {
    log(`[a11y] unnamed: ${JSON.stringify(a11y.unnamed.slice(0, 25))}`);
  }
  if (a11y.unnamed.length > 0) {
    fail(`accessibility: ${a11y.unnamed.length} interactive element(s) have no accessible name`);
  }
  if (!a11y.landmarks.main) fail('accessibility: no <main> / role=main landmark');
  if (a11y.netCanvasDesc === null) {
    fail('accessibility: the rendered Network canvas has no role=img/aria-label description');
  }
  if (!/nodes.*edges/.test(a11y.netCanvasDesc)) {
    fail(`accessibility: Network canvas description is not descriptive ("${a11y.netCanvasDesc}")`);
  }
  log(
    `✓ Accessibility: all ${a11y.total} interactive controls named · main landmark · WebGL canvas described ("${a11y.netCanvasDesc}")`,
  );

  // 10l. Data-dictionary export (Chunk 4 follow-up). Clicking the schema-panel
  // button must produce the Markdown doc through the SAME describe() the agent
  // surface serves. The save path is a native picker, so stub the global to
  // capture the bytes instead of opening a dialog.
  const dictExport = await page.evaluate(async () => {
    const btn = document.querySelector('[data-action="export-data-dictionary"]');
    if (!btn) return { error: 'export-data-dictionary button not rendered' };
    let captured = null;
    window.showSaveFilePicker = async ({ suggestedName }) => ({
      name: suggestedName,
      createWritable: async () => ({
        write: async (blob) => {
          captured = await blob.text();
        },
        close: async () => {},
      }),
    });
    btn.click();
    // Wait for the lazy chunk + describe() round-trip to finish writing.
    for (let i = 0; i < 60 && captured === null; i++) {
      await new Promise((r) => setTimeout(r, 250));
    }
    return { markdown: captured };
  });
  if (dictExport.error) fail(`data dictionary: ${dictExport.error}`);
  if (!dictExport.markdown) fail('data dictionary: export produced no file content');
  if (consoleWarnings.some((msg) => msg.includes('unknown action: export-data-dictionary'))) {
    fail('data dictionary: click leaked into the global dispatcher as an unknown action');
  }
  {
    const md = dictExport.markdown;
    if (!md.startsWith('# Data dictionary')) {
      fail(`data dictionary: unexpected header (${md.slice(0, 40)})`);
    }
    if (!/Envelope v1/.test(md)) fail('data dictionary: missing envelope version');
    // The table header proves the enriched columns made it into the doc.
    if (
      !/\| Column \| Type \| Semantic type \| Sensitivity \| Null % \| Distinct \| Range \|/.test(
        md,
      )
    ) {
      fail('data dictionary: column table header missing/changed');
    }
    // At least one real mounted table + a semantic type resolved.
    const tableCount = (md.match(/^## /gm) || []).length;
    if (tableCount < 1) fail('data dictionary: no table sections rendered');
    log(
      `✓ Data dictionary export: ${md.length} chars · ${tableCount} table section(s) · envelope + enriched columns present`,
    );
  }

  // 11. Override one column's type. Pick the first schema-column row, open
  // the override <details>, pick a type, and confirm origin becomes
  // user_override.
  const overrideColumn = await page.evaluate(() => {
    const first = document.querySelector('.schema-column');
    if (!first) return null;
    const colName = first.dataset.column;
    const details = first.querySelector('details.schema-override');
    if (!(details instanceof HTMLDetailsElement)) return null;
    details.open = true;
    // Trigger toggle so the menu lazily renders.
    details.dispatchEvent(new Event('toggle'));
    return colName ?? null;
  });
  if (!overrideColumn) fail('semantic override target was not available');
  await page.waitForFunction(
    (colName) => {
      const details = document.querySelector(
        `.schema-column[data-column="${CSS.escape(colName)}"] details.schema-override`,
      );
      if (!(details instanceof HTMLDetailsElement)) return false;
      const groupLabels = Array.from(details.querySelectorAll('.type-option-group'))
        .map((group) => group.firstElementChild?.textContent?.trim())
        .filter(Boolean);
      return (
        !!details.querySelector('input[aria-label="Filter types"]') &&
        groupLabels.includes('Suggested for this column') &&
        groupLabels.includes('Common')
      );
    },
    overrideColumn,
    { timeout: 5000 },
  );
  const overridden = await page.evaluate((colName) => {
    const details = document.querySelector(
      `.schema-column[data-column="${CSS.escape(colName)}"] details.schema-override`,
    );
    if (!(details instanceof HTMLDetailsElement)) return null;
    const firstOption = details.querySelector('.type-option[data-type-id]');
    const id = firstOption?.dataset.typeId ?? null;
    firstOption?.click();
    return { colName, id };
  }, overrideColumn);
  await delay(200);
  const overrodeOk = await page.evaluate((col) => {
    const row = document.querySelector(`.schema-column[data-column="${col}"]`);
    return row?.dataset.origin === 'user_override';
  }, overridden?.colName);
  // SB6: the schema panel is the spec's single most important surface — a
  // failed override is a real regression, so fail hard instead of soft-logging.
  if (!overrodeOk) fail(`override did not stick for ${overridden?.colName}`);
  log(`✓ overrode "${overridden?.colName}" → ${overridden?.id}`);

  // 12. Wave 5/6 surface affordances exist in the DOM. Deeper behaviour
  //     is covered by tests/e2e/*; this is the cheap "did the build drop
  //     the button" gate for the load-bearing surfaces shipped 2026-05-31.
  const w56 = await page.evaluate(() => {
    const sel = (s) => document.querySelector(s) !== null;
    // Templates the schema panel surfaces (Vendor concentration is W4.2-era;
    // include here as a sanity check that the panel still renders).
    return {
      addInputBtn: sel('[data-nb-action="add-input"]'),
      addDashboardBtn: sel('[data-nb-action="add-dashboard"]'),
      addAssertionBtn: sel('[data-nb-action="add-assertion"]'),
      addCohortBtn: sel('[data-nb-action="add-cohort"]'),
      askNlToSqlBtn: sel('[data-action="ask-nl-to-sql"]'),
      exportHtmlBtn: sel('[data-action="export-html"]'),
      exitPresentBtn: sel('[data-action="exit-presentation"]'),
      // W5.3 quick-chart affordance — at least one schema-column should have it.
      anyQuickChart: sel('.schema-quick-chart'),
    };
  });
  for (const [k, v] of Object.entries(w56)) {
    if (!v) fail(`Wave 5/6 affordance missing: ${k}`);
  }
  log(
    '✓ Wave 5/6 affordances present (input/dashboard/assertion/cohort + NL→SQL, Export HTML, Exit-present, quick-chart)',
  );

  // 12a. Adding an input cell renders the input-cell DOM + the cell-name is
  //      seeded. (Catches a render-switch regression cheaply — full behaviour
  //      in tests/e2e/input-cell.spec.ts.)
  await page.click('[data-nb-action="add-input"]');
  await delay(400);
  const inputCellOk = await page.evaluate(() => {
    const cell = document.querySelector('.cell[data-cell-kind="input"]');
    if (!cell) return null;
    const name = cell.querySelector('[data-region="cell-name"]')?.value ?? '';
    const widget = cell.querySelector('[data-region="input-widget"] input');
    return { name, hasWidget: !!widget };
  });
  if (!inputCellOk) fail('add-input did not render a .cell[data-cell-kind="input"]');
  if (!inputCellOk.hasWidget) fail('input cell has no widget input');
  if (!inputCellOk.name.startsWith('input_'))
    fail(`input cell name not seeded: got "${inputCellOk.name}"`);
  log(`✓ input cell rendered + seeded (name="${inputCellOk.name}")`);

  // 12b. Adding a dashboard cell renders the dashboard DOM with the
  //      empty-items affordance.
  await page.click('[data-nb-action="add-dashboard"]');
  await delay(400);
  const dashOk = await page.evaluate(() => {
    const cell = document.querySelector('.cell[data-cell-kind="dashboard"]');
    if (!cell) return null;
    const grid = cell.querySelector('.dashboard-grid');
    const affordance = grid?.textContent?.includes('Add cell names') ?? false;
    return { hasGrid: !!grid, affordance };
  });
  if (!dashOk?.hasGrid) fail('add-dashboard did not render a .dashboard-grid');
  if (!dashOk?.affordance) fail('dashboard empty-items affordance missing');
  log('✓ dashboard cell rendered + empty-items affordance present');

  // 12d. v1.3 — adding stats + report cells renders their DOM. (Forward-
  //      pass H8: smoke had zero coverage of the v1.3 M3/M4 surfaces.)
  await page.click('[data-nb-action="add-stats"]');
  await delay(400);
  const statsOk = await page.evaluate(() => {
    const cell = document.querySelector('.cell[data-cell-kind="stats"]');
    if (!cell) return null;
    const hasRun = !!cell.querySelector('[data-action="run-stats"]');
    const hasBody = (cell.querySelector('.cell-output')?.textContent ?? '').length > 0;
    return { hasRun, hasBody };
  });
  if (!statsOk) fail('add-stats did not render a .cell[data-cell-kind="stats"]');
  if (!statsOk.hasRun) fail('stats cell missing the Run button');
  if (!statsOk.hasBody) fail('stats cell has no output body');
  log('✓ stats cell rendered (Run button + body present)');

  await page.click('[data-nb-action="add-report"]');
  await delay(400);
  const reportOk = await page.evaluate(() => {
    const cell = document.querySelector('.cell[data-cell-kind="report"]');
    if (!cell) return null;
    const hasPaper = !!cell.querySelector('.report-paper');
    const hasPrint = !!cell.querySelector('[data-action="report-print"]');
    return { hasPaper, hasPrint };
  });
  if (!reportOk) fail('add-report did not render a .cell[data-cell-kind="report"]');
  if (!reportOk.hasPaper) fail('report cell missing .report-paper');
  if (!reportOk.hasPrint) fail('report cell missing the Print-to-PDF button');
  log('✓ report cell rendered (paper + Print-to-PDF button present)');

  // 12c. Presentation mode toggles via class — flip the class manually
  //      (skip the URL-reload path because full reboot in smoke is
  //      expensive) and check that the sidebars hide.
  const presOk = await page.evaluate(() => {
    const root = document.getElementById('app');
    root?.classList.add('app-present-mode');
    const isHidden = (el) => !el || window.getComputedStyle(el).display === 'none';
    const result = {
      sources: isHidden(document.querySelector('aside[aria-label="Sources"]')),
      schema: isHidden(document.querySelector('aside[aria-label="Schema"]')),
      addRow: isHidden(document.querySelector('.cell-add-row')),
    };
    root?.classList.remove('app-present-mode'); // restore so subsequent steps don't break
    return result;
  });
  if (!(presOk.sources && presOk.schema && presOk.addRow))
    fail(`presentation-mode CSS did not engage: ${JSON.stringify(presOk)}`);
  log('✓ presentation-mode CSS engages (sources / schema / cell-add hidden)');

  // 12e. SQLite mount via the "+ Add source" modal (real-data test fixes
  //      #1 + #2). DuckDB-wasm's sqlite_scanner can't open a registered
  //      file, so the mount goes through the sql.js reader chunk → NDJSON →
  //      read_json_auto. This exercises: (a) the add-source modal opens with
  //      mount options, (b) picking "Add file" runs the mount, (c) each
  //      SQLite table lands as a classified NakliData view.
  const sqliteB64 = await makeSqliteFixtureBase64();
  await page.evaluate((b64) => {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const file = new File([arr], 'demo.sqlite', { type: 'application/x-sqlite3' });
    // Stub the FSA picker so clicking "Add file" resolves to our fixture
    // (a real picker needs a user gesture that headless can't supply).
    window.showOpenFilePicker = async () => [{ getFile: async () => file }];
  }, sqliteB64);

  await page.click('[data-action="add-source"]');
  await page.waitForSelector('.add-source-overlay', { timeout: 3000 });
  const addSourceOptionCount = await page.evaluate(
    () => document.querySelectorAll('.add-source-overlay [data-action^="mount-"]').length,
  );
  if (addSourceOptionCount < 2) {
    fail(`add-source modal rendered only ${addSourceOptionCount} mount option(s)`);
  }
  await page.click('.add-source-overlay [data-action="mount-file"]');
  // Modal should close, then the two SQLite tables land as views.
  await page.waitForFunction(
    () => {
      const rail = document.querySelector('aside[aria-label="Sources"]');
      const t = rail?.textContent ?? '';
      return /demo__regions/.test(t) && /demo__reps/.test(t);
    },
    null,
    { timeout: 20000 },
  );
  const sqliteRowCounts = await page.evaluate(() => {
    const t = document.querySelector('aside[aria-label="Sources"]')?.textContent ?? '';
    const regions = t.match(/demo__regions\s+([\d,]+)\s+rows/);
    const reps = t.match(/demo__reps\s+([\d,]+)\s+rows/);
    return { regions: regions?.[1] ?? null, reps: reps?.[1] ?? null };
  });
  if (sqliteRowCounts.regions !== '3' || sqliteRowCounts.reps !== '2') {
    fail(`SQLite mount row counts wrong: ${JSON.stringify(sqliteRowCounts)} (expected 3 / 2)`);
  }
  log(
    `✓ SQLite mount via Add-source modal: demo__regions (3) + demo__reps (2) mounted through sql.js`,
  );

  // 12e-bis. Compare-tables modal is now LAZY (loadChunk('compare-tables')) —
  //   the shell headroom pass moved it off the inlined budget (~10 KB). With 2
  //   tables mounted the schema panel exposes the compare button; clicking it
  //   must dynamically load the chunk and open the modal. This is the runtime
  //   proof that the lazy-move didn't break the open path (unit tests + build
  //   can't see the dynamic import resolving).
  // The source rail can render before the schema subscriber finishes its
  // post-mount classification render on a CPU-constrained smoke worker. Give
  // this derived affordance the same bounded readiness window as the mount.
  await page.waitForSelector('[data-action="compare-tables"]', { timeout: 20000 });
  await page.click('[data-action="compare-tables"]');
  await page.waitForSelector('.compare-tables-overlay [data-region="compare-tables-modal"]', {
    timeout: 8000,
  });
  log('✓ Compare-tables modal opens via lazy chunk (loadChunk("compare-tables"))');
  await page.click('[data-action="close-compare-tables"]');
  await page.waitForFunction(() => !document.querySelector('.compare-tables-overlay'), null, {
    timeout: 4000,
  });

  // 12f. Introspection statements run directly instead of being wrapped in
  //      `CREATE VIEW AS …` (real-data test fix #4). `SHOW TABLES` used to
  //      surface a baffling "syntax error at or near SHOW".
  const sqlBefore = await page.evaluate(
    () => document.querySelectorAll('.cell[data-cell-kind="sql"]').length,
  );
  await page.click('[data-nb-action="add-sql"]');
  await page.waitForFunction(
    (before) => document.querySelectorAll('.cell[data-cell-kind="sql"]').length > before,
    sqlBefore,
    { timeout: 5000 },
  );
  const showCell = page.locator('.cell[data-cell-kind="sql"]').last();
  await showCell.locator('.cm-content, textarea').first().click();
  await page.keyboard.insertText('SHOW TABLES');
  await showCell.locator('[data-action="cell-run"]').click();
  await page.waitForFunction(
    () => {
      const cells = document.querySelectorAll('.cell[data-cell-kind="sql"]');
      const last = cells[cells.length - 1];
      if (!last || last.classList.contains('errored')) return false;
      const out = last.querySelector('.cell-output');
      // SHOW TABLES returns a `name` column; our mounted views appear in it.
      return !!out && /demo__regions/.test(out.textContent ?? '');
    },
    null,
    { timeout: 8000 },
  );
  log('✓ SHOW TABLES runs directly (not view-wrapped) and returns the table list');

  // 12f-bis. A1 (auto-chart embed / bigint-limb numeric detection). A
  //   `GROUP BY … SUM` over integers promotes to HUGEINT/Int128, which
  //   apache-arrow serialises as a little-endian limb object (`{"0":30,…}`),
  //   NOT a number or a bigint. Two things must hold: (a) the result table
  //   renders those aggregates as plain numbers (formatCell → coerceNumeric),
  //   and (b) "Create report" auto-embeds a bar chart cell wired to the
  //   categorical column × the numeric measure. A regression in the limb
  //   reconstruction fails here rather than silently mis-charting a report.
  {
    const sqlBeforeSum = await page.evaluate(
      () => document.querySelectorAll('.cell[data-cell-kind="sql"]').length,
    );
    await page.click('[data-nb-action="add-sql"]');
    await page.waitForFunction(
      (before) => document.querySelectorAll('.cell[data-cell-kind="sql"]').length > before,
      sqlBeforeSum,
      { timeout: 5000 },
    );
    const sumCell = page.locator('.cell[data-cell-kind="sql"]').last();
    await sumCell.locator('.cm-content, textarea').first().click();
    await page.keyboard.insertText(
      "SELECT k, SUM(n) AS total FROM (VALUES ('east', 30), ('west', 10), ('west', 20)) t(k, n) GROUP BY k ORDER BY k",
    );
    await sumCell.locator('[data-action="cell-run"]').click();
    await page.waitForFunction(
      () => {
        const cells = document.querySelectorAll('.cell[data-cell-kind="sql"]');
        const last = cells[cells.length - 1];
        if (!last || last.classList.contains('errored')) return false;
        return last.querySelectorAll('table td').length >= 4; // 2 rows × 2 cols
      },
      null,
      { timeout: 8000 },
    );
    const sumTds = await sumCell.evaluate((el) =>
      [...el.querySelectorAll('table td')].map((td) => td.textContent ?? ''),
    );
    // Both group totals are 30; they must render as plain numbers, never a
    // limb object like `{"0":30,...}`.
    if (!sumTds.includes('30') || sumTds.some((t) => t.includes('{'))) {
      fail(
        `A1: HUGEINT SUM rendered wrong — cells=${JSON.stringify(sumTds)} (expected plain 30s, no arrow limb objects)`,
      );
    }
    log('✓ A1: GROUP BY … SUM (HUGEINT/Int128) renders as numbers, not arrow limb objects');

    const chartBefore = await page.evaluate(
      () => document.querySelectorAll('.cell[data-cell-kind="chart"]').length,
    );
    await sumCell.locator('[data-action="create-report"]').click();
    await page.waitForFunction(
      (before) => document.querySelectorAll('.cell[data-cell-kind="chart"]').length > before,
      chartBefore,
      { timeout: 8000 },
    );
    const chartWiring = await page.evaluate(() => {
      const charts = document.querySelectorAll('.cell[data-cell-kind="chart"]');
      const last = charts[charts.length - 1];
      if (!last) return null;
      const val = (a) => last.querySelector(`[data-action="${a}"]`)?.value ?? null;
      return { x: val('chart-x'), y: val('chart-y'), type: val('chart-type') };
    });
    if (
      !chartWiring ||
      chartWiring.x !== 'k' ||
      chartWiring.y !== 'total' ||
      chartWiring.type !== 'bar'
    ) {
      fail(
        `A1: Create-report auto-chart not wired to bar/k/total — ${JSON.stringify(chartWiring)}`,
      );
    }
    log('✓ A1: Create-report auto-embeds a bar chart cell wired to category × measure');

    // A2 — the same Create-report leads with a KPI row: total / average / count
    // tiles bound to auto-generated named measures, with values COMPUTED from
    // the HUGEINT result (Total 60, Rows 2 — east=30, west=10+20=30). Verifies
    // the measures step end-to-end: derive → cache value → render (not "…").
    const kpis = await page.evaluate(() => {
      // Read the LAST report cell — the smoke seeds an earlier empty one.
      const reports = document.querySelectorAll('.cell[data-cell-kind="report"]');
      const report = reports[reports.length - 1];
      if (!report) return null;
      return [...report.querySelectorAll('.report-kpi-tile')].map((tile) => ({
        measure: tile.querySelector('[data-measure]')?.getAttribute('data-measure') ?? null,
        value: tile.querySelector('[data-measure]')?.textContent?.trim() ?? null,
      }));
    });
    const total = kpis?.find((k) => k.measure?.endsWith('_total'));
    const rows = kpis?.find((k) => k.measure?.endsWith('_count'));
    if (!kpis || kpis.length < 3 || total?.value !== '60' || rows?.value !== '2') {
      fail(`A2: report KPI tiles wrong — ${JSON.stringify(kpis)} (expected Total 60, Rows 2)`);
    }
    if (kpis.some((k) => k.value === '…' || k.value === '')) {
      fail(`A2: a KPI tile rendered empty/placeholder — ${JSON.stringify(kpis)}`);
    }
    log(
      '✓ A2: Create-report leads with computed KPI tiles (total 60 / rows 2) bound to named measures',
    );

    // A4 — scoped report-refresh. Click "Refresh data" on this report; it
    // re-runs only its dependency subgraph (the source SQL cell), then
    // recomputes the KPI tiles. Asserts the path works end-to-end (the scoped
    // subgraph selection itself is unit-tested).
    await page.evaluate(() => {
      const reports = document.querySelectorAll('.cell[data-cell-kind="report"]');
      const last = reports[reports.length - 1];
      last?.querySelector('[data-action="report-refresh"]')?.click();
    });
    await page.waitForFunction(
      () => {
        const reports = document.querySelectorAll('.cell[data-cell-kind="report"]');
        const last = reports[reports.length - 1];
        const total = last?.querySelector('.report-kpi-tile [data-measure$="_total"]');
        return total?.textContent?.trim() === '60';
      },
      null,
      { timeout: 8000 },
    );
    log('✓ A4: scoped report-refresh re-runs the report subgraph + recomputes KPIs (total 60)');
  }

  // 12f-ter. A3 — executive report-cell templates. Add an empty report, pick
  //   "Briefing memo" from its empty-state picker (which lazy-loads the
  //   report-templates chunk), and assert the scaffold lands: the report
  //   cell-refs the three seeded markdown sections, and those markdown cells
  //   were created.
  {
    const reportsBefore = await page.evaluate(
      () => document.querySelectorAll('.cell[data-cell-kind="report"]').length,
    );
    await page.click('[data-nb-action="add-report"]');
    await page.waitForFunction(
      (b) => document.querySelectorAll('.cell[data-cell-kind="report"]').length > b,
      reportsBefore,
      { timeout: 5000 },
    );
    // The new (last) empty report shows the template picker.
    await page.waitForFunction(
      () => {
        const rs = document.querySelectorAll('.cell[data-cell-kind="report"]');
        const last = rs[rs.length - 1];
        return !!last?.querySelector(
          '[data-action="report-template"][data-template-id="briefing_memo"]',
        );
      },
      null,
      { timeout: 5000 },
    );
    await page.evaluate(() => {
      const rs = document.querySelectorAll('.cell[data-cell-kind="report"]');
      const last = rs[rs.length - 1];
      last
        ?.querySelector('[data-action="report-template"][data-template-id="briefing_memo"]')
        ?.click();
    });
    // Scaffold lands: the report now cell-refs the three seeded markdown sections.
    await page.waitForFunction(
      () => {
        const rs = document.querySelectorAll('.cell[data-cell-kind="report"]');
        const last = rs[rs.length - 1];
        const t = last?.textContent ?? '';
        return /_summary/.test(t) && /_findings/.test(t) && /_recommendation/.test(t);
      },
      null,
      { timeout: 8000 },
    );
    const mdOk = await page.evaluate(() =>
      [...document.querySelectorAll('.cell[data-cell-kind="markdown"]')].some((c) =>
        /Key findings/.test(c.textContent ?? ''),
      ),
    );
    if (!mdOk) fail('A3: briefing-memo markdown section cells not created');
    log('✓ A3: executive report template (briefing memo) scaffolds sections + markdown cells');
  }

  // 12g. Parquet + spatial mount OFFLINE (F1 / DECISIONS BX). Both formats
  //      autoload their DuckDB extension from the repo, not the wasm bundle;
  //      an offline boot pins `custom_extension_repository` local, so this
  //      leg is dead unless `parquet` + `spatial` are vendored into
  //      public/duckdb-extensions/. Mounts go through the same Add-source →
  //      "Add file" path a real user takes.
  //
  //      Fixture: an 822-byte snappy Parquet (5 Indian cities) generated by
  //      pyarrow, base64-inlined so the smoke needs no on-disk binary.
  const PARQUET_B64 =
    'UEFSMRUEFWIVZkwVChUAEgAAMcAGAAAATXVtYmFpBQAAAERlbGhpBAAAAFB1bmUHAAAAQ2hlbm5haQcAAABLb2xrYXRhFQAVFhUaLBUKFRAVBhUGHDYAKARQdW5lGAdDaGVubmFpAAAACygCAAAACgEDA4hGABUEFVAVSkwVChUAEgAAKABmBQEINEAzAQEIc0BABQ9IZhpAAAAAAAAAJ0AzMzMzMzMuQBUAFRYVGiwVChUQFQYVBhwYCDMzMzMzc0BAGAhmZmZmZmYaQBYAKAgzMzMzM3NAQBgIZmZmZmZmGkAAAAALKAIAAAAKAQMDiEYAFQQZPDUAGAZzY2hlbWEVBAAVDCUCGARjaXR5JQBMHAAAABUKJQIYDHBvcF9taWxsaW9ucwAWChkcGSwmABwVDBk1AAYQGRgEY2l0eRUCFgoW3AEW5AEmigEmCBw2ACgEUHVuZRgHQ2hlbm5haQAZLBUEFQAVAgAVABUQFQIAPBY6GQYZJgAKAAAAJgAcFQoZNQAGEBkYDHBvcF9taWxsaW9ucxUCFgoW/AEW+gEm0gIm7AEcGAgzMzMzM3NAQBgIZmZmZmZmGkAWACgIMzMzMzNzQEAYCGZmZmZmZhpAABksFQQVABUCABUAFRAVAgA8KQYZJgAKAAAAFtgDFgomCBbeAwAZHBgMQVJST1c6c2NoZW1hGPgBLy8vLy83QUFBQUFRQUFBQUFBQUtBQXdBQmdBRkFBZ0FDZ0FBQUFBQkJBQU1BQUFBQ0FBSUFBQUFCQUFJQUFBQUJBQUFBQUlBQUFCUUFBQUFCQUFBQU1qLy8vOEFBQUVERUFBQUFDUUFBQUFFQUFBQUFBQUFBQXdBQUFCd2IzQmZiV2xzYkdsdmJuTUFBQVlBQ0FBR0FBWUFBQUFBQUFJQUVBQVVBQWdBQmdBSEFBd0FBQUFRQUJBQUFBQUFBQUVGRUFBQUFCd0FBQUFFQUFBQUFBQUFBQVFBQUFCamFYUjVBQUFBQUFRQUJBQUVBQUFBQUFBQUFBPT0AGCBwYXJxdWV0LWNwcC1hcnJvdyB2ZXJzaW9uIDIxLjAuMBksHAAAHAAAADsCAABQQVIx';
  await page.evaluate((b64) => {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const file = new File([arr], 'cities.parquet', { type: 'application/octet-stream' });
    window.showOpenFilePicker = async () => [{ getFile: async () => file }];
  }, PARQUET_B64);
  await page.click('[data-action="add-source"]');
  await page.waitForSelector('.add-source-overlay', { timeout: 3000 });
  await page.click('.add-source-overlay [data-action="mount-file"]');
  await page.waitForFunction(
    () =>
      /\bcities\b/.test(document.querySelector('aside[aria-label="Sources"]')?.textContent ?? ''),
    null,
    { timeout: 20000 },
  );
  const parquetRows = await page.evaluate(() => {
    const t = document.querySelector('aside[aria-label="Sources"]')?.textContent ?? '';
    return t.match(/\bcities\b\s+([\d,]+)\s+rows/)?.[1] ?? null;
  });
  if (parquetRows !== '5') {
    fail(`offline Parquet mount row count wrong: ${parquetRows} (expected 5)`);
  }
  log('✓ Parquet mounts offline (5 rows) — parquet extension autoloads from the vendored repo');

  // A tiny 2-feature GeoJSON — proves the `spatial` extension's ST_Read
  // autoloads offline too. registerSpatial lands it as a normal source view.
  const GEOJSON = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: 'A' },
        geometry: { type: 'Point', coordinates: [72.8, 19.0] },
      },
      {
        type: 'Feature',
        properties: { name: 'B' },
        geometry: { type: 'Point', coordinates: [77.2, 28.6] },
      },
    ],
  });
  await page.evaluate((gj) => {
    const file = new File([new TextEncoder().encode(gj)], 'places.geojson', {
      type: 'application/geo+json',
    });
    window.showOpenFilePicker = async () => [{ getFile: async () => file }];
  }, GEOJSON);
  await page.click('[data-action="add-source"]');
  await page.waitForSelector('.add-source-overlay', { timeout: 3000 });
  await page.click('.add-source-overlay [data-action="mount-file"]');
  await page.waitForFunction(
    () =>
      /\bplaces\b/.test(document.querySelector('aside[aria-label="Sources"]')?.textContent ?? ''),
    null,
    { timeout: 20000 },
  );
  const geojsonRows = await page.evaluate(() => {
    const t = document.querySelector('aside[aria-label="Sources"]')?.textContent ?? '';
    return t.match(/\bplaces\b\s+([\d,]+)\s+rows/)?.[1] ?? null;
  });
  if (geojsonRows !== '2') {
    fail(`offline GeoJSON mount row count wrong: ${geojsonRows} (expected 2)`);
  }
  log('✓ GeoJSON mounts offline (2 features) — spatial extension autoloads from the vendored repo');

  // 12h. Arrow IPC-file mount (F2 / DECISIONS BX). `.arrow`/`.feather` files
  //      are IPC *file* format (ARROW1 magic); the engine used to feed them
  //      to insertArrowFromIPCStream (which wants IPC *stream*) → silent
  //      no-op → "table does not exist". Now the arrow-reader chunk re-frames
  //      file→stream via apache-arrow. Fixture: a 674-byte UNCOMPRESSED
  //      feather (3 cities); LZ4/ZSTD-compressed Arrow is unsupported by the
  //      JS reader (surfaced as an actionable error, not tested here).
  const ARROW_B64 =
    'QVJST1cxAAD/////qAAAABAAAAAAAAoADAAGAAUACAAKAAAAAAEEAAwAAAAIAAgAAAAEAAgAAAAEAAAAAgAAAEwAAAAEAAAAzP///wAAAQIQAAAAHAAAAAQAAAAAAAAAAwAAAHBvcAAIAAwACAAHAAgAAAAAAAABQAAAABAAFAAIAAYABwAMAAAAEAAQAAAAAAABBRAAAAAcAAAABAAAAAAAAAAEAAAAY2l0eQAAAAAEAAQABAAAAP/////IAAAAFAAAAAAAAAAMABYABgAFAAgADAAMAAAAAAMEABgAAAA4AAAAAAAAAAAACgAYAAwABAAIAAoAAABsAAAAEAAAAAMAAAAAAAAAAAAAAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAABAAAAAAAAAADwAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAYAAAAAAAAAAAAAAACAAAAAwAAAAAAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAABgAAAAsAAAAPAAAATXVtYmFpRGVsaGlQdW5lABQAAAAAAAAAIQAAAAAAAAAHAAAAAAAAAP////8AAAAAEAAAAAwAFAAGAAgADAAQAAwAAAAAAAQANAAAACQAAAAEAAAAAQAAALgAAAAAAAAA0AAAAAAAAAA4AAAAAAAAAAAAAAAIAAgAAAAEAAgAAAAEAAAAAgAAAEwAAAAEAAAAzP///wAAAQIQAAAAHAAAAAQAAAAAAAAAAwAAAHBvcAAIAAwACAAHAAgAAAAAAAABQAAAABAAFAAIAAYABwAMAAAAEAAQAAAAAAABBRAAAAAcAAAABAAAAAAAAAAEAAAAY2l0eQAAAAAEAAQABAAAANAAAABBUlJPVzE=';
  await page.evaluate((b64) => {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const file = new File([arr], 'arrow_cities.arrow', { type: 'application/octet-stream' });
    window.showOpenFilePicker = async () => [{ getFile: async () => file }];
  }, ARROW_B64);
  await page.click('[data-action="add-source"]');
  await page.waitForSelector('.add-source-overlay', { timeout: 3000 });
  await page.click('.add-source-overlay [data-action="mount-file"]');
  await page.waitForFunction(
    () =>
      /\barrow_cities\b/.test(
        document.querySelector('aside[aria-label="Sources"]')?.textContent ?? '',
      ),
    null,
    { timeout: 20000 },
  );
  const arrowRows = await page.evaluate(() => {
    const t = document.querySelector('aside[aria-label="Sources"]')?.textContent ?? '';
    return t.match(/\barrow_cities\b\s+([\d,]+)\s+rows/)?.[1] ?? null;
  });
  if (arrowRows !== '3') {
    fail(`Arrow IPC-file mount row count wrong: ${arrowRows} (expected 3)`);
  }
  log('✓ Arrow IPC-file mounts (3 rows) — file→stream re-framed via the arrow-reader chunk');

  // 12i. Headerless CSV auto-detection (F4 / DECISIONS BX). createDelimitedView
  //      used to force header=true, so a headerless file's first data row
  //      became the column names — one record lost + garbage headers. Now
  //      header detection is left to DuckDB's sniffer. This 3-row typed CSV
  //      (first row is data, same shape as the rest) must mount as 3 rows
  //      with generated `column0…` names; a forced header would show 2 rows.
  await page.evaluate(() => {
    const text = '1,2.5,alpha\n2,3.5,beta\n3,4.5,gamma\n';
    const file = new File([new TextEncoder().encode(text)], 'htyped.csv', { type: 'text/csv' });
    window.showOpenFilePicker = async () => [{ getFile: async () => file }];
  });
  await page.click('[data-action="add-source"]');
  await page.waitForSelector('.add-source-overlay', { timeout: 3000 });
  await page.click('.add-source-overlay [data-action="mount-file"]');
  await page.waitForFunction(
    () =>
      /\bhtyped\b/.test(document.querySelector('aside[aria-label="Sources"]')?.textContent ?? ''),
    null,
    { timeout: 20000 },
  );
  const headerlessRows = await page.evaluate(() => {
    const t = document.querySelector('aside[aria-label="Sources"]')?.textContent ?? '';
    return t.match(/\bhtyped\b\s+([\d,]+)\s+rows/)?.[1] ?? null;
  });
  if (headerlessRows !== '3') {
    fail(
      `headerless CSV row count wrong: ${headerlessRows} (expected 3 — a forced header would give 2)`,
    );
  }
  log('✓ headerless CSV auto-detected (3 rows kept, no forced header) — F4');

  // 12j. Statistical-format mount (SPSS/Stata/SAS via the vendored ReadStat-wasm
  //      reader — Polyglot-Workbench Fork 1). DuckDB's read_stat has no wasm
  //      build; we own the reader (src/lazy/readstat-reader.ts → the C wrapper
  //      emits NDJSON → read_json_auto). Fixture: a 3-row Stata .dta
  //      (city/pop/code) written by pyreadstat, read from the committed
  //      tests/e2e/fixtures/sample-data/stat_demo.dta.
  const dtaBytes = await readFile('tests/e2e/fixtures/sample-data/stat_demo.dta');
  const DTA_B64 = dtaBytes.toString('base64');
  await page.evaluate((b64) => {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const file = new File([arr], 'stat_demo.dta', { type: 'application/octet-stream' });
    window.showOpenFilePicker = async () => [{ getFile: async () => file }];
  }, DTA_B64);
  await page.click('[data-action="add-source"]');
  await page.waitForSelector('.add-source-overlay', { timeout: 3000 });
  await page.click('.add-source-overlay [data-action="mount-file"]');
  await page.waitForFunction(
    () =>
      /\bstat_demo\b/.test(
        document.querySelector('aside[aria-label="Sources"]')?.textContent ?? '',
      ),
    null,
    { timeout: 20000 },
  );
  const statRows = await page.evaluate(() => {
    const t = document.querySelector('aside[aria-label="Sources"]')?.textContent ?? '';
    return t.match(/\bstat_demo\b\s+([\d,]+)\s+rows/)?.[1] ?? null;
  });
  if (statRows !== '3') {
    fail(`Stata .dta mount row count wrong: ${statRows} (expected 3)`);
  }
  log('✓ Stata .dta mounts (3 rows) — ReadStat-wasm reader → NDJSON → read_json_auto');

  // 12j-2. Stata date decoding — a fixture whose columns are %td (daily) + %tc
  //        (datetime) dates must come through as real ISO dates, not the raw
  //        Stata offsets (2020-01-01 not 21915). Mount it, then query row id=1.
  const dtaDates = await readFile('tests/e2e/fixtures/sample-data/stat_dates.dta');
  await page.evaluate((b64) => {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const file = new File([arr], 'stat_dates.dta', { type: 'application/octet-stream' });
    window.showOpenFilePicker = async () => [{ getFile: async () => file }];
  }, dtaDates.toString('base64'));
  await page.click('[data-action="add-source"]');
  await page.waitForSelector('.add-source-overlay', { timeout: 3000 });
  await page.click('.add-source-overlay [data-action="mount-file"]');
  await page.waitForFunction(
    () =>
      /\bstat_dates\b/.test(
        document.querySelector('aside[aria-label="Sources"]')?.textContent ?? '',
      ),
    null,
    { timeout: 20000 },
  );
  const dcBefore = await page.evaluate(
    () => document.querySelectorAll('.cell[data-cell-kind="sql"]').length,
  );
  await page.click('[data-nb-action="add-sql"]');
  await page.waitForFunction(
    (b) => document.querySelectorAll('.cell[data-cell-kind="sql"]').length > b,
    dcBefore,
    { timeout: 5000 },
  );
  const dCell = page.locator('.cell[data-cell-kind="sql"]').last();
  await dCell.locator('.cm-content, textarea').first().click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(
    'SELECT d::VARCHAR AS d, ts::VARCHAR AS ts FROM stat_dates WHERE id = 1',
  );
  await dCell.locator('[data-action="cell-run"]').click();
  await page.waitForFunction(
    () => {
      const c = [...document.querySelectorAll('.cell[data-cell-kind="sql"]')].at(-1);
      return c && !c.classList.contains('errored') && c.querySelector('table td');
    },
    null,
    { timeout: 15000 },
  );
  const dCells = await page.evaluate(() => {
    const c = [...document.querySelectorAll('.cell[data-cell-kind="sql"]')].at(-1);
    return [...c.querySelectorAll('table td')].map((td) => td.textContent);
  });
  if (!dCells.includes('2020-01-01')) {
    fail(`Stata %td date not decoded (expected 2020-01-01, got ${JSON.stringify(dCells)})`);
  }
  if (!dCells.some((v) => /^2020-01-01 13:30:00/.test(v ?? ''))) {
    fail(
      `Stata %tc datetime not decoded (expected 2020-01-01 13:30:00, got ${JSON.stringify(dCells)})`,
    );
  }
  log('✓ Stata date decoding: %td → 2020-01-01, %tc → 2020-01-01 13:30:00 (not raw offsets)');

  // 12j-3. SPSS date decoding — the .sav fixture carries DATE/ADATE/EDATE (day),
  //        DATETIME (instant), and TIME (duration) columns on the SPSS
  //        seconds-since-1582 epoch. They must decode to ISO strings, not the
  //        raw ~1.38e10 second offsets. Query the pre-1960 row (id=2) so a wrong
  //        epoch/sign can't accidentally pass. (SAS .xpt shares the decoder path;
  //        node-verified in the same build — a second browser mount adds no
  //        coverage the .sav leg doesn't already give.)
  const savDates = await readFile('tests/e2e/fixtures/sample-data/spss_dates.sav');
  await page.evaluate((b64) => {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const file = new File([arr], 'spss_dates.sav', { type: 'application/octet-stream' });
    window.showOpenFilePicker = async () => [{ getFile: async () => file }];
  }, savDates.toString('base64'));
  await page.click('[data-action="add-source"]');
  await page.waitForSelector('.add-source-overlay', { timeout: 3000 });
  await page.click('.add-source-overlay [data-action="mount-file"]');
  await page.waitForFunction(
    () =>
      /\bspss_dates\b/.test(
        document.querySelector('aside[aria-label="Sources"]')?.textContent ?? '',
      ),
    null,
    { timeout: 20000 },
  );
  const savBefore = await page.evaluate(
    () => document.querySelectorAll('.cell[data-cell-kind="sql"]').length,
  );
  await page.click('[data-nb-action="add-sql"]');
  await page.waitForFunction(
    (b) => document.querySelectorAll('.cell[data-cell-kind="sql"]').length > b,
    savBefore,
    { timeout: 5000 },
  );
  const sCell = page.locator('.cell[data-cell-kind="sql"]').last();
  await sCell.locator('.cm-content, textarea').first().click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(
    'SELECT d::VARCHAR AS d, ts::VARCHAR AS ts, tm::VARCHAR AS tm ' +
      'FROM spss_dates WHERE id = 2',
  );
  await sCell.locator('[data-action="cell-run"]').click();
  await page.waitForFunction(
    () => {
      const c = [...document.querySelectorAll('.cell[data-cell-kind="sql"]')].at(-1);
      return c && !c.classList.contains('errored') && c.querySelector('table td');
    },
    null,
    { timeout: 15000 },
  );
  const sCells = await page.evaluate(() => {
    const c = [...document.querySelectorAll('.cell[data-cell-kind="sql"]')].at(-1);
    return [...c.querySelectorAll('table td')].map((td) => td.textContent);
  });
  if (!sCells.includes('1959-06-15')) {
    fail(`SPSS DATE not decoded (expected 1959-06-15, got ${JSON.stringify(sCells)})`);
  }
  if (!sCells.some((v) => /^1959-06-15 23:59:59/.test(v ?? ''))) {
    fail(`SPSS DATETIME not decoded (expected 1959-06-15 23:59:59, got ${JSON.stringify(sCells)})`);
  }
  if (!sCells.some((v) => /^0?0:00:01/.test(v ?? ''))) {
    fail(`SPSS TIME not decoded (expected 00:00:01, got ${JSON.stringify(sCells)})`);
  }
  log('✓ SPSS date decoding: DATE → 1959-06-15, DATETIME → 1959-06-15 23:59:59, TIME → 00:00:01');

  // 12k. Python cell (Polyglot-Workbench Fork 2). Add a SQL cell that yields a
  //      tiny table, then a Python cell bound to it: pandas doubles a column.
  //      Exercises the full path — table → Parquet → Pyodide (vendored,
  //      same-origin) → pandas → Parquet → re-registered DuckDB table. First
  //      run loads the ~33 MB runtime, so this leg gets a generous timeout.
  await page.click('[data-nb-action="add-sql"]');
  const pySqlCell = page.locator('.cell[data-cell-kind="sql"]').last();
  await pySqlCell.locator('.cm-content, textarea').first().click();
  await page.keyboard.insertText(
    'SELECT 1 AS a, 10 AS b UNION ALL SELECT 2, 20 UNION ALL SELECT 3, 30',
  );
  await pySqlCell.locator('[data-action="cell-run"]').click();
  const pySqlId = await pySqlCell.getAttribute('data-cell-id');
  // Wait for the SQL cell to produce its result view (cell_<id>).
  await page.waitForFunction(
    (id) => {
      const c = document.querySelector(`.cell[data-cell-id="${id}"]`);
      return (
        !!c &&
        !c.classList.contains('errored') &&
        !!c.querySelector('.result-table, .cell-output table')
      );
    },
    pySqlId,
    { timeout: 15000 },
  );

  await page.click('[data-nb-action="add-python"]');
  const pyCell = page.locator('.cell[data-cell-kind="python"]').last();
  // Pick the SQL cell as input.
  await pyCell.locator('[data-action="lang-input"]').selectOption(pySqlId ?? '');
  // Replace the starter code with a deterministic transform. The language cells
  // now use the shared CodeMirror editor (code-editor-host), so drive it the same
  // way as the SQL cells: click the CM surface (or fallback textarea), select-all,
  // then type.
  const pyEditor = pyCell.locator('.cm-content, textarea').first();
  await pyEditor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText("df['c'] = df['b'] * 2\ndf = df[['a', 'c']]");
  await pyCell.locator('[data-action="run-python"]').click();
  // First run downloads + inits Pyodide (~33 MB) then runs — allow 120 s.
  await page.waitForFunction(
    () => {
      const cells = document.querySelectorAll('.cell[data-cell-kind="python"]');
      const c = cells[cells.length - 1];
      const txt = c?.querySelector('.cell-output')?.textContent ?? '';
      return /rows ×/.test(txt) || /Python error/.test(txt);
    },
    null,
    { timeout: 120000 },
  );
  const pyOut = await pyCell.locator('.cell-output').innerText();
  if (/Python error/.test(pyOut)) {
    fail(`Python cell errored: ${pyOut.slice(0, 200)}`);
  }
  if (!/3 rows × 2 cols/.test(pyOut)) {
    fail(`Python cell output wrong: ${pyOut.slice(0, 200)} (expected "3 rows × 2 cols")`);
  }
  // The result must be queryable downstream as the python cell's table.
  const pyId = await pyCell.getAttribute('data-cell-id');
  await page.click('[data-nb-action="add-sql"]');
  const dsCell = page.locator('.cell[data-cell-kind="sql"]').last();
  await dsCell.locator('.cm-content, textarea').first().click();
  await page.keyboard.insertText(
    `SELECT sum(c) AS total FROM cell_${(pyId ?? '').replace(/[^A-Za-z0-9_]/g, '_')}`,
  );
  await dsCell.locator('[data-action="cell-run"]').click();
  await page.waitForFunction(
    () => {
      const cells = document.querySelectorAll('.cell[data-cell-kind="sql"]');
      const last = cells[cells.length - 1];
      // sum(c) = (10+20+30)*2 = 120
      return !!last && /120/.test(last.querySelector('.cell-output')?.textContent ?? '');
    },
    null,
    { timeout: 10000 },
  );
  log(
    '✓ Python cell: SQL → Parquet → Pyodide(pandas) → Parquet → DuckDB table, queryable downstream (sum=120)',
  );

  // 12l. R cell (Polyglot-Workbench Fork 2, WebR). Same shared language-cell
  //      path as Python, but CSV interchange over WebR's VFS + base R. Reuse the
  //      same SQL input; R doubles column b into c. First run downloads the
  //      ~47 MB WebR runtime (SharedArrayBuffer — needs cross-origin isolation,
  //      which the smoke server sets), so this leg gets a generous timeout.
  await page.click('[data-nb-action="add-r"]');
  const rCell = page.locator('.cell[data-cell-kind="r"]').last();
  await rCell.locator('[data-action="lang-input"]').selectOption(pySqlId ?? '');
  const rEditor = rCell.locator('.cm-content, textarea').first();
  await rEditor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText("df$c <- df$b * 2\ndf <- df[, c('a', 'c')]");
  await rCell.locator('[data-action="run-r"]').click();
  await page.waitForFunction(
    () => {
      const cells = document.querySelectorAll('.cell[data-cell-kind="r"]');
      const c = cells[cells.length - 1];
      const txt = c?.querySelector('.cell-output')?.textContent ?? '';
      return /rows ×/.test(txt) || /r error/i.test(txt);
    },
    null,
    { timeout: 180000 },
  );
  const rOut = await rCell.locator('.cell-output').innerText();
  if (/r error/i.test(rOut)) {
    fail(`R cell errored: ${rOut.slice(0, 200)}`);
  }
  if (!/3 rows × 2 cols/.test(rOut)) {
    fail(`R cell output wrong: ${rOut.slice(0, 200)} (expected "3 rows × 2 cols")`);
  }

  // A long R computation participates in the notebook's ordinary Escape
  // cancellation path. The same runtime must accept a recovery run afterward.
  await rEditor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('Sys.sleep(60)');
  await rCell.locator('[data-action="run-r"]').click();
  await page.waitForFunction(
    () =>
      /Running R/.test(
        document.querySelector('.cell[data-cell-kind="r"] .cell-output')?.textContent ?? '',
      ),
    null,
    { timeout: 10000 },
  );
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () => document.querySelector('.cell[data-cell-kind="r"].running') === null,
    null,
    { timeout: 10000 },
  );
  const recoveryEditor = rCell.locator('.cm-content, textarea').first();
  await recoveryEditor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText("df$c <- df$b * 2\ndf <- df[, c('a', 'c')]");
  await rCell.locator('[data-action="run-r"]').click();
  await page.waitForFunction(
    () => document.querySelector('.cell[data-cell-kind="r"].running') !== null,
    null,
    { timeout: 10000 },
  );
  try {
    await page.waitForFunction(
      () => {
        const cell = document.querySelector('.cell[data-cell-kind="r"]');
        return !cell?.classList.contains('running');
      },
      null,
      { timeout: 180000 },
    );
  } catch (err) {
    const state = await rCell.locator('.cell-output').innerText();
    fail(`R recovery remained busy: ${state.slice(0, 300)} (${String(err)})`);
  }
  const recoveredROut = await rCell.locator('.cell-output').innerText();
  if (!/3 rows × 2 cols/.test(recoveredROut)) {
    fail(`R cell did not recover after cancellation: ${recoveredROut.slice(0, 300)}`);
  }
  log('✓ R cell cancellation: Escape interrupts a long run and the shared runtime recovers');

  const rId = await rCell.getAttribute('data-cell-id');
  await page.click('[data-nb-action="add-sql"]');
  const rdsCell = page.locator('.cell[data-cell-kind="sql"]').last();
  await rdsCell.locator('.cm-content, textarea').first().click();
  await page.keyboard.insertText(
    `SELECT sum(c) AS total FROM cell_${(rId ?? '').replace(/[^A-Za-z0-9_]/g, '_')}`,
  );
  await rdsCell.locator('[data-action="cell-run"]').click();
  await page.waitForFunction(
    () => {
      const cells = document.querySelectorAll('.cell[data-cell-kind="sql"]');
      const last = cells[cells.length - 1];
      return !!last && /120/.test(last.querySelector('.cell-output')?.textContent ?? '');
    },
    null,
    { timeout: 10000 },
  );
  log('✓ R cell: SQL → CSV → WebR(base R) → CSV → DuckDB table, queryable downstream (sum=120)');

  // 12b. Service-worker runtime-byte caching. The large, immutable vendored
  // runtimes (Pyodide/WebR/ReadStat/DuckDB-ext) are cached cache-first in a
  // deploy-independent `naklidata-runtime-*` bucket so a shell redeploy doesn't
  // evict ~100 MB. Verify a runtime asset lands there and NOT in the shell cache.
  // Soft-skips when the SW isn't controlling (registration is prod + async).
  const rtCache = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    let controlled = false;
    for (let i = 0; i < 24; i++) {
      if (navigator.serviceWorker?.controller) {
        controlled = true;
        break;
      }
      await wait(250);
    }
    if (!controlled) return { skipped: true };
    const assets = [
      '/readstat-wasm/readstat.wasm',
      '/webr/webr.js',
      '/webr/R.wasm',
    ];
    await Promise.all(assets.map((asset) => fetch(asset)));
    await wait(400); // let the fire-and-forget cache.put settle
    const keys = await caches.keys();
    const runtimeKey = keys.find((k) => k.startsWith('naklidata-runtime-')) ?? null;
    const shellKey = keys.find((k) => k.startsWith('naklidata-shell-')) ?? null;
    const runtime = runtimeKey ? await caches.open(runtimeKey) : null;
    const shell = shellKey ? await caches.open(shellKey) : null;
    const missingRuntime = [];
    const leakedShell = [];
    for (const asset of assets) {
      if (!runtime || !(await runtime.match(asset))) missingRuntime.push(asset);
      if (shell && (await shell.match(asset))) leakedShell.push(asset);
    }
    return { skipped: false, runtimeKey, missingRuntime, leakedShell };
  });
  if (rtCache.skipped) {
    log('~ SW runtime-cache guard skipped (service worker not controlling in harness)');
  } else {
    if (rtCache.missingRuntime.length > 0) {
      fail(`SW: runtime assets missing from runtime cache: ${rtCache.missingRuntime.join(', ')}`);
    }
    if (rtCache.leakedShell.length > 0) {
      fail(`SW: runtime assets leaked into the shell cache: ${rtCache.leakedShell.join(', ')}`);
    }
    log(`✓ SW runtime cache: ReadStat and WebR core assets cached in ${rtCache.runtimeKey}`);
  }

  // 12c. Generic same-origin caching is a data-leak footgun. Only explicit
  // static paths may enter Cache Storage, and authority/private/partial
  // variants of an allowed path must bypass it.
  const swPolicy = await page.evaluate(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    if (!navigator.serviceWorker?.controller) return { skipped: true };
    const probes = {
      allowed: '/icon.svg?sw-allowed=1',
      unlisted: '/__smoke_dirty.csv?sw-unlisted=1',
      authorized: '/icon.svg?sw-authorized=1',
      credentialed: '/icon.svg?sw-credentialed=1',
      requestNoStore: '/icon.svg?sw-request-no-store=1',
      privateResponse: '/icon.svg?sw-private=1&__private=1',
      partialResponse: '/icon.svg?sw-partial=1&__partial=1',
      sensitiveQuery: '/icon.svg?access_token=smoke-secret',
    };
    await fetch(probes.allowed);
    await fetch(probes.unlisted);
    await fetch(probes.authorized, { headers: { authorization: 'Bearer smoke' } });
    await fetch(probes.credentialed, { credentials: 'include' });
    await fetch(probes.requestNoStore, { cache: 'no-store' });
    await fetch(probes.privateResponse);
    await fetch(probes.partialResponse);
    await fetch(probes.sensitiveQuery);
    await wait(500);
    const shellKey = (await caches.keys()).find((key) => key.startsWith('naklidata-shell-'));
    if (!shellKey) return { skipped: false, error: 'shell cache missing' };
    const cache = await caches.open(shellKey);
    const cached = {};
    for (const [name, path] of Object.entries(probes)) {
      cached[name] = !!(await cache.match(path));
    }
    return { skipped: false, cached };
  });
  if (swPolicy.skipped) {
    log('~ SW policy guard skipped (service worker not controlling in harness)');
  } else if (swPolicy.error) {
    fail(`SW policy: ${swPolicy.error}`);
  } else {
    if (!swPolicy.cached.allowed) fail('SW policy: allowlisted static asset was not cached');
    for (const [name, cached] of Object.entries(swPolicy.cached)) {
      if (name !== 'allowed' && cached) fail(`SW policy: ${name} request entered Cache Storage`);
    }
    log('✓ SW cache policy: static allowlist enforced; auth/private/no-store/206 paths bypassed');
  }

  // 12m. Session isolation. Every source and runnable cell materialises a
  // DuckDB relation. Starting a new session must drop the outgoing workspace's
  // relations, not merely clear the visible source/cell lists.
  const outgoingCellViews = await page.evaluate(() =>
    [...document.querySelectorAll('.cell[data-cell-id]')]
      .map((cell) => cell.getAttribute('data-cell-id'))
      .filter((id) => id !== null)
      .map((id) => `cell_${id}`),
  );
  await page.click('[data-action="session-menu"]');
  await page.click('[data-action="session-new"]');
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.source-card').length === 0 &&
      document.querySelectorAll('.cell[data-cell-id]').length === 0,
    null,
    { timeout: 10000 },
  );
  await page.click('[data-action="open-settings"]');
  await page.waitForSelector('[data-agent-scope="values:read"]', { timeout: 10000 });
  if (
    (await page.locator('[data-agent-scope="values:read"]').isChecked()) ||
    (await page.locator('[data-agent-scope="workspace:propose"]').isChecked())
  ) {
    fail('agent access: a session/workspace replacement retained a sensitive grant');
  }
  const resetActivityCopy = await page
    .locator('[data-region="agent-access"]')
    .textContent();
  if (!resetActivityCopy?.includes('No agent activity in this workspace')) {
    fail('agent access: workspace replacement retained the prior activity ledger');
  }
  await page.click('[data-action="close-settings"]');
  await page.click('[data-action="browse-examples"]');
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.source-card').length === 3 &&
      document.querySelectorAll('.cell[data-cell-kind="sql"]').length === 1,
    null,
    { timeout: 30000 },
  );
  const isolatedSqlCell = page.locator('.cell[data-cell-kind="sql"]').last();
  await isolatedSqlCell.locator('.cm-content, textarea').first().click();
  await page.keyboard.insertText('SHOW TABLES');
  await isolatedSqlCell.locator('[data-action="cell-run"]').click();
  await page.waitForFunction(
    () => {
      const cell = document.querySelector('.cell[data-cell-kind="sql"]');
      return !!cell?.querySelector('.result-table tbody tr');
    },
    null,
    { timeout: 15000 },
  );
  const visibleRelations = await isolatedSqlCell.evaluate((cell) =>
    [...cell.querySelectorAll('.result-table tbody tr')].map(
      (row) => row.querySelector('td')?.textContent ?? '',
    ),
  );
  const leakedCellViews = outgoingCellViews.filter((name) => visibleRelations.includes(name));
  if (leakedCellViews.length > 0) {
    fail(
      `session isolation: outgoing cell views remained queryable (${leakedCellViews.join(', ')})`,
    );
  }
  log(
    `✓ Session isolation: ${outgoingCellViews.length} outgoing cell relation(s) dropped before the new workspace mounted`,
  );

  // 12n. WebMCP is optional: the main leg already loaded with ?webmcp=1 and
  // remains healthy when the native API is absent. A second page injects the
  // current async API shape before application code, proving same-origin
  // exposure, structured v3 results, twelve-tool discovery, and abort-scoped
  // teardown without making smoke depend on browser support.
  const webMcpPage = await context.newPage();
  await webMcpPage.addInitScript(() => {
    globalThis.__webMcpTools = [];
    globalThis.__webMcpAbortCount = 0;
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: {
        registerTool: async (definition, options) => {
          globalThis.__webMcpTools.push({ definition, exposedTo: options?.exposedTo ?? [] });
          options?.signal?.addEventListener(
            'abort',
            () => {
              globalThis.__webMcpAbortCount++;
            },
            { once: true },
          );
        },
      },
    });
  });
  await webMcpPage.goto(`${url}/index.html?offline=1&webmcp=1`, { waitUntil: 'load' });
  await webMcpPage.waitForFunction(() => globalThis.__webMcpTools?.length === 12, null, {
    timeout: 90000,
  });
  const webMcpProbe = await webMcpPage.evaluate(async () => {
    const tools = globalThis.__webMcpTools;
    const capabilities = tools.find((item) => item.definition.name === 'getCapabilities');
    return {
      names: tools.map((item) => item.definition.name).sort(),
      exposure: [...new Set(tools.flatMap((item) => item.exposedTo))],
      result: await capabilities.definition.execute({}),
    };
  });
  if (
    webMcpProbe.names.length !== 12 ||
    webMcpProbe.names.some((name) => /run|execute/i.test(name)) ||
    webMcpProbe.exposure.length !== 1 ||
    webMcpProbe.exposure[0] !== new URL(url).origin ||
    webMcpProbe.result.version !== '3' ||
    webMcpProbe.result.ok !== true
  ) {
    fail(`WebMCP adapter contract failed: ${JSON.stringify(webMcpProbe)}`);
  }
  const webMcpAbortCount = await webMcpPage.evaluate(async () => {
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    return globalThis.__webMcpAbortCount;
  });
  if (webMcpAbortCount !== 12) {
    fail(`WebMCP adapter did not abort all registrations on teardown (${webMcpAbortCount}/12)`);
  }
  await webMcpPage.close();
  log(
    `✓ WebMCP: graceful native ${nativeWebMcpPresent ? 'presence' : 'absence'} · mock current API registered 12 same-origin v3 tools · structured result · abort teardown`,
  );

  // 13. Sanity: no uncaught errors in the console. (SB5: this used to log and
  // pass regardless — now a real gate.) A short allowlist covers errors that
  // are benign in the headless/offline harness only; anything else fails.
  const BENIGN_CONSOLE_ERRORS = [
    // egress to the CDN is blocked in the sandbox; the app falls back to the
    // vendored runtime, so the failed cross-origin fetch is expected here.
    /jsdelivr\.net/i,
    /Failed to load resource/i,
    // The M30 S3-mount leg (step 3b) deliberately points httpfs at an
    // unreachable/invalid endpoint to prove the extension LOADS and reaches the
    // network stage — DuckDB-wasm logs the resulting XHR failure. Expected.
    /Failed to execute 'open' on 'XMLHttpRequest'/i,
  ];
  const realErrors = consoleErrors.filter((e) => !BENIGN_CONSOLE_ERRORS.some((re) => re.test(e)));
  if (realErrors.length > 0) {
    log('console errors during run:');
    for (const e of realErrors) log('  •', e);
    fail(`${realErrors.length} unexpected console error(s) during smoke run`);
  }
  log('✓ no unexpected console errors');

  // A controlled offline reload must still retrieve the migrated WebR browser
  // entry and wasm from the version-independent runtime cache.
  if (!rtCache.skipped) {
    await context.setOffline(true);
    try {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      const offlineWebR = await page.evaluate(async () => {
        const responses = await Promise.all([
          fetch('/webr/webr.js'),
          fetch('/webr/R.wasm'),
        ]);
        return responses.map((response) => ({ ok: response.ok, status: response.status }));
      });
      if (offlineWebR.some((response) => !response.ok)) {
        fail(`WebR offline reload failed: ${JSON.stringify(offlineWebR)}`);
      }
      log('✓ WebR offline reload: browser entry and wasm served from runtime cache');
    } finally {
      await context.setOffline(false);
    }
  }

  await browser.close();
  server.close();
  log('SMOKE TEST PASSED');
}

main().catch((err) => {
  console.error('[smoke] crashed:', err);
  process.exit(1);
});
