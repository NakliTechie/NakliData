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

test('KAG-06 — inferred chart axes populate controls and survive a re-render', async ({
  browser,
}) => {
  const server = await startStaticServer();
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.addInitScript(() => localStorage.setItem('naklidata.welcomed', '1'));
  const page = await context.newPage();

  await page.goto(`${server.url}/index.html?offline=1`);
  await waitForEngineReady(page);
  await page.click('[data-action="browse-examples"]');
  await page.waitForFunction(() => document.querySelectorAll('.schema-column').length >= 10, null, {
    timeout: 60_000,
  });

  await page.evaluate(() => {
    const cell = document.querySelector<HTMLElement>('.cell[data-cell-kind="sql"]');
    const code =
      'SELECT payment_status AS Department, COUNT(*) AS employees FROM invoices GROUP BY payment_status ORDER BY Department';
    const textarea = cell?.querySelector<HTMLTextAreaElement>('textarea');
    const editor = cell?.querySelector<HTMLElement>('.cm-content');
    if (textarea) {
      textarea.value = code;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (editor) {
      editor.textContent = code;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      throw new Error('SQL editor not found');
    }
  });
  await page.click('[data-nb-action="run-all"]');
  await page.waitForSelector('.cell[data-cell-kind="sql"] .result-table', { timeout: 30_000 });

  const sqlId = await page
    .locator('.cell[data-cell-kind="sql"]')
    .first()
    .getAttribute('data-cell-id');
  if (!sqlId) throw new Error('SQL cell id not found');
  await page.click('[data-nb-action="add-chart"]');
  const chart = page.locator('.cell[data-cell-kind="chart"]').last();
  await chart.locator('[data-action="chart-input"]').selectOption(sqlId);

  await expect(chart.locator('[data-region="chart-canvas"] svg')).toBeVisible();
  await expect(chart.locator('[data-action="chart-x"]')).toHaveValue('Department');
  await expect(chart.locator('[data-action="chart-y"]')).toHaveValue('employees');

  // An unrelated notebook edit forces a full re-render. The bindings must come
  // back from the chart cell state, not be rediscovered only by the renderer.
  await page.click('[data-nb-action="add-markdown"]');
  const rerendered = page.locator('.cell[data-cell-kind="chart"]').last();
  await expect(rerendered.locator('[data-action="chart-x"]')).toHaveValue('Department');
  await expect(rerendered.locator('[data-action="chart-y"]')).toHaveValue('employees');

  await context.close();
  await server.close();
});
