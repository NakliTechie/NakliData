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
  /**
   * Provider model id (e.g., `claude-3-5-haiku-latest`). Reflects the
   * model for the CURRENTLY-selected provider. When the user switches
   * provider, this is restored from `sidecarModelByProvider` rather
   * than reset to a hardcoded default — so a manually-typed
   * `claude-sonnet-4` survives a switch-away-and-back round-trip.
   */
  sidecarModel: string;
  /**
   * Per-provider model id memory. The UI updates this whenever the
   * model field changes for the selected provider. On provider switch
   * we read the relevant entry to populate `sidecarModel` instead of
   * the hardcoded `DEFAULT_PROVIDER_CONFIG[provider].model`. Entries
   * are optional so a fresh install falls back to the per-provider
   * default. (Adversarial-review HIGH finding, 2026-06-03.)
   */
  sidecarModelByProvider: Partial<Record<SidecarProvider, string>>;
  /**
   * Wave 2 W2.3 — base URL for the custom OpenAI-compatible provider.
   * Empty string when not configured. Used only when sidecarProvider
   * is `'custom'`. Local llamafiles, vLLM, Ollama, LM Studio, etc.
   */
  sidecarCustomEndpoint: string;
  /**
   * Demo / censor mode. When true, user-data labels (source labels,
   * table names, column names, source origins, result-table column
   * headers) are replaced visually with stable obscured tokens
   * (`src_1`, `tbl_1`, `col_1`, …). Theme 4 wave 2 (B4). Off by
   * default; users opt in for screenshots and demos.
   */
  demoMode: boolean;
  /**
   * Wave 1 W1.6 — Map cell basemap. `'none'` (default) keeps the
   * tile-less, privacy-clean canvas. `'osm'` enables OpenStreetMap
   * raster tiles (https://tile.openstreetmap.org/...). Opting in
   * crosses a privacy line: the OSM servers see tile requests for
   * whichever extent the map cell renders. Default off; explicit
   * opt-in. Spec amendment A13.
   */
  mapBasemap: 'none' | 'osm';
  /**
   * Agent surfaces (2026-07-24, DECISIONS EE-0b) — write access for the
   * `window.naklidata` agent bridge. The READ verbs (describe / listTables /
   * listCells / query) are always on: they're validator-gated, value-redacted,
   * and are the whole point (the semantic layer is the agent surface). The
   * WRITE verbs (proposeCell / runCell) mutate the notebook, so they're refused
   * unless this is on. Off by default — an agent gets grounding for free, and
   * the human opts in before an agent can touch the workbook.
   */
  agentWritesEnabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  autoAcceptThreshold: 0.9,
  sidecarEnabled: false,
  sidecarProvider: 'anthropic',
  sidecarModel: 'claude-3-5-haiku-latest',
  sidecarCustomEndpoint: '',
  sidecarModelByProvider: {},
  demoMode: false,
  mapBasemap: 'none',
  agentWritesEnabled: false,
};

const KEY = 'settings/v1';

// Synchronous mirror of the last loaded/saved settings. Most consumers read
// settings asynchronously at the point they need them, but some surfaces need a
// SYNCHRONOUS live read (e.g. the agent bridge's write gate, which is called
// from a `window.naklidata` verb). Seeded on the first `loadSettings()` at boot
// and kept fresh by every `saveSettings()`. Defaults are the safe pre-load state.
let _current: Settings = { ...DEFAULT_SETTINGS };

/** The current settings, synchronously. Reflects the last load or save; returns
 *  defaults before the first `loadSettings()` (so a gated feature reads OFF). */
export function currentSettings(): Settings {
  return _current;
}

export async function loadSettings(): Promise<Settings> {
  const raw = await kvGet<Partial<Settings>>(KEY);
  _current = raw ? { ...DEFAULT_SETTINGS, ...normalize(raw) } : { ...DEFAULT_SETTINGS };
  return { ..._current };
}

export async function saveSettings(settings: Settings): Promise<void> {
  _current = { ...DEFAULT_SETTINGS, ...normalize(settings) };
  await kvPut(KEY, normalize(settings));
}

function normalize(s: Partial<Settings>): Partial<Settings> {
  const out: Partial<Settings> = {};
  if (typeof s.autoAcceptThreshold === 'number' && Number.isFinite(s.autoAcceptThreshold)) {
    out.autoAcceptThreshold = clamp(s.autoAcceptThreshold, 0.5, 1);
  }
  if (typeof s.sidecarEnabled === 'boolean') out.sidecarEnabled = s.sidecarEnabled;
  if (
    s.sidecarProvider === 'anthropic' ||
    s.sidecarProvider === 'openai' ||
    s.sidecarProvider === 'custom' ||
    // 'local' (in-browser model) is persistence-valid now so a saved
    // choice round-trips once W3.2 slice B exposes the Settings toggle.
    s.sidecarProvider === 'local'
  ) {
    out.sidecarProvider = s.sidecarProvider;
  }
  if (typeof s.sidecarModel === 'string' && s.sidecarModel.trim()) {
    out.sidecarModel = s.sidecarModel.trim();
  }
  if (typeof s.sidecarCustomEndpoint === 'string') {
    out.sidecarCustomEndpoint = s.sidecarCustomEndpoint.trim();
  }
  if (s.sidecarModelByProvider && typeof s.sidecarModelByProvider === 'object') {
    // Only keep entries whose values are strings — defensive against
    // a corrupted IDB record. Provider keys outside the known set
    // get filtered too.
    const known: SidecarProvider[] = ['anthropic', 'openai', 'custom', 'local'];
    const filtered: Partial<Record<SidecarProvider, string>> = {};
    for (const p of known) {
      const v = (s.sidecarModelByProvider as Record<string, unknown>)[p];
      if (typeof v === 'string' && v.trim()) filtered[p] = v.trim();
    }
    out.sidecarModelByProvider = filtered;
  }
  if (typeof s.demoMode === 'boolean') out.demoMode = s.demoMode;
  if (s.mapBasemap === 'none' || s.mapBasemap === 'osm') out.mapBasemap = s.mapBasemap;
  if (typeof s.agentWritesEnabled === 'boolean') out.agentWritesEnabled = s.agentWritesEnabled;
  return out;
}

function clamp(n: number, min: number, max: number): number {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}
