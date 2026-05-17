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

test.describe('pivot-table cell (Theme 2 wave 2)', () => {
  test('+ Pivot button adds a pivot cell that cross-tabulates an upstream SQL result', async ({
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

    // Notebook seeds an empty SQL cell on first mount. Write a 3-column
    // query into it and run all.
    const sqlCellCount = await page.evaluate(
      () => document.querySelectorAll('.cell[data-cell-kind="sql"]').length,
    );
    expect(sqlCellCount).toBeGreaterThanOrEqual(1);
    // Set the SQL. Handles both the textarea (pre-CM6) and the
    // CodeMirror 6 contenteditable (post lazy-load).
    await page.evaluate(() => {
      const sqlCell = document.querySelector<HTMLElement>('.cell[data-cell-kind="sql"]');
      if (!sqlCell) throw new Error('SQL cell not found');
      const code = 'SELECT vendor_name, payment_status, total_amount FROM invoices LIMIT 100';
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
      throw new Error('Neither textarea nor .cm-content found in SQL cell');
    });
    await page.click('[data-nb-action="run-all"]');
    // SQL result table appears once the query lands.
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.cell[data-cell-kind="sql"] .result-table tbody tr').length > 0,
      null,
      { timeout: 30_000 },
    );

    // Add a pivot cell.
    await page.click('[data-nb-action="add-pivot"]');
    await page.waitForSelector('.cell[data-cell-kind="pivot"]', { timeout: 5_000 });

    // Initial state: "Pick a SQL cell that has been run."
    const initialEmpty = await page.textContent('.cell[data-cell-kind="pivot"] .cell-output-empty');
    expect(initialEmpty).toContain('Pick a SQL cell');

    // Pick the upstream SQL cell. The select offers every SQL cell by id;
    // we want the one we ran.
    const sqlId = await page.evaluate(() => {
      const sql = document.querySelector<HTMLElement>('.cell[data-cell-kind="sql"]');
      return sql?.dataset.cellId ?? null;
    });
    expect(sqlId).not.toBeNull();
    await page.evaluate((id) => {
      const sel = document.querySelector<HTMLSelectElement>(
        '.cell[data-cell-kind="pivot"] [data-action="pivot-input"]',
      );
      if (!sel) throw new Error('pivot-input select not found');
      sel.value = id ?? '';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, sqlId);

    // After input is picked, the row/col/value pickers should render.
    await page.waitForSelector('.cell[data-cell-kind="pivot"] [data-action="pivot-row"]', {
      timeout: 5_000,
    });

    // Set row = vendor_name, col = payment_status, value = total_amount, agg = sum.
    await page.evaluate(() => {
      const setSel = (action: string, value: string) => {
        const sel = document.querySelector<HTMLSelectElement>(
          `.cell[data-cell-kind="pivot"] [data-action="${action}"]`,
        );
        if (!sel) throw new Error(`${action} select not found`);
        sel.value = value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setSel('pivot-row', 'vendor_name');
      setSel('pivot-col', 'payment_status');
      setSel('pivot-value', 'total_amount');
      // agg defaults to sum; assert anyway for clarity.
      setSel('pivot-agg', 'sum');
    });

    // A pivot-table should render with at least one numeric cell + a
    // grand total cell (sum has meaningful totals).
    await page.waitForFunction(
      () => {
        const piv = document.querySelector('.cell[data-cell-kind="pivot"] .pivot-table');
        if (!piv) return false;
        const numericCells = piv.querySelectorAll('td.numeric');
        return numericCells.length > 0;
      },
      null,
      { timeout: 5_000 },
    );

    const pivotShape = await page.evaluate(() => {
      const piv = document.querySelector('.cell[data-cell-kind="pivot"] .pivot-table');
      if (!piv) return null;
      const head = Array.from(piv.querySelectorAll('thead th')).map((n) => n.textContent ?? '');
      const bodyRowLabels = Array.from(piv.querySelectorAll('tbody tr th')).map(
        (n) => n.textContent ?? '',
      );
      const hasGrandTotal = piv.querySelector('tfoot') !== null;
      return { head, bodyRowLabels, hasGrandTotal };
    });
    expect(pivotShape).not.toBeNull();
    expect(pivotShape?.head[0]).toContain('vendor_name');
    // payment_status values: paid + open (the corpus has both).
    expect(pivotShape?.head.some((h) => h === 'paid')).toBe(true);
    expect(pivotShape?.bodyRowLabels.length).toBeGreaterThan(0);
    // Sum has meaningful totals → tfoot present.
    expect(pivotShape?.hasGrandTotal).toBe(true);

    await context.close();
    await server.close();
  });
});
