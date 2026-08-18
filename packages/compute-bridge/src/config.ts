import { BRIDGE_QUERY_ROW_CAP_MAX } from '../../../src/core/bridge/protocol.ts';
import { BridgeServerError } from './backend.ts';

export interface BridgeRuntimeConfig {
  name: string;
  version: string;
  environment: string;
  allowedOrigins: ReadonlySet<string>;
  authToken: string | null;
  maxRequestBytes: number;
  maxResultBytes: number;
  maxQueryMilliseconds: number;
  maxRowLimit: number;
}

function positiveInteger(value: string, label: string, ceiling: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > ceiling) {
    throw new BridgeServerError(`${label} is outside its allowed range.`, 'invalid_config', 503);
  }
  return parsed;
}

export function runtimeConfig(env: Env): BridgeRuntimeConfig {
  const allowedOrigins = new Set(
    env.ALLOWED_ORIGINS.split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  for (const origin of allowedOrigins) {
    const parsed = new URL(origin);
    const loopback =
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '[::1]';
    if (
      parsed.origin !== origin ||
      (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback))
    ) {
      throw new BridgeServerError(
        'ALLOWED_ORIGINS contains an invalid origin.',
        'invalid_config',
        503,
      );
    }
  }
  return {
    name: env.BRIDGE_NAME,
    version: env.BRIDGE_VERSION,
    environment: env.ENVIRONMENT,
    allowedOrigins,
    authToken: env.BRIDGE_AUTH_TOKEN?.trim() || null,
    maxRequestBytes: positiveInteger(env.MAX_REQUEST_BYTES, 'MAX_REQUEST_BYTES', 1024 * 1024),
    maxResultBytes: positiveInteger(env.MAX_RESULT_BYTES, 'MAX_RESULT_BYTES', 64 * 1024 * 1024),
    maxQueryMilliseconds: positiveInteger(
      env.MAX_QUERY_MILLISECONDS,
      'MAX_QUERY_MILLISECONDS',
      120_000,
    ),
    maxRowLimit: BRIDGE_QUERY_ROW_CAP_MAX,
  };
}
