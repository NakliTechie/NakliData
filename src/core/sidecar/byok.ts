// BYOK key storage per spec amendment A2.
//
// Default: sessionStorage (cleared on tab close).
// Opt-in: IndexedDB, plaintext, labelled clearly in the UI.
//
// Anyone with same-origin access can read either store — the IDB path
// is an honesty-over-theatre choice (PondPilot's "encrypted in IDB
// with origin-derived key" is largely placebo since the JS that
// decrypts is also same-origin). Future v1.2 will add a
// passphrase-encrypted variant on top of this surface.

import { kvDelete, kvGet, kvPut } from '../idb.ts';
import type { SidecarProvider } from './types.ts';

const SESSION_PREFIX = 'naklidata.byok.';
const IDB_PREFIX = 'sidecar/byok/';

export type BYOKLocation = 'session' | 'idb' | null;

export interface BYOKEntry {
  /** Provider this key belongs to. */
  provider: SidecarProvider;
  /** Where the value is stored right now. */
  location: BYOKLocation;
  /** Last 4 chars of the key, for UI confirmation. Never the full value. */
  preview: string | null;
}

/** Save a key for a provider. `remember=true` persists to IDB; false stays in sessionStorage. */
export async function saveKey(
  provider: SidecarProvider,
  key: string,
  remember: boolean,
): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) throw new Error('Empty key.');
  // Clear any existing store for this provider so we never have it in
  // two places at once.
  await forgetKey(provider);
  if (remember) {
    await kvPut(idbKey(provider), trimmed);
  } else {
    sessionStorage.setItem(sessionKey(provider), trimmed);
  }
}

/** Read a key for a provider. Checks sessionStorage first, then IDB. */
export async function loadKey(provider: SidecarProvider): Promise<string | null> {
  const fromSession = sessionStorage.getItem(sessionKey(provider));
  if (fromSession) return fromSession;
  const fromIdb = await kvGet<string>(idbKey(provider));
  return fromIdb ?? null;
}

/** Where (if anywhere) is this provider's key currently stored? */
export async function locateKey(provider: SidecarProvider): Promise<BYOKEntry> {
  const fromSession = sessionStorage.getItem(sessionKey(provider));
  if (fromSession) {
    return { provider, location: 'session', preview: preview(fromSession) };
  }
  const fromIdb = await kvGet<string>(idbKey(provider));
  if (fromIdb) {
    return { provider, location: 'idb', preview: preview(fromIdb) };
  }
  return { provider, location: null, preview: null };
}

/** Drop the key for one provider from both stores. */
export async function forgetKey(provider: SidecarProvider): Promise<void> {
  sessionStorage.removeItem(sessionKey(provider));
  await kvDelete(idbKey(provider));
}

/** "Forget all stored keys" — the standing global action in settings. */
export async function forgetAllKeys(providers: SidecarProvider[]): Promise<void> {
  for (const p of providers) {
    await forgetKey(p);
  }
}

function sessionKey(provider: SidecarProvider): string {
  return `${SESSION_PREFIX}${provider}`;
}

function idbKey(provider: SidecarProvider): string {
  return `${IDB_PREFIX}${provider}`;
}

function preview(key: string): string {
  if (key.length <= 4) return '••';
  return `••••${key.slice(-4)}`;
}
