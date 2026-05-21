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

test.describe('column-profile pane (Theme 4 wave 1)', () => {
  test('clicking Profile fetches stats from the engine and renders them inline; clicking again collapses', async ({
    browser,
  }) => {
    const server = await startStaticServer();
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${server.url}/index.html?offline=1`);
    await waitForEngineReady(page);
    await page.click('[data-action="browse-examples"]');
    await page.waitForFunction(
      () => document.querySelectorAll('.schema-column').length >= 10,
      null,
      { timeout: 60_000 },
    );

    // Find any column row + click its Profile button.
    const firstColumn = await page.evaluate(() => {
      const col = document.querySelector<HTMLElement>('.schema-column');
      const btn = col?.querySelector<HTMLElement>('[data-action="show-profile"]');
      const colName = col?.dataset.column ?? '';
      const sourceId = btn?.dataset.sourceId ?? '';
      const tableId = btn?.dataset.tableId ?? '';
      return { colName, sourceId, tableId };
    });
    expect(firstColumn.colName).toBeTruthy();
    expect(firstColumn.sourceId).toBeTruthy();

    // Pane is hidden before clicking.
    const initiallyHidden = await page.evaluate(() => {
      const col = document.querySelector<HTMLElement>('.schema-column');
      const pane = col?.querySelector<HTMLElement>('.schema-profile-pane');
      return pane?.hidden ?? false;
    });
    expect(initiallyHidden).toBe(true);

    // Click Profile.
    await page.evaluate(() => {
      const btn = document.querySelector<HTMLElement>(
        '.schema-column [data-action="show-profile"]',
      );
      btn?.click();
    });

    // Wait for the pane to materialise with stats.
    await page.waitForFunction(
      () => {
        const pane = document.querySelector<HTMLElement>('.schema-column .schema-profile-pane');
        if (!pane || pane.hidden) return false;
        return pane.querySelector('.schema-profile-grid') !== null;
      },
      null,
      { timeout: 10_000 },
    );

    // Assert the structural pieces are present.
    const paneShape = await page.evaluate(() => {
      const pane = document.querySelector<HTMLElement>('.schema-column .schema-profile-pane');
      const labels = Array.from(pane?.querySelectorAll('.schema-profile-label') ?? []).map(
        (n) => n.textContent ?? '',
      );
      const values = Array.from(pane?.querySelectorAll('.schema-profile-value') ?? []).map(
        (n) => n.textContent?.trim() ?? '',
      );
      const hasTopK = pane?.querySelector('.schema-profile-topk ul') !== null;
      const topKCount = pane?.querySelectorAll('.schema-profile-topk-row').length ?? 0;
      return { labels, values, hasTopK, topKCount, innerHTML: pane?.innerHTML.slice(0, 400) };
    });
    expect(paneShape.labels).toEqual(
      expect.arrayContaining(['Rows', 'Distinct', 'Null', 'Length']),
    );
    // Values are populated — `Rows` should be a non-zero number for any
    // mounted example-bundle column.
    expect(paneShape.values.length).toBeGreaterThanOrEqual(4);
    // Top-k is rendered when the column has at least one non-null value.
    // We don't assert a specific count since column cardinality varies;
    // we just confirm the section's container is present, which is the
    // contract of the renderer.
    if (!paneShape.hasTopK) {
      throw new Error(`Top-k section missing. Pane innerHTML: ${paneShape.innerHTML}`);
    }

    // Click again → collapses.
    await page.evaluate(() => {
      const btn = document.querySelector<HTMLElement>(
        '.schema-column [data-action="show-profile"]',
      );
      btn?.click();
    });
    await page.waitForFunction(
      () => {
        const pane = document.querySelector<HTMLElement>('.schema-column .schema-profile-pane');
        return pane?.hidden === true || (pane?.innerHTML.trim() ?? '') === '';
      },
      null,
      { timeout: 2_000 },
    );

    await context.close();
    await server.close();
  });
});
