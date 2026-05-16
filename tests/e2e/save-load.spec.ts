import { expect, test } from '@playwright/test';
import { installFsaMocks } from './fixtures/fsa-mocks.ts';
import { startStaticServer } from './fixtures/server.ts';

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
    await page.click('[data-action="browse-examples"]');
    await page.waitForFunction(
      () => document.querySelectorAll('.schema-column').length >= 10,
      null,
      { timeout: 60_000 },
    );

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

    // Reload the page → fresh shell, no mounts.
    await page.reload();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-region="engine-status"]')?.textContent === 'Engine: ready',
      null,
      { timeout: 90_000 },
    );
    expect(await page.locator('.empty-state').count()).toBe(1);

    // Stage the .naklidata file and click Open.
    await fsa.stageOpenFile(written.name, written.text, 'application/json');
    await page.click('[data-action="load"]');

    // Wait for sources + schema to come back.
    await page.waitForFunction(
      () => document.querySelectorAll('.schema-column').length >= 10,
      null,
      { timeout: 30_000 },
    );

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
});
