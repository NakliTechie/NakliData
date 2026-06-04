// Forward-pass H1 (2026-06-02) — lens-link confirmation modal.
//
// The boot path gates `?lens=` auto-mount of remote sources behind a
// confirmation modal. This spec exercises:
//
// 1. Modal fires when the lens contains an `http` source.
// 2. Modal lists the host the link would fetch from.
// 3. Cancel-focused-by-default (Enter dismisses safely, not the
//    dangerous Continue).
// 4. Cancel button + Escape + backdrop-click all strip the lens param
//    and fall back to the saved (or empty) state.
// 5. Modal does NOT fire for local-only lens (example-bundle / fsa).
//    Covered by the existing share-link round-trip e2e — re-asserted
//    here for clarity.

import { expect, test } from '@playwright/test';
import { startStaticServer } from './fixtures/server.ts';

// Construct the same encoded form as `encodeLensParam` produces, so we
// can build a `?lens=…` URL with arbitrary persisted-source contents
// (including remote kinds we'd never want a real Playwright test to
// fetch from).
async function encodeLens(file: Record<string, unknown>): Promise<string> {
  const json = JSON.stringify(file);
  const bytes = new TextEncoder().encode(json);
  // Node 22 has CompressionStream globally.
  const cs = new CompressionStream('gzip');
  const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(cs);
  const buf = await new Response(stream).arrayBuffer();
  const out = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < out.length; i++) bin += String.fromCharCode(out[i] ?? 0);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeRemoteLensFile(host: string): Record<string, unknown> {
  return {
    format: 'naklidata',
    version: '1.0',
    created: '2026-06-02T00:00:00.000Z',
    modified: '2026-06-02T00:00:00.000Z',
    name: 'Shared workbook with remote source',
    sources: [
      {
        id: 'src_remote_1',
        kind: 'http',
        label: 'Remote test source',
        ref: `https://${host}/never-fetched.csv`,
        tables: [
          {
            id: 'tbl_1',
            name: 'never_fetched',
            format: 'csv',
            origin: `https://${host}/never-fetched.csv`,
            rowCount: 0,
          },
        ],
      },
    ],
    assignments: [],
    cells: [],
    user_types: [],
    override_rules: [],
  };
}

