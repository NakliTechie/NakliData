import { type Page, expect, test } from '@playwright/test';
import { startStaticServer } from './fixtures/server.ts';

async function waitForEngineReady(page: Page): Promise<void> {
  await page.waitForSelector('.shell-header', { timeout: 5_000 });
  await page.waitForFunction(
    () => document.querySelector('[data-region="engine-status"]')?.textContent === 'Engine: ready',
    null,
    { timeout: 90_000 },
  );
}

test.describe('offline DuckDB extensions (Theme 1 wave 3)', () => {
  test('?offline=1 mounts the JSONL access log via the vendored json extension — no extensions.duckdb.org hits', async ({
    browser,
  }) => {
    const server = await startStaticServer();
    const context = await browser.newContext();
    const page = await context.newPage();

    // Track outbound fetches to assert no extension request reaches the
    // CDN host. We only care about the json extension here — sqlite_scanner
    // is also vendored but not exercised by the example bundle (see
    // DECISIONS 2026-05-23 for the SQLite-on-wasm limitation).
    const externalExtensionHits: string[] = [];
    const localExtensionHits: string[] = [];
    page.on('request', (req) => {
      const u = req.url();
      if (!u.includes('duckdb_extension')) return;
      if (u.includes('extensions.duckdb.org') || u.includes('community-extensions.duckdb.org')) {
        externalExtensionHits.push(u);
      } else if (u.includes('/duckdb-extensions/')) {
        localExtensionHits.push(u);
      }
    });

    await page.goto(`${server.url}/index.html?offline=1`);
    await waitForEngineReady(page);
    await page.click('[data-action="browse-examples"]');
    // 4 tables = 3 CSVs (vendors / invoices / payments) + JSONL access
    // log. The JSONL load only works if the json extension is reachable;
    // in offline mode that means it must come from the local vendor.
    await page.waitForFunction(() => document.querySelectorAll('.source-row').length >= 4, null, {
      timeout: 60_000,
    });

    const tableCount = await page.evaluate(() => document.querySelectorAll('.source-row').length);
    expect(tableCount).toBeGreaterThanOrEqual(4);

    // At least one local extension fetch — and no external hits.
    expect(localExtensionHits.length).toBeGreaterThan(0);
    expect(externalExtensionHits).toEqual([]);
    // The specific one we expect (json):
    const sawJson = localExtensionHits.some((u) => /\/json\.duckdb_extension\.wasm$/.test(u));
    expect(sawJson).toBe(true);

    await context.close();
    await server.close();
  });
});
