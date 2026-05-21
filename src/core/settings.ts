// Workspace-level settings, persisted to IndexedDB. Loaded on boot,
// saved on change. Currently holds: auto-accept threshold for
// classification, sidecar enabled toggle (v1.1 placeholder).
//
// Lives separately from `.naklidata` files: `.naklidata` is a notebook
// description; settings are user preferences that travel with the tab,
// not the file.

import { kvGet, kvPut } from './idb.ts';
import type { SidecarProvider } from './sidecar/types.ts';

export interface Settings {
  /** 0.5 .. 1.0 — slider in the schema panel. */
  autoAcceptThreshold: number;
  /** Sidecar enable. When false, the Explain button + other sidecar entry points are hidden. */
  sidecarEnabled: boolean;
  /** Which BYOK provider the dispatch layer talks to. */
  sidecarProvider: SidecarProvider;
  /** Provider model id (e.g., `claude-3-5-haiku-latest`). */
  sidecarModel: string;
  /**
   * Demo / censor mode. When true, user-data labels (source labels,
   * table names, column names, source origins, result-table column
   * headers) are replaced visually with stable obscured tokens
   * (`src_1`, `tbl_1`, `col_1`, …). Theme 4 wave 2 (B4). Off by
   * default; users opt in for screenshots and demos.
   */
  demoMode: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  autoAcceptThreshold: 0.9,
  sidecarEnabled: false,
  sidecarProvider: 'anthropic',
  sidecarModel: 'claude-3-5-haiku-latest',
  demoMode: false,
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
  if (s.sidecarProvider === 'anthropic' || s.sidecarProvider === 'openai') {
    out.sidecarProvider = s.sidecarProvider;
  }
  if (typeof s.sidecarModel === 'string' && s.sidecarModel.trim()) {
    out.sidecarModel = s.sidecarModel.trim();
  }
  if (typeof s.demoMode === 'boolean') out.demoMode = s.demoMode;
  return out;
}

function clamp(n: number, min: number, max: number): number {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}
