// Settings modal — provider config + BYOK key entry per spec
// amendment A2. Wording matches the amendment ("Stored on this
// device. Anyone with access to this browser profile can read it.")

import { setDemoMode } from '../core/demo-mode.ts';
import { loadChunk } from '../core/lazy-loader.ts';
import { type Settings, loadSettings, saveSettings } from '../core/settings.ts';
import {
  type BYOKEntry,
  forgetAllKeys,
  forgetKey,
  loadKey,
  locateKey,
  saveKey,
} from '../core/sidecar/byok.ts';
import {
  clearAllCachedModels,
  clearCachedModel,
  formatCacheSize,
  isOpfsAvailable,
  listCachedModels,
} from '../core/sidecar/local-cache.ts';
import { callCustomOpenAI } from '../core/sidecar/providers/custom-openai.ts';
import { DEFAULT_PROVIDER_CONFIG, type SidecarProvider } from '../core/sidecar/types.ts';
import { iconSvg } from '../tokens/icons.ts';
import { restoreModalFocus } from './modal-focus.ts';

const PROVIDERS: SidecarProvider[] = ['anthropic', 'openai', 'custom'];

/**
 * Curated list of HF ONNX models the Settings UI offers for the
 * `local` provider. Per scoping doc Decision 1: Qwen2.5-1.5B is the
 * recommended default (smallest credible chat model, Apache 2.0);
 * Phi-3.5-mini is the bigger-quality option; Llama-3.2-1B is the
 * smallest credible download.
 *
 * Adding entries is intentional and load-bearing — each is a
 * recommended multi-GB download that we're telling users to commit
 * to. Drift requires a /decide.
 */
const LOCAL_MODEL_OPTIONS: ReadonlyArray<{
  id: string;
  label: string;
  summary: string;
}> = [
  {
    id: 'onnx-community/Qwen2.5-1.5B-Instruct',
    label: 'Qwen2.5-1.5B-Instruct (recommended)',
    summary: '~0.9 GB · Apache 2.0 · balanced quality + size',
  },
  {
    id: 'onnx-community/Phi-3.5-mini-instruct',
    label: 'Phi-3.5-mini-instruct',
    summary: '~2.3 GB · MIT · best NL→SQL quality',
  },
  {
    id: 'onnx-community/Llama-3.2-1B-Instruct',
    label: 'Llama-3.2-1B-Instruct',
    summary: '~0.7 GB · Llama license · smallest, fastest',
  },
];

let _modalEl: HTMLElement | null = null;
let _previouslyFocused: HTMLElement | null = null;
let _onKey: ((ev: KeyboardEvent) => void) | null = null;

export async function openSettingsModal(): Promise<void> {
  if (_modalEl && document.body.contains(_modalEl)) return;
  _previouslyFocused = (document.activeElement as HTMLElement) ?? null;
  const overlay = renderModal();
  document.body.append(overlay);
  _modalEl = overlay;
  await refresh();
  // Move focus into the modal so keyboard users can interact + Escape works
  // even when focus was last on a now-hidden element.
  overlay.querySelector<HTMLElement>('[data-action="close-settings"]')?.focus();
}

export function closeSettingsModal(): void {
  if (_modalEl?.parentElement) _modalEl.parentElement.removeChild(_modalEl);
  _modalEl = null;
  // Unconditional listener teardown — the inline self-removing handler
  // leaked when the user closed via the X button (not Escape).
  if (_onKey) {
    document.removeEventListener('keydown', _onKey);
    _onKey = null;
  }
  restoreModalFocus(_previouslyFocused);
  _previouslyFocused = null;
}

