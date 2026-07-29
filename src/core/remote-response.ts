export class RemoteResponseError extends Error {
  readonly code: 'invalid_content_type' | 'invalid_json' | 'response_too_large';

  constructor(
    message: string,
    code: 'invalid_content_type' | 'invalid_json' | 'response_too_large',
  ) {
    super(message);
    this.name = 'RemoteResponseError';
    this.code = code;
  }
}

export function requireContentType(response: Response, accepted: readonly string[]): void {
  const raw = response.headers.get('content-type') ?? '';
  const mediaType = raw.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  const matches = accepted.some(
    (expected) =>
      mediaType === expected || (expected === 'application/json' && mediaType.endsWith('+json')),
  );
  if (!matches) {
    throw new RemoteResponseError(
      `Expected ${accepted.join(' or ')}, received ${mediaType || 'no Content-Type'}.`,
      'invalid_content_type',
    );
  }
}

export async function readBoundedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new RemoteResponseError(
      `Response is ${declared.toLocaleString()} bytes; limit is ${maxBytes.toLocaleString()} bytes.`,
      'response_too_large',
    );
  }

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new RemoteResponseError(
        `Response exceeded the ${maxBytes.toLocaleString()} byte limit.`,
        'response_too_large',
      );
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel('response limit exceeded').catch(() => undefined);
      throw new RemoteResponseError(
        `Response exceeded the ${maxBytes.toLocaleString()} byte limit.`,
        'response_too_large',
      );
    }
    chunks.push(value);
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  requireContentType(response, ['application/json']);
  const text = new TextDecoder().decode(await readBoundedBytes(response, maxBytes));
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RemoteResponseError('Response body is not valid JSON.', 'invalid_json');
  }
}

export async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  return new TextDecoder().decode(await readBoundedBytes(response, maxBytes));
}
