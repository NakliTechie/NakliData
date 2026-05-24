// Source secrets — per-source BYOK credentials for Wave 2 sources
// (S3 endpoints in slice 2; Iceberg auth in slice 3). Same posture as
// the sidecar BYOK module (spec amendment A2): sessionStorage default,
// opt-in IDB plaintext with honest labelling, "Forget" affordance.
//
// Identifier is (sourceId, secretName) so a single source can hold
// multiple named secrets — an S3 endpoint needs both an access_key_id
// and a secret_access_key. When a source is removed from the workbook,
// `forgetSource(sourceId)` cleans up both stores.

import { kvDelete, kvGet, kvPut } from '../idb.ts';

const SESSION_PREFIX = 'naklidata.source-secret.';
const IDB_PREFIX = 'source-secrets/';

export type SecretLocation = 'session' | 'idb' | null;

export interface SecretMeta {
  /** Where the value is stored right now (or null if absent). */
  location: SecretLocation;
  /** Last 4 chars of the value, for UI confirmation. Never the full secret. */
  preview: string | null;
}

/**
 * Save a single named secret for a source. `remember=true` persists to
 * IDB plaintext; `remember=false` keeps it in sessionStorage (cleared
 * on tab close). Any prior copy in the other store is cleaned up first
 * so the value is never in two places at once.
 */
export async function saveSecret(
  sourceId: string,
  name: string,
  value: string,
  remember: boolean,
): Promise<void> {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`Empty value for secret "${name}".`);
  await forgetSecret(sourceId, name);
  if (remember) {
    await kvPut(idbKey(sourceId, name), trimmed);
  } else {
    sessionStorage.setItem(sessionKey(sourceId, name), trimmed);
  }
}

/** Read a named secret. Checks sessionStorage first, then IDB. */
export async function loadSecret(sourceId: string, name: string): Promise<string | null> {
  const fromSession = sessionStorage.getItem(sessionKey(sourceId, name));
  if (fromSession) return fromSession;
  const fromIdb = await kvGet<string>(idbKey(sourceId, name));
  return fromIdb ?? null;
}

/** Where (if anywhere) is this secret currently stored? */
export async function locateSecret(sourceId: string, name: string): Promise<SecretMeta> {
  const fromSession = sessionStorage.getItem(sessionKey(sourceId, name));
  if (fromSession) {
    return { location: 'session', preview: preview(fromSession) };
  }
  const fromIdb = await kvGet<string>(idbKey(sourceId, name));
  if (fromIdb) {
    return { location: 'idb', preview: preview(fromIdb) };
  }
  return { location: null, preview: null };
}

/** Drop one named secret from both stores. */
export async function forgetSecret(sourceId: string, name: string): Promise<void> {
  sessionStorage.removeItem(sessionKey(sourceId, name));
  await kvDelete(idbKey(sourceId, name));
}

/**
 * Drop all secrets for a source. Call this when removing a source from
 * the workbook so we don't leak credentials in storage for sources that
 * no longer exist.
 *
 * `names` is the canonical set of secret names this source kind uses
 * (e.g. ['access_key_id', 'secret_access_key'] for s3-endpoint).
 */
export async function forgetSource(sourceId: string, names: string[]): Promise<void> {
  for (const name of names) {
    await forgetSecret(sourceId, name);
  }
}

function sessionKey(sourceId: string, name: string): string {
  return `${SESSION_PREFIX}${sourceId}.${name}`;
}

function idbKey(sourceId: string, name: string): string {
  return `${IDB_PREFIX}${sourceId}/${name}`;
}

function preview(value: string): string {
  if (value.length <= 4) return '••';
  return `••••${value.slice(-4)}`;
}
