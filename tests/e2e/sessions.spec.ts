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
  throw new Error(`classification did not stabilize within ${timeoutMs}ms`);
}

test.describe('multi-session sidebar', () => {
  test('session switcher: create a second session, switch between them, each keeps its own state', async ({
    browser,
  }) => {
    const server = await startStaticServer();
    // Single context so IDB survives across reloads.
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${server.url}/index.html?offline=1`);
    await waitForEngineReady(page);

    // Header switcher should show the seed session "Untitled".
    const initialName = await page.textContent(
      '.session-switcher .session-trigger .session-name',
    );
    expect(initialName?.trim()).toBe('Untitled');

    // Mount example data in session 1.
    await page.click('[data-action="browse-examples"]');
    await waitForClassificationStable(page);
    const session1Sources = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.source-card strong')).map((n) => n.textContent ?? ''),
    );
    expect(session1Sources.length).toBeGreaterThanOrEqual(1);
    // Let the debounced auto-save flush into session 1's snapshot.
    await page.waitForTimeout(800);

    // Open the switcher menu, click "New session".
    await page.click('.session-switcher .session-trigger');
    await page.waitForSelector('[data-region="session-menu"][data-open]', { timeout: 2_000 });
    await page.click('.session-switcher [data-action="session-new"]');

    // The new (now-active) session should have an empty workbook: the
    // empty state reappears, no source cards, switcher name changed.
    await page.waitForSelector('.empty-state', { timeout: 5_000 });
    const session2Cards = await page.evaluate(
      () => document.querySelectorAll('.source-card').length,
    );
    expect(session2Cards).toBe(0);
    const session2Name = await page.textContent(
      '.session-switcher .session-trigger .session-name',
    );
    // Default name for the second session is "Session 2".
    expect(session2Name?.trim()).toBe('Session 2');

    // Switch back to "Untitled" via the dropdown.
    await page.click('.session-switcher .session-trigger');
    await page.waitForSelector('[data-region="session-menu"][data-open]', { timeout: 2_000 });
    // Pick whichever entry is NOT the active one.
    const untitledId = await page.evaluate(() => {
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>('.session-switcher .session-row'),
      );
      for (const row of rows) {
        if (!row.classList.contains('active')) {
          const btn = row.querySelector<HTMLElement>('[data-action="session-switch"]');
          return btn?.dataset.sessionId ?? null;
        }
      }
      return null;
    });
    expect(untitledId).not.toBeNull();
    await page.click(
      `.session-switcher [data-action="session-switch"][data-session-id="${untitledId}"]`,
    );
    await waitForClassificationStable(page, 30_000);

    const restoredSources = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.source-card strong')).map((n) => n.textContent ?? ''),
    );
    expect(restoredSources).toEqual(session1Sources);
    const backName = await page.textContent('.session-switcher .session-trigger .session-name');
    expect(backName?.trim()).toBe('Untitled');

    await context.close();
    await server.close();
  });

  test('cannot delete the last session', async ({ browser }) => {
    const server = await startStaticServer();
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${server.url}/index.html?offline=1`);
    await waitForEngineReady(page);

    // Stub window.confirm to always accept (we shouldn't even get there
    // because the handler short-circuits, but stub anyway so a confirm
    // dialog doesn't hang the test).
    await page.evaluate(() => {
      window.confirm = () => true;
    });

    // Open menu, click delete on the only session.
    await page.click('.session-switcher .session-trigger');
    await page.waitForSelector('[data-region="session-menu"][data-open]', { timeout: 2_000 });
    const onlyId = await page.evaluate(() => {
      const btn = document.querySelector<HTMLElement>(
        '.session-switcher [data-action="session-switch"]',
      );
      return btn?.dataset.sessionId ?? null;
    });
    expect(onlyId).not.toBeNull();
    await page.click(
      `.session-switcher [data-action="session-delete"][data-session-id="${onlyId}"]`,
    );

    // Session should still be present.
    await page.waitForTimeout(400);
    const stillThere = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '.session-switcher [data-action="session-switch"]',
        ),
      ).map((b) => b.dataset.sessionId),
    );
    expect(stillThere).toContain(onlyId);

    await context.close();
    await server.close();
  });
});
