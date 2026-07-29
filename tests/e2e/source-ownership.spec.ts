import { type Page, expect, test } from '@playwright/test';
import { installFsaMocks } from './fixtures/fsa-mocks.ts';
import { startStaticServer } from './fixtures/server.ts';

async function waitForEngineReady(page: Page): Promise<void> {
  await page.waitForSelector('.shell-header', { timeout: 5_000 });
  await page.waitForFunction(
    () => document.querySelector('[data-region="engine-status"]')?.textContent === 'Engine: ready',
    null,
    { timeout: 90_000 },
  );
  await page
    .locator('.help-overlay')
    .waitFor({ state: 'visible', timeout: 3_000 })
    .catch(() => {});
  const close = page.locator('.help-overlay .schema-graph-close');
  if (await close.isVisible()) await close.click();
}

test.describe('source artifact ownership', () => {
  test('same-named files mount as distinct relations instead of replacing bytes', async ({
    page,
  }) => {
    const server = await startStaticServer();
    const fsa = await installFsaMocks(page);
    await page.goto(`${server.url}/index.html?offline=1`);
    await waitForEngineReady(page);

    await fsa.stageOpenFile('data.csv', 'value\nfirst\n', 'text/csv');
    await page.click('.empty-state [data-action="mount-file"]');
    await expect(page.locator('.source-card')).toHaveCount(1);

    await fsa.stageOpenFile('data.csv', 'value\nsecond\n', 'text/csv');
    await page.click('[data-action="add-source"]');
    await page.click('.add-source-overlay [data-action="mount-file"]');
    await expect(page.locator('.source-card')).toHaveCount(2);

    const listed = await page.evaluate(async () => {
      const result = (await window.naklidata?.listTables()) as
        | { ok: true; data: Array<{ name: string }> }
        | { ok: false; error: string }
        | undefined;
      return result?.ok ? result.data.map((table) => table.name).sort() : [];
    });
    expect(listed).toEqual(['data', 'data_2']);

    await page.locator('.source-card').first().locator('[data-action="remove-source"]').click();
    await expect(page.locator('.source-card')).toHaveCount(1);
    const afterRemove = await page.evaluate(async () => {
      const result = (await window.naklidata?.listTables()) as
        | { ok: true; data: Array<{ name: string }> }
        | { ok: false; error: string }
        | undefined;
      return result?.ok ? result.data.map((table) => table.name).sort() : [];
    });
    expect(afterRemove).toEqual(['data_2']);

    await fsa.stageOpenFile('data.csv', 'value\nthird\n', 'text/csv');
    await page.click('[data-action="add-source"]');
    await page.click('.add-source-overlay [data-action="mount-file"]');
    await expect(page.locator('.source-card')).toHaveCount(2);
    const afterRemount = await page.evaluate(async () => {
      const result = (await window.naklidata?.listTables()) as
        | { ok: true; data: Array<{ name: string }> }
        | { ok: false; error: string }
        | undefined;
      return result?.ok ? result.data.map((table) => table.name).sort() : [];
    });
    expect(afterRemount).toEqual(['data', 'data_2']);

    await server.close();
  });
});
