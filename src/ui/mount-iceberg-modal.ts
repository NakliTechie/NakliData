// Wave 2 slice 3a — "Mount Iceberg table" modal. Slice 3a is the
// table-by-URL + Bearer auth flow; slice 3b will add REST catalog
// navigation + OAuth2 + SigV4 (separate modal or extended picker).

import { iconSvg } from '../tokens/icons.ts';
import { restoreModalFocus } from './modal-focus.ts';

let _modalEl: HTMLElement | null = null;
let _previouslyFocused: HTMLElement | null = null;
let _onKey: ((ev: KeyboardEvent) => void) | null = null;

export interface MountIcebergInput {
  label: string;
  metadataUrl: string;
  bearerToken: string;
  remember: boolean;
}

export function openMountIcebergModal(opts: {
  onMount: (input: MountIcebergInput) => Promise<void> | void;
}): void {
  if (_modalEl && document.body.contains(_modalEl)) return;
  _previouslyFocused = (document.activeElement as HTMLElement) ?? null;
  const overlay = renderModal(opts);
  document.body.append(overlay);
  _modalEl = overlay;
  overlay.querySelector<HTMLInputElement>('[data-region="metadata-url-input"]')?.focus();
}

export function closeMountIcebergModal(): void {
  if (_modalEl?.parentElement) {
    _modalEl.parentElement.removeChild(_modalEl);
  }
  _modalEl = null;
  if (_onKey) {
    document.removeEventListener('keydown', _onKey);
    _onKey = null;
  }
  // Forward-pass M11 (2026-06-02): use restoreModalFocus — handles the
  // case where the stored node has detached mid-modal (workbook tick →
  // schema-panel re-render). Raw .focus() on a detached node silently
  // no-ops, sending focus to <body>.
  restoreModalFocus(_previouslyFocused);
  _previouslyFocused = null;
}

function renderModal(opts: {
  onMount: (input: MountIcebergInput) => Promise<void> | void;
}): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'schema-graph-overlay mount-iceberg-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Mount Iceberg table');
  overlay.innerHTML = `
    <div class="schema-graph-modal mount-iceberg-modal" data-region="mount-iceberg-modal">
      <div class="schema-graph-header">
        <strong>Mount Iceberg table</strong>
        <button class="btn btn-ghost schema-graph-close" data-action="close-mount-iceberg" aria-label="Close">
          ${iconSvg('x', 14)}
        </button>
      </div>
      <div class="mount-s3-body">
        <label class="mount-url-field">
          <span>Metadata URL <em>(metadata.json or its directory)</em></span>
          <input type="url" data-region="metadata-url-input" placeholder="https://my-bucket.s3.amazonaws.com/warehouse/sales/metadata/v3.metadata.json" autocomplete="off" spellcheck="false">
        </label>
        <label class="mount-url-field">
          <span>Bearer token <em>(optional — leave blank for public tables; applies to all data requests this session)</em></span>
          <input type="password" data-region="bearer-token-input" autocomplete="off" spellcheck="false">
        </label>
        <label class="mount-url-field mount-s3-remember">
          <input type="checkbox" data-region="remember-input">
          <span>Remember token on this device <em>— stored plaintext in IndexedDB on this origin. Anyone with access to this browser profile can read it.</em></span>
        </label>
        <label class="mount-url-field">
          <span>Label <em>(optional)</em></span>
          <input type="text" data-region="label-input" placeholder="defaults to the table directory name" autocomplete="off" spellcheck="false">
        </label>
        <p class="mount-url-hint">
          Slice 3a — table-by-URL with Bearer auth. For <code>s3://</code> URLs,
          mount your bucket via "Mount bucket" first so the S3 credentials are
          configured. REST catalog navigation (OAuth2 device flow, AWS Glue
          SigV4) is queued for slice 3b.
        </p>
        <div class="mount-url-error" data-region="error" hidden></div>
        <div class="mount-url-actions">
          <button class="btn btn-ghost" data-action="close-mount-iceberg">Cancel</button>
          <button class="btn btn-primary" data-action="confirm-mount-iceberg">Mount</button>
        </div>
      </div>
    </div>
  `;
  overlay.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    if (target === overlay) closeMountIcebergModal();
    if (target.closest('[data-action="close-mount-iceberg"]')) closeMountIcebergModal();
    if (target.closest('[data-action="confirm-mount-iceberg"]')) void confirmMount(overlay, opts);
  });
  _onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') closeMountIcebergModal();
  };
  document.addEventListener('keydown', _onKey);
  return overlay;
}

async function confirmMount(
  overlay: HTMLElement,
  opts: { onMount: (input: MountIcebergInput) => Promise<void> | void },
): Promise<void> {
  const get = <T extends HTMLInputElement>(region: string): T | null =>
    overlay.querySelector<T>(`[data-region="${region}"]`);
  const errEl = overlay.querySelector<HTMLElement>('[data-region="error"]');

  const input: MountIcebergInput = {
    label: get('label-input')?.value.trim() ?? '',
    metadataUrl: get('metadata-url-input')?.value.trim() ?? '',
    bearerToken: get('bearer-token-input')?.value ?? '',
    remember: get('remember-input')?.checked ?? false,
  };

  if (!input.metadataUrl) {
    if (errEl) {
      errEl.textContent = 'Metadata URL is required.';
      errEl.hidden = false;
    }
    get('metadata-url-input')?.focus();
    return;
  }
  if (errEl) {
    errEl.textContent = '';
    errEl.hidden = true;
  }
  try {
    await opts.onMount(input);
    closeMountIcebergModal();
  } catch (err) {
    if (errEl) {
      errEl.textContent = err instanceof Error ? err.message : String(err);
      errEl.hidden = false;
    }
  }
}
