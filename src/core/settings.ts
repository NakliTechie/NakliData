// Workspace-level settings, persisted to IndexedDB. Loaded on boot,
// saved on change. Currently holds: auto-accept threshold for
// classification, sidecar enabled toggle (v1.1 placeholder).
//
// Lives separately from `.naklidata` files: `.naklidata` is a notebook
// description; settings are user preferences that travel with the tab,
// not the file.

import { kvGet, kvPut } from './idb.ts';

export interface Settings {
  /** 0.5 .. 1.0 — slider in the schema panel. */
  autoAcceptThreshold: number;
  /** Sidecar enable (v1.1 placeholder). */
  sidecarEnabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  autoAcceptThreshold: 0.9,
  sidecarEnabled: false,
};

const KEY = 'settings/v1';

export async function loadSettings(): Promise<Settings> {
  const raw = await kvGet<Partial<Settings>>(KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...normalize(raw) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await kvPut(KEY, normalize(settings));
}

function normalize(s: Partial<Settings>): Partial<Settings> {
  const out: Partial<Settings> = {};
  if (typeof s.autoAcceptThreshold === 'number' && Number.isFinite(s.autoAcceptThreshold)) {
    out.autoAcceptThreshold = clamp(s.autoAcceptThreshold, 0.5, 1);
  }
  if (typeof s.sidecarEnabled === 'boolean') out.sidecarEnabled = s.sidecarEnabled;
  return out;
}

function clamp(n: number, min: number, max: number): number {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}
