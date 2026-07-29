import { readFile, stat } from 'node:fs/promises';
// Tiny static server pointing at dist/. Shared by all e2e tests.
import { type Server, createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve('dist');

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
      const body = await readFile(filePath);
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
