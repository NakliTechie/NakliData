import { writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
// Facet M0 — drive the runner harness in a real browser and write results.json.
// Needs a WebGPU-capable Chromium (L2) + optionally a BYOK key (C1) / Ollama (L1).
//
//   node eval/m0/runner/build.mjs            # bundle the harness first
//   M0_RUNGS=L2,C1 M0_C1_KEY=sk-... node eval/m0/runner/run.mjs
//
// Env: M0_RUNGS (csv of L1,L2,C1; default L2), M0_LOCAL_MODEL,
//      M0_L1_URL (default http://localhost:11434/v1), M0_L1_MODEL,
//      M0_C1_PROVIDER (anthropic|openai; default anthropic), M0_C1_MODEL, M0_C1_KEY,
//      M0_HEADED=1 (headed browser — often needed for a real WebGPU adapter).
import { chromium } from 'playwright';

const ROOT = new URL('../', import.meta.url).pathname; // eval/m0/
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.jsonl': 'application/x-ndjson',
  '.parquet': 'application/octet-stream',
};

const server = createServer(async (req, res) => {
  try {
    const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    const body = await readFile(join(ROOT, rel));
    res.writeHead(200, { 'content-type': TYPES[extname(rel)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const rungs = (process.env.M0_RUNGS ?? 'L2').split(',').map((s) => s.trim());
const config = {
  rungs,
  localModel: process.env.M0_LOCAL_MODEL,
  embedModel: process.env.M0_EMBED_MODEL,
  l1: rungs.includes('L1')
    ? {
        url: process.env.M0_L1_URL ?? 'http://localhost:11434/v1',
        model: process.env.M0_L1_MODEL ?? 'qwen2.5:0.5b',
      }
    : undefined,
  c1: rungs.includes('C1')
    ? {
        provider: process.env.M0_C1_PROVIDER ?? 'anthropic',
        model: process.env.M0_C1_MODEL ?? 'claude-3-5-haiku-latest',
        key: process.env.M0_C1_KEY ?? '',
      }
    : undefined,
};
if (rungs.includes('C1') && !config.c1.key) throw new Error('C1 requested but M0_C1_KEY is empty');

const browser = await chromium.launch({
  headless: !process.env.M0_HEADED,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
page.on('console', (m) => console.log('  [page]', m.text()));
await page.addInitScript((cfg) => {
  window.__M0_CONFIG__ = cfg;
}, config);
await page.goto(`http://127.0.0.1:${port}/runner/harness.html`, { waitUntil: 'load' });

console.log(`running rungs=[${rungs}] — model load + inference is slow, be patient…`);
await page.waitForFunction(
  () => window.__M0_RESULTS__ !== undefined || window.__M0_ERROR__ !== undefined,
  null,
  { timeout: 60 * 60 * 1000, polling: 2000 },
);
const err = await page.evaluate(() => window.__M0_ERROR__);
if (err) {
  console.error('HARNESS ERROR:\n', err);
  await browser.close();
  server.close();
  process.exit(1);
}
const results = await page.evaluate(() => window.__M0_RESULTS__);
const out = join(ROOT, 'results.json');
writeFileSync(out, JSON.stringify(results, null, 2));
console.log(`wrote ${results.length} rows -> ${out}`);
await browser.close();
server.close();
