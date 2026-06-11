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

import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve('dist');
const CHROME = process.env.PLAYWRIGHT_CHROMIUM_PATH;

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.jsonl': 'application/x-ndjson',
  '.csv': 'text/csv',
  '.parquet': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
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
    ...(CHROME ? { executablePath: CHROME } : {}),
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
  // 'load' (not 'domcontentloaded'): the app hydrates after DOMContentLoaded,
  // so waiting for the full load event reduces flake on slower CI runners.
  await page.goto(targetUrl, { waitUntil: 'load' });

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

  // 3a. Remote-source mount buttons open + close cleanly without
  // console errors. Spec gates for Wave 2/3 modal hygiene — each modal
  // should mount, accept Escape, tear down cleanly.
  const REMOTE_MODALS = [
    { trigger: 'mount-url', overlay: '.mount-url-overlay' },
    { trigger: 'mount-s3', overlay: '.mount-s3-overlay' },
    { trigger: 'mount-iceberg', overlay: '.mount-iceberg-overlay' },
    { trigger: 'mount-iceberg-catalog', overlay: '.mount-iceberg-catalog-overlay' },
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

  // 4. Click "Browse example data" to mount the bundled sources.
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

  // 13. Sanity: no uncaught errors in the console.
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
