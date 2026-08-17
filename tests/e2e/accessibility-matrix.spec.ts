import { expect, test } from '@playwright/test';
import { mountExamples } from './fixtures/examples.ts';
import { startStaticServer } from './fixtures/server.ts';

async function waitForEngine(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelector('[data-region="engine-status"]')?.textContent === 'Engine: ready',
    null,
    { timeout: 90_000 },
  );
}

test.describe('accessibility matrix', () => {
  test('critical controls meet compact target and token contrast floors', async ({ browser }) => {
    const server = await startStaticServer();
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(`${server.url}/index.html?offline=1`);
    await waitForEngine(page);
    await mountExamples(page);
    await page.waitForFunction(
      () => document.querySelectorAll('.schema-column').length >= 10,
      null,
      {
        timeout: 60_000,
      },
    );

    const audit = await page.evaluate(() => {
      const visible = (element: Element): element is HTMLElement => {
        if (!(element instanceof HTMLElement)) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      const targets = [
        ...document.querySelectorAll(
          'button, summary, select, input:not([type="hidden"]), textarea',
        ),
      ]
        .filter(visible)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            name:
              element.getAttribute('aria-label') ||
              element.getAttribute('title') ||
              element.textContent?.trim() ||
              element.tagName,
            width: Math.round(rect.width * 10) / 10,
            height: Math.round(rect.height * 10) / 10,
          };
        })
        .filter((target) => target.width < 24 || target.height < 24);

      const parse = (value: string): [number, number, number] => {
        const hex = value.trim().match(/^#([0-9a-f]{6})$/i)?.[1];
        if (hex) {
          return [
            Number.parseInt(hex.slice(0, 2), 16),
            Number.parseInt(hex.slice(2, 4), 16),
            Number.parseInt(hex.slice(4, 6), 16),
          ];
        }
        const match = value.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
        return [match[0] ?? 0, match[1] ?? 0, match[2] ?? 0];
      };
      const luminance = ([r, g, b]: [number, number, number]): number => {
        const values = [r, g, b].map((channel) => {
          const value = channel / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * (values[0] ?? 0) + 0.7152 * (values[1] ?? 0) + 0.0722 * (values[2] ?? 0);
      };
      const ratio = (a: string, b: string): number => {
        const values = [luminance(parse(a)), luminance(parse(b))].sort(
          (left, right) => right - left,
        );
        return ((values[0] ?? 0) + 0.05) / ((values[1] ?? 0) + 0.05);
      };
      const root = getComputedStyle(document.documentElement);
      const surface = root.getPropertyValue('--surface');
      return {
        targets,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        contrast: {
          text: ratio(root.getPropertyValue('--text'), root.getPropertyValue('--bg')),
          muted: ratio(root.getPropertyValue('--text-muted'), surface),
          border: ratio(root.getPropertyValue('--border'), surface),
          focus: ratio(root.getPropertyValue('--focus'), surface),
        },
      };
    });

    expect(audit.targets).toEqual([]);
    expect(audit.reducedMotion).toBe(true);
    expect(audit.contrast.text).toBeGreaterThanOrEqual(4.5);
    expect(audit.contrast.muted).toBeGreaterThanOrEqual(4.5);
    expect(audit.contrast.border).toBeGreaterThanOrEqual(3);
    expect(audit.contrast.focus).toBeGreaterThanOrEqual(3);
    await context.close();
    await server.close();
  });

  for (const width of [640, 320]) {
    test(`${(1280 / width) * 100}% zoom-equivalent viewport retains one-axis document flow`, async ({
      browser,
    }) => {
      const server = await startStaticServer();
      const context = await browser.newContext({ viewport: { width, height: 720 } });
      const page = await context.newPage();
      await page.goto(`${server.url}/index.html?offline=1`);
      await waitForEngine(page);
      const geometry = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
        mainVisible: Boolean(document.querySelector('main')),
      }));
      expect(geometry.mainVisible).toBe(true);
      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
      await context.close();
      await server.close();
    });
  }
});
