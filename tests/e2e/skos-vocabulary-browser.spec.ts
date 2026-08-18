import { expect, test } from '@playwright/test';
import { startStaticServer } from './fixtures/server.ts';

test('SKOS vocabulary browser filters and returns explicit accepted proposals', async ({
  page,
}) => {
  const server = await startStaticServer();
  try {
    await page.goto(`${server.url}/index.html?offline=1`);
    await page.getByRole('main').waitFor();
    await page.evaluate(async () => {
      const focusOwner = document.createElement('button');
      focusOwner.id = 'skos-focus-owner';
      focusOwner.textContent = 'Open vocabulary';
      document.body.append(focusOwner);
      focusOwner.focus();
      const url = new URL('./chunks/standards-skos.js', document.baseURI).href;
      const module = (await import(url)) as typeof import('../../src/lazy/standards-skos.ts');
      const imported = module.importSkosTurtle(
        `
          @prefix skos: <http://www.w3.org/2004/02/skos/core#> .
          @prefix ex: <https://example.test/vocab/> .
          ex:scheme a skos:ConceptScheme; skos:prefLabel "Finance"@en .
          ex:vendor a skos:Concept; skos:inScheme ex:scheme;
            skos:prefLabel "Vendor"@en; skos:altLabel "Supplier"@en .
          ex:amount a skos:Concept; skos:inScheme ex:scheme;
            skos:prefLabel "Amount"@en .
        `,
        'https://example.test/vocab/',
      );
      window.__skosAccepted = null;
      module.openSkosVocabularyBrowser(imported, {
        onAccept: (accepted) => {
          window.__skosAccepted = accepted;
        },
      });
    });

    const dialog = page.getByRole('dialog', { name: 'Review business vocabulary' });
    await expect(dialog).toBeVisible();
    const search = page.getByRole('searchbox', { name: 'Search concepts and aliases' });
    await expect(search).toBeFocused();
    await search.fill('supplier');
    await expect(page.getByLabel('Select Vendor')).toBeVisible();
    await expect(page.getByLabel('Select Amount')).toHaveCount(0);
    await page.getByLabel('Select Vendor').check();
    await expect(page.getByText('1 selected')).toBeVisible();
    await page.getByRole('button', { name: 'Accept selected' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#skos-focus-owner')).toBeFocused();
    expect(
      await page.evaluate(() => ({
        schemes: window.__skosAccepted?.schemes.length ?? 0,
        concepts: window.__skosAccepted?.concepts.length ?? 0,
      })),
    ).toEqual({ schemes: 1, concepts: 1 });
  } finally {
    await server.close();
  }
});

declare global {
  interface Window {
    __skosAccepted: import('../../src/core/standards/skos.ts').AcceptedSkosProposals | null;
  }
}
