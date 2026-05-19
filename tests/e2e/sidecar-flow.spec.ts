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

    // Enable sidecar (without saving a key) so the Explain button shows.
    await page.click('[data-action="open-settings"]');
    await page.waitForSelector('.settings-modal', { timeout: 5_000 });
    await page.evaluate(() => {
      const cb = document.querySelector<HTMLInputElement>('[data-action="settings-enable"]');
      if (!cb) throw new Error('settings-enable checkbox not found');
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.click('[data-action="close-settings"]');

    // Cause an error + click Explain.
    await writeIntoSqlCell(page, 'SELEKT * FROM invoices LIMIT 1');
    await page.click('[data-nb-action="run-all"]');
    await page.waitForFunction(
      () => document.querySelector('.cell.errored .cell-output-error') !== null,
      null,
      { timeout: 10_000 },
    );
    await page.click('[data-action="explain-error"]');
    await page.waitForFunction(
      () => {
        const e = document.querySelector('.cell-sidecar-error');
        return e !== null && /No API key configured/.test(e.textContent ?? '');
      },
      null,
      { timeout: 5_000 },
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
