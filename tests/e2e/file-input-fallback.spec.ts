import { expect, test } from '@playwright/test';
import { startStaticServer } from './fixtures/server.ts';

test('core WebAssembly boots without native File System Access', async ({ page }) => {
  const server = await startStaticServer();
  try {
    await page.addInitScript(() => {
      localStorage.setItem('naklidata.welcomed', '1');
      Reflect.deleteProperty(window, 'showOpenFilePicker');
      Reflect.deleteProperty(window, 'showSaveFilePicker');
    });
    await page.goto(`${server.url}/index.html?offline=1`);

    await page.waitForFunction(
      () =>
        document.querySelector('[data-region="engine-status"]')?.textContent === 'Engine: ready',
      null,
      { timeout: 90_000 },
    );
    await expect(page.getByText("NakliData isn't supported here yet")).toHaveCount(0);

    const chooser = page.waitForEvent('filechooser');
    await page.click('[data-action="mount-file"]');
    const fileChooser = await chooser;
    await fileChooser.setFiles({
      name: 'firefox-fallback.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('id,value\n1,ok\n'),
    });
    await expect(page.getByText('firefox-fallback.csv', { exact: true })).toBeVisible({
      timeout: 30_000,
    });
  } finally {
    await server.close();
  }
});
