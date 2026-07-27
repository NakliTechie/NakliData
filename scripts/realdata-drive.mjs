// Real-data drive: mount LARGE, DIVERSE public datasets through the app's own
// "Paste URL" path and check what the semantic layer actually does with them.
//
// Why this exists: the smoke test proves the surfaces work on small synthetic
// fixtures. It cannot tell you whether classification, the sensitivity tiers, or
// the Chunk-4 describe() enrichment hold up on a 3-million-row taxi parquet or a
// 45 MB clinical CSV with real column names. This harness answers that, and is
// committed so the answer is reproducible rather than a one-off browser session.
//
// Datasets are NOT committed (~96 MB). Fetch them first:
//   node scripts/realdata-fetch.mjs
// which writes to `.realdata/` (gitignored). Then:
//   npm run build && node scripts/realdata-drive.mjs
//
// The server below serves `dist/` plus `.realdata/` under /realdata/ — the app's
// CSP allows `connect-src 'self'`, so same-origin is what makes a local file
// mountable by URL at all (a cross-origin localhost port would be blocked).

import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const DIST = resolve('dist');
const DATA = resolve('.realdata');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.csv': 'text/csv',
  '.parquet': 'application/octet-stream',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

const log = (...a) => console.log('[realdata]', ...a);
const fail = (msg) => {
  console.error('[realdata] FAIL:', msg);
  process.exit(1);
};

/** The datasets to drive. `expect` lists semantic types / tiers we want to SEE —
 *  reported, not asserted, because taxonomy coverage is the thing under test. */
const DATASETS = [
  {
    file: 'healthcare.csv',
    label: 'clinical',
    why: 'clinical + PII columns (doctor_name, patientid, Age, gender, Insurance, Admission_Deposit) — the hardest test for sensitivity tiers',
  },
  {
    file: 'adult_census.csv',
    label: 'census',
    why: 'sensitive demographics (race, sex, marital.status, capital.gain)',
  },
  {
    file: 'nyc_taxi_2024_01.parquet',
    label: 'taxi',
    why: '~3M rows of geo + temporal + money, as parquet — scale + format',
  },
  {
    file: 'employee_attrition.parquet',
    label: 'hr',
    why: 'HR attributes',
  },
];

