import { type Page, expect } from '@playwright/test';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export async function expectModalTabWrap(page: Page, rootSelector: string): Promise<void> {
  const count = await page.evaluate(
    ({ rootSelector, focusableSelector }) => {
      const root = document.querySelector<HTMLElement>(rootSelector);
      if (!root) throw new Error(`Modal root not found: ${rootSelector}`);
      const elements = [...root.querySelectorAll<HTMLElement>(focusableSelector)].filter(
        (element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            rect.width > 0 &&
            rect.height > 0
          );
        },
      );
      elements[0]?.setAttribute('data-test-tab-boundary', 'first');
      elements.at(-1)?.setAttribute('data-test-tab-boundary', 'last');
      elements[0]?.focus();
      return elements.length;
    },
    { rootSelector, focusableSelector: FOCUSABLE_SELECTOR },
  );
  expect(count).toBeGreaterThan(1);

  await page.keyboard.press('Shift+Tab');
  await expect(page.locator(`${rootSelector} [data-test-tab-boundary="last"]`)).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(page.locator(`${rootSelector} [data-test-tab-boundary="first"]`)).toBeFocused();
}
