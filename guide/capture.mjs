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
  log('section: facet');
  await page.click('[data-nb-action="add-embedding"]');
  await page.waitForFunction(
    () => document.querySelector('.cell[data-cell-kind="embedding"]') !== null,
    null,
    { timeout: 5000 },
  );
  await page.evaluate(() => {
    document
      .querySelector('.cell[data-cell-kind="embedding"]')
      ?.scrollIntoView({ block: 'center' });
  });
  await shoot('facet', '01-embedding-cell');

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
