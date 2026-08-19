import { describe, expect, it } from 'vitest';
import { devServerContentType } from '../scripts/dev-server-mime.mjs';

describe('development server MIME types', () => {
  it('serves WebAssembly with the streaming compilation MIME type', () => {
    expect(devServerContentType('.wasm')).toBe('application/wasm');
  });

  it('falls back to an opaque binary response for unknown extensions', () => {
    expect(devServerContentType('.unknown')).toBe('application/octet-stream');
  });
});
