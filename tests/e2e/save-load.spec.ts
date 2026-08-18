import { type Page, expect, test } from '@playwright/test';
import { waitForExampleClassification } from './fixtures/examples.ts';
import { installFsaMocks } from './fixtures/fsa-mocks.ts';
import { startStaticServer } from './fixtures/server.ts';

async function dismissWelcomeIfPresent(page: Page): Promise<void> {
  // The splash is scheduled immediately after engine-ready, so give it a brief
  // chance to mount instead of racing the empty-state click beneath it.
  await page
    .locator('.help-overlay')
    .waitFor({ state: 'visible', timeout: 3_000 })
    .catch(() => {});
  const close = page.locator('.help-overlay .schema-graph-close');
  if (await close.isVisible()) await close.click();
}

test.describe('save / load round-trip', () => {
  test('Cmd+S writes a valid .naklidata file; loading restores sources + assignments + cells', async ({
    page,
  }) => {
    const server = await startStaticServer();
    const fsa = await installFsaMocks(page);
    await page.goto(`${server.url}/index.html?offline=1`);

    // Boot: shell + engine + example bundle + classification.
    await page.waitForSelector('.shell-header', { timeout: 5_000 });
    await page.waitForFunction(
      () =>
        document.querySelector('[data-region="engine-status"]')?.textContent === 'Engine: ready',
      null,
      { timeout: 90_000 },
    );
    await dismissWelcomeIfPresent(page);
    await page.click('[data-action="browse-examples"]');
    await waitForExampleClassification(page);

    // Snapshot the current state we expect to round-trip.
    const before = await page.evaluate(() => {
      const cols = Array.from(document.querySelectorAll('.schema-column')).map((c) => ({
        col: (c as HTMLElement).dataset.column,
        type: (c as HTMLElement).dataset.assignedType,
      }));
      const sources = Array.from(document.querySelectorAll('.source-card strong')).map(
        (n) => n.textContent ?? '',
      );
      return { cols, sources };
    });
    expect(before.cols.length).toBeGreaterThanOrEqual(10);
    expect(before.sources.length).toBeGreaterThanOrEqual(1);

    // Save: Click the Save button.
    await page.click('[data-action="save"]');
    // The save handler is async. Poll until we see a write.
    await expect
      .poll(async () => (await fsa.readLatestWriteText())?.name ?? null)
      .toContain('.naklidata');

    const written = await fsa.readLatestWriteText();
    if (!written) throw new Error('expected a write');
    const parsed = JSON.parse(written.text);
    expect(parsed.format).toBe('naklidata');
    expect(parsed.version).toBe('1.0');
    expect(Array.isArray(parsed.sources)).toBe(true);
    expect(parsed.sources.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(parsed.assignments)).toBe(true);
    expect(parsed.assignments.length).toBeGreaterThanOrEqual(10);

    // Reload the page. We deliberately leave the IDB snapshot in place
    // so auto-restore fires concurrently with the explicit Load below —
    // both call applyLoadedFile, and serialisation is the contract this
    // test exercises (regression guard for the v1.1 race that produced
    // 4 source cards instead of 2).
    await page.reload();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-region="engine-status"]')?.textContent === 'Engine: ready',
      null,
      { timeout: 90_000 },
    );

    // Stage the .naklidata file and click Open immediately, without
    // waiting for auto-restore to settle — the mutex inside
    // applyLoadedFile must queue the Load behind the in-flight restore.
    await fsa.stageOpenFile(written.name, written.text, 'application/json');
    await page.click('[data-action="load"]');

    // Wait for sources + schema to come back, including any re-classification
    // pass on remounted tables (avoids racing the access-log columns).
    await waitForExampleClassification(page);

    const after = await page.evaluate(() => {
      const cols = Array.from(document.querySelectorAll('.schema-column')).map((c) => ({
        col: (c as HTMLElement).dataset.column,
        type: (c as HTMLElement).dataset.assignedType,
      }));
      const sources = Array.from(document.querySelectorAll('.source-card strong')).map(
        (n) => n.textContent ?? '',
      );
      return { cols, sources };
    });

    expect(after.sources).toEqual(before.sources);
    // Same column-type assignments restored — order-insensitive compare.
    const norm = (xs: typeof after.cols) =>
      xs
        .map((c) => `${c.col}:${c.type}`)
        .sort()
        .join('|');
    expect(norm(after.cols)).toBe(norm(before.cols));

    await server.close();
  });

  test('a malformed nested workbook leaves the live and autosaved workspace unchanged', async ({
    page,
  }) => {
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
    await dismissWelcomeIfPresent(page);
    await page.click('[data-action="browse-examples"]');
    await waitForExampleClassification(page);
    // Let the normal debounced autosave commit the healthy workspace.
    await page.waitForTimeout(500);

    const snapshot = () =>
      page.evaluate(() => ({
        sources: Array.from(document.querySelectorAll('.source-card strong')).map(
          (node) => node.textContent ?? '',
        ),
        columns: Array.from(document.querySelectorAll('.schema-column')).map((node) => ({
          name: (node as HTMLElement).dataset.column ?? '',
          type: (node as HTMLElement).dataset.assignedType ?? '',
        })),
        cells: Array.from(document.querySelectorAll('.cell[data-cell-id]')).map((node) => ({
          id: (node as HTMLElement).dataset.cellId ?? '',
          kind: (node as HTMLElement).dataset.cellKind ?? '',
        })),
      }));
    const before = await snapshot();

    const malformed = JSON.stringify({
      format: 'naklidata',
      version: '1.0',
      name: 'Must not replace the live workspace',
      sources: [],
      assignments: [],
      cells: [{ id: 'broken', kind: 'dashboard', columns: 2, items: { not: 'an array' } }],
      user_types: [],
      settings: { auto_accept_threshold: 0.9 },
    });
    await fsa.stageOpenFile('malformed.naklidata', malformed, 'application/json');
    await page.click('[data-action="load"]');
    await expect(page.locator('#naklidata-toast')).toContainText('Load failed');
    expect(await snapshot()).toEqual(before);

    // The rejected file must not leak an empty/partial state into the active
    // session snapshot through autosave.
    await page.waitForTimeout(500);
    await page.reload();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-region="engine-status"]')?.textContent === 'Engine: ready',
      null,
      { timeout: 90_000 },
    );
    await waitForExampleClassification(page);
    expect(await snapshot()).toEqual(before);

    await server.close();
  });
});
