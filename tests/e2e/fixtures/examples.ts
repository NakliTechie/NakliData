import type { Page } from '@playwright/test';

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
