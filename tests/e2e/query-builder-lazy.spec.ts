import { expect, test } from '@playwright/test';
import { mountExamples } from './fixtures/examples.ts';
import { startStaticServer } from './fixtures/server.ts';

test('query builder loads on demand and returns focus after Escape', async ({ browser }) => {
  const server = await startStaticServer();
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  try {
    let chunkRequests = 0;
    await page.route('**/chunks/query-builder.js*', async (route) => {
      chunkRequests += 1;
      if (chunkRequests === 1) {
        await route.abort('failed');
        return;
      }
      await route.continue();
    });
    await page.goto(`${server.url}/index.html?offline=1`);
    await page.waitForFunction(
      () =>
        document.querySelector('[data-region="engine-status"]')?.textContent === 'Engine: ready',
      null,
      { timeout: 90_000 },
    );
    await mountExamples(page);
    await page.waitForFunction(
      () => document.querySelectorAll('.schema-column').length >= 20,
      null,
      { timeout: 60_000 },
    );

    const explore = page.locator('details[data-header-menu="explore"]');
    await explore.locator('summary').click();
    const trigger = explore.locator('[data-action="open-query-builder"]');
    await trigger.click();
    await expect(page.locator('#naklidata-toast')).toContainText('Query builder could not load');

    await explore.locator('summary').click();
    await trigger.click();

    const dialog = page.getByRole('dialog', { name: 'Visual query builder' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Insert as SQL cell' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(explore.locator('summary')).toBeFocused();
    expect(chunkRequests).toBe(2);
  } finally {
    await context.close();
    await server.close();
  }
});
