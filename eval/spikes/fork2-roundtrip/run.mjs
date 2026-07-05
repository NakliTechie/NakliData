// Driver for the Fork 2 round-trip spike (THROWAWAY). Serves the spike page
// on a local origin, loads DuckDB-wasm + Pyodide, and runs the round-trip at
// 100k and 1M rows, plus a warm-reload load timing. Prints metrics JSON.
//
//   PLAYWRIGHT_CHROMIUM_PATH=$(node -e "console.log(require('playwright').chromium.executablePath())") \
//     node eval/spikes/fork2-roundtrip/run.mjs
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve('eval/spikes/fork2-roundtrip');
const CHROME = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const MIME = { '.html': 'text/html', '.mjs': 'application/javascript', '.js': 'application/javascript' };

const server = createServer(async (req, res) => {
  try {
    const url = (req.url ?? '/').split('?')[0];
    const fp = join(ROOT, url === '/' ? '/index.html' : url);
    const st = await stat(fp);
    if (!st.isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }
    // COOP/COEP not set — DuckDB picks the non-threaded EH bundle, Pyodide
    // needs no isolation. Mirrors the product's headers.
    res.writeHead(200, { 'content-type': MIME[extname(fp)] ?? 'application/octet-stream' });
    res.end(await readFile(fp));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  ...(CHROME ? { executablePath: CHROME } : {}),
  args: ['--no-sandbox', '--enable-precise-memory-info'],
});
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') console.log('  cerr:', m.text());
});
page.on('pageerror', (e) => console.log('  perr:', e.message));

// Track total bytes transferred during cold load (the vendoring payload size).
let coldTransferBytes = 0;
let trackTransfer = true;
page.on('response', async (resp) => {
  if (!trackTransfer) return;
  const len = Number(resp.headers()['content-length'] ?? 0);
  if (len) coldTransferBytes += len;
});

async function boot() {
  await page.goto(`${base}/index.html`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__spikeReady === true, null, { timeout: 30000 });
  return page.evaluate(() => window.loadRuntimes());
}

console.log('=== COLD load (fresh context) ===');
const cold = await boot();
trackTransfer = false;
cold.transferMB = +(coldTransferBytes / 1048576).toFixed(1);
console.log(JSON.stringify(cold, null, 2));

const results = {};
for (const rows of [100_000, 1_000_000, 5_000_000]) {
  console.log(`\n=== round-trip @ ${rows.toLocaleString()} rows ===`);
  try {
    const m = await page.evaluate((n) => window.runSpike(n), rows);
    results[rows] = m;
    console.log(JSON.stringify(m, null, 2));
  } catch (e) {
    results[rows] = { error: String(e.message ?? e).slice(0, 200) };
    console.log('  FAILED:', results[rows].error);
  }
}

// Warm reload — same context so HTTP cache is warm; measures re-init cost.
console.log('\n=== WARM load (reload, HTTP cache warm) ===');
const warm = await boot();
console.log(JSON.stringify(warm, null, 2));

console.log('\n=== SUMMARY ===');
console.log(
  JSON.stringify(
    {
      loadCold: cold,
      loadWarm: warm,
      roundTrip100k: results[100_000],
      roundTrip1M: results[1_000_000],
      roundTrip5M: results[5_000_000],
    },
    null,
    2,
  ),
);

await browser.close();
server.close();
