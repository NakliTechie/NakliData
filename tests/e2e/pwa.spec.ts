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

test.describe('PWA installability', () => {
  test('manifest is linked and fetchable; declares standalone display + maskable icon', async ({
    browser,
  }) => {
    const server = await startStaticServer();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${server.url}/index.html?offline=1`);
    await page.waitForSelector('.shell-header', { timeout: 5_000 });

    const manifestHref = await page.evaluate(() =>
      document.querySelector('link[rel="manifest"]')?.getAttribute('href'),
    );
    expect(manifestHref).toBe('./manifest.webmanifest');

    const themeColor = await page.evaluate(() =>
      document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
    );
    expect(themeColor).toBe('#B5371C');

    // Fetch + parse the manifest with the right Accept header.
    const resp = await page.request.get(`${server.url}/manifest.webmanifest`);
    expect(resp.status()).toBe(200);
    expect(resp.headers()['content-type']).toMatch(/application\/manifest\+json/);
    const manifest = (await resp.json()) as {
      name: string;
      start_url: string;
      display: string;
      icons: Array<{ src: string; purpose: string }>;
    };
    expect(manifest.name).toBe('NakliData');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('./');
    expect(manifest.icons.length).toBeGreaterThanOrEqual(1);
    // At least one icon should advertise the maskable purpose so installed
    // OS surfaces can crop the icon without losing the brand mark.
    const hasMaskable = manifest.icons.some((i) => /maskable/.test(i.purpose));
    expect(hasMaskable).toBe(true);

    await context.close();
    await server.close();
  });

  test('service worker registers, precaches the shell, and serves the cached shell offline', async ({
    browser,
  }) => {
    const server = await startStaticServer();
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${server.url}/index.html?offline=1`);
    await waitForEngineReady(page);

    // SW registration happens on window 'load'. Wait until the SW reports
    // an active controller for this page.
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
      timeout: 10_000,
    });

    // Cache should contain the shell + manifest + at least one chunk.
    const cachedPaths = await page.evaluate(async () => {
      const cacheNames = await caches.keys();
      const target = cacheNames.find((n) => n.startsWith('naklidata-shell-'));
      if (!target) return null;
      const cache = await caches.open(target);
      const keys = await cache.keys();
      return keys.map((r) => new URL(r.url).pathname);
    });
    if (cachedPaths === null) throw new Error('naklidata-shell cache not found');
    expect(cachedPaths).toEqual(expect.arrayContaining(['/index.html']));
    expect(cachedPaths).toEqual(expect.arrayContaining(['/manifest.webmanifest']));
    expect(cachedPaths.some((p) => p.startsWith('/chunks/'))).toBe(true);

    // Now go offline (route everything to abort) and reload. The SW's
    // navigation handler should fall back to the cached index.html so the
    // shell still mounts. We don't expect engine to boot offline (CDN
    // unreachable + the test passed `?offline=1` for offline path, but
    // that needs DuckDB-fallback bytes which weren't precached). What we
    // verify here is the *shell* loads, not the engine.
    await context.setOffline(true);
    await page.reload();
    await page.waitForSelector('.shell-header', { timeout: 10_000 });
    const brand = await page.textContent('.brand');
    expect(brand).toContain('NakliData');

    await context.close();
    await server.close();
  });

  test('service worker caches only public static responses', async ({ browser }) => {
    const server = await startStaticServer();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${server.url}/index.html?offline=1`);
    await waitForEngineReady(page);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
      timeout: 10_000,
    });

    const cached = await page.evaluate(async () => {
      const probes = {
        allowed: '/icon.svg?e2e-allowed=1',
        api: '/api/private.json',
        authorized: '/icon.svg?e2e-authorized=1',
        credentialed: '/icon.svg?e2e-credentialed=1',
        requestNoStore: '/icon.svg?e2e-request-no-store=1',
        privateResponse: '/icon.svg?e2e-private=1&__private=1',
        partialResponse: '/icon.svg?e2e-partial=1&__partial=1',
        sensitiveQuery: '/icon.svg?access_token=e2e-secret',
      };
      await fetch(probes.allowed);
      await fetch(probes.api);
      await fetch(probes.authorized, { headers: { authorization: 'Bearer e2e' } });
      await fetch(probes.credentialed, { credentials: 'include' });
      await fetch(probes.requestNoStore, { cache: 'no-store' });
      await fetch(probes.privateResponse);
      await fetch(probes.partialResponse);
      await fetch(probes.sensitiveQuery);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const shellName = (await caches.keys()).find((name) => name.startsWith('naklidata-shell-'));
      if (!shellName) throw new Error('shell cache missing');
      const cache = await caches.open(shellName);
      return Object.fromEntries(
        await Promise.all(
          Object.entries(probes).map(async ([name, path]) => [name, !!(await cache.match(path))]),
        ),
      );
    });

    expect(cached.allowed).toBe(true);
    for (const [name, value] of Object.entries(cached)) {
      if (name !== 'allowed') expect(value, `${name} must bypass Cache Storage`).toBe(false);
    }

    await context.close();
    await server.close();
  });
});
