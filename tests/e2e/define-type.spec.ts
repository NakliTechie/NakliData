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

test.describe('define-type modal — focus a11y (W1.11 pattern)', () => {
  test('focus moves into the modal on open, restores to the trigger on Escape', async ({
    browser,
  }) => {
    const server = await startStaticServer();
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${server.url}/index.html?offline=1`);
    await waitForEngineReady(page);
    await waitForExamplesClassified(page);

    // The override-menu and its define-new-type button are inside each
    // column row's <details>. Open the first vendor_name column's override
    // menu and wait for the menu options + define button to render.
    await page.evaluate(() => {
      const first = document.querySelector<HTMLElement>(
        '.schema-column[data-column="vendor_name"]',
      );
      const details = first?.querySelector<HTMLDetailsElement>('details.schema-override');
      if (details) details.open = true;
    });
    await page.waitForFunction(() => {
      const first = document.querySelector<HTMLElement>(
        '.schema-column[data-column="vendor_name"]',
      );
      const btn = first?.querySelector<HTMLElement>('.define-new-type-trigger');
      return !!btn;
    });

    // Click the "+ Define new type from this column…" trigger.
    await page.evaluate(() => {
      const first = document.querySelector<HTMLElement>(
        '.schema-column[data-column="vendor_name"]',
      );
      const btn = first?.querySelector<HTMLElement>('.define-new-type-trigger');
      btn?.focus();
      btn?.click();
    });
    await page.waitForSelector('.define-type-modal', { timeout: 5_000 });

    // a11y: initial focus is the id field (the modal's most useful entry
    // point — user starts by naming the new type).
    const focusedOnOpen = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset?.defineField ?? null,
    );
    expect(focusedOnOpen).toBe('id');

    // Escape closes the modal.
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('.define-type-modal') === null, null, {
      timeout: 2_000,
    });

    // a11y: focus returns to the define-new-type trigger button.
    const focusedAfterClose = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset?.action ?? null,
    );
    expect(focusedAfterClose).toBe('define-new-type');

    await context.close();
    await server.close();
  });
});
