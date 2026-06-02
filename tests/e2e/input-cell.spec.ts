// W6.1 — Interactive-input cell. Observable viewof / Briefer pattern.
//
// The "+ Input" toolbar button adds a named cell whose value is
// inlined into downstream SQL via `@<name>` ref resolution. The
// in-process `inputAsSqlLiteral` is covered by tests/input-cell.test.ts;
// this spec covers the live wiring: that adding an input cell, editing
// its value, and running a downstream SQL cell against `@<name>`
// produces a query that respects the value.

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

test.describe('W6.1 — interactive-input cell', () => {
  test('+ Input toolbar button adds an input cell seeded with a unique name', async ({ page }) => {
    await bootWithSources(page);
    await page.click('[data-nb-action="add-input"]');
    await page.waitForTimeout(400);
    const result = await page.evaluate(() => {
      const cells = Array.from(
        document.querySelectorAll<HTMLElement>('.cell[data-cell-kind="input"]'),
      );
      const last = cells[cells.length - 1];
      const name = last?.querySelector<HTMLInputElement>('[data-region="cell-name"]')?.value ?? '';
      return { count: cells.length, name };
    });
    expect(result.count).toBeGreaterThanOrEqual(1);
    expect(result.name).toMatch(/^input_/); // seeded with input_<n>
  });

  test('changing the value triggers downstream SQL rewrite via @name ref', async ({ page }) => {
    await bootWithSources(page);
    // Add an input cell + name it "min_amt".
    await page.click('[data-nb-action="add-input"]');
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const cell = document.querySelector<HTMLElement>('.cell[data-cell-kind="input"]');
      if (!cell) return;
      const nameInput = cell.querySelector<HTMLInputElement>('[data-region="cell-name"]');
      if (nameInput) {
        nameInput.value = 'min_amt';
        nameInput.dispatchEvent(new Event('change'));
      }
      const typeSel = cell.querySelector<HTMLSelectElement>('[data-region="input-type"]');
      if (typeSel) {
        typeSel.value = 'number';
        typeSel.dispatchEvent(new Event('change'));
      }
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const cell = document.querySelector<HTMLElement>('.cell[data-cell-kind="input"]');
      const valueInput = cell?.querySelector<HTMLInputElement>(
        '[data-region="input-widget"] input',
      );
      if (valueInput) {
        valueInput.value = '5000';
        valueInput.dispatchEvent(new Event('change'));
      }
    });
    await page.waitForTimeout(300);

    // Add a SQL cell that references the input + type some SQL. The
    // editor may be either the initial textarea or a swapped-in CM6
    // contenteditable depending on whether the lazy chunk has loaded.
    // The click handler reads from the editor's closure-captured
    // currentDoc, so we need the input event to land BEFORE the click —
    // doing both inside one evaluate keeps them synchronous.
    await page.click('[data-nb-action="add-sql"]');
    await page.waitForTimeout(600);
    // Set the code first.
    await page.evaluate(() => {
      const cells = Array.from(
        document.querySelectorAll<HTMLElement>('.cell[data-cell-kind="sql"]'),
      );
      const last = cells[cells.length - 1];
      if (!last) return;
      const sql = 'SELECT @min_amt AS picked';
      const ta = last.querySelector<HTMLTextAreaElement>('textarea');
      if (ta) {
        ta.value = sql;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      const cm = last.querySelector<HTMLElement>('.cm-content');
      if (cm) {
        cm.textContent = sql;
        cm.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    // Give the change handler a tick to propagate cell.code via the
    // workbook subscriber chain.
    await page.waitForTimeout(400);
    // Now click Run on the (possibly re-rendered) last cell.
    await page.evaluate(() => {
      const cells = Array.from(
        document.querySelectorAll<HTMLElement>('.cell[data-cell-kind="sql"]'),
      );
      const last = cells[cells.length - 1];
      last?.querySelector<HTMLButtonElement>('[data-action="cell-run"]')?.click();
    });
    await page.waitForTimeout(2_500);

    // The result table should contain "5000" (the input value coerced
    // to a bare numeric and selected as the picked column).
    const detail = await page.evaluate(() => {
      const cells = Array.from(
        document.querySelectorAll<HTMLElement>('.cell[data-cell-kind="sql"]'),
      );
      const last = cells[cells.length - 1];
      return {
        resultText: last?.querySelector('.result-table')?.textContent ?? '',
        errored: last?.classList.contains('errored'),
        errorText: last?.querySelector('.cell-output-error')?.textContent ?? '',
        cellCode:
          last?.querySelector<HTMLTextAreaElement>('textarea')?.value ??
          last?.querySelector<HTMLElement>('.cm-content')?.textContent ??
          '',
      };
    });
    expect(detail.errored, `cell errored: ${detail.errorText}`).toBe(false);
    expect(detail.resultText, `code was: ${detail.cellCode}`).toContain('5000');
  });

  test('switching inputType to "select" reveals the comma-separated options editor', async ({
    page,
  }) => {
    await bootWithSources(page);
    await page.click('[data-nb-action="add-input"]');
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const cell = document.querySelector<HTMLElement>('.cell[data-cell-kind="input"]');
      const typeSel = cell?.querySelector<HTMLSelectElement>('[data-region="input-type"]');
      if (typeSel) {
        typeSel.value = 'select';
        typeSel.dispatchEvent(new Event('change'));
      }
    });
    await page.waitForTimeout(400);
    const checks = await page.evaluate(() => {
      const cell = document.querySelector<HTMLElement>('.cell[data-cell-kind="input"]');
      const widget = cell?.querySelector('[data-region="input-widget"]');
      const valueSelect = widget?.querySelector('select');
      const editor = widget?.querySelectorAll('input[type="text"]');
      return {
        hasSelect: !!valueSelect,
        editorCount: editor?.length ?? 0,
      };
    });
    expect(checks.hasSelect).toBe(true);
    expect(checks.editorCount).toBeGreaterThanOrEqual(1);
  });
});
