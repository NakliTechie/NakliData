import { readFile, writeFile } from 'node:fs/promises';
// Dev server for the Chrome-driven M0 run: serves eval/m0/, proxies
// /ollama/v1/* -> localhost:11434, /deepseek/v1/* -> api.deepseek.com (injecting
// the DEEPSEEK_API_KEY from env server-side, so the key never enters the
// browser), and accepts POST /save (body -> eval/m0/results.json).
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname; // eval/m0/
const OLLAMA = process.env.M0_OLLAMA ?? 'http://localhost:11434';
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY ?? '';
const PORT = Number(process.env.M0_PORT ?? 8830);
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.jsonl': 'application/x-ndjson',
  '.parquet': 'application/octet-stream',
};
const readBody = (req) =>
  new Promise((r) => {
    const c = [];
    req.on('data', (d) => c.push(d));
    req.on('end', () => r(Buffer.concat(c)));
  });

async function proxy(req, res, prefix, base, extraHeaders) {
  const target = base + req.url.replace(prefix, '');
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
  const up = await fetch(target, {
    method: req.method,
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body,
  });
  res.writeHead(up.status, {
    'content-type': up.headers.get('content-type') ?? 'application/json',
    'access-control-allow-origin': '*',
  });
  res.end(Buffer.from(await up.arrayBuffer()));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname === '/save' && req.method === 'POST') {
      const body = await readBody(req);
      await writeFile(join(ROOT, 'results.json'), body);
      res.writeHead(200, { 'access-control-allow-origin': '*' });
      res.end(`saved ${body.length}`);
      return;
    }
    if (url.pathname.startsWith('/ollama/')) return void proxy(req, res, '/ollama', OLLAMA, {});
    if (url.pathname.startsWith('/deepseek/')) {
      if (!DEEPSEEK_KEY) {
        res.writeHead(500);
        res.end('DEEPSEEK_API_KEY not set');
        return;
      }
      return void proxy(req, res, '/deepseek', 'https://api.deepseek.com', {
        authorization: `Bearer ${DEEPSEEK_KEY}`,
      });
    }
    const rel = normalize(decodeURIComponent(url.pathname))
      .replace(/^(\.\.[/\\])+/, '')
      .replace(/^\/+/, '');
    const data = await readFile(join(ROOT, rel || 'runner/harness.html'));
    res.writeHead(200, { 'content-type': TYPES[extname(rel)] ?? 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    res.writeHead(404);
    res.end(`not found: ${e.message}`);
  }
});
server.listen(PORT, () =>
  console.log(`[serve] :${PORT} (ollama, deepseek${DEEPSEEK_KEY ? '✓' : '✗ NO KEY'}, /save)`),
);
