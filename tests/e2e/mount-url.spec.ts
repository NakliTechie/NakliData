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

test.describe('Paste URL mount (Wave 2 slice 1)', () => {
  test('opens the modal, accepts a public CSV URL, mounts as a new source', async ({ page }) => {
    const server = await startStaticServer();
    await page.goto(`${server.url}/index.html?offline=1`);
    await waitForEngineReady(page);

    // The Paste URL button is in the empty-state action grid and is no
    // longer disabled (was a "v1.1" placeholder until Wave 2 slice 1).
    const pasteBtn = page.locator('[data-action="mount-url"]');
    await expect(pasteBtn).not.toBeDisabled();
    await pasteBtn.click();

    // Modal renders. Focus should land on the URL input.
    await page.waitForSelector('.mount-url-overlay', { timeout: 3_000 });
    const focusedRegion = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset?.region ?? null,
    );
    expect(focusedRegion).toBe('url-input');

    // Type a same-origin URL pointing at one of the served example CSVs.
    await page.fill(
      '.mount-url-overlay [data-region="url-input"]',
      `${server.url}/examples/finance/vendors.csv`,
    );
    await page.fill('.mount-url-overlay [data-region="label-input"]', 'Vendors (remote)');
    await page.click('.mount-url-overlay [data-action="confirm-mount-url"]');

    // Modal closes on success.
    await page.waitForFunction(() => document.querySelector('.mount-url-overlay') === null, {
      timeout: 10_000,
    });

    // The new source card appears in the sources panel.
    await page.waitForSelector('.source-card', { timeout: 5_000 });
    const sourceLabels = await page.$$eval('.source-card strong', (nodes) =>
      nodes.map((n) => n.textContent ?? ''),
    );
    expect(sourceLabels).toContain('Vendors (remote)');

    await server.close();
  });

  test('shows an inline error when the URL is missing or unsupported', async ({ page }) => {
    const server = await startStaticServer();
    await page.goto(`${server.url}/index.html?offline=1`);
    await waitForEngineReady(page);

    await page.click('[data-action="mount-url"]');
    await page.waitForSelector('.mount-url-overlay', { timeout: 3_000 });

    // Empty URL → "URL is required."
    await page.click('.mount-url-overlay [data-action="confirm-mount-url"]');
    const errEmpty = await page.textContent('.mount-url-overlay [data-region="error"]');
    expect(errEmpty).toContain('URL is required');

    // Unsupported extension → "Could not infer a supported format…"
    await page.fill(
      '.mount-url-overlay [data-region="url-input"]',
      'https://example.com/data.txt',
    );
    await page.click('.mount-url-overlay [data-action="confirm-mount-url"]');
    await page.waitForFunction(
      () => {
        const el = document.querySelector(
          '.mount-url-overlay [data-region="error"]',
        ) as HTMLElement | null;
        return el && !el.hidden && /Could not infer/.test(el.textContent ?? '');
      },
      null,
      { timeout: 5_000 },
    );

    // Escape closes the modal even after an error.
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('.mount-url-overlay') === null, {
      timeout: 2_000,
    });

    await server.close();
  });
});
