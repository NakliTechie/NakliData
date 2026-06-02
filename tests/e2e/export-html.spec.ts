// W6.3 — Static-HTML export sink. Evidence Dev pattern.
//
// Clicking "Export HTML" in the header should serialize the live
// notebook DOM into a single self-contained .html file with markdown
// previews, chart SVGs, SQL <details> blocks, and the privacy
// footer. The FSA mocks capture the bytes written so we can assert
// on them.

import { type Page, expect, test } from '@playwright/test';
import { installFsaMocks } from './fixtures/fsa-mocks.ts';
import { startStaticServer } from './fixtures/server.ts';

async function bootWithSources(page: Page): Promise<void> {
  const server = await startStaticServer();
  await page.goto(`${server.url}/index.html?offline=1`);
  await page.waitForSelector('.shell-header', { timeout: 5_000 });
  await page.waitForFunction(
    () => document.querySelector('[data-region="engine-status"]')?.textContent === 'Engine: ready',
    null,
    { timeout: 90_000 },
  );
  await page.click('[data-action="browse-examples"]');
  await page.waitForFunction(() => document.querySelectorAll('.source-row').length > 0, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(1_500);
}

test.describe('W6.3 — static-HTML export', () => {
  test('export with no mounts shows a toast and does NOT write a file', async ({ page }) => {
    const server = await startStaticServer();
    const fsa = await installFsaMocks(page);
    await page.goto(`${server.url}/index.html?offline=1`);
    await page.waitForSelector('.shell-header', { timeout: 5_000 });
    await page.waitForFunction(
      () =>
        document.querySelector('[data-region="engine-status"]')?.textContent === 'Engine: ready',
      null,
      { timeout: 90_000 },
    );
    await page.click('[data-action="export-html"]');
    await page.waitForTimeout(500);
    const writes = await fsa.readAllWrites();
    expect(writes).toEqual([]);
  });

  test('export after running a template writes a valid HTML doc with chart SVG + result table', async ({
    page,
  }) => {
    const fsa = await installFsaMocks(page);
    await bootWithSources(page);

    // Instantiate Vendor concentration (md + sql + chart).
    await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.template-card'));
      const card = cards.find(
        (c) => c.querySelector('strong')?.textContent === 'Vendor concentration',
      );
      const btn = card?.querySelector('button');
      if (btn instanceof HTMLElement) btn.click();
    });
    await page.waitForTimeout(800);
    // Run all so the chart has a result + SVG.
    await page.click('[data-nb-action="run-all"]');
    await page.waitForTimeout(4_000);

    await page.click('[data-action="export-html"]');
    await page.waitForTimeout(800);

    const latest = await fsa.readLatestWriteText();
    expect(latest).not.toBeNull();
    if (!latest) return;
    expect(latest.name).toMatch(/\.html$/);
    const html = latest.text;
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<svg'); // chart SVG
    expect(html).toContain('result-table'); // SQL result preview
    expect(html).toContain('<details>'); // SQL details block
    expect(html).toContain('Your data never left'); // privacy footer
    expect(html).toContain('<title>'); // valid title element
  });

  test('exported HTML embeds the markdown preview inline (no engine, no JS)', async ({ page }) => {
    const fsa = await installFsaMocks(page);
    await bootWithSources(page);

    // Add a markdown cell with a heading so we know what to look for.
    await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.template-card'));
      const card = cards.find(
        (c) => c.querySelector('strong')?.textContent === 'Vendor concentration',
      );
      const btn = card?.querySelector('button');
      if (btn instanceof HTMLElement) btn.click();
    });
    await page.waitForTimeout(800);

    await page.click('[data-action="export-html"]');
    await page.waitForTimeout(800);

    const latest = await fsa.readLatestWriteText();
    expect(latest).not.toBeNull();
    if (!latest) return;
    // The Vendor-concentration template ships a markdown heading
    // "Vendor concentration" — assert it survived to the export.
    expect(latest.text.toLowerCase()).toContain('vendor concentration');
    // No <script> tags — the export is JS-free.
    expect(latest.text).not.toContain('<script');
  });
});
