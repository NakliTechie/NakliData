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

/**
 * Wait until the classifier stops producing new schema-column rows for
 * `stableMs`. Cloned from auto-restore.spec — avoiding a shared helper
 * file because adding one would force a cascade of import changes; the
 * function is small enough to duplicate.
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

async function writeIntoSqlCell(page: Page, code: string): Promise<void> {
  await page.evaluate((c) => {
    const sqlCell = document.querySelector<HTMLElement>('.cell[data-cell-kind="sql"]');
    if (!sqlCell) throw new Error('SQL cell not found');
    const ta = sqlCell.querySelector<HTMLTextAreaElement>('textarea');
    if (ta) {
      ta.value = c;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const cm = sqlCell.querySelector<HTMLElement>('.cm-content');
    if (cm) {
      cm.textContent = c;
      cm.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    throw new Error('No editor surface found');
  }, code);
}

test.describe('AI sidecar — explain query error (BYOK)', () => {
  test('end-to-end: enable sidecar in Settings, save key, trigger SQL error, Explain renders the response', async ({
    browser,
  }) => {
    const server = await startStaticServer();
    const context = await browser.newContext();
    const page = await context.newPage();

    // Stub the Anthropic API endpoint with a canned JSON response so the
    // test doesn't need a real key + the network.
    let anthropicCalls = 0;
    await context.route('https://api.anthropic.com/v1/messages', async (route) => {
      anthropicCalls++;
      const body = JSON.stringify({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              explanation:
                'You wrote SELEKT instead of SELECT — DuckDB does not recognise that keyword.',
              suggested_fix: 'SELECT * FROM invoices LIMIT 1',
            }),
          },
        ],
      });
      await route.fulfill({ status: 200, contentType: 'application/json', body });
    });

    await page.goto(`${server.url}/index.html?offline=1`);
    await waitForEngineReady(page);
    await page.click('[data-action="browse-examples"]');
    await page.waitForFunction(
      () => document.querySelectorAll('.schema-column').length >= 10,
      null,
      { timeout: 60_000 },
    );

    // --- Open Settings, enable sidecar, save an Anthropic key.
    await page.click('[data-action="open-settings"]');
    await page.waitForSelector('.settings-modal', { timeout: 5_000 });

    // a11y: focus moves to close button on open (W1.11 pattern). Settings
    // does an async refresh + focus, so wait for it to land rather than
    // sampling immediately.
    await page.waitForFunction(
      () =>
        (document.activeElement as HTMLElement | null)?.dataset?.action === 'close-settings',
      null,
      { timeout: 2_000 },
    );

    // Sidecar is off by default; flip the enable checkbox.
    await page.evaluate(() => {
      const cb = document.querySelector<HTMLInputElement>('[data-action="settings-enable"]');
      if (!cb) throw new Error('settings-enable checkbox not found');
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // App root should pick up the class right away.
    await page.waitForFunction(
      () => document.getElementById('app')?.classList.contains('app-sidecar-enabled') ?? false,
      null,
      { timeout: 2_000 },
    );
    // Type the test API key.
    await page.fill(
      '[data-action="settings-key-input"][data-provider="anthropic"]',
      'sk-ant-test-key',
    );
    await page.click('[data-action="settings-save-key"][data-provider="anthropic"]');
    // Status line should switch to "In sessionStorage (••••-key)…"
    await page.waitForFunction(
      () => {
        const status = document.querySelector(
          '.settings-provider-block[data-provider="anthropic"] .settings-provider-status',
        );
        return /sessionStorage/.test(status?.textContent ?? '');
      },
      null,
      { timeout: 2_000 },
    );
    await page.click('[data-action="close-settings"]');
    await page.waitForFunction(() => document.querySelector('.settings-modal') === null, null, {
      timeout: 2_000,
    });

    // a11y: focus returns to the header trigger after close.
    await page.waitForFunction(
      () =>
        (document.activeElement as HTMLElement | null)?.dataset?.action === 'open-settings',
      null,
      { timeout: 2_000 },
    );

    // --- Trigger a SQL error. Use a known-bad keyword so DuckDB rejects it.
    await writeIntoSqlCell(page, 'SELEKT * FROM invoices LIMIT 1');
    await page.click('[data-nb-action="run-all"]');
    await page.waitForFunction(
      () => document.querySelector('.cell.errored .cell-output-error') !== null,
      null,
      { timeout: 10_000 },
    );

    // --- Click "Explain this error". The sidecar should call the stubbed
    // route and render the JSON-parsed response inline.
    await page.click('[data-action="explain-error"]');
    await page.waitForFunction(
      () => document.querySelector('.cell-sidecar-explanation') !== null,
      null,
      { timeout: 5_000 },
    );
    expect(anthropicCalls).toBe(1);
    const explanationText = await page.textContent('.cell-sidecar-explanation');
    expect(explanationText).toContain('SELEKT');
    expect(explanationText).toContain('SELECT');
    const fix = await page.textContent('.cell-sidecar-suggested');
    expect(fix).toContain('SELECT * FROM invoices');

    await context.close();
    await server.close();
  });

  test('clicking Explain with no key configured surfaces the no-key error + Open Settings affordance', async ({
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
    // Wait for the classifier to fully settle. Under workers=2 CPU
    // contention, a late-arriving classification update fires the
    // workbook subscriber which re-renders the notebook — replacing
    // the cell's sidecar-result mount node mid-dispatch and losing the
    // error message. Stabilising first sidesteps the race.
    await waitForClassificationStable(page);

    // Enable sidecar (without saving a key) so the Explain button shows.
    await page.click('[data-action="open-settings"]');
    await page.waitForSelector('.settings-modal', { timeout: 5_000 });
    await page.evaluate(() => {
      const cb = document.querySelector<HTMLInputElement>('[data-action="settings-enable"]');
      if (!cb) throw new Error('settings-enable checkbox not found');
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // The change handler is async (awaits patchSettings → IDB write).
    // Wait for the body class flip — that's the deterministic signal
    // that the setting has actually persisted + the Explain button is
    // wired up. Without this, under workers=2 CPU contention the
    // subsequent close-settings click can outrun the IDB write.
    await page.waitForFunction(
      () => document.getElementById('app')?.classList.contains('app-sidecar-enabled') === true,
      null,
      { timeout: 5_000 },
    );
    await page.click('[data-action="close-settings"]');

    // Cause an error + click Explain.
    await writeIntoSqlCell(page, 'SELEKT * FROM invoices LIMIT 1');
    await page.click('[data-nb-action="run-all"]');
    await page.waitForFunction(
      () => document.querySelector('.cell.errored .cell-output-error') !== null,
      null,
      { timeout: 10_000 },
    );
    // The Explain button is rendered inside the errored cell only when
    // sidecar is enabled. Under workers=2 contention, the click can
    // outrun the button's render — wait for it explicitly.
    await page.waitForSelector('[data-action="explain-error"]', { timeout: 5_000 });
    await page.click('[data-action="explain-error"]');
    await page.waitForFunction(
      () => {
        const e = document.querySelector('.cell-sidecar-error');
        return e !== null && /No API key configured/.test(e.textContent ?? '');
      },
      null,
      { timeout: 10_000 },
    );

    // The "Open Settings" affordance should be present alongside the error.
    const reopen = await page.evaluate(
      () => Array.from(document.querySelectorAll('[data-action="open-settings"]')).length,
    );
    expect(reopen).toBeGreaterThan(1); // header button + the one in the sidecar-error block

    await context.close();
    await server.close();
  });
});
