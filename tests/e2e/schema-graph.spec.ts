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

test.describe('schema-graph modal (Theme 2 wave 3)', () => {
  test('clicking the schema-panel graph button opens a Cytoscape modal with nodes + edges', async ({
    browser,
  }) => {
    const server = await startStaticServer();
    const context = await browser.newContext();
    const page = await context.newPage();

    // Track lazy-chunk fetches.
    const loaded: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/chunks/cytoscape-graph.js')) loaded.push(req.url());
    });

    await page.goto(`${server.url}/index.html?offline=1`);
    await waitForEngineReady(page);

    // The Schema panel header has the open-schema-graph button. It's
    // present even before any sources are mounted.
    await page.click('[data-action="open-schema-graph"]');
    await page.waitForSelector('.schema-graph-overlay', { timeout: 5_000 });

    // The cytoscape chunk should be fetched on demand.
    await page.waitForFunction(
      () =>
        Array.from(performance.getEntriesByType('resource')).some((r) =>
          r.name.includes('/chunks/cytoscape-graph.js'),
        ),
      null,
      { timeout: 10_000 },
    );
    expect(loaded.length).toBeGreaterThanOrEqual(1);

    // Cytoscape renders into the canvas region; once layout runs there
    // should be a <canvas> element inside it.
    await page.waitForFunction(
      () => {
        const canvas = document.querySelector('[data-region="graph-canvas"] canvas');
        return canvas !== null;
      },
      null,
      { timeout: 10_000 },
    );

    // Status line should report node + edge counts.
    const statusText = await page.textContent('[data-region="graph-status"]');
    expect(statusText).toMatch(/\d+ types,\s*\d+ relationships/);

    // Escape closes the modal.
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('.schema-graph-overlay') === null, {
      timeout: 2_000,
    });

    await context.close();
    await server.close();
  });

  test('clicking the backdrop closes the modal; clicking the close icon also closes', async ({
    browser,
  }) => {
    const server = await startStaticServer();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${server.url}/index.html?offline=1`);
    await waitForEngineReady(page);

    // Open, click backdrop.
    await page.click('[data-action="open-schema-graph"]');
    await page.waitForSelector('.schema-graph-overlay', { timeout: 5_000 });
    // Click the overlay itself (not the inner modal).
    await page.evaluate(() => {
      const overlay = document.querySelector<HTMLElement>('.schema-graph-overlay');
      overlay?.click();
    });
    await page.waitForFunction(() => document.querySelector('.schema-graph-overlay') === null, {
      timeout: 2_000,
    });

    // Reopen, click the close icon.
    await page.click('[data-action="open-schema-graph"]');
    await page.waitForSelector('.schema-graph-overlay', { timeout: 5_000 });
    await page.click('[data-action="close-schema-graph"]');
    await page.waitForFunction(() => document.querySelector('.schema-graph-overlay') === null, {
      timeout: 2_000,
    });

    await context.close();
    await server.close();
  });
});