async function refresh(): Promise<void> {
  const overlay = _modalEl;
  if (!overlay) return;
  const settings = await loadSettings();
  const provider = settings.sidecarProvider;
  setRadio(overlay, 'settings-provider', provider);
  const modelInput = overlay.querySelector<HTMLInputElement>('[data-action="settings-model"]');
  if (modelInput) modelInput.value = settings.sidecarModel;
  const enableInput = overlay.querySelector<HTMLInputElement>('[data-action="settings-enable"]');
  if (enableInput) enableInput.checked = settings.sidecarEnabled;
  const demoInput = overlay.querySelector<HTMLInputElement>('[data-action="settings-demo-mode"]');
  if (demoInput) demoInput.checked = settings.demoMode;
  const basemapInput = overlay.querySelector<HTMLInputElement>(
    '[data-action="settings-map-basemap"]',
  );
  if (basemapInput) basemapInput.checked = settings.mapBasemap === 'osm';
  // Wave 2 W2.3 — custom endpoint URL field is only relevant when the
  // provider is `'custom'`. Hide the row otherwise to keep the form
  // shape compact.
  const customRow = overlay.querySelector<HTMLElement>(
    '[data-region="settings-custom-endpoint-row"]',
  );
  const customInput = overlay.querySelector<HTMLInputElement>(
    '[data-action="settings-custom-endpoint"]',
  );
  if (customRow) customRow.hidden = provider !== 'custom';
  if (customInput) customInput.value = settings.sidecarCustomEndpoint;
  if (provider === 'custom') updateEndpointInspector(overlay, settings.sidecarCustomEndpoint);
  // Adversarial-review codex P2 (2026-06-03): the generic "Model"
  // text field is meaningful only for cloud / custom providers.
  // For the local provider, the curated radios in the Local section
  // ARE the model picker — and a free-text edit there would persist
  // arbitrary text into `sidecarModel`, which `generate()` then
  // passes to `loadPipeline` and triggers an unprompted multi-GB
  // download outside the "Download & load" flow.
  const modelRow = modelInput?.closest<HTMLElement>('label.settings-field');
  if (modelRow) modelRow.hidden = provider === 'local';
  // Local-model section (W3.2 slice B chunk 3): show only when
  // provider is 'local'; pre-select the configured model id (default
  // = LOCAL_MODEL_OPTIONS[0].id when nothing is configured); refresh
  // the cached-models list.
  const localRow = overlay.querySelector<HTMLElement>('[data-region="settings-local-section"]');
  if (localRow) localRow.hidden = provider !== 'local';
  if (provider === 'local') {
    const targetModelId = settings.sidecarModel || LOCAL_MODEL_OPTIONS[0]?.id || '';
    setRadio(overlay, 'settings-local-model', targetModelId);
    await refreshLocalCacheList(overlay);
  }
  await renderProviderBlocks(overlay, settings);
}

/**
 * Surface the resolved host + a warning when the typed URL is not a
 * valid `https:` endpoint.
 *
 * Threat the warning addresses (Forward-pass M3, 2026-06-02): the user
 * is about to ship their BYOK key + every prompt context to whatever
 * URL this field holds. A typo (`api.opena1.com`) or a
 * paste-from-clipboard-with-instructions attack would otherwise leak
 * keys silently — CSP `connect-src https:` permits any HTTPS origin.
 *
 * Implementation: empty input → no warning, no host chip. Bad URL or
 * non-https → red warning, no host chip. Good URL → green host chip
 * showing the resolved hostname so the user can spot drift at a glance.
 */
