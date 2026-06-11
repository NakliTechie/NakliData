#!/usr/bin/env node
// Demo verification for Wave 4 (event-shape taxonomy + templates).
//
// Workplan Chunk 1 keystone. Mounts a real Mixpanel/Amplitude-shaped
// xlsx (the user's queued `Retention Rate Analysis_Ecommerce.xlsx`),
// captures classification + which templates surface as applicable,
// instantiates the first applicable template and confirms it runs.
//
// Writes a JSON report to plan/demo-verification-ecommerce.json with:
//   - sources mounted (sheets → tables)
//   - per-column classification (column name → assigned type + confidence)
//   - which event-shape types fired (event_name, user_id, session_id,
//     event_timestamp, utm_*)
//   - which W4.2 templates surfaced as applicable
//   - which template was run + whether a result + chart rendered
//
// Usage:
//   node scripts/verify-demo-ecommerce.mjs [path/to/file.xlsx]
//
// Defaults to ~/Downloads/Retention Rate Analysis_Ecommerce.xlsx if no
// argument is passed.

import { readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve('dist');
const DEFAULT_XLSX = join(homedir(), 'Downloads', 'Retention Rate Analysis_Ecommerce.xlsx');
const XLSX_PATH = resolve(process.argv[2] ?? DEFAULT_XLSX);
const OUT_REPORT = resolve('plan/demo-verification-ecommerce.json');
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

const log = (...a) => console.log('[verify-demo]', ...a);
const fail = (msg) => {
  console.error('[verify-demo] FAIL:', msg);
  process.exitCode = 1;
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

const EVENT_SHAPE_TYPES = [
  'event_name',
  'user_id',
  'session_id',
  'event_timestamp',
  'iso_datetime',
  'iso_date',
  'unix_timestamp_s',
  'unix_timestamp_ms',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'event_properties_json',
  'page_url',
];

async function main() {
  log(`xlsx: ${XLSX_PATH}`);
  // Ensure the file exists upfront.
  try {
    await stat(XLSX_PATH);
  } catch {
    console.error(`[verify-demo] file not found: ${XLSX_PATH}`);
    process.exit(2);
  }

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
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
      log(`console error: ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => {
    consoleErrors.push(err.message);
    log(`page error: ${err.message}`);
  });

  const targetUrl = `${url}/index.html?offline=1`;
  log(`loading ${targetUrl}`);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.shell-header', { timeout: 5000 });

  log('waiting for engine boot');
  await page.waitForFunction(
    () => document.querySelector('[data-region="engine-status"]')?.textContent === 'Engine: ready',
    null,
    { timeout: 90000 },
  );
  log('✓ engine ready');

  // Click "Mount file" — the app prefers File System Access API
  // (window.showOpenFilePicker) when available, falling back to a
  // dynamic <input type=file>. In headless Chromium FSA exists but
  // the picker can't actually present — Playwright's filechooser
  // event only fires for the input-fallback path. We delete the FSA
  // global so the fallback is taken, then catch the filechooser.
  await page.evaluate(() => {
    // biome-ignore lint: test-only hack
    delete window.showOpenFilePicker;
  });
  log('clicking mount-file + injecting xlsx');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10000 }),
    page.click('[data-action="mount-file"]'),
  ]);
  await chooser.setFiles(XLSX_PATH);

  // Wait for the source(s) to land. xlsx mounts emit one table per sheet.
  log('waiting for xlsx sheets to register');
  await page.waitForFunction(() => document.querySelectorAll('.source-row').length > 0, null, {
    timeout: 60000,
  });
  await page.waitForTimeout(1500); // give multi-sheet xlsx a moment to finish

  const sources = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.source-row'));
    return rows.map((r) => ({
      label: r.textContent?.trim() ?? '',
    }));
  });
  log(`✓ sources mounted: ${sources.length} table(s)`);

  log('waiting for classification');
  await page.waitForFunction(() => document.querySelectorAll('.schema-column').length >= 1, null, {
    timeout: 60000,
  });
  await page.waitForTimeout(2000); // let detectors finish

  // Schema-panel DOM contract (verified against src/ui/schema-panel.ts):
  //   li.schema-column · dataset.column       — column name
  //                    · dataset.assignedType — typeId, or '' for unknown
  //                    · dataset.origin       — detector | auto_accept | user_accept | …
  //   .col-name                                — display label of column
  //   .col-sql-type                            — DuckDB column type
  //   .confidence-pct                          — "94%" style
  //   .sensitivity-badge                       — W5.4 badge (only for pii/financial/secret)
  //   .schema-table-header strong              — table display name
  const classifiedWithIds = await page.evaluate(() => {
    const cols = Array.from(document.querySelectorAll('li.schema-column'));
    return cols.map((c) => {
      const tableEl = c.closest('.schema-table');
      const table =
        tableEl?.querySelector('.schema-table-header strong')?.textContent?.trim() ?? '';
      const column = c.dataset.column ?? c.querySelector('.col-name')?.textContent?.trim() ?? '';
      const typeId = c.dataset.assignedType ?? '';
      const origin = c.dataset.origin ?? '';
      const sqlType = c.querySelector('.col-sql-type')?.textContent?.trim() ?? '';
      const conf = c.querySelector('.confidence-pct')?.textContent?.trim() ?? '';
      const sensitivity = c.querySelector('.sensitivity-badge')?.textContent?.trim() ?? '';
      return { table, column, typeId, origin, sqlType, confidence: conf, sensitivity };
    });
  });
  const classified = classifiedWithIds; // alias for downstream references

  const eventShapeHits = classifiedWithIds.filter((c) => EVENT_SHAPE_TYPES.includes(c.typeId));
  log(
    `classification: ${classifiedWithIds.length} columns; event-shape hits: ${eventShapeHits.length}`,
  );

  // Read templates panel.
  const templates = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.template-card'));
    return cards.map((card) => {
      const name = card.querySelector('strong')?.textContent?.trim() ?? '';
      const desc = card.querySelector('.template-desc')?.textContent?.trim() ?? '';
      const applicable = !card.classList.contains('template-not-applicable');
      const btnLabel = card.querySelector('button')?.textContent?.trim() ?? '';
      return { name, desc, applicable, btnLabel };
    });
  });
  const applicable = templates.filter((t) => t.applicable);
  log(`templates: ${applicable.length}/${templates.length} applicable`);

  // Pick the first applicable template, instantiate it, run all.
  let runReport = null;
  if (applicable.length > 0) {
    const pick = applicable[0];
    log(`instantiating "${pick.name}"`);
    await page.evaluate((targetName) => {
      const cards = Array.from(document.querySelectorAll('.template-card'));
      const match = cards.find(
        (c) => c.querySelector('strong')?.textContent?.trim() === targetName,
      );
      const btn = match?.querySelector('button');
      btn?.click();
    }, pick.name);
    await page.waitForTimeout(1000);

    // Trigger run-all.
    const runAllBtn = await page.$('[data-nb-action="run-all"]');
    if (runAllBtn) {
      await runAllBtn.click();
      log('clicked run-all; waiting for cells');
      await page.waitForTimeout(8000);
    }

    runReport = await page.evaluate(() => {
      const cells = Array.from(document.querySelectorAll('.cell'));
      const summary = cells.map((cell) => {
        const kind = cell.dataset.cellKind ?? '';
        const errored = cell.classList.contains('errored');
        const hasResultTable = !!cell.querySelector('.result-table');
        const resultRows = cell.querySelectorAll('.result-table tbody tr').length;
        const errorMsg = cell.querySelector('.cell-output-error')?.textContent?.trim() ?? '';
        const chartSvg = !!cell.querySelector('.cell-output svg');
        return { kind, errored, hasResultTable, resultRows, errorMsg, chartSvg };
      });
      return {
        cells: summary,
        anyChart: summary.some((c) => c.chartSvg),
        anyError: summary.some((c) => c.errored),
        totalCells: summary.length,
      };
    });
    log(
      `run-all: ${runReport.totalCells} cells, chart=${runReport.anyChart}, error=${runReport.anyError}`,
    );
  } else {
    log('no applicable templates — skipping run');
  }

  // Histogram by assigned typeId for the report.
  const typeIdHistogram = {};
  for (const c of classifiedWithIds) {
    const key = c.typeId || '<unknown>';
    typeIdHistogram[key] = (typeIdHistogram[key] ?? 0) + 1;
  }

  // Build the report and write it.
  const report = {
    xlsx: XLSX_PATH,
    timestamp: new Date().toISOString(),
    sources,
    classification: classifiedWithIds,
    typeIdHistogram,
    eventShapeHits,
    templates,
    applicableTemplates: applicable.map((t) => t.name),
    run: runReport,
    consoleErrors,
  };
  await writeFile(OUT_REPORT, JSON.stringify(report, null, 2), 'utf8');
  log(`✓ report written: ${OUT_REPORT}`);

  await browser.close();
  await new Promise((r) => server.close(r));

  // Console summary.
  console.log('');
  console.log('─── Demo verification summary ───');
  console.log(`Sources:                 ${sources.length}`);
  console.log(`Columns classified:      ${classifiedWithIds.length}`);
  console.log(
    `Event-shape hits:        ${eventShapeHits.length} (${eventShapeHits.map((c) => `${c.column}→${c.typeId}`).join(', ') || 'none'})`,
  );
  console.log(`Templates applicable:    ${applicable.length}/${templates.length}`);
  console.log(`Applicable list:         ${applicable.map((t) => t.name).join(', ') || 'none'}`);
  if (runReport) {
    console.log(`Run-all cells:           ${runReport.totalCells}`);
    console.log(`Chart rendered:          ${runReport.anyChart ? 'yes' : 'no'}`);
    console.log(`Run errors:              ${runReport.anyError ? 'yes' : 'no'}`);
  }
  console.log(`Console errors:          ${consoleErrors.length}`);
  console.log('');
  if (consoleErrors.length > 0) fail(`${consoleErrors.length} console error(s)`);
  if (eventShapeHits.length === 0) {
    console.warn('[verify-demo] WARN: no W4.1 event-shape types fired — capture as W4 follow-up.');
  }
  if (applicable.length === 0) {
    console.warn('[verify-demo] WARN: no W4.2 templates surfaced — capture as W4 follow-up.');
  }
}

main().catch((err) => {
  console.error('[verify-demo] crashed:', err);
  process.exit(1);
});
