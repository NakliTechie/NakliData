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
      const reqUrl = (req.url ?? '/').split('?')[0] ?? '/';
      const url = reqUrl === '/' ? '/index.html' : reqUrl;
      const filePath = join(ROOT, url);
      const st = await stat(filePath);
      if (!st.isFile()) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      const body = await readFile(filePath);
      res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' });
      res.end(body);
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
