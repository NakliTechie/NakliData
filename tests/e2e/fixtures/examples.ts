import type { Page } from '@playwright/test';

export const EXAMPLE_SCHEMA_COLUMN_COUNT = 42;

/**
 * Mount the example workbook through whichever first-run surface is active.
 * New contexts show the welcome dialog; returning contexts expose the empty
 * state's demo button. Both product controls call the same application action.
 */
export async function mountExamples(page: Page): Promise<void> {
  const welcomeCta = page.locator('[data-welcome-examples]');
  const alreadyWelcomed = await page.evaluate(
    () => localStorage.getItem('naklidata.welcomed') === '1',
  );
  const skipsWelcome =
    new URL(page.url()).searchParams.has('lens') ||
    new URL(page.url()).searchParams.get('present') === '1';
  if (!alreadyWelcomed && !skipsWelcome) {
    await welcomeCta.waitFor({ state: 'visible', timeout: 5_000 });
    if (await welcomeCta.isVisible()) {
      await welcomeCta.click();
      return;
    }
  }
  await page.click('[data-action="browse-examples"]');
}

/** Wait until all five demo tables have published their schema assignments. */
export async function waitForExampleClassification(page: Page, timeoutMs = 60_000): Promise<void> {
  await page.waitForFunction(
    (expected) => document.querySelectorAll('.schema-column').length === expected,
    EXAMPLE_SCHEMA_COLUMN_COUNT,
    { timeout: timeoutMs },
  );
}
