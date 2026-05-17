import { type Page, expect, test } from '@playwright/test';
import { startStaticServer } from './fixtures/server.ts';

/**
 * Wait for the schema panel column count to stop growing — same shape
 * as the helper in auto-restore.spec.ts.
 */
async function waitForClassificationStable(
  page: Page,
  timeoutMs = 60_000,
  stableMs = 600,
): Promise<void> {
  await page.waitForFunction(() => document.querySelectorAll('.schema-column').length > 0, null, {
    timeout: timeoutMs,
  });
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

async function waitForEngineReady(page: Page): Promise<void> {
  await page.waitForSelector('.shell-header', { timeout: 5_000 });
  await page.waitForFunction(
    () => document.querySelector('[data-region="engine-status"]')?.textContent === 'Engine: ready',
    null,
    { timeout: 90_000 },
  );
}

test.describe('?lens=<base64> share link round-trips workbook state', () => {
  test('Share button copies a link; opening it in a fresh context restores the workbook', async ({
    browser,
  }) => {
    const server = await startStaticServer();

    // --- Producer: mount example bundle, click Share, capture the URL the
    // handler tried to copy. We stub navigator.clipboard.writeText rather
    // than rely on clipboard read permission, which is flaky under headless
    // chromium.
    const producerCtx = await browser.newContext();
    const producerPage = await producerCtx.newPage();
    await producerPage.goto(`${server.url}/index.html?offline=1`);
    await waitForEngineReady(producerPage);

    await producerPage.click('[data-action="browse-examples"]');
    await waitForClassificationStable(producerPage);
    const producerCols = await producerPage.evaluate(() =>
      Array.from(document.querySelectorAll('.schema-column')).map((c) => ({
        col: (c as HTMLElement).dataset.column,
        type: (c as HTMLElement).dataset.assignedType,
      })),
    );
    const producerSources = await producerPage.evaluate(() =>
      Array.from(document.querySelectorAll('.source-card strong')).map((n) => n.textContent ?? ''),
    );
    expect(producerCols.length).toBeGreaterThanOrEqual(10);
    expect(producerSources.length).toBeGreaterThanOrEqual(1);

    // Give debounced auto-save a beat so the snapshot is settled.
    await producerPage.waitForTimeout(800);

    // Stub clipboard.writeText to capture what the Share handler writes.
    await producerPage.evaluate(() => {
      const w = window as unknown as { __capturedShareUrl?: string };
      w.__capturedShareUrl = '';
      navigator.clipboard.writeText = async (text: string) => {
        w.__capturedShareUrl = text;
      };
    });
    await producerPage.click('[data-action="share-link"]');
    // Handler awaits buildShareUrl (gzip compression) before writing — give
    // it a beat.
    await producerPage.waitForFunction(
      () => (window as unknown as { __capturedShareUrl?: string }).__capturedShareUrl !== '',
      null,
      { timeout: 5_000 },
    );
    const shareUrl = await producerPage.evaluate(
      () => (window as unknown as { __capturedShareUrl?: string }).__capturedShareUrl ?? '',
    );
    expect(shareUrl).toContain('?lens=');
    expect(shareUrl).toMatch(/[A-Za-z0-9_-]+$/);

    await producerCtx.close();

    // --- Consumer: brand-new context (no IDB carry-over). Open the link.
    // The producer's URL was built from window.location, which the static
    // server serves on a random port — rewrite to ?lens=... on the static
    // server URL to be sure.
    const lensParam = new URL(shareUrl).searchParams.get('lens') ?? '';
    expect(lensParam.length).toBeGreaterThan(0);

    const consumerCtx = await browser.newContext();
    const consumerPage = await consumerCtx.newPage();
    await consumerPage.goto(`${server.url}/index.html?offline=1&lens=${lensParam}`);
    await waitForEngineReady(consumerPage);

    // Restored sources + schema columns should match the producer.
    await waitForClassificationStable(consumerPage, 30_000);

    // After applyLoadedFile finishes, the URL should have had the lens
    // param stripped (clearLensFromLocation uses replaceState).
    await consumerPage.waitForFunction(() => !window.location.search.includes('lens='), null, {
      timeout: 5_000,
    });
    const consumerSources = await consumerPage.evaluate(() =>
      Array.from(document.querySelectorAll('.source-card strong')).map((n) => n.textContent ?? ''),
    );
    const consumerCols = await consumerPage.evaluate(() =>
      Array.from(document.querySelectorAll('.schema-column')).map((c) => ({
        col: (c as HTMLElement).dataset.column,
        type: (c as HTMLElement).dataset.assignedType,
      })),
    );
    expect(consumerSources).toEqual(producerSources);
    const norm = (xs: typeof producerCols) =>
      xs
        .map((c) => `${c.col}:${c.type}`)
        .sort()
        .join('|');
    expect(norm(consumerCols)).toBe(norm(producerCols));

    await consumerCtx.close();
    await server.close();
  });

  test('corrupted ?lens= falls back to empty state without crashing', async ({ browser }) => {
    const server = await startStaticServer();
    const context = await browser.newContext();
    const page = await context.newPage();

    // Capture page errors — none should fire even with a bad lens.
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto(`${server.url}/index.html?offline=1&lens=not-real-gzip-bytes`);
    await waitForEngineReady(page);

    // Empty state should be visible — fall-back behavior since no IDB
    // restore is possible in a fresh context.
    await page.waitForSelector('.empty-state', { timeout: 5_000 });
    expect(pageErrors).toEqual([]);

    await context.close();
    await server.close();
  });
});
