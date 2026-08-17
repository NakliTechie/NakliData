import { BridgeServerError } from './backend.ts';

const encoder = new TextEncoder();

async function digest(value: string): Promise<ArrayBuffer> {
  return await crypto.subtle.digest('SHA-256', encoder.encode(value));
}

export async function requireBearer(request: Request, expectedToken: string | null): Promise<void> {
  if (!expectedToken) {
    throw new BridgeServerError('Bridge authentication is not configured.', 'not_ready', 503);
  }
  const header = request.headers.get('authorization');
  const provided = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  const [providedHash, expectedHash] = await Promise.all([digest(provided), digest(expectedToken)]);
  if (!crypto.subtle.timingSafeEqual(providedHash, expectedHash)) {
    throw new BridgeServerError('Bridge authentication failed.', 'unauthorized', 401);
  }
}
