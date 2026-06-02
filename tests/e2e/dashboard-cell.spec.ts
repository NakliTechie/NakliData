// W6.4 — Dashboard layout cell. Superset / Power BI pattern.
//
// A dashboard cell holds a list of @-names; each name is resolved to a
// cell in the notebook, and its output (chart SVG, markdown preview,
// pivot table, map canvas) is re-rendered inside a CSS-grid slot with
// the editing chrome stripped. SQL/cohort/assertion/input/dashboard
// cells are not valid items (they're queries / params / containers,
// not presentation surfaces) — the dashboard renders a polite "only
// markdown / chart / pivot / map can be embedded" affordance.

import { type Page, expect, test } from '@playwright/test';
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

async function instantiateVendorConcentration(page: Page): Promise<void> {
  await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.template-card'));
    const card = cards.find(
      (c) => c.querySelector('strong')?.textContent === 'Vendor concentration',
    );
    const btn = card?.querySelector('button');
    if (btn instanceof HTMLElement) btn.click();
  });
  await page.waitForTimeout(800);
}

test.describe('W6.4 — dashboard layout cell', () => {
  test('+ Dashboard button adds a default 2-column dashboard with an empty-items affordance', async ({
    page,
  }) => {
    await bootWithSources(page);
    await page.click('[data-nb-action="add-dashboard"]');
    await page.waitForTimeout(400);
    const result = await page.evaluate(() => {
      const dash = document.querySelector<HTMLElement>('.cell[data-cell-kind="dashboard"]');
      if (!dash) return null;
      const grid = dash.querySelector<HTMLElement>('.dashboard-grid');
      const colsInput = dash.querySelector<HTMLInputElement>('[data-region="dashboard-cols"]');
      return {
        present: true,
        columns: colsInput?.value,
        gridCols: grid ? window.getComputedStyle(grid).gridTemplateColumns : '',
        affordanceText: grid?.textContent?.trim() ?? '',
      };
    });
    expect(result?.present).toBe(true);
    expect(result?.columns).toBe('2');
    // CSS grid resolves repeat(2, 1fr) to two equal columns.
    expect(result?.gridCols.split(' ').length).toBe(2);
    expect(result?.affordanceText.toLowerCase()).toContain('add cell names');
  });

  test('referencing markdown + chart cells by name renders preview + SVG in slots', async ({
    page,
  }) => {
    await bootWithSources(page);
    await instantiateVendorConcentration(page);
    // Name the markdown + chart cells (markdown + chart cells gained
    // name inputs in W6.4 specifically for this use).
    await page.evaluate(() => {
      for (const c of document.querySelectorAll<HTMLElement>('.cell')) {
        const kind = c.dataset.cellKind;
        const nm = c.querySelector<HTMLInputElement>('[data-region="cell-name"]');
        if (!nm) continue;
        if (kind === 'markdown') {
          nm.value = 'intro';
          nm.dispatchEvent(new Event('change'));
        }
        if (kind === 'chart') {
          nm.value = 'spend_chart';
          nm.dispatchEvent(new Event('change'));
        }
      }
    });
    await page.waitForTimeout(500);

    // Run all so the chart has a result + SVG to render.
    await page.click('[data-nb-action="run-all"]');
    await page.waitForTimeout(3_500);

    // Add a dashboard + list both names.
    await page.click('[data-nb-action="add-dashboard"]');
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const dash = document.querySelector<HTMLElement>('.cell[data-cell-kind="dashboard"]');
      const items = dash?.querySelector<HTMLInputElement>('[data-region="dashboard-items"]');
      if (items) {
        items.value = 'intro, spend_chart';
        items.dispatchEvent(new Event('change'));
      }
    });
    await page.waitForTimeout(1_500);

    const stats = await page.evaluate(() => {
      const dash = document.querySelector<HTMLElement>('.cell[data-cell-kind="dashboard"]');
      const grid = dash?.querySelector<HTMLElement>('.dashboard-grid');
      const slots = Array.from(grid?.querySelectorAll<HTMLElement>('.dashboard-slot') ?? []);
      return {
        slotCount: slots.length,
        hasMd: slots.some((s) => s.querySelector('.markdown-preview')),
        hasSvg: slots.some((s) => s.querySelector('svg')),
      };
    });
    expect(stats.slotCount).toBe(2);
    expect(stats.hasMd).toBe(true);
    expect(stats.hasSvg).toBe(true);
  });

  test('unknown @name renders a "no cell named X" affordance', async ({ page }) => {
    await bootWithSources(page);
    await page.click('[data-nb-action="add-dashboard"]');
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const dash = document.querySelector<HTMLElement>('.cell[data-cell-kind="dashboard"]');
      const items = dash?.querySelector<HTMLInputElement>('[data-region="dashboard-items"]');
      if (items) {
        items.value = 'does_not_exist';
        items.dispatchEvent(new Event('change'));
      }
    });
    await page.waitForTimeout(800);
    const slotText = await page.evaluate(() => {
      const slot = document.querySelector('.cell[data-cell-kind="dashboard"] .dashboard-slot');
      return slot?.textContent ?? '';
    });
    expect(slotText.toLowerCase()).toContain('no cell named');
    expect(slotText).toContain('does_not_exist');
  });

  test('referencing a SQL cell by name shows "only markdown / chart / pivot / map" affordance', async ({
    page,
  }) => {
    await bootWithSources(page);
    await instantiateVendorConcentration(page);
    // Vendor concentration emits a named SQL cell ("vendor_spend" per
    // src/ui/templates/templates.ts). Reference it from a dashboard —
    // dashboards refuse to embed SQL cells.
    await page.click('[data-nb-action="add-dashboard"]');
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const dash = document.querySelector<HTMLElement>('.cell[data-cell-kind="dashboard"]');
      const items = dash?.querySelector<HTMLInputElement>('[data-region="dashboard-items"]');
      if (items) {
        items.value = 'vendor_spend';
        items.dispatchEvent(new Event('change'));
      }
    });
    await page.waitForTimeout(800);
    const slotText = await page.evaluate(() => {
      const slot = document.querySelector('.cell[data-cell-kind="dashboard"] .dashboard-slot');
      return slot?.textContent ?? '';
    });
    expect(slotText.toLowerCase()).toContain('only markdown');
  });

  test('changing the columns input from 2 → 3 updates the grid-template-columns', async ({
    page,
  }) => {
    await bootWithSources(page);
    await page.click('[data-nb-action="add-dashboard"]');
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const dash = document.querySelector<HTMLElement>('.cell[data-cell-kind="dashboard"]');
      const colsInput = dash?.querySelector<HTMLInputElement>('[data-region="dashboard-cols"]');
      if (colsInput) {
        colsInput.value = '3';
        colsInput.dispatchEvent(new Event('change'));
      }
    });
    await page.waitForTimeout(600);
    const gridCols = await page.evaluate(() => {
      const grid = document.querySelector<HTMLElement>(
        '.cell[data-cell-kind="dashboard"] .dashboard-grid',
      );
      return grid ? window.getComputedStyle(grid).gridTemplateColumns : '';
    });
    expect(gridCols.split(' ').length).toBe(3);
  });
});
