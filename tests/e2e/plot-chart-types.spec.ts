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

test.describe('Observable Plot chart types (Theme 2 wave 1)', () => {
  test('switching chart cell to stacked-bar loads the lazy chunk and renders an SVG', async ({
    browser,
  }) => {
    const server = await startStaticServer();
    const context = await browser.newContext();
    const page = await context.newPage();

    // Capture chunk-load requests so we can assert the lazy chunk fires.
    const loadedChunks: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/chunks/observable-plot.js')) {
        loadedChunks.push(req.url());
      }
    });
    // Capture page errors + console messages for diagnostics.
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    const consoleMessages: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
      }
    });

    await page.goto(`${server.url}/index.html?offline=1`);
    await waitForEngineReady(page);

    // Mount data + instantiate the "Vendor concentration" template
    // (gives us a SQL cell + chart cell out of the box).
    await page.click('[data-action="browse-examples"]');
    await page.waitForFunction(
      () => document.querySelectorAll('.schema-column').length >= 10,
      null,
      { timeout: 60_000 },
    );
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll('.template-card strong')).some(
          (n) => n.textContent === 'Vendor concentration',
        ),
      null,
      { timeout: 10_000 },
    );
    await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('.template-card')).find(
        (c) => c.querySelector('strong')?.textContent === 'Vendor concentration',
      );
      card?.querySelector<HTMLElement>('[data-action="instantiate"]')?.click();
    });
    await page.click('[data-nb-action="run-all"]');
    // Wait for the default bar chart to render once.
    await page.waitForFunction(
      () => document.querySelectorAll('.cell[data-cell-kind="chart"] svg').length > 0,
      null,
      { timeout: 30_000 },
    );

    // Sanity: lazy Plot chunk has NOT been loaded yet — only the default
    // 'bar' chart rendered, which is custom canvas+SVG, not Plot.
    expect(loadedChunks).toHaveLength(0);

    // Flip the chart cell's chartType to stacked-bar by dispatching a
    // change event on the select.
    await page.evaluate(() => {
      const select = document.querySelector<HTMLSelectElement>(
        '.cell[data-cell-kind="chart"] select[data-action="chart-type"]',
      );
      if (!select) throw new Error('chart-type select not found');
      select.value = 'stacked-bar';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // The lazy chunk should fire first.
    await page.waitForFunction(() => true, null, { timeout: 100 });
    // Wait for the request to be observed by Playwright (small race
    // between dispatchEvent and the import() kicking off).
    for (let i = 0; i < 20 && loadedChunks.length === 0; i++) {
      await page.waitForTimeout(100);
    }

    if (loadedChunks.length === 0) {
      const cellHtml = await page.evaluate(
        () => document.querySelector('.cell[data-cell-kind="chart"]')?.innerHTML ?? '',
      );
      throw new Error(
        `Plot chunk never loaded after switch. Console: ${consoleMessages.join(' | ')}; PageErrors: ${pageErrors.join(' | ')}; Cell: ${cellHtml.slice(0, 400)}`,
      );
    }
    expect(loadedChunks.length).toBeGreaterThanOrEqual(1);

    // Then wait for Plot's chart marks. Plot's output may include a
    // <figure> wrapping a swatch-legend (each swatch is its own tiny
    // <svg>) plus the main chart <svg>. We look for any SVG in the cell
    // that contains real mark elements (rect/path/circle/g).
    try {
      await page.waitForFunction(
        () => {
          const cell = document.querySelector('.cell[data-cell-kind="chart"]');
          if (!cell) return false;
          const svgs = Array.from(cell.querySelectorAll('svg'));
          return svgs.some((s) =>
            ['rect', 'path', 'circle', 'g'].some((tag) => s.querySelector(tag) !== null),
          );
        },
        null,
        { timeout: 10_000 },
      );
    } catch (err) {
      const diag = await page.evaluate(() => {
        const cell = document.querySelector<HTMLElement>('.cell[data-cell-kind="chart"]');
        const canvas = cell?.querySelector<HTMLElement>('[data-region="chart-canvas"]');
        const sel = cell?.querySelector<HTMLSelectElement>('[data-action="chart-type"]');
        return {
          canvasHtml: canvas?.innerHTML ?? '(no canvas)',
          chartTypeSel: sel?.value ?? '(no select)',
          allSvgInCell: cell?.querySelectorAll('svg').length ?? 0,
        };
      });
      throw new Error(
        `Plot SVG never appeared. chartTypeSel=${diag.chartTypeSel} svgCount=${diag.allSvgInCell} canvas=${diag.canvasHtml.slice(0, 800)}. Console: ${consoleMessages.join(' | ')} PageErrors: ${pageErrors.join(' | ')} orig: ${err}`,
      );
    }

    await context.close();
    await server.close();
  });

  test('chart cell falls back gracefully when chartType points at heatmap with single-axis data', async ({
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

    // Use the template path for setup, then switch its chart cell to heatmap.
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll('.template-card strong')).some(
          (n) => n.textContent === 'Vendor concentration',
        ),
      null,
      { timeout: 10_000 },
    );
    await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('.template-card')).find(
        (c) => c.querySelector('strong')?.textContent === 'Vendor concentration',
      );
      card?.querySelector<HTMLElement>('[data-action="instantiate"]')?.click();
    });
    await page.click('[data-nb-action="run-all"]');
    await page.waitForFunction(
      () => document.querySelectorAll('.cell[data-cell-kind="chart"] svg').length > 0,
      null,
      { timeout: 30_000 },
    );

    // Track page errors — Plot must not throw uncaught for this dataset.
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.evaluate(() => {
      const select = document.querySelector<HTMLSelectElement>(
        '.cell[data-cell-kind="chart"] select[data-action="chart-type"]',
      );
      if (!select) throw new Error('chart-type select not found');
      select.value = 'heatmap';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Either Plot renders something (SVG with at least one <g>), or the
    // wrapper shows a "Couldn't render" / "No rows" message — both are
    // acceptable; the contract is "no uncaught error."
    await page.waitForTimeout(2_000);
    expect(pageErrors).toEqual([]);

    await context.close();
    await server.close();
  });
});
