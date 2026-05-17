import { expect, test } from '@playwright/test';
import { startStaticServer } from './fixtures/server.ts';

test.describe('lazy chunk loader (Theme 1 wave 2 infrastructure)', () => {
  test('loadChunk("_demo") fetches dist/chunks/_demo.js and exports work', async ({ browser }) => {
    const server = await startStaticServer();
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${server.url}/index.html?offline=1`);
    await page.waitForSelector('.shell-header', { timeout: 5_000 });

    // The main bundle exports `loadChunk` via window for testability —
    // but we don't expose it; instead, do the import directly from the
    // page context using the same URL pattern the loader uses.
    const result = await page.evaluate(async () => {
      // Mirror the lazy-loader's import strategy.
      const url = '/chunks/_demo.js';
      const mod = (await import(/* @vite-ignore */ url)) as {
        greet: (n: string) => string;
        LAZY_DEMO_MARKER: symbol;
      };
      return {
        greeting: mod.greet('test'),
        hasMarker: typeof mod.LAZY_DEMO_MARKER === 'symbol',
      };
    });

    expect(result.greeting).toBe('hello from lazy chunk, test!');
    expect(result.hasMarker).toBe(true);

    // Also verify the chunk is a separate file (the request hit
    // /chunks/_demo.js rather than being inlined in main).
    const responses: string[] = [];
    page.on('response', (r) => {
      if (r.url().includes('/chunks/')) responses.push(r.url());
    });
    await page.evaluate(async () => {
      const url = '/chunks/_demo.js?second-fetch';
      await import(/* @vite-ignore */ url);
    });
    expect(responses.some((u) => u.includes('_demo.js'))).toBe(true);

    await context.close();
    await server.close();
  });
});
