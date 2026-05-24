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

test.describe('Mount Iceberg table modal (Wave 2 slice 3a)', () => {
  // Modal surface only — actual mount needs a live Iceberg endpoint, covered
  // by manual / staging tests.
  test('opens, validates required URL, closes on Cancel, returns focus', async ({ page }) => {
    const server = await startStaticServer();
    await page.goto(`${server.url}/index.html?offline=1`);
    await waitForEngineReady(page);

    const trigger = page.locator('[data-action="mount-iceberg"]');
    await expect(trigger).toBeVisible();
    await trigger.click();
    await page.waitForSelector('.mount-iceberg-overlay', { timeout: 3_000 });

    const focusedRegion = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset?.region ?? null,
    );
    expect(focusedRegion).toBe('metadata-url-input');

    // Empty submit → required error.
    await page.click('.mount-iceberg-overlay [data-action="confirm-mount-iceberg"]');
    await page.waitForFunction(
      () => {
        const el = document.querySelector(
          '.mount-iceberg-overlay [data-region="error"]',
        ) as HTMLElement | null;
        return el && !el.hidden && /Metadata URL is required/.test(el.textContent ?? '');
      },
      null,
      { timeout: 3_000 },
    );

    // file:// URL → friendly rejection (via mountIcebergTable validation).
    await page.fill(
      '.mount-iceberg-overlay [data-region="metadata-url-input"]',
      'file:///tmp/metadata.json',
    );
    await page.click('.mount-iceberg-overlay [data-action="confirm-mount-iceberg"]');
    await page.waitForFunction(
      () => {
        const el = document.querySelector(
          '.mount-iceberg-overlay [data-region="error"]',
        ) as HTMLElement | null;
        return el && !el.hidden && /must start with https/.test(el.textContent ?? '');
      },
      null,
      { timeout: 3_000 },
    );

    // Cancel returns focus to the trigger.
    await page.click('.mount-iceberg-overlay [data-action="close-mount-iceberg"]');
    await page.waitForFunction(
      () => document.querySelector('.mount-iceberg-overlay') === null,
      { timeout: 2_000 },
    );
    const focusedAfterClose = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset?.action ?? null,
    );
    expect(focusedAfterClose).toBe('mount-iceberg');

    await server.close();
  });
});
