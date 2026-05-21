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

async function waitForExamplesClassified(page: Page): Promise<void> {
  await page.click('[data-action="browse-examples"]');
  await page.waitForFunction(() => document.querySelectorAll('.schema-column').length >= 10, null, {
    timeout: 60_000,
  });
}

test.describe('demo / censor mode (Theme 4 wave 2 / B4)', () => {
  test('toggling demo mode swaps user-data labels for stable masked tokens', async ({
    browser,
  }) => {
    const server = await startStaticServer();
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${server.url}/index.html?offline=1`);
    await waitForEngineReady(page);
    await waitForExamplesClassified(page);

    // Baseline: schema-panel column rows show real column names like
    // "vendor_id". Source labels show "SMB Finance".
    const baseline = await page.evaluate(() => {
      const col = document.querySelector<HTMLElement>('.schema-column .col-name');
      const tbl = document.querySelector<HTMLElement>('.schema-table-header strong');
      const src = document.querySelector<HTMLElement>('.source-card strong');
      return {
        col: col?.textContent ?? '',
        tbl: tbl?.textContent ?? '',
        src: src?.textContent ?? '',
      };
    });
    expect(baseline.col).not.toMatch(/^col_\d+$/);
    expect(baseline.tbl).not.toMatch(/^tbl_\d+$/);
    expect(baseline.src).not.toMatch(/^src_\d+$/);
    // data-column on the LI still holds the underlying name regardless.
    const realColumnName = await page.evaluate(
      () => document.querySelector<HTMLElement>('.schema-column')?.dataset.column ?? '',
    );
    expect(realColumnName).toBeTruthy();

    // Open Settings → toggle Demo mode on.
    await page.click('[data-action="open-settings"]');
    await page.waitForSelector('[data-action="settings-demo-mode"]', { timeout: 4_000 });
    await page.check('[data-action="settings-demo-mode"]');

    // The change event re-renders surfaces — close the modal and verify.
    await page.click('[data-action="close-settings"]');
    await page.waitForFunction(
      () => document.querySelector('.settings-overlay, .schema-graph-overlay') === null,
      null,
      { timeout: 3_000 },
    );

    // After toggle: column names + table names + source labels are masked.
    await page.waitForFunction(() => {
      const col = document.querySelector<HTMLElement>('.schema-column .col-name')?.textContent;
      return col?.match(/^col_\d+$/) !== null;
    });
    const masked = await page.evaluate(() => {
      const col = document.querySelector<HTMLElement>('.schema-column .col-name');
      const tbl = document.querySelector<HTMLElement>('.schema-table-header strong');
      const src = document.querySelector<HTMLElement>('.source-card strong');
      return {
        col: col?.textContent ?? '',
        tbl: tbl?.textContent ?? '',
        src: src?.textContent ?? '',
      };
    });
    expect(masked.col).toMatch(/^col_\d+$/);
    expect(masked.tbl).toMatch(/^tbl_\d+$/);
    expect(masked.src).toMatch(/^src_\d+$/);

    // The body class flipped — useful for CSS-only adornments later.
    const appClass = await page.evaluate(
      () => document.getElementById('app')?.classList.contains('app-demo-mode') ?? false,
    );
    expect(appClass).toBe(true);

    // Real underlying column name on dataset is unchanged — handlers
    // still work after masking.
    const stillRealColumn = await page.evaluate(
      () => document.querySelector<HTMLElement>('.schema-column')?.dataset.column ?? '',
    );
    expect(stillRealColumn).toBe(realColumnName);

    // Toggle back off — labels return.
    await page.click('[data-action="open-settings"]');
    await page.waitForSelector('[data-action="settings-demo-mode"]', { timeout: 4_000 });
    // The settings modal renders synchronously but reads the saved
    // `demoMode` flag in an async `refresh()` pass. Wait for the
    // checkbox to reflect the saved (true) state before unchecking —
    // otherwise `page.uncheck` is a no-op on an already-unchecked box.
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLInputElement>('[data-action="settings-demo-mode"]')?.checked ===
        true,
      null,
      { timeout: 3_000 },
    );
    await page.uncheck('[data-action="settings-demo-mode"]');
    await page.click('[data-action="close-settings"]');

    await page.waitForFunction(
      () => {
        const col = document.querySelector<HTMLElement>('.schema-column .col-name')?.textContent;
        return !!col && !col.match(/^col_\d+$/);
      },
      null,
      { timeout: 3_000 },
    );

    await context.close();
    await server.close();
  });
});