function updateEndpointInspector(overlay: HTMLElement, value: string): void {
  const hostEl = overlay.querySelector<HTMLElement>('[data-region="settings-endpoint-host"]');
  const warnEl = overlay.querySelector<HTMLElement>('[data-region="settings-endpoint-warn"]');
  if (!hostEl || !warnEl) return;
  const trimmed = value.trim();
  if (!trimmed) {
    hostEl.textContent = '';
    hostEl.hidden = true;
    warnEl.textContent = '';
    warnEl.hidden = true;
    return;
  }
  let parsed: URL | null = null;
  try {
    parsed = new URL(trimmed);
  } catch {
    parsed = null;
  }
  if (!parsed) {
    hostEl.hidden = true;
    warnEl.textContent = 'Not a valid URL. Your key will not be sent until this is fixed.';
    warnEl.hidden = false;
    return;
  }
  if (parsed.protocol !== 'https:') {
    hostEl.hidden = true;
    warnEl.textContent = `Only https:// endpoints are accepted (got "${parsed.protocol}"). The browser's CSP will reject this URL.`;
    warnEl.hidden = false;
    return;
  }
  hostEl.textContent = `Will POST to: ${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`;
  hostEl.hidden = false;
  warnEl.hidden = true;
}

async function renderProviderBlocks(overlay: HTMLElement, settings: Settings): Promise<void> {
  const region = overlay.querySelector<HTMLElement>('[data-region="provider-blocks"]');
  if (!region) return;
  region.innerHTML = '';
  for (const provider of PROVIDERS) {
    const entry = await locateKey(provider);
    region.append(renderProviderBlock(provider, entry, provider === settings.sidecarProvider));
  }
}

function renderProviderBlock(
  provider: SidecarProvider,
  entry: BYOKEntry,
  isActive: boolean,
): HTMLElement {
  const block = document.createElement('div');
  block.className = 'settings-provider-block';
  block.dataset.provider = provider;
  const status = formatStatus(entry);
  const defaultModel = DEFAULT_PROVIDER_CONFIG[provider].model;
  block.innerHTML = `
    <div class="settings-provider-head">
      <strong>${providerLabel(provider)}</strong>
      ${isActive ? '<span class="settings-active-pill">active</span>' : ''}
    </div>
    <div class="settings-provider-status">${status.text}</div>
    ${
      status.canForget
        ? `<button class="btn btn-ghost" data-action="settings-forget" data-provider="${provider}">${iconSvg('x', 12)} Forget this key</button>`
        : ''
    }
    <div class="settings-provider-form">
      <label class="settings-field">
        <span>API key</span>
        <input
          type="password"
          autocomplete="off"
          spellcheck="false"
          data-action="settings-key-input"
          data-provider="${provider}"
          placeholder="${provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'}"
        />
      </label>
      <label class="settings-remember">
        <input type="checkbox" data-action="settings-remember" data-provider="${provider}" />
        <span>Remember on this device</span>
      </label>
      <button class="btn btn-primary" data-action="settings-save-key" data-provider="${provider}">
        Save key
      </button>
      <p class="settings-hint">
        Default: cleared when the tab closes. Check "Remember" to store in this browser's IndexedDB —
        anyone with access to this browser profile will then be able to read it.
        Model default: <code>${defaultModel}</code>.
      </p>
    </div>
  `;
  return block;
}

function formatStatus(entry: BYOKEntry): { text: string; canForget: boolean } {
  if (entry.location === 'session') {
    return {
      text: `In sessionStorage (${entry.preview}). Will clear when you close this tab.`,
      canForget: true,
    };
  }
  if (entry.location === 'idb') {
    return {
      text: `Stored on this device (${entry.preview}). Anyone with access to this browser profile can read it.`,
      canForget: true,
    };
  }
  return { text: 'Not configured.', canForget: false };
}

function providerLabel(provider: SidecarProvider): string {
  if (provider === 'anthropic') return 'Anthropic (Claude)';
  if (provider === 'openai') return 'OpenAI';
  return 'Custom (OpenAI-compatible)';
}

function setRadio(root: HTMLElement, name: string, value: string): void {
  for (const input of root.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)) {
    input.checked = input.value === value;
  }
}

