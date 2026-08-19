const MIME_BY_EXTENSION = Object.freeze({
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.jsonl': 'application/x-ndjson',
  '.csv': 'text/csv',
  '.parquet': 'application/octet-stream',
});

export function devServerContentType(extension) {
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
}
