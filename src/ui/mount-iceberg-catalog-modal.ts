// Wave 2 slice 3b — "Mount Iceberg via REST Catalog" modal. Captures
// the catalog URL + optional Bearer + namespace.table. Slice 3b ships
// Bearer auth only; OAuth2 device flow and AWS SigV4 stay queued for
// v1.3.

import { iconSvg } from '../tokens/icons.ts';
import { restoreModalFocus } from './modal-focus.ts';

let _modalEl: HTMLElement | null = null;
let _previouslyFocused: HTMLElement | null = null;
let _onKey: ((ev: KeyboardEvent) => void) | null = null;

export interface MountIcebergCatalogInput {
  label: string;
  catalogUrl: string;
  namespace: string;
  table: string;
  bearerToken: string;
  remember: boolean;
}

export function openMountIcebergCatalogModal(opts: {
  onMount: (input: MountIcebergCatalogInput) => Promise<void> | void;
}): void {
  if (_modalEl && document.body.contains(_modalEl)) return;
  _previouslyFocused = (document.activeElement as HTMLElement) ?? null;
  const overlay = renderModal(opts);
  document.body.append(overlay);
  _modalEl = overlay;
  overlay.querySelector<HTMLInputElement>('[data-region="catalog-url-input"]')?.focus();
}

export function closeMountIcebergCatalogModal(): void {
  if (_modalEl?.parentElement) {
    _modalEl.parentElement.removeChild(_modalEl);
  }
  _modalEl = null;
  if (_onKey) {
    document.removeEventListener('keydown', _onKey);
    _onKey = null;
  }
  // Forward-pass M11: restoreModalFocus handles detached previousFocus.
  restoreModalFocus(_previouslyFocused);
  _previouslyFocused = null;
}

function renderModal(opts: {
  onMount: (input: MountIcebergCatalogInput) => Promise<void> | void;
}): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'schema-graph-overlay mount-iceberg-catalog-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Mount Iceberg via REST Catalog');
  overlay.innerHTML = `
    <div class="schema-graph-modal mount-iceberg-modal" data-region="mount-iceberg-catalog-modal">
      <div class="schema-graph-header">
        <strong>Mount Iceberg via REST Catalog</strong>
        <button class="btn btn-ghost schema-graph-close" data-action="close-mount-iceberg-catalog" aria-label="Close">
          ${iconSvg('x', 14)}
        </button>
      </div>
      <div class="mount-s3-body">
        <label class="mount-url-field">
          <span>Catalog URL <em>(base URL — we append /v1/...)</em></span>
          <input type="url" data-region="catalog-url-input" placeholder="https://lakehouse.example.com/iceberg" autocomplete="off" spellcheck="false">
        </label>
        <div class="mount-s3-row">
          <label class="mount-url-field">
            <span>Namespace <em>(dot-separated for nested)</em></span>
            <input type="text" data-region="namespace-input" placeholder="analytics" autocomplete="off" spellcheck="false">
          </label>
          <label class="mount-url-field">
            <span>Table</span>
            <input type="text" data-region="table-input" placeholder="sales" autocomplete="off" spellcheck="false">
          </label>
        </div>
        <label class="mount-url-field">
          <span>Bearer token <em>(optional — leave blank for public catalogs)</em></span>
          <input type="password" data-region="bearer-token-input" autocomplete="off" spellcheck="false">
        </label>
        <label class="mount-url-field mount-s3-remember">
          <input type="checkbox" data-region="remember-input">
          <span>Remember token on this device <em>— stored plaintext in IndexedDB on this origin. Anyone with access to this browser profile can read it.</em></span>
        </label>
        <label class="mount-url-field">
          <span>Label <em>(optional)</em></span>
          <input type="text" data-region="label-input" placeholder="defaults to namespace.table" autocomplete="off" spellcheck="false">
        </label>
        <p class="mount-url-hint">
          The catalog resolves the table's current metadata-location each time
          you reload, so fresh snapshots pick up automatically. Slice 3b ships
          Bearer auth only; OAuth2 device flow and AWS SigV4 (for Glue) are
          queued for v1.3.
        </p>
        <div class="mount-url-error" data-region="error" hidden></div>
        <div class="mount-url-actions">
          <button class="btn btn-ghost" data-action="close-mount-iceberg-catalog">Cancel</button>
          <button class="btn btn-primary" data-action="confirm-mount-iceberg-catalog">Mount</button>
        </div>
      </div>
    </div>
  `;
  overlay.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    if (target === overlay) closeMountIcebergCatalogModal();
    if (target.closest('[data-action="close-mount-iceberg-catalog"]')) {
      closeMountIcebergCatalogModal();
    }
    if (target.closest('[data-action="confirm-mount-iceberg-catalog"]')) {
      void confirmMount(overlay, opts);
    }
  });
  _onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') closeMountIcebergCatalogModal();
  };
  document.addEventListener('keydown', _onKey);
  return overlay;
}

async function confirmMount(
  overlay: HTMLElement,
  opts: { onMount: (input: MountIcebergCatalogInput) => Promise<void> | void },
): Promise<void> {
  const get = <T extends HTMLInputElement>(region: string): T | null =>
    overlay.querySelector<T>(`[data-region="${region}"]`);
  const errEl = overlay.querySelector<HTMLElement>('[data-region="error"]');

  const input: MountIcebergCatalogInput = {
    label: get('label-input')?.value.trim() ?? '',
    catalogUrl: get('catalog-url-input')?.value.trim() ?? '',
    namespace: get('namespace-input')?.value.trim() ?? '',
    table: get('table-input')?.value.trim() ?? '',
    bearerToken: get('bearer-token-input')?.value ?? '',
    remember: get('remember-input')?.checked ?? false,
  };

  const required: Array<[keyof MountIcebergCatalogInput, string, string]> = [
    ['catalogUrl', 'Catalog URL', 'catalog-url-input'],
    ['namespace', 'Namespace', 'namespace-input'],
    ['table', 'Table', 'table-input'],
  ];
  for (const [field, label, regionId] of required) {
    if (!String(input[field]).trim()) {
      if (errEl) {
        errEl.textContent = `${label} is required.`;
        errEl.hidden = false;
      }
      get(regionId)?.focus();
      return;
    }
  }
  if (errEl) {
    errEl.textContent = '';
    errEl.hidden = true;
  }
  try {
    await opts.onMount(input);
    closeMountIcebergCatalogModal();
  } catch (err) {
    if (errEl) {
      errEl.textContent = err instanceof Error ? err.message : String(err);
      errEl.hidden = false;
    }
  }
}
