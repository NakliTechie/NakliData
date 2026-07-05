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
  // source name. This whole class slips past tsc + vitest — only a live run
  // catches it.
  // recordLineageForCell is fire-and-forget after the result ships (notebook
  // .ts), and the panel renders a snapshot at open time — so poll by
  // reopening until lineage lands (the EXPLAIN + information_schema sniff
  // finishes shortly after the rows render). ~6 s budget.
  let lineage = { empty: true, hasSource: false };
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await page.click('[data-action="open-lineage"]');
    await page.waitForSelector('.lineage-list', { timeout: 5000 });
    lineage = await page.evaluate(() => {
      const txt = document.querySelector('.lineage-list')?.textContent ?? '';
      return {
        empty: txt.includes('No lineage recorded yet'),
        hasSource: /invoices|vendors|payments|access_logs|events/i.test(txt),
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
  // Close the panel so it doesn't overlay later steps.
  await page.click('[data-action="close-lineage"]').catch(() => {});
  await page.waitForSelector('.lineage-list', { state: 'detached', timeout: 5000 }).catch(() => {});

  // 9b. Cloud-BYOK sidecar path — exercised end-to-end against a MOCKED
  //     transport. The local-model provider can't run headless (needs
  //     WebGPU + a multi-GB download), and we never put a real BYOK key in
  //     CI (secrets/telemetry are Hard NOTs). So we monkeypatch
  //     `window.fetch` to return a canned chat-completion (a JS-returned
  //     Response makes no real request — CSP-clean), set a dummy key, and
  //     drive a real job through the WHOLE path we own: dispatch → provider
  //     call → response parse → render. This is what catches a regression
  //     in that wiring; the live network/auth leg stays a manual BYOK check.
  //     Handles both the Anthropic + OpenAI response shapes so it works
  //     against whatever the default provider is. (Added 2026-06-13 after
  //     the cloud path was asserted-but-not-verified — DECISIONS AU.)
  await page.evaluate(() => {
    const CANNED = JSON.stringify({ observation: 'SMOKE_SIDECAR_OK — top vendor leads total.' });
    window.__origFetch = window.fetch.bind(window);
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
  await page.evaluate(() => {
    const en = document.querySelector('[data-action="settings-enable"]');
    if (en && !en.checked) {
      en.checked = true;
      en.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await page.click('[data-action="close-settings"]').catch(() => {});
  await delay(300);
  // Re-run the first SQL cell so its result re-renders with the (now-enabled)
  // sidecar chips, then click Summarise.
  await page.evaluate(() => {
    document
      .querySelector('.cell[data-cell-kind="sql"]')
      ?.querySelector('[data-action="cell-run"]')
      ?.click();
  });
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('button,[data-action]')].some((e) =>
        /summaris/i.test(e.textContent || ''),
      ),
    null,
    { timeout: 10000 },
  );
  await page.evaluate(() => {
    [...document.querySelectorAll('button,[data-action]')]
      .find((e) => /summaris/i.test(e.textContent || ''))
      ?.click();
  });
  await page.waitForFunction(() => document.body.innerText.includes('SMOKE_SIDECAR_OK'), null, {
    timeout: 15000,
  });
  await page.evaluate(() => {
    if (window.__origFetch) window.fetch = window.__origFetch;
  });
  log('✓ cloud-BYOK sidecar path (mocked transport): summarise dispatched → parsed → rendered');

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
    log(`✓ Facet find-similar: picked #${similar.hit} → "${similar.pinnedTip.slice(0, 60)}…" → cleared`);
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
      "SELECT s::VARCHAR AS src, d::VARCHAR AS tgt, " +
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
    if (netState.hit === null || !netState.pinned || !/neighbours highlighted/.test(netState.pinnedTip)) {
      throw new Error(
        `network find-neighbours: no pinned highlight ("${netState.pinnedTip}")`,
      );
    }
    if (!netState.cleared) {
      throw new Error('network find-neighbours: background click did not clear');
    }
    log(`✓ Facet Network cell: edge list → force layout → canvas → find-neighbours ("${netState.pinnedTip.slice(0, 50)}…") → cleared`);

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
      throw new Error(`attributed edges: expected an edge-type legend, got ${legend.count} swatches`);
    }
    if (!legend.dimmedAfterClick) {
      throw new Error('attributed edges: clicking a legend swatch did not filter (dim others)');
    }
    log(`✓ Facet attributed edges: legend [${legend.values.join(', ')}] → swatch click filters`);
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
    { timeout: 5000 },
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
    { timeout: 5000 },
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
    { timeout: 8000 },
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
  if (!temporal.brushed || temporal.count === null || temporal.count <= 0 || temporal.count >= 120) {
    throw new Error(`temporal: brushing a window did not report a partial count (${temporal.count})`);
  }
  log(`✓ Facet Temporal cell: timeline (${temporal.bars} bars) → brush window → ${temporal.count}/120 rows in range`);

  // 10h. Facet Distribution cell — reuse the same timestamp SQL cell; summarize
  // the numeric `n` column into a histogram, then click a bar via the seam and
  // assert the readout reports that bar's row share.
  await page.click('[data-nb-action="add-distribution"]');
  await page.waitForFunction(
    () => document.querySelector('.cell[data-cell-kind="distribution"]') !== null,
    null,
    { timeout: 5000 },
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
    { timeout: 8000 },
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
  log(`✓ Facet Distribution cell: ${dist.bars} bars → select bar → ${dist.count} rows ("${dist.text.slice(0, 40)}…")`);

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
    () => /\bcities\b/.test(document.querySelector('aside[aria-label="Sources"]')?.textContent ?? ''),
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
      { type: 'Feature', properties: { name: 'A' }, geometry: { type: 'Point', coordinates: [72.8, 19.0] } },
      { type: 'Feature', properties: { name: 'B' }, geometry: { type: 'Point', coordinates: [77.2, 28.6] } },
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
    () => /\bplaces\b/.test(document.querySelector('aside[aria-label="Sources"]')?.textContent ?? ''),
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
    () => /\barrow_cities\b/.test(document.querySelector('aside[aria-label="Sources"]')?.textContent ?? ''),
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
    () => /\bhtyped\b/.test(document.querySelector('aside[aria-label="Sources"]')?.textContent ?? ''),
    null,
    { timeout: 20000 },
  );
  const headerlessRows = await page.evaluate(() => {
    const t = document.querySelector('aside[aria-label="Sources"]')?.textContent ?? '';
    return t.match(/\bhtyped\b\s+([\d,]+)\s+rows/)?.[1] ?? null;
  });
  if (headerlessRows !== '3') {
    fail(`headerless CSV row count wrong: ${headerlessRows} (expected 3 — a forced header would give 2)`);
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
    () => /\bstat_demo\b/.test(document.querySelector('aside[aria-label="Sources"]')?.textContent ?? ''),
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

  // 12k. Python cell (Polyglot-Workbench Fork 2). Add a SQL cell that yields a
  //      tiny table, then a Python cell bound to it: pandas doubles a column.
  //      Exercises the full path — table → Parquet → Pyodide (vendored,
  //      same-origin) → pandas → Parquet → re-registered DuckDB table. First
  //      run loads the ~33 MB runtime, so this leg gets a generous timeout.
  await page.click('[data-nb-action="add-sql"]');
  const pySqlCell = page.locator('.cell[data-cell-kind="sql"]').last();
  await pySqlCell.locator('.cm-content, textarea').first().click();
  await page.keyboard.insertText('SELECT 1 AS a, 10 AS b UNION ALL SELECT 2, 20 UNION ALL SELECT 3, 30');
  await pySqlCell.locator('[data-action="cell-run"]').click();
  const pySqlId = await pySqlCell.getAttribute('data-cell-id');
  // Wait for the SQL cell to produce its result view (cell_<id>).
  await page.waitForFunction(
    (id) => {
      const c = document.querySelector(`.cell[data-cell-id="${id}"]`);
      return !!c && !c.classList.contains('errored') && !!c.querySelector('.result-table, .cell-output table');
    },
    pySqlId,
    { timeout: 15000 },
  );

  await page.click('[data-nb-action="add-python"]');
  const pyCell = page.locator('.cell[data-cell-kind="python"]').last();
  // Pick the SQL cell as input.
  await pyCell.locator('[data-action="python-input"]').selectOption(pySqlId ?? '');
  // Replace the starter code with a deterministic transform.
  const ta = pyCell.locator('[data-action="python-code"]');
  await ta.fill("df['c'] = df['b'] * 2\ndf = df[['a', 'c']]");
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
  await page.keyboard.insertText(`SELECT sum(c) AS total FROM cell_${(pyId ?? '').replace(/[^A-Za-z0-9_]/g, '_')}`);
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
  log('✓ Python cell: SQL → Parquet → Pyodide(pandas) → Parquet → DuckDB table, queryable downstream (sum=120)');

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
