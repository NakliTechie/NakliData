import { expect, test } from '@playwright/test';
import { startStaticServer } from './fixtures/server.ts';

test('standards reasoning runs and cancels in its dedicated worker', async ({ page }) => {
  const server = await startStaticServer();
  try {
    await page.goto(`${server.url}/index.html?offline=1`);
    const result = await page.evaluate(async () => {
      const url = new URL('./chunks/standards-reasoning.js', document.baseURI).href;
      const module = (await import(url)) as typeof import('../../src/lazy/standards-reasoning.ts');
      const client = new module.StandardsReasoningClient();
      const derived = await client.reason({
        workspaceId: 'browser-workspace',
        workspaceRevision: 1,
        expectedWorkspaceId: 'browser-workspace',
        expectedWorkspaceRevision: 1,
        facts: [
          { id: 'ab', kind: 'owl_subclass', subject: 'A', object: 'B' },
          { id: 'bc', kind: 'owl_subclass', subject: 'B', object: 'C' },
        ],
      });

      const controller = new AbortController();
      const facts = Array.from({ length: 300 }, (_, index) => ({
        id: `edge-${index}`,
        kind: 'owl_subclass' as const,
        subject: `N${index}`,
        object: `N${index + 1}`,
      }));
      const cancellation = client
        .reason(
          {
            workspaceId: 'browser-workspace',
            workspaceRevision: 1,
            expectedWorkspaceId: 'browser-workspace',
            expectedWorkspaceRevision: 1,
            facts,
          },
          { signal: controller.signal },
        )
        .then(() => 'unexpected-result')
        .catch((error: unknown) => (error instanceof Error ? error.name : String(error)));
      window.setTimeout(() => controller.abort(), 0);
      const cancelled = await cancellation;
      client.terminate();
      return {
        inferred: derived.proposals.some(
          (proposal) => proposal.fact.subject === 'A' && proposal.fact.object === 'C',
        ),
        cancelled,
      };
    });
    expect(result).toEqual({ inferred: true, cancelled: 'AbortError' });
  } finally {
    await server.close();
  }
});
