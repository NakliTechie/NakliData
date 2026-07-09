// M3 — Incremental Refresh: IDB persistence of source fingerprints.
//
// One KV entry per session: `refresh:<sessionId>:fingerprints` =
// `Record<sourceId, SourceFingerprint>`. Stored alongside session
// snapshots in the existing KV store so the schema doesn't need a
// version bump.
//
// Per handoff §10 Hard NOT: this stores ONLY change-detection tokens
// (size + lastModified + ETag), NEVER file contents or query results.

import { kvDelete, kvGet, kvPut } from './idb.ts';
import type { SourceFingerprint } from './refresh.ts';

const KEY_PREFIX = 'refresh:';

type FingerprintMap = Record<string, SourceFingerprint>;

function key(sessionId: string): string {
  return `${KEY_PREFIX}${sessionId}:fingerprints`;
}

/**
 * Load every persisted fingerprint for a session. Returns `{}` when
 * the session has never been fingerprinted (first boot, or pre-M3
 * snapshot).
 */
export async function loadFingerprints(sessionId: string): Promise<FingerprintMap> {
  const v = await kvGet<FingerprintMap>(key(sessionId));
  return v ?? {};
}

/**
 * Replace every fingerprint for a session in one IDB write — used by
 * the boot path to commit a batch of newly-computed fingerprints
 * after all sources have been mounted.
 */
export async function saveFingerprints(
  sessionId: string,
  fingerprints: FingerprintMap,
): Promise<void> {
  await kvPut(key(sessionId), fingerprints);
}

/**
 * Drop a session's fingerprints. Called when a session is deleted
 * so the IDB record doesn't outlive the session metadata (L7). Deletes
 * the KV entry outright rather than leaving an empty `{}` record behind.
 */
export async function clearFingerprints(sessionId: string): Promise<void> {
  await kvDelete(key(sessionId));
}
