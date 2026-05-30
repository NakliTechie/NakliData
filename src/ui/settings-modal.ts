// Settings modal — provider config + BYOK key entry per spec
// amendment A2. Wording matches the amendment ("Stored on this
// device. Anyone with access to this browser profile can read it.")

import { setDemoMode } from '../core/demo-mode.ts';
import { type Settings, loadSettings, saveSettings } from '../core/settings.ts';
import {
  type BYOKEntry,
  forgetAllKeys,
  forgetKey,
  loadKey,
  locateKey,
  saveKey,
} from '../core/sidecar/byok.ts';
import { callCustomOpenAI } from '../core/sidecar/providers/custom-openai.ts';
import { DEFAULT_PROVIDER_CONFIG, type SidecarProvider } from '../core/sidecar/types.ts';
import { iconSvg } from '../tokens/icons.ts';
import { restoreModalFocus } from './modal-focus.ts';

const PROVIDERS: SidecarProvider[] = ['anthropic', 'openai', 'custom'];

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
          <h2>Active provider</h2>
          <div class="settings-radio-row">
            <label><input type="radio" name="settings-provider" value="anthropic" /> Anthropic (Claude)</label>
            <label><input type="radio" name="settings-provider" value="openai" /> OpenAI</label>
            <label><input type="radio" name="settings-provider" value="custom" /> Custom (OpenAI-compatible)</label>
          </div>
          <label class="settings-field">
            <span>Model</span>
            <input type="text" data-action="settings-model" placeholder="claude-3-5-haiku-latest" />
          </label>
          <label class="settings-field" data-region="settings-custom-endpoint-row" hidden>
            <span>Custom endpoint URL <em>(OpenAI-compatible — local llamafile, vLLM, Ollama, LM Studio)</em></span>
            <input type="url" data-action="settings-custom-endpoint" placeholder="https://my-llm.example.com" autocomplete="off" spellcheck="false" />
            <div class="settings-test-row">
              <button class="btn btn-ghost" data-action="settings-test-custom">Test connection</button>
              <span class="settings-test-result" data-region="settings-test-result"></span>
            </div>
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
    if (target.dataset.action === 'settings-custom-endpoint') {
      await patchSettings({ sidecarCustomEndpoint: target.value });
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
