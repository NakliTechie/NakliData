#!/usr/bin/env node
// guide/capture.mjs — drives the built dist/ through every feature surface in a
// real (headless) browser and screenshots each state to guide/screenshots/.
//
// This is the capture half of the guide generator. Its sibling is build.mjs
// (turns screenshots + caption data into guide/index.html). The prose lives in
// build.mjs's CAPTIONS/SECTIONS — this file owns only the *route-plan*: the
// ordered set of (section, slug, setup→screenshot) steps.
//
// NakliData is a single-role, no-login workbench (spec §6: no accounts), so the
// guide is organised by FEATURE AREA, not RBAC role. The whole app is one
// stateful session, so we drive it linearly (mount data → classify → notebook →
// resolve → facet → sidecar) exactly like scripts/smoke.mjs, screenshotting as
// we pass through each surface.
//
// Run: node guide/capture.mjs   (expects dist/ built; see regenerate.sh)

import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', 'dist');
const SHOTS_DIR = join(HERE, 'screenshots');
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

const log = (...a) => console.log('[guide]', ...a);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

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
      resolveListen({ server, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

async function main() {
  await rm(SHOTS_DIR, { recursive: true, force: true });
  await mkdir(SHOTS_DIR, { recursive: true });

  const { server, url } = await startServer();
  log('serving dist/ at', url);

  const browser = await chromium.launch({
    ...(CHROME ? { executablePath: CHROME } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    deviceScaleFactor: 2, // retina captures
  });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(e.message));

  // The capture log: one row per shot with render-ok + console-error state.
  const results = [];
  let shotErrorsBaseline = 0;

  // shoot(section, slug): waits a settle beat, guards against a blank main,
  // screenshots to screenshots/<section>/<slug>.png, records the result.
  async function shoot(section, slug) {
    const dir = join(SHOTS_DIR, section);
    await mkdir(dir, { recursive: true });
    await page
      .evaluate(async () => {
        if (document.fonts) await document.fonts.ready;
        // Suppress any lingering toast so a stale message doesn't leak into an
        // unrelated shot (e.g. a "…cancelled" toast from a prior modal close).
        const t = document.getElementById('naklidata-toast');
        if (t) t.style.display = 'none';
      })
      .catch(() => {});
    await delay(500);
    const bodyLen = await page
      .evaluate(() => (document.querySelector('#app') ?? document.body)?.innerHTML.length ?? 0)
      .catch(() => 0);
    const path = join(dir, `${slug}.png`);
    await page.screenshot({ path });
    const newErrors = consoleErrors.length - shotErrorsBaseline;
    shotErrorsBaseline = consoleErrors.length;
    const status = bodyLen < 50 ? 'empty' : 'ok';
    results.push({ section, slug, status, errors: newErrors });
    log(
      `  ${status === 'ok' ? '✓' : '✗'} ${section}/${slug}${newErrors ? ` (${newErrors} console err)` : ''}`,
    );
  }

  // ── Boot ────────────────────────────────────────────────────────────────
  // ?offline=1 forces the vendored DuckDB fallback (no CDN egress needed).
  log('loading app (offline mode)');
  await page.goto(`${url}/index.html?offline=1`, { waitUntil: 'load' });
  await page.waitForSelector('.shell-header', { timeout: 5000 });
  await page.waitForFunction(
    () => document.querySelector('[data-region="engine-status"]')?.textContent === 'Engine: ready',
    null,
    { timeout: 90000 },
  );
  await page.waitForSelector('.empty-state h1', { timeout: 5000 });
  shotErrorsBaseline = consoleErrors.length;

  // ── Section: getting-started ─────────────────────────────────────────────
  log('section: getting-started');
  // The first-run welcome splash overlays the empty state on a fresh visit.
  // Capture it as its own shot, then dismiss it so the rest of the walkthrough
  // can click through (an open modal intercepts every pointer event).
  const splashPresent = await page
    .waitForSelector('.help-overlay [data-welcome-examples]', { timeout: 4000 })
    .then(() => true)
    .catch(() => false);
  if (splashPresent) {
    await shoot('getting-started', '00-welcome');
    await page.evaluate(() => {
      const ov = document.querySelector('.schema-graph-overlay');
      const close = ov?.querySelector('[data-close]');
      if (close instanceof HTMLElement) close.click();
      else ov?.remove();
    });
    await page
      .waitForFunction(() => document.querySelector('.schema-graph-overlay') === null, null, {
        timeout: 3000,
      })
      .catch(() => {});
  }
  await shoot('getting-started', '01-empty-state');

  // A remote-source mount modal (URL) — the "bring your own data" entry point.
  await page.click('[data-action="mount-url"]');
  await page.waitForSelector('.mount-url-overlay', { timeout: 3000 });
  await shoot('getting-started', '02-mount-url');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.mount-url-overlay') === null, null, {
    timeout: 2000,
  });

  // The S3 mount modal — remote object-store sources.
  await page.click('[data-action="mount-s3"]');
  await page.waitForSelector('.mount-s3-overlay', { timeout: 3000 });
  await shoot('getting-started', '03-mount-s3');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.mount-s3-overlay') === null, null, {
    timeout: 2000,
  });

  // ── Section: data-and-schema ─────────────────────────────────────────────
  log('section: data-and-schema');
  await page.click('[data-action="browse-examples"]');
  await page.waitForFunction(() => document.querySelectorAll('.source-row').length > 0, null, {
    timeout: 30000,
  });
  await shoot('data-and-schema', '01-sources-mounted');

  // Schema panel classifies columns — wait for the classifier to land, then
  // capture it as the spec's headline surface. In the live right-rail layout
  // the classified columns share vertical space with the Suggested Reports
  // below, so only a row or two shows. For a clear documentation shot we
  // temporarily hide the reports block (giving the scrollable schema list the
  // full rail height) and clip the screenshot to just the Schema aside, so the
  // type pills + confidence % + override affordances read clearly.
  await page.waitForFunction(() => document.querySelectorAll('.schema-column').length >= 10, null, {
    timeout: 60000,
  });
  await page.evaluate(() => {
    const aside = document.querySelector('aside[aria-label="Schema"]');
    // Stash + hide the Suggested-reports header + body so schema fills the rail.
    for (const n of document.querySelectorAll(
      '.templates-panel-header, [data-region="templates-panel"]',
    )) {
      n.dataset.guideHidden = '1';
      n.style.display = 'none';
    }
    const body = aside?.querySelector('[data-region="schema-panel"]');
    if (body) body.scrollTop = 0;
  });
  await delay(300);
  {
    const aside = page.locator('aside[aria-label="Schema"]');
    await mkdir(join(SHOTS_DIR, 'data-and-schema'), { recursive: true });
    await aside.screenshot({ path: join(SHOTS_DIR, 'data-and-schema', '02-schema-panel.png') });
    results.push({ section: 'data-and-schema', slug: '02-schema-panel', status: 'ok', errors: 0 });
    log('  ✓ data-and-schema/02-schema-panel (clipped to schema aside)');
  }
  // Restore the reports block for subsequent shots.
  await page.evaluate(() => {
    for (const n of document.querySelectorAll('[data-guide-hidden="1"]')) {
      n.style.display = '';
      delete n.dataset.guideHidden;
    }
  });

  // A type-override menu open on the first column — again clipped to the schema
  // aside (reports hidden) so the override picker isn't crushed by the rail.
  await page.evaluate(() => {
    for (const n of document.querySelectorAll(
      '.templates-panel-header, [data-region="templates-panel"]',
    )) {
      n.dataset.guideHidden = '1';
      n.style.display = 'none';
    }
    const first = document.querySelector('.schema-column');
    first?.closest('[data-region="schema-panel"]')?.scrollTo(0, 0);
    const details = first?.querySelector('details.schema-override');
    if (details instanceof HTMLDetailsElement) {
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
      details.scrollIntoView({ block: 'start' });
    }
  });
  await delay(350);
  {
    const aside = page.locator('aside[aria-label="Schema"]');
    await aside.screenshot({ path: join(SHOTS_DIR, 'data-and-schema', '03-type-override.png') });
    results.push({ section: 'data-and-schema', slug: '03-type-override', status: 'ok', errors: 0 });
    log('  ✓ data-and-schema/03-type-override (clipped to schema aside)');
  }
  await page.evaluate(() => {
    const d = document.querySelector('.schema-column details.schema-override');
    if (d instanceof HTMLDetailsElement) d.open = false;
    for (const n of document.querySelectorAll('[data-guide-hidden="1"]')) {
      n.style.display = '';
      delete n.dataset.guideHidden;
    }
  });

  // ── Section: notebook ────────────────────────────────────────────────────
  log('section: notebook');
  // Templates panel — the applicable-template surface.
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.template-card strong')].some(
        (n) => n.textContent === 'Vendor concentration',
      ),
    null,
    { timeout: 10000 },
  );
  await shoot('notebook', '01-templates');

  // Instantiate the Vendor-concentration template and run all cells.
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('.template-card')].find(
      (c) => c.querySelector('strong')?.textContent === 'Vendor concentration',
    );
    card?.querySelector('[data-action="instantiate"]')?.click();
  });
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.cell[data-cell-kind="sql"]')].some((c) => {
        const ta = c.querySelector('textarea');
        if (ta && /vendor/i.test(ta.value)) return true;
        const cm = c.querySelector('.cm-content');
        return cm && /vendor/i.test(cm.textContent ?? '');
      }),
    null,
    { timeout: 10000 },
  );
  await page.click('[data-nb-action="run-all"]');
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.cell[data-cell-kind="sql"] .result-table tbody tr').length > 0,
    null,
    { timeout: 30000 },
  );
  await shoot('notebook', '02-sql-cell-result');

  // Chart cell renders an SVG once the SQL cell has rows.
  await page.waitForFunction(
    () => document.querySelectorAll('.cell[data-cell-kind="chart"] svg').length > 0,
    null,
    { timeout: 30000 },
  );
  // Scroll the chart cell into view for a clean shot.
  await page.evaluate(() => {
    document.querySelector('.cell[data-cell-kind="chart"]')?.scrollIntoView({ block: 'center' });
  });
  await shoot('notebook', '03-chart-cell');

  // The add-cell row — the palette of cell kinds available.
  await page.evaluate(() => {
    document.querySelector('.cell-add-row')?.scrollIntoView({ block: 'center' });
  });
  await shoot('notebook', '04-add-cell-row');

  // (The NL→SQL entry point + per-result AI chips live in the ai-sidecar
  // section — they are display:none until the sidecar is enabled.)

  // ── Section: resolve ─────────────────────────────────────────────────────
  log('section: resolve');
  // Cluster (fuzzy-merge) modal off the SQL result.
  await page.evaluate(() => {
    document.querySelector('.cell[data-cell-kind="sql"]')?.scrollIntoView({ block: 'center' });
  });
  await page.click('.cell[data-cell-kind="sql"] [data-action="cluster-result"]');
  await page.waitForSelector('.cluster-overlay', { timeout: 10000 });
  await shoot('resolve', '01-cluster-modal');
  await page.click('.cluster-overlay [data-action="cl-close"]');
  await page.waitForFunction(() => document.querySelector('.cluster-overlay') === null, null, {
    timeout: 5000,
  });

  // Semantic panel — measures / dimensions / segments.
  await page.click('[data-action="open-measures"]');
  await page.waitForSelector('.measures-overlay', { timeout: 10000 });
  await shoot('resolve', '02-semantic-panel');
  await page.click('.measures-overlay [data-action="measures-close"]');
  await page.waitForFunction(() => document.querySelector('.measures-overlay') === null, null, {
    timeout: 5000,
  });

  // Golden-table sink — survivorship export.
  const goldenOpened = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.cell[data-cell-kind="sql"] button')].find(
      (b) => b.textContent?.trim() === 'Export golden table',
    );
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (goldenOpened) {
    await page.waitForSelector('.golden-overlay', { timeout: 10000 });
    await shoot('resolve', '03-golden-table');
    await page.click('.golden-overlay [data-action="g-cancel"]');
    await page.waitForFunction(() => document.querySelector('.golden-overlay') === null, null, {
      timeout: 5000,
    });
  }

  // ── Section: lineage ─────────────────────────────────────────────────────
  log('section: lineage');
  let lineageReady = false;
  for (let i = 0; i < 12 && !lineageReady; i += 1) {
    await page.click('[data-action="open-lineage"]');
    await page.waitForSelector('.lineage-list', { timeout: 5000 });
    lineageReady = await page.evaluate(() => {
      const txt = document.querySelector('.lineage-list')?.textContent ?? '';
      return (
        !txt.includes('No lineage recorded yet') &&
        /invoices|vendors|payments|access_logs|events/i.test(txt)
      );
    });
    if (lineageReady) break;
    await page.click('[data-action="close-lineage"]').catch(() => {});
    await page
      .waitForSelector('.lineage-list', { state: 'detached', timeout: 5000 })
      .catch(() => {});
    await delay(500);
  }
  await shoot('lineage', '01-lineage-panel');
  await page.click('[data-action="close-lineage"]').catch(() => {});
  await page.waitForSelector('.lineage-list', { state: 'detached', timeout: 5000 }).catch(() => {});

  // ── Section: facet ───────────────────────────────────────────────────────
  // We drive real data into each Facet view so the guide shows populated
  // visualizations, not empty pickers. SQL is typed through the real keyboard
  // pipeline (CodeMirror ignores programmatic value swaps). The SVG views
  // (Temporal, Distribution) screenshot fully here.
  //
  // ⚠️ The deck.gl views (Embedding, Network, Knowledge-graph) MOUNT correctly
  // headless (the canvas is sized + the render seam is live — the smoke's GPU
  // picking proves it), but Playwright's page.screenshot does not composite the
  // WebGL framebuffer, so those three come out blank here. They are backfilled
  // from a real GPU browser (the preview MCP) — see guide/CAPTURE-LOG.md. The
  // capture still drives them (a mount smoke-check); forceDeckPaint nudges a
  // redraw for any environment where Playwright *can* paint WebGL.
  log('section: facet');

  // Add a fresh SQL cell, type + run a query, return its cell id.
  async function freshSql(sql) {
    const before = await page.evaluate(
      () => document.querySelectorAll('.cell[data-cell-kind="sql"]').length,
    );
    await page.click('[data-nb-action="add-sql"]');
    await page.waitForFunction(
      (b) => document.querySelectorAll('.cell[data-cell-kind="sql"]').length > b,
      before,
      { timeout: 5000 },
    );
    const cell = page.locator('.cell[data-cell-kind="sql"]').last();
    await cell.locator('.cm-content, textarea').first().click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(sql);
    await cell.locator('[data-action="cell-run"]').click();
    await page.waitForFunction(
      () => {
        const cells = [...document.querySelectorAll('.cell[data-cell-kind="sql"]')];
        const last = cells[cells.length - 1];
        return !!last && !last.classList.contains('errored') && last.querySelector('table') !== null;
      },
      null,
      { timeout: 15000 },
    );
    return page.evaluate(() => {
      const cells = [...document.querySelectorAll('.cell[data-cell-kind="sql"]')];
      return cells[cells.length - 1].dataset.cellId;
    });
  }
  // Set a <select> on the LAST cell of `kind` (input picker re-renders the cell,
  // so callers set input first, await the column picker, then set columns).
  const setPick = (kind, action, value) =>
    page.evaluate(
      ({ kind, action, value }) => {
        const cell = [...document.querySelectorAll(`.cell[data-cell-kind="${kind}"]`)].pop();
        const sel = cell?.querySelector(`[data-action="${action}"]`);
        if (sel) {
          sel.value = value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
      },
      { kind, action, value },
    );
  const waitPick = (kind, action) =>
    page.waitForFunction(
      ({ kind, action }) =>
        [...document.querySelectorAll(`.cell[data-cell-kind="${kind}"]`)]
          .pop()
          ?.querySelector(`[data-action="${action}"]`) !== null,
      { kind, action },
      { timeout: 6000 },
    );
  const scrollLast = (kind) =>
    page.evaluate((kind) => {
      [...document.querySelectorAll(`.cell[data-cell-kind="${kind}"]`)]
        .pop()
        ?.scrollIntoView({ block: 'center' });
    }, kind);
  // deck.gl renders on its own rAF loop, which doesn't reliably PAINT the
  // visible canvas in an automated browser (picking uses a separate buffer, so
  // the render is "there" but the framebuffer stays blank in a screenshot). A
  // no-op setHighlight goes through deck.setProps → a forced redraw; then we
  // await two real animation frames so the paint lands before the shot.
  const forceDeckPaint = async (kind, region, seamProp) => {
    await page.evaluate(
      ({ kind, region, seamProp }) => {
        const mount = [...document.querySelectorAll(`.cell[data-cell-kind="${kind}"]`)]
          .pop()
          ?.querySelector(`[data-region="${region}"]`);
        mount?.[seamProp]?.setHighlight?.(null, []);
      },
      { kind, region, seamProp },
    );
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    );
    await delay(400);
  };

  // 1. Embedding map — a FLOAT[] embedding column auto-projected to 2-D (PCA),
  //    coloured by a categorical group.
  const embSqlId = await freshSql(
    "SELECT i::VARCHAR AS label, " +
      "CASE WHEN i % 4 = 0 THEN 'cluster A' WHEN i % 4 = 1 THEN 'cluster B' " +
      "WHEN i % 4 = 2 THEN 'cluster C' ELSE 'cluster D' END AS grp, " +
      '[cos(i*0.5) + (i%4), sin(i*0.5) + (i%4), (i % 7)::DOUBLE, ((i*3) % 5)::DOUBLE] AS emb ' +
      'FROM range(160) t(i)',
  );
  await page.click('[data-nb-action="add-embedding"]');
  await page.waitForFunction(
    () => document.querySelector('.cell[data-cell-kind="embedding"]') !== null,
    null,
    { timeout: 5000 },
  );
  await setPick('embedding', 'embed-input', embSqlId);
  await waitPick('embedding', 'embed-emb');
  await setPick('embedding', 'embed-emb', 'emb');
  await setPick('embedding', 'embed-color', 'grp');
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll('.cell[data-cell-kind="embedding"]')]
          .pop()
          ?.querySelector('[data-region="embed-canvas"] canvas') !== null,
      null,
      { timeout: 15000 },
    )
    .catch(() => {});
  await scrollLast('embedding');
  await forceDeckPaint('embedding', 'embed-canvas', '__embedScatter');
  await shoot('facet', '01-embedding-map');

  // 2 + 3. Network force-graph, then the same graph coloured by edge type
  //        (Knowledge-graph view) with a legend + weighted edges.
  await freshSql(
    'WITH n AS (SELECT i, (i // 20) AS c FROM range(80) t(i)), ' +
      'e AS (SELECT a.i AS s, b.i AS d FROM n a JOIN n b ON a.c = b.c AND a.i < b.i ' +
      'AND (a.i * 7 + b.i * 13) % 4 < 2 UNION ALL SELECT (i*11) % 80, (i*23) % 80 FROM range(30) t(i)) ' +
      "SELECT s::VARCHAR AS src, d::VARCHAR AS tgt, " +
      "CASE WHEN (s + d) % 3 = 0 THEN 'cites' WHEN (s + d) % 3 = 1 THEN 'authored' ELSE 'funded' END AS rel, " +
      '(1 + (s * 7 + d) % 9) AS weight FROM e WHERE s <> d',
  );
  const netSqlId = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.cell[data-cell-kind="sql"]')];
    return cells[cells.length - 1].dataset.cellId;
  });
  await page.click('[data-nb-action="add-network"]');
  await page.waitForFunction(
    () => document.querySelector('.cell[data-cell-kind="network"]') !== null,
    null,
    { timeout: 5000 },
  );
  await setPick('network', 'net-input', netSqlId);
  await waitPick('network', 'net-source');
  await setPick('network', 'net-source', 'src');
  await setPick('network', 'net-target', 'tgt');
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll('.cell[data-cell-kind="network"]')]
          .pop()
          ?.querySelector('[data-region="net-canvas"] canvas') !== null,
      null,
      { timeout: 15000 },
    )
    .catch(() => {});
  await scrollLast('network');
  await forceDeckPaint('network', 'net-canvas', '__networkGraph');
  await shoot('facet', '02-network-graph');

  // Colour by edge type + width by weight → the Knowledge-graph / Weighted view.
  await setPick('network', 'net-edge-color', 'rel');
  await setPick('network', 'net-edge-width', 'weight');
  await page
    .waitForFunction(
      () =>
        ([...document.querySelectorAll('.cell[data-cell-kind="network"]')]
          .pop()
          ?.querySelectorAll('[data-region="net-legend"] [data-legend-value]').length ?? 0) > 0,
      null,
      { timeout: 8000 },
    )
    .catch(() => {});
  await scrollLast('network');
  await forceDeckPaint('network', 'net-canvas', '__networkGraph');
  await shoot('facet', '03-knowledge-graph');

  // 4. Temporal — a timestamp column bucketed into a brushable timeline.
  const tempSqlId = await freshSql(
    "SELECT TIMESTAMP '2023-01-01' + INTERVAL ((i * i) % 365) DAY AS ts, i AS n FROM range(400) t(i)",
  );
  await page.click('[data-nb-action="add-temporal"]');
  await page.waitForFunction(
    () => document.querySelector('.cell[data-cell-kind="temporal"]') !== null,
    null,
    { timeout: 5000 },
  );
  await setPick('temporal', 'temporal-input', tempSqlId);
  await waitPick('temporal', 'temporal-time');
  await setPick('temporal', 'temporal-time', 'ts');
  await page
    .waitForFunction(
      () =>
        ([...document.querySelectorAll('.cell[data-cell-kind="temporal"]')]
          .pop()
          ?.querySelectorAll('[data-region="temporal-svg"] rect').length ?? 0) > 2,
      null,
      { timeout: 8000 },
    )
    .catch(() => {});
  await scrollLast('temporal');
  await delay(500);
  await shoot('facet', '04-temporal-timeline');

  // 5. Distribution — a categorical column summarized as value-count bars.
  const distSqlId = await freshSql(
    "SELECT CASE WHEN i % 6 = 0 THEN 'Purchase' WHEN i % 6 = 1 THEN 'Refund' " +
      "WHEN i % 6 = 2 THEN 'Transfer' WHEN i % 6 = 3 THEN 'Fee' " +
      "WHEN i % 6 = 4 THEN 'Chargeback' ELSE 'Adjustment' END AS txn_type " +
      'FROM range(240) t(i)',
  );
  await page.click('[data-nb-action="add-distribution"]');
  await page.waitForFunction(
    () => document.querySelector('.cell[data-cell-kind="distribution"]') !== null,
    null,
    { timeout: 5000 },
  );
  await setPick('distribution', 'dist-input', distSqlId);
  await waitPick('distribution', 'dist-column');
  await setPick('distribution', 'dist-column', 'txn_type');
  await page
    .waitForFunction(
      () =>
        ([...document.querySelectorAll('.cell[data-cell-kind="distribution"]')]
          .pop()
          ?.querySelectorAll('[data-region="dist-svg"] [data-bar]').length ?? 0) > 1,
      null,
      { timeout: 8000 },
    )
    .catch(() => {});
  await scrollLast('distribution');
  await delay(500);
  await shoot('facet', '05-distribution');

  // ── Section: reports ───────────────────────────────────────────────────────
  // Real management datasets → board-ready cuts. We mount three public files
  // exactly as a junior analyst would — through the "+ Add source" flow — then
  // run a representative report in a SQL cell and clip the shot to that cell
  // (query + result), so the guide shows realistic output, not toy data.
  //   • Superstore (CSV)          — profit & margin by region
  //   • MS Financial Sample (XLSX) — profit & margin by segment
  //   • Chinook (SQLite)          — revenue by country
  // Data lives in guide/sample-data/ (read here as bytes; the FSA picker is
  // stubbed so "Add file" resolves to the fixture — headless can't drive a real
  // picker). The SQLite mount exercises the sql.js path (DECISIONS BW).
  log('section: reports');
  const SAMPLE_DIR = join(HERE, 'sample-data');
  const sampleB64 = async (f) => (await readFile(join(SAMPLE_DIR, f))).toString('base64');

  async function mountFileFixture(fileName, mimeType, base64, railHint) {
    await page.evaluate(
      ({ fileName, mimeType, b64 }) => {
        const bin = atob(b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
        const file = new File([arr], fileName, { type: mimeType });
        // Stub the FSA picker so clicking "Add file" resolves to this fixture.
        window.showOpenFilePicker = async () => [{ getFile: async () => file }];
      },
      { fileName, mimeType, b64: base64 },
    );
    await page.click('[data-action="add-source"]');
    await page.waitForSelector('.add-source-overlay', { timeout: 3000 });
    await page.click('.add-source-overlay [data-action="mount-file"]');
    await page.waitForFunction(
      (hint) =>
        new RegExp(hint).test(
          document.querySelector('aside[aria-label="Sources"]')?.textContent ?? '',
        ),
      railHint,
      { timeout: 30000 },
    );
  }

  // Clip the shot to the last SQL cell (query + result table) — a clean
  // "here's the report" frame rather than the whole crowded workbench.
  // Mounting a multi-table source (chinook = 11 tables) fires classification
  // churn that re-renders the notebook CONTINUOUSLY, so an element-screenshot
  // never sees a "stable" element and detaches. Instead we read the cell's
  // bounding box synchronously and page.screenshot a viewport clip at those
  // coords — a region capture that doesn't wait on element stability.
  async function shootReport(slug) {
    await mkdir(join(SHOTS_DIR, 'reports'), { recursive: true });
    await delay(4000); // let post-mount classification stop re-rendering
    await page.evaluate(() => {
      const cells = document.querySelectorAll('.cell[data-cell-kind="sql"]');
      cells[cells.length - 1]?.scrollIntoView({ block: 'center' });
    });
    await delay(600);
    const box = await page.evaluate(() => {
      const cells = document.querySelectorAll('.cell[data-cell-kind="sql"]');
      const el = cells[cells.length - 1];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    const path = join(SHOTS_DIR, 'reports', `${slug}.png`);
    if (box && box.width > 4 && box.height > 4) {
      const x = Math.max(0, Math.floor(box.x));
      const y = Math.max(0, Math.floor(box.y));
      const clip = {
        x,
        y,
        width: Math.min(Math.ceil(box.width), 1400 - x),
        height: Math.min(Math.ceil(box.height), 900 - y),
      };
      await page.screenshot({ path, clip });
    } else {
      await page.screenshot({ path });
    }
    results.push({ section: 'reports', slug, status: 'ok', errors: 0 });
    log(`  ✓ reports/${slug}`);
  }

  await mountFileFixture('superstore.csv', 'text/csv', await sampleB64('superstore.csv'), 'superstore');
  await freshSql(
    'SELECT "Region", ROUND(SUM("Sales"),0) AS sales, ROUND(SUM("Profit"),0) AS profit, ' +
      'ROUND(100*SUM("Profit")/NULLIF(SUM("Sales"),0),1) AS margin_pct ' +
      'FROM superstore GROUP BY "Region" ORDER BY profit DESC',
  );
  await shootReport('01-superstore-region-margin');

  await mountFileFixture(
    'financial_sample.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    await sampleB64('financial_sample.xlsx'),
    'financial_sample',
  );
  await freshSql(
    'SELECT "Segment", ROUND(SUM("Sales"),0) AS sales, ROUND(SUM("Profit"),0) AS profit, ' +
      'ROUND(100*SUM("Profit")/NULLIF(SUM("Sales"),0),1) AS margin_pct ' +
      'FROM financial_sample GROUP BY "Segment" ORDER BY profit DESC',
  );
  await shootReport('02-financial-segment-margin');

  await mountFileFixture(
    'chinook.sqlite',
    'application/x-sqlite3',
    await sampleB64('chinook.sqlite'),
    'chinook__Invoice',
  );
  await freshSql(
    'SELECT "BillingCountry" AS country, ROUND(SUM("Total"),2) AS revenue, COUNT(*) AS invoices ' +
      'FROM chinook__Invoice GROUP BY country ORDER BY revenue DESC LIMIT 8',
  );
  await shootReport('03-chinook-revenue-country');

  // ── Section: ai-sidecar ──────────────────────────────────────────────────
  log('section: ai-sidecar');
  await page.click('[data-action="open-settings"]');
  await page.waitForSelector('[data-action="settings-enable"]', { timeout: 5000 });
  await shoot('ai-sidecar', '01-settings-byok');
  // Enable the sidecar so its per-cell affordances (NL→SQL, summarise, propose
  // chart) become visible — they are display:none until .app-sidecar-enabled.
  await page.evaluate(() => {
    const en = document.querySelector('[data-action="settings-enable"]');
    if (en && !en.checked) {
      en.checked = true;
      en.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await page.click('[data-action="close-settings"]').catch(() => {});
  await delay(400);

  // The SQL result now shows AI chips (Summarise / Propose chart). Scroll the
  // first SQL cell into view and shoot the enabled affordances.
  await page.evaluate(() => {
    document.querySelector('.cell[data-cell-kind="sql"]')?.scrollIntoView({ block: 'center' });
  });
  await delay(300);
  await shoot('ai-sidecar', '02-result-ai-chips');

  // NL→SQL modal — plain-English question → proposed SQL cell (never auto-run).
  try {
    const nl = await page.$('[data-action="ask-nl-to-sql"]');
    if (nl && (await nl.isVisible())) {
      await nl.click();
      const opened = await page
        .waitForSelector('.nl-to-sql-overlay', { timeout: 4000 })
        .catch(() => null);
      if (opened) {
        await shoot('ai-sidecar', '03-nl-to-sql');
        await page.keyboard.press('Escape');
        await page
          .waitForFunction(() => document.querySelector('.nl-to-sql-overlay') === null, null, {
            timeout: 2000,
          })
          .catch(() => {});
      }
    } else {
      results.push({ section: 'ai-sidecar', slug: '03-nl-to-sql', status: 'skip', errors: 0 });
      log('  – ai-sidecar/03-nl-to-sql (trigger hidden, skipped)');
    }
  } catch (e) {
    log('  – ai-sidecar/03-nl-to-sql skipped:', e.message.split('\n')[0]);
  }

  // ── Section: more-cells ──────────────────────────────────────────────────
  // Add the remaining cell kinds and screenshot each freshly-rendered cell.
  log('section: more-cells');
  const CELL_ADDS = [
    { action: 'add-input', kind: 'input', slug: '01-input-cell' },
    { action: 'add-dashboard', kind: 'dashboard', slug: '02-dashboard-cell' },
    { action: 'add-stats', kind: 'stats', slug: '03-stats-cell' },
    { action: 'add-report', kind: 'report', slug: '04-report-cell' },
    { action: 'add-assertion', kind: 'assertion', slug: '05-assertion-cell' },
    { action: 'add-cohort', kind: 'cohort', slug: '06-cohort-cell' },
  ];
  for (const c of CELL_ADDS) {
    const btn = await page.$(`[data-nb-action="${c.action}"]`);
    if (!btn) {
      results.push({ section: 'more-cells', slug: c.slug, status: 'skip', errors: 0 });
      log(`  – more-cells/${c.slug} (button absent, skipped)`);
      continue;
    }
    await page.click(`[data-nb-action="${c.action}"]`);
    await page
      .waitForFunction(
        (k) => document.querySelector(`.cell[data-cell-kind="${k}"]`) !== null,
        c.kind,
        { timeout: 5000 },
      )
      .catch(() => {});
    await page.evaluate((k) => {
      const cells = document.querySelectorAll(`.cell[data-cell-kind="${k}"]`);
      cells[cells.length - 1]?.scrollIntoView({ block: 'center' });
    }, c.kind);
    await shoot('more-cells', c.slug);
  }

  await browser.close();
  server.close();

  // ── Capture log ──────────────────────────────────────────────────────────
  const total = results.length;
  const ok = results.filter((r) => r.status === 'ok').length;
  const bad = results.filter((r) => r.status !== 'ok' && r.status !== 'skip');
  const withErrors = results.filter((r) => r.errors > 0);
  const lines = [];
  lines.push('# Guide capture log');
  lines.push('');
  lines.push(`${ok}/${total} shots rendered ok · ${withErrors.length} shots logged console errors`);
  lines.push('');
  lines.push('| section | slug | status | console errors |');
  lines.push('| --- | --- | --- | --- |');
  for (const r of results) lines.push(`| ${r.section} | ${r.slug} | ${r.status} | ${r.errors} |`);
  if (bad.length) {
    lines.push('');
    lines.push('## Blind spots (empty / failed)');
    for (const r of bad) lines.push(`- ${r.section}/${r.slug} → ${r.status}`);
  }
  if (consoleErrors.length) {
    lines.push('');
    lines.push('## Console errors (all, deduped)');
    for (const e of [...new Set(consoleErrors)]) lines.push(`- ${e}`);
  }
  await writeFile(join(HERE, 'CAPTURE-LOG.md'), `${lines.join('\n')}\n`);
  log(
    `done: ${ok}/${total} ok, ${bad.length} blind spots, ${withErrors.length} shots with console errors`,
  );
  log('wrote guide/CAPTURE-LOG.md');
  await writeFile(join(SHOTS_DIR, 'manifest.json'), JSON.stringify(results, null, 2));

  if (bad.length) process.exitCode = 0; // non-fatal: build still assembles what rendered
}

main().catch((err) => {
  console.error('[guide] capture crashed:', err);
  process.exit(1);
});