function renderModal(): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'schema-graph-overlay settings-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Settings');
  overlay.innerHTML = `
    <div class="schema-graph-modal settings-modal">
      <div class="schema-graph-header">
        <strong>Settings — AI sidecar (BYOK)</strong>
        <span class="schema-graph-status">Spec amendment A2: keys stay in sessionStorage by default.</span>
        <button class="btn btn-ghost schema-graph-close" data-action="close-settings" aria-label="Close">
          ${iconSvg('x', 14)}
        </button>
      </div>
      <div class="settings-body">
        <section class="settings-section">
          <h2>Sidecar</h2>
          <label class="settings-remember">
            <input type="checkbox" data-action="settings-enable" />
            <span>Enable sidecar (shows the Explain button on errored SQL cells)</span>
          </label>
          <p class="settings-hint">Per spec §4.3: the v1.1 sidecar is narrow — it explains query errors, helps disambiguate column types, and helps define new types. It never generates SQL you didn't write yourself.</p>
        </section>
        <section class="settings-section">
          <h2>Demo / censor mode</h2>
          <label class="settings-remember">
            <input type="checkbox" data-action="settings-demo-mode" />
            <span>Mask source, table, and column names with stable tokens (<code>src_1</code>, <code>tbl_1</code>, <code>col_1</code>…)</span>
          </label>
          <p class="settings-hint">For screenshots and demos. Row values, SQL cell text, and the underlying engine queries are NOT masked — clear cells before screenshotting if they contain sensitive data. Toggle off any time to reveal real labels.</p>
        </section>
        <section class="settings-section">
          <h2>Map basemap</h2>
          <label class="settings-remember">
            <input type="checkbox" data-action="settings-map-basemap" />
            <span>Show OpenStreetMap tiles behind map cells <em>(opt-in — see below)</em></span>
          </label>
          <p class="settings-hint">
            Default is a tile-less canvas: nothing leaves the tab. Enabling this
            fetches raster tiles from <code>tile.openstreetmap.org</code> for
            whichever extent each map cell renders — area-of-interest leaks to
            OSM's servers. Tiles are images only (no scripts). Attribution shown
            on the map. Spec amendment A13.
          </p>
        </section>
        <section class="settings-section">
          <h2>Active provider</h2>
          <div class="settings-radio-row">
            <label><input type="radio" name="settings-provider" value="anthropic" /> Anthropic (Claude)</label>
            <label><input type="radio" name="settings-provider" value="openai" /> OpenAI</label>
            <label><input type="radio" name="settings-provider" value="custom" /> Custom (OpenAI-compatible)</label>
            <label><input type="radio" name="settings-provider" value="local" /> Local (in-browser, no API key)</label>
          </div>
          <label class="settings-field">
            <span>Model</span>
            <input type="text" data-action="settings-model" placeholder="claude-3-5-haiku-latest" />
          </label>
          <label class="settings-field" data-region="settings-custom-endpoint-row" hidden>
            <span>Custom endpoint URL <em>(OpenAI-compatible — local llamafile, vLLM, Ollama, LM Studio)</em></span>
            <input type="url" data-action="settings-custom-endpoint" placeholder="https://my-llm.example.com" autocomplete="off" spellcheck="false" />
            <div class="settings-endpoint-host" data-region="settings-endpoint-host"></div>
            <div class="settings-endpoint-warn" data-region="settings-endpoint-warn" hidden></div>
            <div class="settings-test-row">
              <button class="btn btn-ghost" data-action="settings-test-custom">Test connection</button>
              <span class="settings-test-result" data-region="settings-test-result"></span>
            </div>
          </label>
          <div class="settings-field" data-region="settings-local-section" hidden>
            <span>Local model <em>(runs in this tab — no API key, no network calls after download)</em></span>
            <div class="settings-local-picker">
              ${LOCAL_MODEL_OPTIONS.map(
                (m) => `
                <label class="settings-local-option">
                  <input type="radio" name="settings-local-model" value="${m.id}" data-action="settings-local-model" />
                  <div>
                    <strong>${m.label}</strong>
                    <em>${m.summary}</em>
                  </div>
                </label>`,
              ).join('')}
            </div>
            <div class="settings-local-actions">
              <button class="btn btn-primary" data-action="settings-local-load">${iconSvg('download', 12)} Download &amp; load</button>
              <button class="btn btn-ghost" data-action="settings-local-forget-all" title="Delete every cached model from this device">${iconSvg('warning', 12)} Forget all cached models</button>
            </div>
            <div class="settings-local-status" data-region="settings-local-status" hidden></div>
            <div class="settings-local-cache" data-region="settings-local-cache"></div>
          </div>
        </section>
        <section class="settings-section">
          <h2>API keys</h2>
          <div data-region="provider-blocks"></div>
          <div class="settings-actions">
            <button class="btn btn-ghost" data-action="settings-forget-all" title="Drop every stored key from sessionStorage + IDB">
              ${iconSvg('warning', 12)} Forget all stored keys
            </button>
          </div>
        </section>
      </div>
    </div>
  `;

  overlay.addEventListener('click', async (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    if (target === overlay) return closeSettingsModal();
    if (target.closest('[data-action="close-settings"]')) return closeSettingsModal();
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (!action) return;
    await handleAction(overlay, action, target);
  });
  overlay.addEventListener('change', async (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'settings-enable') {
      const enabled = (target as HTMLInputElement).checked;
      await patchSettings({ sidecarEnabled: enabled });
      document.getElementById('app')?.classList.toggle('app-sidecar-enabled', enabled);
    }
    if (action === 'settings-demo-mode') {
      const enabled = (target as HTMLInputElement).checked;
      await patchSettings({ demoMode: enabled });
      setDemoMode(enabled);
      document.getElementById('app')?.classList.toggle('app-demo-mode', enabled);
      // Notify the rest of the app so visible surfaces re-render with
      // masked / unmasked labels. main.ts owns the re-render orchestration.
      document.dispatchEvent(
        new CustomEvent('naklidata-demo-mode-changed', { detail: { enabled } }),
      );
    }
    if (action === 'settings-map-basemap') {
      const enabled = (target as HTMLInputElement).checked;
      await patchSettings({ mapBasemap: enabled ? 'osm' : 'none' });
      // Existing map cells keep their current canvas until re-rendered;
      // a notebook re-run picks up the new setting via loadSettings() on
      // each map cell render. No live event needed.
    }
    if (
      target instanceof HTMLInputElement &&
      target.name === 'settings-provider' &&
      target.checked
    ) {
      const provider = target.value as SidecarProvider;
      const current = await loadSettings();
      const defaults = DEFAULT_PROVIDER_CONFIG[provider];
      // Adversarial-review HIGH (2026-06-03): prefer the per-provider
      // memoised id over a hardcoded default. A user who switched
      // away from Anthropic with `claude-sonnet-4` typed in shouldn't
      // lose it on switch back. Local provider's recommended Qwen
      // still wins when nothing's memoised yet.
      const memo = current.sidecarModelByProvider?.[provider];
      const modelId =
        memo ||
        (provider === 'local' ? (LOCAL_MODEL_OPTIONS[0]?.id ?? defaults.model) : defaults.model);
      // Memoise the OUTGOING provider's current model id so it
      // survives a switch back. Skip when the outgoing model is
      // empty (e.g. fresh install before anything's been typed).
      const outgoing = current.sidecarProvider;
      const outgoingModel = current.sidecarModel?.trim();
      const memoUpdate: Partial<Record<SidecarProvider, string>> = {
        ...current.sidecarModelByProvider,
      };
      if (outgoingModel) memoUpdate[outgoing] = outgoingModel;
      await patchSettings({
        sidecarProvider: provider,
        sidecarModel: modelId,
        sidecarModelByProvider: memoUpdate,
      });
      await refresh();
    }
    if (
      target instanceof HTMLInputElement &&
      target.name === 'settings-local-model' &&
      target.checked
    ) {
      // Persist the chosen local model id + memoise so future
      // provider switch round-trip restores it.
      const current = await loadSettings();
      const memoUpdate: Partial<Record<SidecarProvider, string>> = {
        ...current.sidecarModelByProvider,
        local: target.value,
      };
      await patchSettings({
        sidecarModel: target.value,
        sidecarModelByProvider: memoUpdate,
      });
    }
  });
  overlay.addEventListener('input', async (ev) => {
    const target = ev.target as HTMLInputElement | null;
    if (!target) return;
    if (target.dataset.action === 'settings-model') {
      // Memo the model id under the active provider so a switch
      // round-trip restores it (HIGH finding follow-up).
      const current = await loadSettings();
      const memoUpdate: Partial<Record<SidecarProvider, string>> = {
        ...current.sidecarModelByProvider,
      };
      if (target.value.trim()) memoUpdate[current.sidecarProvider] = target.value.trim();
      await patchSettings({
        sidecarModel: target.value,
        sidecarModelByProvider: memoUpdate,
      });
    }
    if (target.dataset.action === 'settings-custom-endpoint') {
      await patchSettings({ sidecarCustomEndpoint: target.value });
      // Surface host + scheme inline so the user can spot a typo / pasted
      // clipboard before clicking Test or making a real call. Forward-pass
      // M3 (2026-06-02) — silent send to e.g. `api.opena1.com` is the
      // BYOK-key-exfil risk we're closing.
      updateEndpointInspector(overlay, target.value);
    }
  });
  // Stash at module scope so closeSettingsModal() can detach it
  // regardless of which path closed the modal (X / backdrop / Escape).
  _onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') closeSettingsModal();
  };
  document.addEventListener('keydown', _onKey);
  return overlay;
}

