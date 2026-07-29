// Deterministic public CSV/TSV acquisition.
//
// DuckDB-wasm's network-backed CSV reader can issue several scans against an
// origin that does not implement byte ranges. Real-data verification found
// changing and over-counted results on otherwise-valid CSVs. Fetch the response
// once, normalize supported text encodings, and hand one owned byte buffer to
// DuckDB instead.

export type RemoteTextEncoding = 'utf-8' | 'windows-1252';

export interface RemoteDelimitedBytes {
  bytes: Uint8Array;
  byteLength: number;
  encoding: RemoteTextEncoding;
}

function declaredEncoding(contentType: string | null): RemoteTextEncoding | null {
  const charset = contentType?.match(/(?:^|;)\s*charset\s*=\s*["']?([^;"'\s]+)/i)?.[1];
  if (!charset) return null;
  const normalized = charset.toLowerCase().replace(/_/g, '-');
  if (normalized === 'utf-8' || normalized === 'utf8') return 'utf-8';
  if (
    normalized === 'windows-1252' ||
    normalized === 'cp1252' ||
    normalized === 'iso-8859-1' ||
    normalized === 'latin1' ||
    normalized === 'latin-1'
  ) {
    return 'windows-1252';
  }
  return null;
}

export function normalizeRemoteDelimitedBytes(
  input: Uint8Array,
  contentType: string | null = null,
): RemoteDelimitedBytes {
  const declared = declaredEncoding(contentType);
  if (declared === 'windows-1252') {
    const bytes = new TextEncoder().encode(new TextDecoder('windows-1252').decode(input));
    return { bytes, byteLength: input.byteLength, encoding: 'windows-1252' };
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(input);
    return { bytes: input, byteLength: input.byteLength, encoding: 'utf-8' };
  } catch {
    const bytes = new TextEncoder().encode(new TextDecoder('windows-1252').decode(input));
    return { bytes, byteLength: input.byteLength, encoding: 'windows-1252' };
  }
}

export async function fetchRemoteDelimited(url: string): Promise<RemoteDelimitedBytes> {
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) {
    throw new Error(`Remote file request failed (HTTP ${response.status}).`);
  }
  const input = new Uint8Array(await response.arrayBuffer());
  return normalizeRemoteDelimitedBytes(input, response.headers.get('content-type'));
}
