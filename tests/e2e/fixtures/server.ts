// Tiny static server pointing at dist/. Shared by all e2e tests.
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { type Server, createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve('dist');
const E2E_WELCOME_SCRIPT = "localStorage.setItem('naklidata.welcomed','1');";
const E2E_WELCOME_HASH = createHash('sha256').update(E2E_WELCOME_SCRIPT).digest('base64');

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.jsonl': 'application/x-ndjson',
  '.csv': 'text/csv',
  '.parquet': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
};

export interface StaticServer {
  url: string;
  close: () => Promise<void>;
}

function prepareE2eHtml(body: Buffer): Buffer {
  const html = body.toString('utf8');
  if (!html.includes('<script type="module">')) return body;
  const withHash = html.replace(
    "script-src 'self'",
    `script-src 'self' 'sha256-${E2E_WELCOME_HASH}'`,
  );
  return Buffer.from(
    withHash.replace(
      '<script type="module">',
      `<script>${E2E_WELCOME_SCRIPT}</script>\n    <script type="module">`,
    ),
  );
}

export async function startStaticServer(): Promise<StaticServer> {
  const server: Server = createServer(async (req, res) => {
    try {
      const parsedUrl = new URL(req.url ?? '/', 'http://test.local');
      const reqUrl = parsedUrl.pathname;
      if (reqUrl === '/api/private.json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"private":true}');
        return;
      }
      const url = reqUrl === '/' ? '/index.html' : reqUrl;
      const filePath = join(ROOT, url);
      const st = await stat(filePath);
      if (!st.isFile()) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      const fileBody = await readFile(filePath);
      const body = extname(filePath) === '.html' ? prepareE2eHtml(fileBody) : fileBody;
      const partial = parsedUrl.searchParams.has('__partial');
      const headers: Record<string, string> = {
        'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
      };
      if (parsedUrl.searchParams.has('__private')) {
        headers['cache-control'] = 'private, no-store';
      }
      if (partial) headers['content-range'] = `bytes 0-3/${body.byteLength}`;
      res.writeHead(partial ? 206 : 200, headers);
      res.end(partial ? body.subarray(0, 4) : body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('server address unavailable');
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