/**
 * Re-render the "Cached on this device" list under the Local model
 * section. Pulled from local-cache module (chunk 1).
 *
 * If OPFS isn't available (older browsers, Firefox private-browsing
 * <111), display a one-line "Local model caching unavailable" hint
 * instead of an empty list.
 */
async function refreshLocalCacheList(overlay: HTMLElement): Promise<void> {
  const region = overlay.querySelector<HTMLElement>('[data-region="settings-local-cache"]');
  if (!region) return;
  if (!(await isOpfsAvailable())) {
    region.innerHTML = `<p class="settings-local-cache-empty">Local model caching is not available in this browser.</p>`;
    return;
  }
  const cached = await listCachedModels();
  if (cached.length === 0) {
    region.innerHTML = `<p class="settings-local-cache-empty">No cached models on this device.</p>`;
    return;
  }
  const total = cached.reduce((sum, m) => sum + m.totalBytes, 0);
  const rows = cached
    .map(
      (m) => `
      <li class="settings-local-cache-row">
        <span class="settings-local-cache-id">${escapeText(m.modelId)}</span>
        <span class="settings-local-cache-size">${formatCacheSize(m.totalBytes)}</span>
        <button class="btn btn-ghost" data-action="settings-local-delete" data-model-id="${escapeText(m.modelId)}" title="Delete this model from OPFS">${iconSvg('x', 12)}</button>
      </li>`,
    )
    .join('');
  region.innerHTML = `
    <div class="settings-local-cache-header">Cached on this device — total ${formatCacheSize(total)}</div>
    <ul class="settings-local-cache-list">${rows}</ul>
  `;
}

