import { type Page, expect, test } from '@playwright/test';
import { startStaticServer } from './fixtures/server.ts';

async function waitForReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelector('[data-region="engine-status"]')?.textContent === 'Engine: ready',
    null,
    { timeout: 90_000 },
  );
  const welcome = page.locator('.help-overlay');
  await welcome.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => {});
  if (await welcome.isVisible()) await welcome.locator('[data-close]').first().click();
}

test.describe('Compute Bridge catalog readiness', () => {
  test('negotiates the protocol and renders catalog → namespace → object hierarchy', async ({
    page,
  }) => {
    const server = await startStaticServer();
    await page.route('https://bridge.example/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/v1/health') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            protocol: 'naklidata-compute-bridge',
            protocol_version: 1,
            name: 'test-bridge',
            version: '1.0.0',
            auth: 'none',
            single_tenant: true,
            capabilities: ['query', 'tables', 'arrow-ipc'],
          }),
        });
        return;
      }
      if (path === '/v1/tables') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            tables: [
              {
                catalog: 'prod',
                namespace: ['finance', 'ap'],
                name: 'invoices',
                kind: 'view',
                source: 'databricks',
                schema: [{ name: 'amount', type: 'DECIMAL(18,2)' }],
              },
              {
                catalog: 'prod',
                namespace: ['sales'],
                name: 'orders',
                kind: 'table',
                source: 'snowflake',
                schema: [{ name: 'order_id', type: 'VARCHAR' }],
              },
            ],
          }),
        });
        return;
      }
      await route.abort();
    });

    try {
      await page.goto(`${server.url}/index.html?offline=1`);
      await waitForReady(page);
      await page.click('.empty-state [data-action="mount-compute-bridge-catalog"]');
      const modal = page.locator('.mount-bridge-catalog-overlay');
      await modal.locator('[data-region="bridge-url-input"]').fill('https://bridge.example');
      await modal.locator('[data-action="bridge-catalog-connect"]').click();

      await expect(modal.locator('.mount-bridge-catalog-group-title')).toHaveText('prod');
      await expect(modal.locator('.mount-bridge-namespace-title')).toHaveText([
        'finance › ap',
        'sales',
      ]);
      await expect(modal.locator('.mount-bridge-catalog-name code')).toHaveText([
        'invoices',
        'orders',
      ]);
      await expect(modal.locator('.mount-bridge-catalog-name small')).toHaveText([
        'view · databricks',
        'table · snowflake',
      ]);
      await expect(modal.locator('.mount-bridge-catalog-row').first()).toHaveAttribute(
        'data-table-name',
        'prod.finance.ap.invoices',
      );
    } finally {
      await server.close();
    }
  });

  test('shows protocol mismatch inline and does not expose a picker', async ({ page }) => {
    const server = await startStaticServer();
    await page.route('https://foreign.example/**', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          protocol: 'some-other-service',
          protocol_version: 9,
          name: 'foreign',
          version: '9',
          auth: 'none',
          single_tenant: true,
          capabilities: ['query', 'tables', 'arrow-ipc'],
        }),
      });
    });

    try {
      await page.goto(`${server.url}/index.html?offline=1`);
      await waitForReady(page);
      await page.click('.empty-state [data-action="mount-compute-bridge-catalog"]');
      const modal = page.locator('.mount-bridge-catalog-overlay');
      await modal.locator('[data-region="bridge-url-input"]').fill('https://foreign.example');
      await modal.locator('[data-action="bridge-catalog-connect"]').click();
      await expect(modal.locator('[data-region="error"]')).toContainText(
        'Unsupported bridge protocol',
      );
      await expect(modal.locator('[data-region="catalog-pick"]')).toBeHidden();
    } finally {
      await server.close();
    }
  });

  test('closing a bridge dialog aborts its in-flight request', async ({ page }) => {
    const server = await startStaticServer();
    await page.addInitScript(() => {
      const nativeFetch = window.fetch.bind(window);
      (window as Window & { __bridgeRequestAborted?: boolean }).__bridgeRequestAborted = false;
      window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).startsWith('https://slow-bridge.example')) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => {
                (
                  window as Window & {
                    __bridgeRequestAborted?: boolean;
                  }
                ).__bridgeRequestAborted = true;
                reject(new DOMException('aborted', 'AbortError'));
              },
              { once: true },
            );
          });
        }
        return nativeFetch(input, init);
      }) as typeof fetch;
    });

    try {
      await page.goto(`${server.url}/index.html?offline=1`);
      await waitForReady(page);
      await page.click('.empty-state [data-action="mount-compute-bridge"]');
      const modal = page.locator('.mount-bridge-overlay');
      await modal.locator('[data-region="bridge-url-input"]').fill('https://slow-bridge.example');
      await modal.locator('[data-region="table-name-input"]').fill('orders');
      await modal.locator('[data-region="sql-input"]').fill('SELECT * FROM orders LIMIT 100');
      await modal.locator('[data-action="confirm-mount-bridge"]').click();
      await modal.getByRole('button', { name: 'Cancel' }).click();
      await expect
        .poll(() =>
          page.evaluate(
            () => (window as Window & { __bridgeRequestAborted?: boolean }).__bridgeRequestAborted,
          ),
        )
        .toBe(true);
    } finally {
      await server.close();
    }
  });
});
