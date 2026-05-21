// Settings modal — provider config + BYOK key entry per spec
// amendment A2. Wording matches the amendment ("Stored on this
// device. Anyone with access to this browser profile can read it.")

import { setDemoMode } from '../core/demo-mode.ts';
import { type Settings, loadSettings, saveSettings } from '../core/settings.ts';
import {
  type BYOKEntry,
  forgetAllKeys,
  forgetKey,
  locateKey,
  saveKey,
} from '../core/sidecar/byok.ts';
import { DEFAULT_PROVIDER_CONFIG, type SidecarProvider } from '../core/sidecar/types.ts';
import { iconSvg } from '../tokens/icons.ts';

const PROVIDERS: SidecarProvider[] = ['anthropic', 'openai'];

let _modalEl: HTMLElement | null = null;

export async function openSettingsModal(): Promise<void> {
  if (_modalEl && document.body.contains(_modalEl)) return;
  const overlay = renderModal();
  document.body.append(overlay);
  _modalEl = overlay;
  await refresh();
}

export function closeSettingsModal(): void {
  if (_modalEl?.parentElement) _modalEl.parentElement.removeChild(_modalEl);
  _modalEl = null;
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
  await renderProviderBlocks(overlay, settings);
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
  return provider === 'anthropic' ? 'Anthropic (Claude)' : 'OpenAI';
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
          <h2>Active provider</h2>
          <div class="settings-radio-row">
            <label><input type="radio" name="settings-provider" value="anthropic" /> Anthropic (Claude)</label>
            <label><input type="radio" name="settings-provider" value="openai" /> OpenAI</label>
          </div>
          <label class="settings-field">
            <span>Model</span>
            <input type="text" data-action="settings-model" placeholder="claude-3-5-haiku-latest" />
          </label>
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
    if (
      target instanceof HTMLInputElement &&
      target.name === 'settings-provider' &&
      target.checked
    ) {
      const provider = target.value as SidecarProvider;
      const defaults = DEFAULT_PROVIDER_CONFIG[provider];
      await patchSettings({ sidecarProvider: provider, sidecarModel: defaults.model });
      await refresh();
    }
  });
  overlay.addEventListener('input', async (ev) => {
    const target = ev.target as HTMLInputElement | null;
    if (!target) return;
    if (target.dataset.action === 'settings-model') {
      await patchSettings({ sidecarModel: target.value });
    }
  });
  document.addEventListener(
    'keydown',
    function onKey(ev) {
      if (ev.key === 'Escape') {
        closeSettingsModal();
        document.removeEventListener('keydown', onKey);
      }
    },
    { once: false },
  );
  return overlay;
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