/**
 * Small textContent escaper for safe-by-default attribute / display
 * interpolation. Same shape as the existing escapeHtml helper in
 * other modals.
 */
function escapeText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Format a per-file progress event from Transformers.js into the
 * one-line status the Settings UI shows. The library's progress
 * stream is granular (per-file: initiate / download / progress /
 * done); we collapse to "Downloading <file>: <loaded> / <total>".
 */
function formatLocalProgress(p: {
  file?: string;
  loaded?: number;
  total?: number;
  progress?: number;
  status?: string;
}): string {
  const file = p.file ?? 'model files';
  if (p.status === 'ready' || p.status === 'done') return `${file}: done`;
  if (p.loaded !== undefined && p.total !== undefined && p.total > 0) {
    const pct = Math.round((p.loaded / p.total) * 100);
    return `Downloading ${file}: ${formatCacheSize(p.loaded)} / ${formatCacheSize(p.total)} (${pct}%)`;
  }
  return `${p.status ?? 'Working'}: ${file}`;
}

/** Show the local-section status line; pass null to hide. */
function setLocalStatus(overlay: HTMLElement, text: string | null): void {
  const el = overlay.querySelector<HTMLElement>('[data-region="settings-local-status"]');
  if (!el) return;
  if (text === null) {
    el.hidden = true;
    el.textContent = '';
  } else {
    el.hidden = false;
    el.textContent = text;
  }
}

