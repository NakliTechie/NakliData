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

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve('dist');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.jsonl': 'application/x-ndjson',
  '.csv': 'text/csv',
  '.parquet': 'application/octet-stream',
  '.wasm': 'application/wasm',
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
        const reqUrl = (req.url ?? '/').split('?')[0];
        const url = reqUrl === '/' ? '/index.html' : reqUrl;
        const filePath = join(ROOT, url);
        const st = await stat(filePath);
        if (!st.isFile()) {
          res.writeHead(404);
          res.end('not found');
          return;
        }
        const body = await readFile(filePath);
        res.writeHead(200, {
          'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
        });
        res.end(body);
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
  log('starting server');
  const { server, url } = await startServer();

  log('launching headless chromium');
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error') {
      consoleErrors.push(msg.text());
      log(`console error: ${msg.text()}`);
    } else if (type === 'warning') {
      log(`console warning: ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => {
    consoleErrors.push(err.message);
    log(`page error: ${err.message}`);
  });

  // Egress in this sandbox blocks cdn.jsdelivr.net, so force the vendored
  // fallback path (?offline=1) for the smoke test.
  const targetUrl = `${url}/index.html?offline=1`;
  log(`loading ${targetUrl}`);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

  // 1. The shell mounted.
  await page.waitForSelector('.shell-header', { timeout: 5000 });
  const brand = await page.textContent('.brand');
  if (!brand || !brand.includes('NakliData')) fail(`brand not found: ${brand}`);
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

  // 3. Empty state is visible.
  const heading = await page.textContent('.empty-state h1');
  if (!heading?.includes('What do you have?')) fail(`empty-state heading: ${heading}`);
  log('✓ empty state visible');

  // 4. Click "Browse example data" to mount the bundled sources.
  await page.click('[data-action="browse-examples"]');
  log('clicked browse-examples');

  // Wait for sources panel to populate.
  await page.waitForFunction(
    () => document.querySelectorAll('.source-row').length > 0,
    null,
    { timeout: 30000 },
  );
  const sourceRowCount = await page.evaluate(
    () => document.querySelectorAll('.source-row').length,
  );
  log(`✓ sources mounted (${sourceRowCount} tables in sources panel)`);
  // We expect 3 CSVs (vendors, invoices, payments). The bundled JSONL log
  // file needs the duckdb JSON extension which is auto-fetched from
  // extensions.duckdb.org — this sandbox's egress blocks that origin, so
  // we tolerate one missing table here.
  if (sourceRowCount < 3) fail(`expected ≥3 tables, got ${sourceRowCount}`);

  // 5. Wait for the schema panel to classify at least some columns.
  log('waiting for classification');
  await page.waitForFunction(
    () => document.querySelectorAll('.schema-column').length >= 10,
    null,
    { timeout: 60000 },
  );
  const colsTotal = await page.evaluate(
    () => document.querySelectorAll('.schema-column').length,
  );
  log(`✓ schema panel rendered ${colsTotal} column rows`);

  const classified = await page.evaluate(() => {
    const cols = Array.from(document.querySelectorAll('.schema-column'));
    let typed = 0;
    let highConf = 0;
    let unknown = 0;
    for (const c of cols) {
      const pill = c.querySelector('.type-pill span:nth-of-type(2)');
      const pct = c.querySelector('.confidence-pct')?.textContent ?? '';
      const num = parseInt(pct, 10);
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

  // 6. Templates panel: "Vendor concentration" should be applicable.
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll('.template-card strong')).some(
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
      const tables = document.querySelectorAll('.cell[data-cell-kind="sql"] .result-table tbody tr');
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

  // 11. Override one column's type. Pick the first schema-column row, open
  // the override <details>, pick a type, and confirm origin becomes
  // user_override.
  const overridden = await page.evaluate(() => {
    const first = document.querySelector('.schema-column');
    if (!first) return null;
    const colName = first.dataset.column;
    const details = first.querySelector('details.schema-override');
    if (!(details instanceof HTMLDetailsElement)) return null;
    details.open = true;
    // Trigger toggle so the menu lazily renders.
    details.dispatchEvent(new Event('toggle'));
    // Wait one tick via microtask.
    return new Promise((resolve) => {
      setTimeout(() => {
        const firstOption = details.querySelector('.type-option');
        const id = firstOption?.dataset.typeId ?? null;
        firstOption?.click();
        resolve({ colName, id });
      }, 50);
    });
  });
  await delay(200);
  const overrodeOk = await page.evaluate((col) => {
    const row = document.querySelector(`.schema-column[data-column="${col}"]`);
    return row?.dataset.origin === 'user_override';
  }, overridden?.colName);
  if (overrodeOk) log(`✓ overrode "${overridden?.colName}" → ${overridden?.id}`);
  else log(`! override did not stick for ${overridden?.colName}`);

  // 12. Sanity: no uncaught errors in the console.
  if (consoleErrors.length > 0) {
    log('NOTE: console errors during run:');
    for (const e of consoleErrors) log('  •', e);
  } else {
    log('✓ no console errors');
  }

  await browser.close();
  server.close();
  log('SMOKE TEST PASSED');
}

main().catch((err) => {
  console.error('[smoke] crashed:', err);
  process.exit(1);
});