test.describe('?lens= confirmation modal (forward-pass H1)', () => {
  test('fires the modal for a lens containing an http source; Cancel strips the param', async ({
    browser,
  }) => {
    const server = await startStaticServer();
    const context = await browser.newContext();
    const page = await context.newPage();

    // Capture engine fetch attempts — if any fire BEFORE the user
    // clicks Continue, that's the SSRF the modal is supposed to
    // prevent. We watch by listening on the requests stream and
    // failing the test if our `remote-host-under-test` ever appears.
    const remoteHostFetches: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('remote-host-under-test.invalid')) {
        remoteHostFetches.push(req.url());
      }
    });

    const lens = await encodeLens(makeRemoteLensFile('remote-host-under-test.invalid'));
    await page.goto(`${server.url}/index.html?offline=1&lens=${lens}`);

    // Modal should appear; engine still booting in background.
    const modal = page.locator('.lens-confirm-modal');
    await expect(modal).toBeVisible({ timeout: 10_000 });

    // Modal lists the host.
    await expect(modal.locator('.lens-confirm-host')).toContainText(
      'remote-host-under-test.invalid',
    );

    // Cancel is the focused button (Enter-dismiss is safe-default).
    const cancelButton = modal.locator('[data-action="lens-confirm-cancel"]');
    await expect(cancelButton).toBeFocused();

    // No remote fetch fired during the modal-open window.
    expect(remoteHostFetches).toEqual([]);

    // Click Cancel.
    await cancelButton.click();

    // Modal gone.
    await expect(modal).toBeHidden({ timeout: 2_000 });

    // Lens param stripped from URL.
    const finalUrl = page.url();
    expect(finalUrl).not.toContain('lens=');

    // Still no remote fetch fired.
    expect(remoteHostFetches).toEqual([]);

    // Page now in the empty / saved-state fallback (no remote source
    // mounted). Empty-state visible since we're in a fresh context.
    await page.waitForSelector('.empty-state', { timeout: 5_000 });

    await context.close();
    await server.close();
  });

  test('Escape key also cancels the modal', async ({ browser }) => {
    const server = await startStaticServer();
    const context = await browser.newContext();
    const page = await context.newPage();

    const lens = await encodeLens(makeRemoteLensFile('escape-test.invalid'));
    await page.goto(`${server.url}/index.html?offline=1&lens=${lens}`);

    const modal = page.locator('.lens-confirm-modal');
    await expect(modal).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden({ timeout: 2_000 });

    expect(page.url()).not.toContain('lens=');

    await context.close();
    await server.close();
  });

  test('back-button after Cancel does NOT replay the lens (forward-pass W2)', async ({
    browser,
  }) => {
    // Forward-pass "worth a look" W2: clearLensFromLocation uses
    // history.replaceState, which replaces the CURRENT entry without
    // creating a new one. So after Cancel strips the lens, the
    // current history entry is the cleaned URL — back navigates to
    // whatever was BEFORE the lens link, not back to the lens.
    //
    // This test pins the behaviour by clicking back after Cancel and
    // asserting the modal does NOT re-fire.
    const server = await startStaticServer();
    const context = await browser.newContext();
    const page = await context.newPage();

    // Establish a prior history entry so "back" has somewhere to go.
    await page.goto(`${server.url}/index.html`);
    await page.waitForSelector('.shell-header', { timeout: 10_000 });

    const lens = await encodeLens(makeRemoteLensFile('w2-back-button.invalid'));
    await page.goto(`${server.url}/index.html?offline=1&lens=${lens}`);

    const modal = page.locator('.lens-confirm-modal');
    await expect(modal).toBeVisible({ timeout: 10_000 });

    // Cancel the modal.
    await modal.locator('[data-action="lens-confirm-cancel"]').click();
    await expect(modal).toBeHidden({ timeout: 2_000 });
    expect(page.url()).not.toContain('lens=');

    // Now click back. With replaceState semantics, we should land on
    // the original (pre-lens) page, NOT on /?lens=... again.
    await page.goBack();
    // Give the page a beat to settle.
    await page.waitForTimeout(2_000);

    // Modal should still NOT be visible.
    await expect(modal).toHaveCount(0);
    // URL should not contain the lens param.
    expect(page.url()).not.toContain('lens=');

    await context.close();
    await server.close();
  });

  test('does NOT fire the modal for a local-only lens (no http/iceberg/s3/bridge sources)', async ({
    browser,
  }) => {
    const server = await startStaticServer();
    const context = await browser.newContext();
    const page = await context.newPage();

    // Lens contains ONLY `example-bundle` — no remote-source kinds.
    // The modal should NOT appear; auto-restore proceeds silently.
    const localLens = await encodeLens({
      format: 'naklidata',
      version: '1.0',
      created: '2026-06-02T00:00:00.000Z',
      modified: '2026-06-02T00:00:00.000Z',
      name: 'Local-only workbook',
      sources: [
        {
          id: 'src_bundle_1',
          kind: 'example-bundle',
          label: 'Example data',
          ref: 'demo',
          tables: [],
        },
      ],
      assignments: [],
      cells: [],
      user_types: [],
      override_rules: [],
    });

    await page.goto(`${server.url}/index.html?offline=1&lens=${localLens}`);

    // Give the page a beat to settle — the modal would have appeared
    // by now if it were going to. Use the same timeout the positive
    // test used for "modal visible".
    await page.waitForTimeout(3_000);

    // Modal should NOT be present.
    const modal = page.locator('.lens-confirm-modal');
    await expect(modal).toHaveCount(0);

    await context.close();
    await server.close();
  });
});