async function handleAction(
  overlay: HTMLElement,
  action: string,
  target: HTMLElement,
): Promise<void> {
  if (action === 'settings-save-key') {
    const provider = target.dataset.provider as SidecarProvider | undefined;
    if (!provider) return;
    const input = overlay.querySelector<HTMLInputElement>(
      `[data-action="settings-key-input"][data-provider="${provider}"]`,
    );
    const remember = overlay.querySelector<HTMLInputElement>(
      `[data-action="settings-remember"][data-provider="${provider}"]`,
    );
    if (!input || !remember) return;
    const key = input.value;
    if (!key.trim()) {
      flashStatus(overlay, 'Enter an API key before saving.');
      return;
    }
    try {
      await saveKey(provider, key, remember.checked);
      input.value = '';
      remember.checked = false;
      flashStatus(overlay, `${providerLabel(provider)} key saved.`);
      await refresh();
    } catch (err) {
      flashStatus(overlay, `Could not save key: ${err instanceof Error ? err.message : err}`);
    }
    return;
  }
  if (action === 'settings-forget') {
    const provider = target.dataset.provider as SidecarProvider | undefined;
    if (!provider) return;
    await forgetKey(provider);
    flashStatus(overlay, `${providerLabel(provider)} key forgotten.`);
    await refresh();
    return;
  }
  if (action === 'settings-forget-all') {
    const ok = window.confirm('Drop every saved API key from sessionStorage + IndexedDB?');
    if (!ok) return;
    await forgetAllKeys(PROVIDERS);
    flashStatus(overlay, 'All stored keys forgotten.');
    await refresh();
    return;
  }
  if (action === 'settings-test-custom') {
    await testCustomConnection(overlay, target);
    return;
  }
  if (action === 'settings-local-load') {
    await loadLocalModel(overlay);
    return;
  }
  if (action === 'settings-local-delete') {
    const modelId = target.dataset.modelId;
    if (!modelId) return;
    const ok = window.confirm(
      `Delete ${modelId} from this device? You can re-download from Settings later.`,
    );
    if (!ok) return;
    await clearCachedModel(modelId);
    flashStatus(overlay, `${modelId} deleted from cache.`);
    await refreshLocalCacheList(overlay);
    return;
  }
  if (action === 'settings-local-forget-all') {
    const ok = window.confirm(
      'Delete every cached model from this device? You can re-download later.',
    );
    if (!ok) return;
    await clearAllCachedModels();
    flashStatus(overlay, 'All cached models deleted.');
    await refreshLocalCacheList(overlay);
    return;
  }
}

/**
 * Probe the configured custom endpoint with the smallest possible
 * chat-completion request. Surfaces real HTTP errors inline so the
 * user can debug config without waiting for the first job to fail.
 */
