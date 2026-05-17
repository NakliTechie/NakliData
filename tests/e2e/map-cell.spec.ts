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

test.describe('map cell (Theme 2 wave 4)', () => {
  test('+ Map button adds a map cell that renders GeoJSON points on a MapLibre canvas', async ({
    browser,
  }) => {
    const server = await startStaticServer();
    const context = await browser.newContext();
    const page = await context.newPage();

    const loaded: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/chunks/maplibre-map.js')) loaded.push(req.url());
    });
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto(`${server.url}/index.html?offline=1`);
    await waitForEngineReady(page);

    // Mount example data so the notebook seeds a SQL cell; we'll overwrite
    // its query with a literal-GeoJSON SELECT.
    await page.click('[data-action="browse-examples"]');
    await page.waitForFunction(
      () => document.querySelectorAll('.schema-column').length >= 10,
      null,
      { timeout: 60_000 },
    );

    // Write SQL that produces two GeoJSON Point rows + a name property.
    // Strings are fine — the map cell parses with JSON.parse.
    await page.evaluate(() => {
      const sqlCell = document.querySelector<HTMLElement>('.cell[data-cell-kind="sql"]');
      if (!sqlCell) throw new Error('SQL cell not found');
      const code = `SELECT '{"type":"Point","coordinates":[77.59,12.97]}' AS geometry, 'Bengaluru' AS name
UNION ALL SELECT '{"type":"Point","coordinates":[72.83,18.94]}', 'Mumbai'
UNION ALL SELECT '{"type":"Point","coordinates":[88.36,22.57]}', 'Kolkata'`;
      const ta = sqlCell.querySelector<HTMLTextAreaElement>('textarea');
      if (ta) {
        ta.value = code;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      const cm = sqlCell.querySelector<HTMLElement>('.cm-content');
      if (cm) {
        cm.textContent = code;
        cm.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      throw new Error('No editor surface found');
    });
    await page.click('[data-nb-action="run-all"]');
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.cell[data-cell-kind="sql"] .result-table tbody tr').length > 0,
      null,
      { timeout: 30_000 },
    );

    // Add a map cell.
    await page.click('[data-nb-action="add-map"]');
    await page.waitForSelector('.cell[data-cell-kind="map"]', { timeout: 5_000 });

    // Initial empty state.
    const initial = await page.textContent('.cell[data-cell-kind="map"] .cell-output-empty');
    expect(initial).toContain('Pick a SQL cell');

    // Pick the upstream SQL cell.
    const sqlId = await page.evaluate(() => {
      const sql = document.querySelector<HTMLElement>('.cell[data-cell-kind="sql"]');
      return sql?.dataset.cellId ?? null;
    });
    expect(sqlId).not.toBeNull();
    await page.evaluate((id) => {
      const sel = document.querySelector<HTMLSelectElement>(
        '.cell[data-cell-kind="map"] [data-action="map-input"]',
      );
      if (!sel) throw new Error('map-input select not found');
      sel.value = id ?? '';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, sqlId);
    await page.waitForSelector('.cell[data-cell-kind="map"] [data-action="map-geometry"]', {
      timeout: 5_000,
    });

    // Pick the geometry column.
    await page.evaluate(() => {
      const sel = document.querySelector<HTMLSelectElement>(
        '.cell[data-cell-kind="map"] [data-action="map-geometry"]',
      );
      if (!sel) throw new Error('map-geometry select not found');
      sel.value = 'geometry';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // MapLibre chunk should fetch on demand.
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('.cell[data-cell-kind="map"] canvas')).length > 0,
      null,
      { timeout: 15_000 },
    );
    expect(loaded.length).toBeGreaterThanOrEqual(1);
    // MapLibre's render canvas is inside .maplibregl-canvas-container.
    const hasMapCanvas = await page.evaluate(
      () =>
        document.querySelector(
          '.cell[data-cell-kind="map"] .maplibregl-canvas-container canvas, .cell[data-cell-kind="map"] canvas',
        ) !== null,
    );
    expect(hasMapCanvas).toBe(true);
    expect(pageErrors).toEqual([]);

    await context.close();
    await server.close();
  });

  test('map cell with no valid geometries shows a friendly message', async ({ browser }) => {
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

    // SQL with a "geometry" column that isn't valid GeoJSON.
    await page.evaluate(() => {
      const sqlCell = document.querySelector<HTMLElement>('.cell[data-cell-kind="sql"]');
      if (!sqlCell) throw new Error('SQL cell not found');
      const code = "SELECT 'not-a-geometry' AS geometry, 'A' AS name";
      const ta = sqlCell.querySelector<HTMLTextAreaElement>('textarea');
      const cm = sqlCell.querySelector<HTMLElement>('.cm-content');
      if (ta) {
        ta.value = code;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (cm) {
        cm.textContent = code;
        cm.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await page.click('[data-nb-action="run-all"]');
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.cell[data-cell-kind="sql"] .result-table tbody tr').length > 0,
      null,
      { timeout: 30_000 },
    );
    await page.click('[data-nb-action="add-map"]');
    await page.waitForSelector('.cell[data-cell-kind="map"]', { timeout: 5_000 });

    const sqlId = await page.evaluate(
      () => document.querySelector<HTMLElement>('.cell[data-cell-kind="sql"]')?.dataset.cellId,
    );
    await page.evaluate((id) => {
      const sel = document.querySelector<HTMLSelectElement>(
        '.cell[data-cell-kind="map"] [data-action="map-input"]',
      );
      if (sel) {
        sel.value = id ?? '';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, sqlId);
    await page.waitForSelector('.cell[data-cell-kind="map"] [data-action="map-geometry"]', {
      timeout: 5_000,
    });
    await page.evaluate(() => {
      const sel = document.querySelector<HTMLSelectElement>(
        '.cell[data-cell-kind="map"] [data-action="map-geometry"]',
      );
      if (sel) {
        sel.value = 'geometry';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    // Should show a friendly "No valid GeoJSON…" message — and not crash.
    await page.waitForFunction(
      () => {
        const t = document.querySelector('.cell[data-cell-kind="map"] .cell-output-empty');
        return t !== null && /No valid GeoJSON/.test(t.textContent ?? '');
      },
      null,
      { timeout: 5_000 },
    );

    await context.close();
    await server.close();
  });
});