async function startServer() {
  return await new Promise((resolveListen) => {
    const server = createServer(async (req, res) => {
      try {
        const reqUrl = (req.url ?? '/').split('#')[0].split('?')[0];
        const url = reqUrl === '/' ? '/index.html' : reqUrl;
        // /realdata/* comes from the (gitignored) data dir; everything else from dist.
        const filePath = url.startsWith('/realdata/')
          ? join(DATA, url.slice('/realdata/'.length))
          : join(DIST, url);
        const st = await stat(filePath);
        if (!st.isFile()) {
          res.writeHead(404);
          res.end('not found');
          return;
        }
        const body = await readFile(filePath);
        res.writeHead(200, {
          'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'credentialless',
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

/** Mount one dataset through the real "Paste URL" modal and wait for its table. */
async function mountByUrl(page, baseUrl, ds) {
  // Count tables via the app's OWN API, not a CSS guess — an earlier version of
  // this harness waited on `.source-item` (the real class is `.source-row`) and
  // silently timed out on mounts that had actually succeeded.
  const before = await page.evaluate(async () => {
    const r = await window.naklidata.listTables();
    return r.ok ? r.data.length : 0;
  });
  // Open the mount picker: the empty state shows the options inline; once a
  // source exists, the "+ Add source" button opens the same option set.
  const hasPicker = await page.evaluate(
    () => !!document.querySelector('[data-action="mount-url"]'),
  );
  // NOTE: these option cards are dispatched, not `page.click`ed. Playwright's
  // actionability check never settles on them in this harness (the smoke test
  // clicks the same selector fine, and a hit-test shows the button visible with
  // pointer-events:auto and no covering element — so this is a harness quirk,
  // not an app defect a real user would hit). dispatchEvent lands reliably.
  if (!hasPicker) await page.dispatchEvent('[data-action="add-source"]', 'click');
  await page.waitForSelector('[data-action="mount-url"]', { timeout: 15000 });
  await page.dispatchEvent('[data-action="mount-url"]', 'click');
  await page.waitForSelector('.mount-url-overlay', { timeout: 15000 });
  await page.fill('[data-region="url-input"]', `${baseUrl}/realdata/${ds.file}`);
  await page.fill('[data-region="label-input"]', ds.label);
  const t0 = Date.now();
  await page.dispatchEvent('[data-action="confirm-mount-url"]', 'click');
  // Mount is done when the modal closes AND a new source row appears.
  // Poll from NODE, not via waitForFunction. A `waitForFunction(async …)`
  // predicate returns a Promise, which is TRUTHY on the first poll — so an
  // earlier version of this harness reported every dataset "mounted in 1.6s"
  // (including a 48 MB parquet) while nothing had actually mounted. Awaiting a
  // page.evaluate per tick is the honest version.
  const deadline = Date.now() + 300000;
  for (;;) {
    const st = await page.evaluate(async () => {
      const overlay = document.querySelector('.mount-url-overlay');
      const errEl = overlay?.querySelector('[data-region="error"]');
      const errText = errEl && !errEl.hidden ? (errEl.textContent || '').trim() : '';
      let count = -1;
      try {
        const r = await window.naklidata.listTables();
        count = r.ok ? r.data.length : -1;
      } catch {
        /* engine mid-flight */
      }
      return { open: !!overlay, errText, count };
    });
    if (st.errText) throw new Error(`mount rejected: ${st.errText}`);
    if (!st.open && st.count > before) break;
    if (Date.now() > deadline) {
      throw new Error(
        `timed out (modal ${st.open ? 'still open' : 'closed'}, tables ${st.count}, wanted >${before})`,
      );
    }
    await page.waitForTimeout(1000);
  }
  // Let the post-mount re-render settle before the next mount's click.
  await page.waitForTimeout(1500);
  return Date.now() - t0;
}

async function main() {
  if (!existsSync(DIST)) fail('no dist/ — run `npm run build` first.');
  if (!existsSync(DATA)) fail('no .realdata/ — run `node scripts/realdata-fetch.mjs` first.');
  for (const ds of DATASETS) {
    if (!existsSync(join(DATA, ds.file))) {
      fail(`missing .realdata/${ds.file} — run \`node scripts/realdata-fetch.mjs\`.`);
    }
  }

  const { server, url } = await startServer();
  log(`serving dist/ + .realdata/ at ${url}`);
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(e.message));

  log('booting app (offline=1 → vendored DuckDB)');
  await page.goto(`${url}/index.html?offline=1`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !/booting/i.test(document.body.innerText), null, {
    timeout: 120000,
  });
  // The empty state re-renders once as the engine flips to ready (the option
  // cards are replaced and move ~265px down). Clicking inside that window fails
  // Playwright's element-stability check — and a `force:true` click lands on the
  // stale coordinates. Measured: the DOM is completely quiet ~3s after ready
  // (0 mutations / 0 element replacements over 5s), so settle first.
  await page.waitForTimeout(3000);
  log('✓ engine ready (DOM settled)');

  const results = [];
  for (const ds of DATASETS) {
    log(`mounting ${ds.file} — ${ds.why}`);
    let ms;
    try {
      ms = await mountByUrl(page, url, ds);
    } catch (err) {
      log(`✗ ${ds.file} did NOT mount: ${String(err).split('\n')[0]}`);
      results.push({ file: ds.file, mounted: false, error: String(err).split('\n')[0] });
      continue;
    }
    log(`✓ mounted ${ds.file} in ${(ms / 1000).toFixed(1)}s`);
    results.push({ file: ds.file, mounted: true, ms });
  }

  // Classification is FIRE-AND-FORGET (`void classifyMountedSources(...)`) and
  // runs in the taxonomy worker, so it is NOT done when the mount resolves. An
  // earlier version of this harness measured describe() straight after mounting
  // and reported "0/67 columns classified" — a pure race, not a taxonomy miss.
  // Wait for the panel to stop saying "Classifying columns…" AND for the
  // classified count to stop climbing.
  log('waiting for classification to settle');
  {
    const deadline = Date.now() + 300000;
    let prev = -1;
    let stable = 0;
    for (;;) {
      const st = await page.evaluate(async () => {
        const pending = !!document.querySelector('.schema-pending');
        let classified = -1;
        try {
          const r = await window.naklidata.describe();
          if (r.ok) {
            classified = r.data.tables.reduce(
              (n, t) => n + t.columns.filter((c) => c.typeId).length,
              0,
            );
          }
        } catch {
          /* mid-flight */
        }
        return { pending, classified };
      });
      if (!st.pending && st.classified === prev) stable++;
      else stable = 0;
      prev = st.classified;
      if (stable >= 3) break;
      if (Date.now() > deadline) {
        log(
          `⚠ classification did not settle in 300s (last count ${st.classified}); reporting anyway`,
        );
        break;
      }
      await page.waitForTimeout(2000);
    }
  }

  // Now the real question: what did the semantic layer make of it? describe()
  // is the agent surface AND the data dictionary, so one call answers both.
  log('calling window.naklidata.describe() over the real workbook');
  const described = await page.evaluate(async () => {
    const r = await window.naklidata.describe();
    if (!r.ok) return { error: r.error };
    const tiers = {};
    const typed = [];
    let cols = 0;
    for (const t of r.data.tables) {
      for (const c of t.columns) {
        cols++;
        tiers[c.sensitivity] = (tiers[c.sensitivity] ?? 0) + 1;
        if (c.typeId)
          typed.push({ table: t.name, col: c.name, type: c.typeId, tier: c.sensitivity });
      }
    }
    return {
      version: r.data.version,
      taxonomyVersion: r.data.taxonomyVersion,
      sensitivityLayerLoaded: r.data.sensitivityLayerLoaded,
      tableCount: r.data.tables.length,
      tables: r.data.tables.map((t) => ({
        name: t.name,
        rows: t.rowCount,
        cols: t.columns.length,
        provenance: t.provenance,
        statsFilled: t.columns.filter((c) => c.nullFraction != null || c.distinctCount != null)
          .length,
        ranged: t.columns.filter((c) => c.min != null).length,
      })),
      columnCount: cols,
      tiers,
      classified: typed,
      unclassified: r.data.tables.flatMap((t) =>
        t.columns.filter((c) => !c.typeId).map((c) => `${t.name}.${c.name}`),
      ),
    };
  });
  if (described.error) fail(`describe() failed: ${described.error}`);

  log('--- describe() over real data ---');
  log(
    `envelope v${described.version} · taxonomy ${described.taxonomyVersion} · sensitivity layer ${described.sensitivityLayerLoaded ? 'loaded' : 'NOT loaded'}`,
  );
  for (const t of described.tables) {
    log(
      `  ${t.name}: ${t.rows?.toLocaleString() ?? '?'} rows · ${t.cols} cols · stats on ${t.statsFilled}/${t.cols} · range on ${t.ranged} · from ${t.provenance.sourceLabel} (${t.provenance.sourceKind})`,
    );
  }
  log(`  columns total: ${described.columnCount}`);
  log(`  sensitivity tiers: ${JSON.stringify(described.tiers)}`);
  log(`  semantically classified: ${described.classified.length}/${described.columnCount}`);
  for (const c of described.classified.slice(0, 60)) {
    log(`    ${c.table}.${c.col} → ${c.type} [${c.tier}]`);
  }
  log(`  UNCLASSIFIED (${described.unclassified.length}):`);
  for (const u of described.unclassified) log(`    ${u}`);

  // Redaction check: query a table that has a non-public column and confirm the
  // agent surface actually masks it (0c) on REAL data, not a fixture.
  const nonPublic = described.classified.find((c) => c.tier !== 'public');
  if (nonPublic) {
    const red = await page.evaluate(async (c) => {
      const r = await window.naklidata.query({
        sql: `SELECT "${c.col}" FROM "${c.table}" LIMIT 3`,
      });
      return r.ok
        ? { redactedColumns: r.data.redactedColumns, sample: r.data.rows[0] }
        : { error: r.error };
    }, nonPublic);
    log(
      `  redaction on ${nonPublic.table}.${nonPublic.col} [${nonPublic.tier}] → ${JSON.stringify(red)}`,
    );
    if (!red.error && red.redactedColumns?.length === 0) {
      log('  ⚠ a non-public column came back UNREDACTED — investigate (0c)');
    }
  } else {
    log('  (no non-public column classified — redaction not exercised)');
  }

  // The data dictionary over real data, through the button's own code path.
  const dict = await page.evaluate(async () => {
    const btn = document.querySelector('[data-action="export-data-dictionary"]');
    if (!btn) return { error: 'export button not rendered' };
    let captured = null;
    window.showSaveFilePicker = async ({ suggestedName }) => ({
      name: suggestedName,
      createWritable: async () => ({
        write: async (b) => {
          captured = await b.text();
        },
        close: async () => {},
      }),
    });
    btn.click();
    for (let i = 0; i < 120 && captured === null; i++) {
      await new Promise((r) => setTimeout(r, 250));
    }
    return { md: captured };
  });
  if (dict.error || !dict.md) fail(`data dictionary export failed: ${dict.error ?? 'no content'}`);
  log(
    `✓ data dictionary: ${dict.md.length} chars · ${(dict.md.match(/^## /gm) || []).length} table sections`,
  );

  const unexpected = consoleErrors.filter(
    (e) => !/favicon|ERR_BLOCKED_BY_CLIENT|Failed to load resource/i.test(e),
  );
  if (unexpected.length > 0) {
    log(`⚠ ${unexpected.length} console error(s):`);
    for (const e of unexpected.slice(0, 8)) log(`   ${e.slice(0, 160)}`);
  } else {
    log('✓ no unexpected console errors');
  }

  const failedMounts = results.filter((r) => !r.mounted);
  await browser.close();
  server.close();
  if (failedMounts.length > 0) fail(`${failedMounts.length} dataset(s) failed to mount`);
  log('REAL-DATA DRIVE PASSED');
}

main().catch((e) => fail(String(e)));
