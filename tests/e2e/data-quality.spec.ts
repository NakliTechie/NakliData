import { expect, test } from '@playwright/test';
import { waitForExampleClassification } from './fixtures/examples.ts';
import { startStaticServer } from './fixtures/server.ts';

test('data quality suggestions create un-run assertions and execute only on request', async ({
  page,
}) => {
  const server = await startStaticServer();
  try {
    await page.goto(`${server.url}/index.html?offline=1`);
    await page.waitForFunction(
      () =>
        document.querySelector('[data-region="engine-status"]')?.textContent === 'Engine: ready',
      null,
      { timeout: 90_000 },
    );
    const welcome = page.locator('.help-overlay');
    await welcome.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => {});
    if (await welcome.isVisible()) await welcome.locator('[data-close]').first().click();

    await page.click('[data-action="browse-examples"]');
    await waitForExampleClassification(page);
    const assertionCount = await page.locator('.cell[data-cell-kind="assertion"]').count();
    await page.getByText('Model', { exact: true }).click();
    await page.click('[data-action="open-data-quality"]');

    await expect(page.getByRole('heading', { name: 'Data quality' })).toBeVisible();
    await expect(page.getByText('Databricks alias: Expectation')).toBeVisible();
    await expect(page.getByText('Snowflake alias: DMF / expectation')).toBeVisible();
    const add = page.locator('[data-action="quality-add"]').first();
    await expect(add).toBeVisible();
    await add.click();

    await expect(page.getByText('1 saved in assertion cells')).toBeVisible();
    await expect(page.getByText('NOT RUN', { exact: true })).toBeVisible();
    await page.locator('[data-action="quality-close"]').first().click();
    await expect(page.locator('.cell[data-cell-kind="assertion"]')).toHaveCount(assertionCount + 1);

    await page.getByText('Model', { exact: true }).click();
    await page.click('[data-action="open-data-quality"]');
    await expect(page.getByText('NOT RUN', { exact: true })).toBeVisible();
    await page.click('[data-action="quality-run"]');
    await expect(page.getByText(/^(PASS|FAIL · \d+)$/)).toBeVisible({ timeout: 60_000 });
  } finally {
    await server.close();
  }
});
