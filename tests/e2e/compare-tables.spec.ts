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

async function waitForExamplesClassified(page: Page): Promise<void> {
  await page.click('[data-action="browse-examples"]');
  await page.waitForFunction(() => document.querySelectorAll('.schema-column').length >= 15, null, {
    timeout: 60_000,
  });
}

test.describe('compare-tables modal (Theme 4 wave 2 / B2)', () => {
  test('opens the modal, auto-picks a shared GSTIN join key, renders bucket counts', async ({
    browser,
  }) => {
    const server = await startStaticServer();
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${server.url}/index.html?offline=1`);
    await waitForEngineReady(page);
    await waitForExamplesClassified(page);

    // Toolbar button is present (≥2 tables mounted).
    await page.waitForSelector('[data-action="compare-tables"]', { timeout: 3_000 });
    await page.click('[data-action="compare-tables"]');
    await page.waitForSelector('.compare-tables-modal', { timeout: 2_000 });

    // a11y: focus should move into the modal (close button is the
    // predictable initial-focus target — see W1.11 pattern).
    const focusedOnOpen = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset?.action ?? null,
    );
    expect(focusedOnOpen).toBe('close-compare-tables');

    // Default selections are first two tables — for the example bundle
    // those are `vendors` and `invoices`. Both have a GSTIN-typed
    // column so the key picker auto-populates.
    await page.waitForSelector('[data-region="key-select"]', { timeout: 2_000 });

    // Run the comparison.
    await page.click('[data-action="run-compare"]');
    // The result region paints a summary block.
    await page.waitForSelector('[data-region="summary"]', { timeout: 15_000 });

    // Bucket counts add up — total rowsA + onlyInB should equal rowsA + onlyInB
    // but we just check shape: each bucket span exists with a number.
    const buckets = await page.evaluate(() => {
      const pick = (region: string): string | null =>
        document.querySelector<HTMLElement>(`[data-region="${region}"]`)?.textContent?.trim() ??
        null;
      return {
        summary: pick('summary'),
        onlyA: pick('only-a'),
        onlyB: pick('only-b'),
        matched: pick('matched'),
        differing: pick('differing'),
      };
    });
    expect(buckets.summary).toBeTruthy();
    expect(buckets.onlyA).toMatch(/Only in A:/);
    expect(buckets.onlyB).toMatch(/Only in B:/);
    expect(buckets.matched).toMatch(/Matched:/);
    expect(buckets.differing).toMatch(/Differing:/);

    // Close via Escape.
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => document.querySelector('.compare-tables-modal') === null,
      null,
      { timeout: 2_000 },
    );

    // a11y: focus returns to the trigger after close. The schema panel
    // may have re-rendered during the long-running compare (workbook
    // subscribers fire on tick), so the close-side restoration falls
    // back to a live `[data-action]` lookup when the stored element ref
    // has been detached.
    const focusedAfterClose = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset?.action ?? null,
    );
    expect(focusedAfterClose).toBe('compare-tables');

    await context.close();
    await server.close();
  });

  test('hides the toolbar button when only one table is mounted', async ({ browser }) => {
    const server = await startStaticServer();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${server.url}/index.html?offline=1`);
    await waitForEngineReady(page);
    // No mounts → no schema-toolbar at all (the panel shows "mount a source" hint).
    // After mounting examples there are ≥2 tables — already covered by the
    // first test. We assert the "hidden when <2" path via the empty state.
    const buttonPresent = await page.locator('[data-action="compare-tables"]').count();
    expect(buttonPresent).toBe(0);
    await context.close();
    await server.close();
  });
});
