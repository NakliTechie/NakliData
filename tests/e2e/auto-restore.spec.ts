import { type Page, expect, test } from '@playwright/test';
import { startStaticServer } from './fixtures/server.ts';

/**
 * Wait for the schema panel column count to stop growing for `stableMs`
 * consecutive milliseconds — proxy for "classification finished." Avoids
 * a hard sleep; tolerant of slow-classifier runs.
 */
async function waitForClassificationStable(
  page: Page,
  timeoutMs = 60_000,
  stableMs = 600,
): Promise<void> {
  // First wait until at least one column appears.
  await page.waitForFunction(() => document.querySelectorAll('.schema-column').length > 0, null, {
    timeout: timeoutMs,
  });
  // Then poll the count; bail when it stops changing.
  const start = Date.now();
  let lastCount = -1;
  let stableSince = Date.now();
  while (Date.now() - start < timeoutMs) {
    const count = await page.evaluate(() => document.querySelectorAll('.schema-column').length);
    if (count !== lastCount) {
      lastCount = count;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= stableMs) {
      return;
    }
    await page.waitForTimeout(100);
  }
  throw new Error(
    `classification did not stabilize within ${timeoutMs}ms (last count: ${lastCount})`,
  );
}

test.describe('auto-restore across tabs (IDB workbook snapshot)', () => {
  test('mounting example bundle, reloading, and reopening restores the workbook automatically', async ({
    browser,
  }) => {
    const server = await startStaticServer();
    // We use a single context so IndexedDB survives the page reload —
    // each context has its own storage partition.
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${server.url}/index.html?offline=1`);
    await page.waitForSelector('.shell-header', { timeout: 5_000 });
    await page.waitForFunction(
      () =>
        document.querySelector('[data-region="engine-status"]')?.textContent === 'Engine: ready',
      null,
      { timeout: 90_000 },
    );

    // Mount example bundle, wait for classification to fully settle.
    // Classification runs column-by-column across all mounted tables; we
    // need to wait until the schema-panel count stops growing, otherwise
    // we'd snapshot an intermediate state and miss columns the auto-save
    // captures later.
    await page.click('[data-action="browse-examples"]');
    await waitForClassificationStable(page);

    const before = await page.evaluate(() => ({
      cols: Array.from(document.querySelectorAll('.schema-column')).map((c) => ({
        col: (c as HTMLElement).dataset.column,
        type: (c as HTMLElement).dataset.assignedType,
      })),
      sources: Array.from(document.querySelectorAll('.source-card strong')).map(
        (n) => n.textContent ?? '',
      ),
    }));
    expect(before.cols.length).toBeGreaterThanOrEqual(10);
    expect(before.sources.length).toBeGreaterThanOrEqual(1);

    // Give the debounced auto-save (300 ms) time to fire.
    await page.waitForTimeout(800);

    // Reload the tab. Same context = same IDB.
    await page.reload();

    // After reload, the empty state should NOT be shown; auto-restore
    // should bring the sources + assignments back without any click.
    await page.waitForFunction(
      () =>
        document.querySelector('[data-region="engine-status"]')?.textContent === 'Engine: ready',
      null,
      { timeout: 90_000 },
    );
    await waitForClassificationStable(page, 30_000);

    // No "What do you have?" empty state.
    expect(await page.locator('.empty-state').count()).toBe(0);

    const after = await page.evaluate(() => ({
      cols: Array.from(document.querySelectorAll('.schema-column')).map((c) => ({
        col: (c as HTMLElement).dataset.column,
        type: (c as HTMLElement).dataset.assignedType,
      })),
      sources: Array.from(document.querySelectorAll('.source-card strong')).map(
        (n) => n.textContent ?? '',
      ),
    }));

    expect(after.sources).toEqual(before.sources);
    const norm = (xs: typeof after.cols) =>
      xs
        .map((c) => `${c.col}:${c.type}`)
        .sort()
        .join('|');
    expect(norm(after.cols)).toBe(norm(before.cols));

    await context.close();
    await server.close();
  });

  test('changing the auto-accept threshold persists across reload', async ({ browser }) => {
    const server = await startStaticServer();
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${server.url}/index.html?offline=1`);
    await page.waitForFunction(
      () =>
        document.querySelector('[data-region="engine-status"]')?.textContent === 'Engine: ready',
      null,
      { timeout: 90_000 },
    );
    // Mount example data so the schema-panel slider is rendered.
    await page.click('[data-action="browse-examples"]');
    await waitForClassificationStable(page);

    // Move the threshold slider via direct dispatch (CodeMirror not in play).
    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('[data-action="threshold-slider"]');
      if (!input) throw new Error('slider not found');
      input.value = '0.75';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // Debounce window for auto-save.
    await page.waitForTimeout(800);

    // Reload; the restored threshold should be 0.75.
    await page.reload();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-region="engine-status"]')?.textContent === 'Engine: ready',
      null,
      { timeout: 90_000 },
    );
    await waitForClassificationStable(page, 30_000);

    const sliderValue = await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('[data-action="threshold-slider"]');
      return input?.value ?? null;
    });
    expect(sliderValue).toBe('0.75');

    await context.close();
    await server.close();
  });
});
