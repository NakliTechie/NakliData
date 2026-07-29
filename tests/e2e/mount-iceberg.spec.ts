import { expect, test } from '@playwright/test';
import { startStaticServer } from './fixtures/server.ts';

test.describe('Iceberg readiness gate', () => {
  test('keeps table and REST Catalog entry points visibly disabled', async ({ page }) => {
    const server = await startStaticServer();
    await page.goto(`${server.url}/index.html?offline=1`);
    await page.waitForSelector('.shell-header', { timeout: 5_000 });

    const table = page.locator('[data-action="mount-iceberg"]');
    const catalog = page.locator('[data-action="mount-iceberg-catalog"]');
    await expect(table).toBeVisible();
    await expect(table).toBeDisabled();
    await expect(catalog).toBeDisabled();
    await expect(table).toContainText('Unavailable');
    await expect(
      page.locator('.source-option-group').filter({ hasText: 'Catalogs' }),
    ).toContainText('Unavailable until real endpoints pass the release smoke');

    await server.close();
  });
});
