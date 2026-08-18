import { expect, test } from '@playwright/test';
import { startStaticServer } from './fixtures/server.ts';

test.describe('Iceberg readiness gate', () => {
  test('enables public tables while REST Catalog stays visibly disabled', async ({ page }) => {
    const server = await startStaticServer();
    const catalogChunkRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/chunks/iceberg-modals.js')) {
        catalogChunkRequests.push(request.url());
      }
    });
    await page.goto(`${server.url}/index.html?offline=1`);
    await page.waitForSelector('.shell-header', { timeout: 5_000 });

    const table = page.locator('[data-action="mount-iceberg"]');
    const catalog = page.locator('[data-action="mount-iceberg-catalog"]');
    await expect(table).toBeVisible();
    await expect(table).toBeEnabled();
    await expect(catalog).toBeDisabled();
    await expect(catalog).toHaveAttribute('data-readiness', 'unavailable');
    await expect(catalog).toHaveAttribute(
      'title',
      /remains disabled until real catalog endpoints pass the release matrix/i,
    );
    await expect(table).toContainText('Public HTTPS');
    await expect(
      page.locator('.source-option-group').filter({ hasText: 'Catalogs' }),
    ).toContainText('Public Iceberg tables are available');

    // The action boundary repeats the registry check. A DOM mutation cannot
    // bypass release gating or lazy-load the credential-bearing modal.
    await catalog.evaluate((element) => {
      const button = element as HTMLButtonElement;
      button.disabled = false;
      button.click();
    });
    await expect(page.locator('#naklidata-toast')).toContainText(
      'remains disabled until real catalog endpoints pass the release matrix',
    );
    await expect(page.locator('[data-region="mount-iceberg-catalog-modal"]')).toHaveCount(0);
    expect(catalogChunkRequests).toEqual([]);

    await server.close();
  });
});
