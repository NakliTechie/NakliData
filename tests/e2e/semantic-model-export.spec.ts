import { expect, test } from '@playwright/test';
import { startStaticServer } from './fixtures/server.ts';

test('semantic layer exposes portable export and fails closed for unbound vendor YAML', async ({
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
    await page.waitForFunction(
      () => document.querySelectorAll('.schema-column').length >= 10,
      null,
      {
        timeout: 60_000,
      },
    );
    await page.getByText('Model', { exact: true }).click();
    await page.click('[data-action="open-measures"]');
    await expect(page.getByRole('heading', { name: 'Semantic layer' })).toBeVisible();
    await page.click('[data-action="export-model"]');

    await expect(page.getByRole('heading', { name: 'Export semantic model' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'NakliData portable model' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Databricks Metric View YAML 1.1' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Snowflake Semantic View YAML' })).toBeVisible();
    await expect(
      page.locator('[data-action="semantic-export-save"][data-format="portable"]'),
    ).toBeEnabled();
    await expect(
      page.locator('[data-action="semantic-export-save"][data-format="databricks"]'),
    ).toBeDisabled();
    await expect(
      page.locator('[data-action="semantic-export-save"][data-format="snowflake"]'),
    ).toBeDisabled();
    await expect(page.getByText('Export blocked — review diagnostics')).toHaveCount(2);
  } finally {
    await server.close();
  }
});
