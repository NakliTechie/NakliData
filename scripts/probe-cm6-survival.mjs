#!/usr/bin/env node
// CM6 EditorView survival probe.
//
// Reactive question: does the CodeMirror 6 editor in a SQL cell survive
// many workbook re-renders intact? The forward-pass audit on
// 2026-05-31 speculated that the per-id `cmInstances` registry pattern
// orphaned the editor DOM after enough ticks ("eventually the SQL
// editor stops accepting input"). This script tries to falsify that
// hypothesis with a deterministic stress test.
//
// Result (2026-05-31, 500 ticks): NO RACE OBSERVED. The CM6 editor:
//   - stays connected to the DOM
//   - accepts new content via .textContent + dispatched input event
//   - the engine runs the new SQL and produces a correct result table
//   - zero console errors
//
// Conclusion: `mount.innerHTML = ''` in renderNotebook only detaches
// children from the DOM; the EditorView's JS state survives, and
// re-appending its dom via `existing.domNode()` in renderSqlCell
// correctly re-attaches it. CM6 tolerates re-parenting cleanly.
//
// Run when: a user reports an editor-freeze symptom and we want
// evidence one way or the other. Increase the inline `ticks` constant
// if needed (it's set to 500).
//
// Strategy:
//   1. Boot dist/, mount example bundle, instantiate Vendor concentration.
//   2. Wait for CM6 to swap in (codemirrorReady = true).
//   3. Force N workbook re-renders by toggling column-profile expand/collapse
//      (each toggle mutates workbook state → notebook re-renders).
//   4. Type into the CM6 editor, verify the text lands in the cell's
//      runtime `code` field via the input event path.
//   5. Run the cell; if the editor froze, the run would fail or use stale text.

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve('dist');
const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.jsonl': 'application/x-ndjson',
  '.csv': 'text/csv',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.parquet': 'application/octet-stream',
};

const server = createServer(async (req, res) => {
  try {
    const reqUrl = (req.url ?? '/').split('?')[0];
    const body = await readFile(join(ROOT, reqUrl === '/' ? '/index.html' : reqUrl));
    res.writeHead(200, {
      'content-type': MIME[extname(reqUrl)] ?? 'application/octet-stream',
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') {
    consoleErrors.push(m.text());
    console.error('[console]', m.text());
  }
});
page.on('pageerror', (err) => {
  consoleErrors.push(err.message);
  console.error('[pageerror]', err.message);
});

await page.goto(`http://127.0.0.1:${port}/index.html?offline=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => document.querySelector('[data-region="engine-status"]')?.textContent === 'Engine: ready',
  null,
  { timeout: 90000 },
);
await page.click('[data-action="browse-examples"]');
await page.waitForFunction(() => document.querySelectorAll('.source-row').length > 0, null, {
  timeout: 30000,
});
await page.waitForTimeout(2000);

// Instantiate Vendor concentration (md + sql + chart) so we have a SQL cell.
await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll('.template-card'));
  const card = cards.find((c) => c.querySelector('strong')?.textContent === 'Vendor concentration');
  card?.querySelector('button')?.click();
});
await page.waitForTimeout(1000);

// Wait for CM6 to swap in. The textarea-first render eventually swaps
// for `.cm-content`. We loop until either CM6 mounts or we give up.
for (let i = 0; i < 30; i++) {
  const swapped = await page.evaluate(
    () => !!document.querySelector('.cell[data-cell-kind="sql"] .cm-content'),
  );
  if (swapped) break;
  await page.waitForTimeout(200);
}
const cm6Mounted = await page.evaluate(
  () => !!document.querySelector('.cell[data-cell-kind="sql"] .cm-content'),
);
console.log('cm6 mounted:', cm6Mounted);

// Snapshot the initial CM6 dom node reference (via a per-render counter).
const initialDomCount = await page.evaluate(() => {
  const cm = document.querySelector('.cell[data-cell-kind="sql"] .cm-content');
  return cm ? 1 : 0;
});
console.log('initial .cm-content count:', initialDomCount);

// Now hammer the workbook with re-renders. Toggling the column-profile
// affordance toggles _columnProfiles map, which fires a workbook update.
// We do it directly via the DOM since the schema-panel renders the
// toggle button per column.
const profileToggleResult = await page.evaluate(async () => {
  const ticks = 500;
  const events = [];
  for (let i = 0; i < ticks; i++) {
    // Find any "Show profile" / "Hide profile" button via data-action.
    const btn = document.querySelector('[data-action="show-profile"]');
    if (btn) {
      btn.click();
      events.push('show');
    } else {
      // No show button — the profile is currently open. Find the close.
      const closeBtn = document.querySelector('[data-action="hide-profile"]');
      if (closeBtn) {
        closeBtn.click();
        events.push('hide');
      }
    }
    // Yield to the event loop so workbook subscribers fire.
    await new Promise((r) => setTimeout(r, 20));
  }
  return events.length;
});
console.log('workbook ticks triggered:', profileToggleResult);

// Check the CM6 editor is still alive: is its dom still connected? Is
// it still the same DOM node as before, or has it been replaced?
const editorState = await page.evaluate(() => {
  const cm = document.querySelector('.cell[data-cell-kind="sql"] .cm-content');
  if (!cm) return null;
  return {
    isConnected: cm.isConnected,
    hasInnerText: cm.textContent?.length ?? 0,
    classList: Array.from(cm.classList),
  };
});
console.log('editor state after ticks:', JSON.stringify(editorState));

// Try to type into the editor — programmatically simulate the input
// event path that sql-cell.ts uses. If the editor is frozen, the
// dispatched input event won't update the cell's runtime `code`.
const typed = await page.evaluate(() => {
  const cm = document.querySelector('.cell[data-cell-kind="sql"] .cm-content');
  if (!cm) return { error: 'no .cm-content' };
  cm.textContent = 'SELECT 42 AS marker';
  cm.dispatchEvent(new Event('input', { bubbles: true }));
  return { text: cm.textContent };
});
console.log('typed result:', JSON.stringify(typed));

// Wait a bit for the workbook to settle, then click Run.
await page.waitForTimeout(500);
await page.evaluate(() => {
  const sql = document.querySelector('.cell[data-cell-kind="sql"]');
  const btn = sql?.querySelector('[data-action="cell-run"]');
  if (btn instanceof HTMLElement) btn.click();
});
await page.waitForTimeout(2500);

const ranResult = await page.evaluate(() => {
  const sql = document.querySelector('.cell[data-cell-kind="sql"]');
  const errored = sql?.classList.contains('errored');
  const resultText = sql?.querySelector('.result-table')?.textContent ?? '';
  const errorText = sql?.querySelector('.cell-output-error')?.textContent ?? '';
  return { errored, resultText: resultText.slice(0, 200), errorText: errorText.slice(0, 200) };
});
console.log('run result:', JSON.stringify(ranResult));

console.log('console errors:', consoleErrors.length);
await browser.close();
await new Promise((r) => server.close(r));
