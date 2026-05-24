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

test.describe('pie chart + faceted small-multiples (Wave 1 polish)', () => {
  test('switching a chart cell to pie renders an SVG with slice paths; facet picker becomes available', async ({
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

    // Set up a SQL cell that returns vendor + amount + status — the
    // status column is what we'll facet by.
    await page.evaluate(() => {
      const sqlCell = document.querySelector<HTMLElement>('.cell[data-cell-kind="sql"]');
      if (!sqlCell) throw new Error('SQL cell not found');
      const code = 'SELECT vendor_name, total_amount, payment_status FROM invoices LIMIT 100';
      const ta = sqlCell.querySelector<HTMLTextAreaElement>('textarea');
      if (ta) {
        ta.value = code;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      const cm = sqlCell.querySelector<HTMLElement>('.cm-content');
      if (cm) {
        cm.textContent = code;
        cm.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      throw new Error('Neither textarea nor .cm-content found');
    });
    await page.click('[data-nb-action="run-all"]');
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.cell[data-cell-kind="sql"] .result-table tbody tr').length > 0,
      null,
      { timeout: 30_000 },
    );

    // Add a chart cell and wire it to the SQL cell.
    await page.click('[data-nb-action="add-chart"]');
    await page.waitForSelector('.cell[data-cell-kind="chart"]', { timeout: 5_000 });

    const sqlId = await page.evaluate(
      () =>
        document.querySelector<HTMLElement>('.cell[data-cell-kind="sql"]')?.dataset.cellId ?? null,
    );
    expect(sqlId).not.toBeNull();
    await page.evaluate((id) => {
      const sel = document.querySelector<HTMLSelectElement>(
        '.cell[data-cell-kind="chart"] [data-action="chart-input"]',
      );
      if (!sel) throw new Error('chart-input not found');
      sel.value = id ?? '';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, sqlId);

    // Switch chart type to pie. Before doing so, confirm the facet picker
    // is NOT shown for the default 'bar' type.
    const facetVisibleForBar = await page.evaluate(
      () =>
        document.querySelector('.cell[data-cell-kind="chart"] [data-action="chart-facet"]') !==
        null,
    );
    expect(facetVisibleForBar).toBe(false);

    await page.evaluate(() => {
      const setSel = (action: string, value: string) => {
        const sel = document.querySelector<HTMLSelectElement>(
          `.cell[data-cell-kind="chart"] [data-action="${action}"]`,
        );
        if (!sel) throw new Error(`${action} select not found`);
        sel.value = value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setSel('chart-type', 'pie');
      setSel('chart-x', 'vendor_name');
      setSel('chart-y', 'total_amount');
    });

    // Pie SVG with slice paths should render.
    await page.waitForFunction(
      () => {
        const cell = document.querySelector('.cell[data-cell-kind="chart"]');
        if (!cell) return false;
        const svgs = Array.from(cell.querySelectorAll('svg'));
        // Pie has either circle (single slice) or path elements.
        return svgs.some(
          (s) => s.querySelector('path') !== null || s.querySelector('circle') !== null,
        );
      },
      null,
      { timeout: 5_000 },
    );

    // Facet picker should now be visible for pie.
    const facetVisibleForPie = await page.evaluate(
      () =>
        document.querySelector('.cell[data-cell-kind="chart"] [data-action="chart-facet"]') !==
        null,
    );
    expect(facetVisibleForPie).toBe(true);

    // Pick payment_status as the facet — should split into multiple pies.
    await page.evaluate(() => {
      const sel = document.querySelector<HTMLSelectElement>(
        '.cell[data-cell-kind="chart"] [data-action="chart-facet"]',
      );
      if (!sel) throw new Error('chart-facet not found');
      sel.value = 'payment_status';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Expect >1 SVG inside the chart-canvas region now (one per facet
    // value). The accessible-table mirror lives outside data-region so
    // we scope the count to the canvas.
    await page.waitForFunction(
      () => {
        const canvas = document.querySelector(
          '.cell[data-cell-kind="chart"] [data-region="chart-canvas"]',
        );
        if (!canvas) return false;
        return canvas.querySelectorAll('svg').length >= 2;
      },
      null,
      { timeout: 5_000 },
    );

    await context.close();
    await server.close();
  });
});
