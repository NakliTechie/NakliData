// URL-state sharing — `?lens=<base64url>` round-trips a `.naklidata`
// file via the URL. Same JSON shape as `.naklidata` (so no data, just
// the description: sources, assignments, cells). Gzip-compressed before
// base64url-encoding so a realistic workbook fits within common URL
// limits.
//
// Spec amendment A1 + plan/pending.md "URL-encoded query state".
// Honors the no-server / no-account vision: the recipient gets the
// link, opens it, the page restores from URL, end of story.

import { type NakliDataFile, parse } from './persistence.ts';

const PARAM_NAME = 'lens';
/**
 * Conservative URL-length ceiling — most browsers tolerate ~8 KB, but
 * some chat clients truncate sooner. We warn (not block) past this.
 */
const SOFT_URL_LIMIT = 7800;
/**
 * Decompression ceiling for an inbound `?lens=` payload. A `.naklidata`
 * description (no row data) is comfortably under this; the cap exists to
 * defuse a gzip bomb — a few-KB URL that expands to gigabytes and OOMs
 * the tab (forward-pass H3). The lens comes from an attacker-controllable
 * shared link, so this is a real DoS channel without the guard.
 */
const MAX_DECOMPRESSED_BYTES = 2 * 1024 * 1024;

export async function encodeLensParam(file: NakliDataFile): Promise<string> {
  const json = JSON.stringify(file);
  const bytes = new TextEncoder().encode(json);
  const compressed = await gzipCompress(bytes);
  return bytesToBase64Url(compressed);
}

export async function decodeLensParam(encoded: string): Promise<NakliDataFile> {
  const compressed = base64UrlToBytes(encoded);
  const decompressed = await gzipDecompress(compressed);
  const json = new TextDecoder().decode(decompressed);
  return parse(json);
}

export function readLensFromLocation(): string | null {
  return new URLSearchParams(window.location.search).get(PARAM_NAME);
}

export function clearLensFromLocation(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete(PARAM_NAME);
  window.history.replaceState({}, '', url);
}

export interface ShareUrlResult {
  url: string;
  encodedLength: number;
  tooLong: boolean;
}

export async function buildShareUrl(file: NakliDataFile, base?: string): Promise<ShareUrlResult> {
  const encoded = await encodeLensParam(file);
  const baseUrl = base ?? `${window.location.origin}${window.location.pathname}`;
  const url = `${baseUrl}?${PARAM_NAME}=${encoded}`;
  return { url, encodedLength: encoded.length, tooLong: url.length > SOFT_URL_LIMIT };
}

async function gzipCompress(bytes: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip');
  const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(cs);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

async function gzipDecompress(
  bytes: Uint8Array,
  maxBytes: number = MAX_DECOMPRESSED_BYTES,
): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(ds);
  // Read incrementally and bail the moment the running total exceeds the
  // cap, rather than buffering the whole stream first — that's what makes
  // this a real gzip-bomb guard (forward-pass H3).
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(
          `Lens payload decompresses to over ${Math.round(maxBytes / (1024 * 1024))} MB — refusing to load (possible gzip bomb).`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] ?? 0);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
