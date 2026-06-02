// W6.2 — Presentation mode (?present=1). Hex app-publish pattern.
//
// The CSS rules under `.app-present-mode` hide a lot of surface
// (sources + schema sidebars, notebook toolbar, cell-add row, every
// per-cell .cell-head, SQL/cohort/assertion cells entirely). All of
// that lives in shell.css.ts as static rules — easy to break with a
// stray selector change. This spec pins the observable behaviour so
// regressions surface as test failures, not screenshot diffs.

import { type Page, expect, test } from '@playwright/test';
import { startStaticServer } from './fixtures/server.ts';

async function bootAndMount(page: Page, present: boolean): Promise<void> {
  const server = await startStaticServer();
  const url = `${server.url}/index.html?offline=1${present ? '&present=1' : ''}`;
  await page.goto(url);
  await page.waitForSelector('.shell-header', { timeout: 5_000 });
  await page.waitForFunction(
    () => document.querySelector('[data-region="engine-status"]')?.textContent === 'Engine: ready',
    null,
    { timeout: 90_000 },
  );
  // Mount the example bundle so there's a notebook to look at.
  await page.click('[data-action="browse-examples"]');
  await page.waitForFunction(() => document.querySelectorAll('.source-row').length > 0, null, {
    timeout: 30_000,
  });
  // Give classification a moment.
  await page.waitForTimeout(1_500);
}

test.describe('W6.2 — presentation mode', () => {
  test('?present=1 adds the app-present-mode class on boot', async ({ page }) => {
    await bootAndMount(page, true);
    await expect
      .poll(() =>
        page.evaluate(() => document.getElementById('app')?.classList.contains('app-present-mode')),
      )
      .toBe(true);
  });

  test('?present=1 hides sources + schema sidebars', async ({ page }) => {
    await bootAndMount(page, true);
    const hiddenCounts = await page.evaluate(() => {
      const isHidden = (el: Element | null) =>
        !el || window.getComputedStyle(el).display === 'none';
      return {
        sources: isHidden(document.querySelector('aside[aria-label="Sources"]')),
        schema: isHidden(document.querySelector('aside[aria-label="Schema"]')),
      };
    });
    expect(hiddenCounts.sources).toBe(true);
    expect(hiddenCounts.schema).toBe(true);
  });

  test('?present=1 hides the notebook toolbar + cell-add row', async ({ page }) => {
    await bootAndMount(page, true);
    // Instantiate a template so the notebook has cells (toolbar + add-row
    // only render once a notebook is present).
    await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.template-card'));
      const card = cards.find(
        (c) => c.querySelector('strong')?.textContent === 'Vendor concentration',
      );
      const btn = card?.querySelector('button');
      if (btn instanceof HTMLElement) btn.click();
    });
    await page.waitForTimeout(800);
    const checks = await page.evaluate(() => {
      const isHidden = (el: Element | null) =>
        !el || window.getComputedStyle(el).display === 'none';
      return {
        toolbar: isHidden(document.querySelector('.notebook-toolbar')),
        addRow: isHidden(document.querySelector('.cell-add-row')),
      };
    });
    expect(checks.toolbar).toBe(true);
    expect(checks.addRow).toBe(true);
  });

  test('?present=1 hides SQL cells but keeps markdown + chart visible', async ({ page }) => {
    await bootAndMount(page, true);
    // Vendor concentration ships markdown + SQL + chart cells.
    await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.template-card'));
      const card = cards.find(
        (c) => c.querySelector('strong')?.textContent === 'Vendor concentration',
      );
      const btn = card?.querySelector('button');
      if (btn instanceof HTMLElement) btn.click();
    });
    await page.waitForTimeout(800);
    const visibility = await page.evaluate(() => {
      const isHidden = (el: Element) => window.getComputedStyle(el).display === 'none';
      const sqlCells = Array.from(
        document.querySelectorAll<HTMLElement>('.cell[data-cell-kind="sql"]'),
      );
      const mdCells = Array.from(
        document.querySelectorAll<HTMLElement>('.cell[data-cell-kind="markdown"]'),
      );
      return {
        sqlAllHidden: sqlCells.length > 0 && sqlCells.every(isHidden),
        mdAnyVisible: mdCells.length > 0 && mdCells.some((c) => !isHidden(c)),
      };
    });
    expect(visibility.sqlAllHidden).toBe(true);
    expect(visibility.mdAnyVisible).toBe(true);
  });

  test('?present=1 hides per-cell .cell-head editor chrome', async ({ page }) => {
    await bootAndMount(page, true);
    await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.template-card'));
      const card = cards.find(
        (c) => c.querySelector('strong')?.textContent === 'Vendor concentration',
      );
      const btn = card?.querySelector('button');
      if (btn instanceof HTMLElement) btn.click();
    });
    await page.waitForTimeout(800);
    const headHidden = await page.evaluate(() => {
      const heads = Array.from(document.querySelectorAll<HTMLElement>('.cell .cell-head'));
      if (heads.length === 0) return false;
      return heads.every((h) => window.getComputedStyle(h).display === 'none');
    });
    expect(headHidden).toBe(true);
  });

  test('without ?present, the app-present-mode class is NOT added (default workbench)', async ({
    page,
  }) => {
    await bootAndMount(page, false);
    const checks = await page.evaluate(() => {
      const isHidden = (el: Element | null) =>
        !el || window.getComputedStyle(el).display === 'none';
      return {
        hasPresentClass: document.getElementById('app')?.classList.contains('app-present-mode'),
        sourcesVisible: !isHidden(document.querySelector('aside[aria-label="Sources"]')),
        schemaVisible: !isHidden(document.querySelector('aside[aria-label="Schema"]')),
      };
    });
    expect(checks.hasPresentClass).toBe(false);
    expect(checks.sourcesVisible).toBe(true);
    expect(checks.schemaVisible).toBe(true);
  });

  test('Exit-presentation pill is only visible in presentation mode', async ({ page }) => {
    // Default mode: present-exit button is hidden by CSS.
    await bootAndMount(page, false);
    const inDefault = await page.evaluate(() => {
      const btn = document.querySelector('[data-action="exit-presentation"]');
      return btn ? window.getComputedStyle(btn).display === 'none' : 'missing';
    });
    expect(inDefault).toBe(true);
  });

  test('Exit-presentation button strips ?present from URL', async ({ page }) => {
    await bootAndMount(page, true);
    // The button uses location.replace(); just check the navigation
    // happens and the resulting URL has no ?present.
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.click('[data-action="exit-presentation"]'),
    ]);
    expect(new URL(page.url()).searchParams.has('present')).toBe(false);
  });
});
