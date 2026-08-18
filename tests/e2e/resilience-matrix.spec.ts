import { type Locator, type Page, expect, test } from '@playwright/test';
import { mountExamples } from './fixtures/examples.ts';
import { installFsaMocks } from './fixtures/fsa-mocks.ts';
import { startStaticServer } from './fixtures/server.ts';

async function waitForEngine(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelector('[data-region="engine-status"]')?.textContent === 'Engine: ready',
    null,
    { timeout: 90_000 },
  );
}

async function replaceEditorText(page: Page, cell: Locator, sql: string): Promise<void> {
  const editor = cell.locator('.cm-content, textarea').first();
  await editor.waitFor({ state: 'visible' });
  await editor.click();
  await editor.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await page.keyboard.type(sql);
}

test.describe('browser resilience matrix', () => {
  test('quota exhaustion stays visible and recovers after storage returns', async ({
    browserName,
    context,
    page,
  }) => {
    test.skip(browserName !== 'chromium', 'Chromium CDP provides deterministic quota control.');
    const server = await startStaticServer();
    try {
      await page.goto(`${server.url}/index.html?offline=1`);
      await waitForEngine(page);
      await mountExamples(page);
      await expect(
        page.locator('.cell[data-cell-id="demo_vendor_spend"] .result-table tbody tr').first(),
      ).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(1_000);

      const origin = new URL(server.url).origin;
      const cdp = await context.newCDPSession(page);
      const usage = await page.evaluate(
        async () => (await navigator.storage.estimate()).usage ?? 0,
      );
      await cdp.send('Storage.overrideQuotaForOrigin', {
        origin,
        quotaSize: Math.ceil(usage) + 1_024,
      });

      await page.click('[data-nb-action="add-sql"]');
      const pressureCell = page.locator('.cell[data-cell-kind="sql"]').last();
      await replaceEditorText(page, pressureCell, `SELECT 1 /*${'x'.repeat(4 * 1024)}*/`);
      await expect(page.locator('[data-region="storage-warning"]')).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.locator('[data-region="storage-warning"]')).toContainText(
        'Local changes not saved',
      );
      await expect(pressureCell).toBeVisible();

      await cdp.send('Storage.overrideQuotaForOrigin', {
        origin,
        quotaSize: Math.ceil(usage) + 64 * 1024 * 1024,
      });
      await page.click('[data-nb-action="add-sql"]');
      await expect(page.locator('[data-region="storage-warning"]')).toBeHidden({
        timeout: 30_000,
      });

      await page.reload();
      await waitForEngine(page);
      await expect(page.locator('.cell[data-cell-id="demo_vendor_spend"]')).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      await server.close();
    }
  });

  test('remains queryable during bounded JavaScript memory pressure', async ({
    browserName,
    context,
    page,
  }) => {
    test.skip(browserName !== 'chromium', 'Chromium CDP provides deterministic heap cleanup.');
    const server = await startStaticServer();
    try {
      await page.goto(`${server.url}/index.html?offline=1`);
      await waitForEngine(page);
      const allocated = await page.evaluate(() => {
        const chunks = Array.from({ length: 8 }, () => new Uint8Array(16 * 1024 * 1024));
        for (const chunk of chunks) {
          for (let index = 0; index < chunk.length; index += 4_096) chunk[index] = 1;
        }
        (
          window as unknown as { __naklidataMemoryPressure?: Uint8Array[] }
        ).__naklidataMemoryPressure = chunks;
        return chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
      });
      expect(allocated).toBe(128 * 1024 * 1024);

      await mountExamples(page);
      await expect(
        page.locator('.cell[data-cell-id="demo_vendor_spend"] .result-table tbody tr').first(),
      ).toBeVisible({ timeout: 30_000 });
      await page.evaluate(() => {
        (
          window as unknown as { __naklidataMemoryPressure: Uint8Array[] | undefined }
        ).__naklidataMemoryPressure = undefined;
      });
      const cdp = await context.newCDPSession(page);
      await cdp.send('HeapProfiler.collectGarbage');

      await page.click('[data-nb-action="add-sql"]');
      const recoveryCell = page.locator('.cell[data-cell-kind="sql"]').last();
      await replaceEditorText(page, recoveryCell, 'SELECT 42 AS answer');
      await recoveryCell.locator('[data-action="cell-run"]').click();
      await expect(recoveryCell.locator('table td').filter({ hasText: /^42$/ })).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await server.close();
    }
  });

  test('large schema mounts, removes, and leaves the engine reusable', async ({ page }) => {
    test.slow();
    const server = await startStaticServer();
    try {
      const fsa = await installFsaMocks(page);
      await page.goto(`${server.url}/index.html?offline=1`);
      await waitForEngine(page);

      const columnCount = 120;
      const rowCount = 2_000;
      const header = Array.from({ length: columnCount }, (_, index) => `field_${index}`).join(',');
      const row = Array.from({ length: columnCount }, (_, index) => String(index % 17)).join(',');
      const csv = `${header}\n${Array.from({ length: rowCount }, () => row).join('\n')}\n`;
      await fsa.stageOpenFile('large-schema.csv', csv, 'text/csv');

      await page.click('[data-action="mount-file"]');
      await expect(page.getByText('large-schema.csv', { exact: true })).toBeVisible({
        timeout: 60_000,
      });
      await page.waitForFunction(
        (expected) => document.querySelectorAll('.schema-column').length === expected,
        columnCount,
        { timeout: 180_000 },
      );

      await page
        .locator('.source-card', { hasText: 'large-schema.csv' })
        .getByTitle('Remove source')
        .click();
      await expect(page.getByText('large-schema.csv', { exact: true })).toHaveCount(0);
      await expect(page.locator('.schema-column')).toHaveCount(0);

      await mountExamples(page);
      await page.waitForFunction(
        () => document.querySelectorAll('.schema-column').length >= 20,
        null,
        {
          timeout: 60_000,
        },
      );
    } finally {
      await server.close();
    }
  });

  test('Escape cancels a long query and a later query recovers', async ({ page }) => {
    const server = await startStaticServer();
    try {
      await page.goto(`${server.url}/index.html?offline=1`);
      await waitForEngine(page);
      await mountExamples(page);
      await page.waitForFunction(
        () => document.querySelectorAll('.schema-column').length >= 20,
        null,
        {
          timeout: 60_000,
        },
      );
      await expect(
        page.locator('.cell[data-cell-id="demo_vendor_spend"] .result-table tbody tr').first(),
      ).toBeVisible({ timeout: 30_000 });

      await page.click('[data-nb-action="add-sql"]');
      const cell = page.locator('.cell[data-cell-kind="sql"]').last();
      await replaceEditorText(
        page,
        cell,
        'SELECT sum(sin(i)) AS total FROM range(1000000000) t(i)',
      );
      await cell.locator('[data-action="cell-run"]').click();
      await expect(cell).toHaveClass(/running/);
      const cancelStarted = Date.now();
      await page.keyboard.press('Escape');
      await expect(cell).not.toHaveClass(/running/, { timeout: 30_000 });
      expect(Date.now() - cancelStarted).toBeLessThan(10_000);

      await page.click('[data-nb-action="add-sql"]');
      const recoveryCell = page.locator('.cell[data-cell-kind="sql"]').last();
      await replaceEditorText(page, recoveryCell, 'SELECT 42 AS answer');
      await recoveryCell.locator('[data-action="cell-run"]').click();
      await expect(recoveryCell.locator('table td').filter({ hasText: /^42$/ })).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await server.close();
    }
  });
});
