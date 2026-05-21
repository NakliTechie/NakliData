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
  await page.waitForFunction(() => document.querySelectorAll('.schema-column').length >= 15, null, {
    timeout: 60_000,
  });
}

test.describe('override rules (Theme 4 wave 2 / B3)', () => {
  test('Override → Remember applies to other matching columns; rule visible in modal; Remove drops it', async ({
    browser,
  }) => {
    const server = await startStaticServer();
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${server.url}/index.html?offline=1`);
    await waitForEngineReady(page);
    await waitForExamplesClassified(page);

    // Both `vendors` and `invoices` have a `vendor_name` column. Pick
    // one and override it to a deliberately-different type (PAN). After
    // Remember, the OTHER vendor_name should snap to PAN too.
    const targetSelector = '.schema-column[data-column="vendor_name"]';
    const targetCount = await page.locator(targetSelector).count();
    expect(targetCount).toBeGreaterThanOrEqual(2); // sanity: examples carry two

    // Open the first vendor_name's Override menu + click the PAN option.
    await page.evaluate(() => {
      const first = document.querySelector<HTMLElement>(
        '.schema-column[data-column="vendor_name"]',
      );
      const details = first?.querySelector<HTMLDetailsElement>('details.schema-override');
      if (details) details.open = true;
    });
    // The override menu is built lazily on first open — wait for its options.
    await page.waitForFunction(() => {
      const first = document.querySelector<HTMLElement>(
        '.schema-column[data-column="vendor_name"]',
      );
      const menu = first?.querySelector<HTMLElement>('[data-region="override-menu"]');
      return !!menu && menu.childElementCount > 0;
    });
    // Find and click the PAN option.
    const clicked = await page.evaluate(() => {
      const first = document.querySelector<HTMLElement>(
        '.schema-column[data-column="vendor_name"]',
      );
      const menu = first?.querySelector<HTMLElement>('[data-region="override-menu"]');
      if (!menu) return false;
      // Override-menu items use data-type-id="<id>" on their buttons.
      const btn = menu.querySelector<HTMLElement>('[data-type-id="pan"]');
      if (!btn) return false;
      btn.click();
      return true;
    });
    expect(clicked).toBe(true);

    // Toast appears with a Remember action.
    await page.waitForSelector('#naklidata-toast [data-action="toast-action"]', {
      timeout: 4_000,
    });
    const toastText = await page.locator('#naklidata-toast').textContent();
    expect(toastText).toContain('Remember');
    expect(toastText).toContain('vendor_name');

    // Click Remember.
    await page.click('#naklidata-toast [data-action="toast-action"]');

    // After Remember: toolbar shows "Override rules (1)" + the SECOND
    // vendor_name in `invoices` is now flipped to PAN.
    await page.waitForFunction(
      () =>
        document
          .querySelector<HTMLElement>('[data-action="manage-override-rules"]')
          ?.textContent?.includes('Override rules (1)'),
      null,
      { timeout: 4_000 },
    );

    // Confirm the other vendor_name flipped via the rule. We check
    // the assignedType data-attribute the schema-panel sets on each row.
    const flippedCount = await page.evaluate(() => {
      const rows = document.querySelectorAll<HTMLElement>(
        '.schema-column[data-column="vendor_name"]',
      );
      let n = 0;
      for (const r of rows) {
        if (r.dataset.assignedType === 'pan') n++;
      }
      return n;
    });
    expect(flippedCount).toBeGreaterThanOrEqual(2);

    // Open the manage-rules modal.
    await page.click('[data-action="manage-override-rules"]');
    await page.waitForSelector('.override-rules-modal', { timeout: 2_000 });
    const ruleRowVisible = await page.locator('.override-rules-row code').first().textContent();
    expect(ruleRowVisible).toBe('vendor_name');

    // Remove the rule.
    await page.click('.override-rules-row [data-action="remove-rule"]');
    // Empty state appears.
    await page.waitForSelector('.override-rules-empty', { timeout: 2_000 });
    // The toolbar button disappears.
    await page.waitForFunction(
      () => document.querySelector('[data-action="manage-override-rules"]') === null,
      null,
      { timeout: 2_000 },
    );

    // Close the modal via Escape.
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => document.querySelector('.override-rules-modal') === null,
      null,
      { timeout: 2_000 },
    );

    await context.close();
    await server.close();
  });
});
