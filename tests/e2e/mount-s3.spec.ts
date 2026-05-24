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

test.describe('Mount S3-compatible bucket modal (Wave 2 slice 2)', () => {
  // We exercise the modal surface — open / validation / cancel — without
  // touching a real S3 endpoint. The actual mount needs live credentials
  // against a real bucket; covered by manual / staging tests, not e2e.
  test('opens the modal, focuses endpoint input, validates required fields, closes on Cancel', async ({
    page,
  }) => {
    const server = await startStaticServer();
    await page.goto(`${server.url}/index.html?offline=1`);
    await waitForEngineReady(page);

    // Trigger lives in the empty-state action grid.
    const trigger = page.locator('[data-action="mount-s3"]');
    await expect(trigger).toBeVisible();
    await trigger.click();
    await page.waitForSelector('.mount-s3-overlay', { timeout: 3_000 });

    // Focus lands on the endpoint input.
    const focusedRegion = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset?.region ?? null,
    );
    expect(focusedRegion).toBe('endpoint-input');

    // Clicking Mount with empty fields surfaces an inline error.
    await page.click('.mount-s3-overlay [data-action="confirm-mount-s3"]');
    await page.waitForFunction(
      () => {
        const el = document.querySelector(
          '.mount-s3-overlay [data-region="error"]',
        ) as HTMLElement | null;
        return el && !el.hidden && /Endpoint is required/.test(el.textContent ?? '');
      },
      null,
      { timeout: 3_000 },
    );

    // Filling endpoint only leaves bucket required next.
    await page.fill('.mount-s3-overlay [data-region="endpoint-input"]', 's3.amazonaws.com');
    await page.click('.mount-s3-overlay [data-action="confirm-mount-s3"]');
    await page.waitForFunction(
      () => {
        const el = document.querySelector(
          '.mount-s3-overlay [data-region="error"]',
        ) as HTMLElement | null;
        return el && !el.hidden && /Bucket is required/.test(el.textContent ?? '');
      },
      null,
      { timeout: 3_000 },
    );

    // Cancel closes the modal and returns focus to the trigger.
    await page.click('.mount-s3-overlay [data-action="close-mount-s3"]');
    await page.waitForFunction(() => document.querySelector('.mount-s3-overlay') === null, {
      timeout: 2_000,
    });
    const focusedAfterClose = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset?.action ?? null,
    );
    expect(focusedAfterClose).toBe('mount-s3');

    await server.close();
  });

  test('URL style picker offers both vhost and path options', async ({ page }) => {
    const server = await startStaticServer();
    await page.goto(`${server.url}/index.html?offline=1`);
    await waitForEngineReady(page);
    await page.click('[data-action="mount-s3"]');
    await page.waitForSelector('.mount-s3-overlay', { timeout: 3_000 });

    const options = await page.$$eval(
      '.mount-s3-overlay [data-region="url-style-input"] option',
      (nodes) => nodes.map((n) => (n as HTMLOptionElement).value),
    );
    expect(options).toEqual(['vhost', 'path']);

    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('.mount-s3-overlay') === null, {
      timeout: 2_000,
    });
    await server.close();
  });
});