async function testCustomConnection(overlay: HTMLElement, target: HTMLElement): Promise<void> {
  const resultEl = overlay.querySelector<HTMLElement>('[data-region="settings-test-result"]');
  const buttonEl = target as HTMLButtonElement;
  const settings = await loadSettings();
  if (!settings.sidecarCustomEndpoint.trim()) {
    if (resultEl) {
      resultEl.textContent = 'Enter an endpoint URL first.';
      resultEl.dataset.state = 'error';
    }
    return;
  }
  if (!settings.sidecarModel.trim()) {
    if (resultEl) {
      resultEl.textContent = 'Set a model id (above) first.';
      resultEl.dataset.state = 'error';
    }
    return;
  }
  const apiKey = await loadKey('custom');
  if (!apiKey) {
    if (resultEl) {
      resultEl.textContent =
        'No API key saved for "custom" — save one below (use any placeholder if the endpoint is unauthenticated).';
      resultEl.dataset.state = 'error';
    }
    return;
  }
  if (resultEl) {
    resultEl.textContent = 'Probing…';
    resultEl.dataset.state = 'pending';
  }
  buttonEl.disabled = true;
  try {
    const text = await callCustomOpenAI({
      endpointUrl: settings.sidecarCustomEndpoint,
      apiKey,
      model: settings.sidecarModel,
      system: 'Reply with the single character "k".',
      user: 'ping',
      maxTokens: 4,
    });
    if (resultEl) {
      resultEl.textContent = `✓ OK · returned "${text.slice(0, 24)}${text.length > 24 ? '…' : ''}"`;
      resultEl.dataset.state = 'ok';
    }
  } catch (err) {
    if (resultEl) {
      resultEl.textContent = `✗ ${err instanceof Error ? err.message : String(err)}`;
      resultEl.dataset.state = 'error';
    }
  } finally {
    buttonEl.disabled = false;
  }
}

/**
 * Click handler for "Download & load" in the Local model section.
 * Loads the Transformers.js chunk (lazy), starts the model download
 * via `loadAndRegister`, surfaces progress in the status line, and
 * refreshes the cached-models list when done. Disables the button
 * while in flight so the user can't double-click.
 */
async function loadLocalModel(overlay: HTMLElement): Promise<void> {
  if (!(await isOpfsAvailable())) {
    setLocalStatus(
      overlay,
      'Local model caching is not available in this browser. Try a recent Chrome / Edge / Safari.',
    );
    return;
  }
  const selected = overlay.querySelector<HTMLInputElement>(
    'input[name="settings-local-model"]:checked',
  );
  const modelId = selected?.value || LOCAL_MODEL_OPTIONS[0]?.id;
  if (!modelId) {
    setLocalStatus(overlay, 'Pick a model first.');
    return;
  }
  await patchSettings({ sidecarModel: modelId });
  const button = overlay.querySelector<HTMLButtonElement>('[data-action="settings-local-load"]');
  if (button) button.disabled = true;
  setLocalStatus(overlay, 'Loading Transformers.js chunk…');
  try {
    const mod = await loadChunk('transformers');
    setLocalStatus(overlay, `Preparing ${modelId}…`);
    await mod.loadAndRegister(modelId, (p) => {
      setLocalStatus(overlay, formatLocalProgress(p));
    });
    setLocalStatus(overlay, `${modelId} loaded and ready.`);
    flashStatus(overlay, `Local model ${modelId} ready.`);
    await refreshLocalCacheList(overlay);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setLocalStatus(overlay, `Load failed: ${msg}`);
    flashStatus(overlay, `Could not load model: ${msg}`);
  } finally {
    if (button) button.disabled = false;
  }
}

async function patchSettings(patch: Partial<Settings>): Promise<void> {
  const current = await loadSettings();
  await saveSettings({ ...current, ...patch });
}

function flashStatus(overlay: HTMLElement, message: string): void {
  const status = overlay.querySelector<HTMLElement>('.schema-graph-status');
  if (!status) return;
  const original = status.textContent ?? '';
  status.textContent = message;
  window.setTimeout(() => {
    if (status.textContent === message) status.textContent = original;
  }, 2400);
}
