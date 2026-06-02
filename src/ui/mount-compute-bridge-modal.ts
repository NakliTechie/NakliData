// Wave 3 W3.4a — "Mount Compute Bridge" modal. Captures the bridge
// URL + optional Bearer + local table name + the SQL to run. The
// bridge does the heavy scan in-VPC; the result lands as a local
// DuckDB table.

import { iconSvg } from '../tokens/icons.ts';
import { restoreModalFocus } from './modal-focus.ts';

let _modalEl: HTMLElement | null = null;
let _previouslyFocused: HTMLElement | null = null;
let _onKey: ((ev: KeyboardEvent) => void) | null = null;

export interface MountComputeBridgeInput {
  label: string;
  bridgeUrl: string;
  bearerToken: string;
  tableName: string;
  sql: string;
  remember: boolean;
}

export function openMountComputeBridgeModal(opts: {
  onMount: (input: MountComputeBridgeInput) => Promise<void> | void;
}): void {
  if (_modalEl && document.body.contains(_modalEl)) return;
  _previouslyFocused = (document.activeElement as HTMLElement) ?? null;
  const overlay = renderModal(opts);
  document.body.append(overlay);
  _modalEl = overlay;
  overlay.querySelector<HTMLInputElement>('[data-region="bridge-url-input"]')?.focus();
}

export function closeMountComputeBridgeModal(): void {
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
  onMount: (input: MountComputeBridgeInput) => Promise<void> | void;
}): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'schema-graph-overlay mount-bridge-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Mount Compute Bridge');
  overlay.innerHTML = `
    <div class="schema-graph-modal mount-iceberg-modal" data-region="mount-bridge-modal">
      <div class="schema-graph-header">
        <strong>Mount Compute Bridge</strong>
        <button class="btn btn-ghost schema-graph-close" data-action="close-mount-bridge" aria-label="Close">
          ${iconSvg('x', 14)}
        </button>
      </div>
      <div class="mount-s3-body">
        <label class="mount-url-field">
          <span>Bridge URL <em>(e.g. https://nakli-compute.your-vpc.internal:8088)</em></span>
          <input type="url" data-region="bridge-url-input" placeholder="https://nakli-compute.your-vpc.internal:8088" autocomplete="off" spellcheck="false">
        </label>
        <label class="mount-url-field">
          <span>Bearer token <em>(optional — leave blank for unauthenticated bridges)</em></span>
          <input type="password" data-region="bearer-token-input" autocomplete="off" spellcheck="false">
        </label>
        <label class="mount-url-field mount-s3-remember">
          <input type="checkbox" data-region="remember-input">
          <span>Remember token on this device <em>— stored plaintext in IndexedDB on this origin. Anyone with access to this browser profile can read it.</em></span>
        </label>
        <label class="mount-url-field">
          <span>Local table name <em>(what the result registers as in DuckDB)</em></span>
          <input type="text" data-region="table-name-input" placeholder="sales_2026" autocomplete="off" spellcheck="false">
        </label>
        <label class="mount-url-field">
          <span>SQL to run on the bridge</span>
          <textarea data-region="sql-input" rows="4" placeholder="SELECT * FROM lakehouse.sales WHERE iso_date >= '2026-01-01' LIMIT 100000" spellcheck="false"></textarea>
        </label>
        <label class="mount-url-field">
          <span>Label <em>(optional)</em></span>
          <input type="text" data-region="label-input" placeholder="defaults to '<table> (bridge)'" autocomplete="off" spellcheck="false">
        </label>
        <p class="mount-url-hint">
          The bridge runs the SQL inside your VPC; only the result rows cross to
          the browser as Arrow IPC and land as a local DuckDB table. Bound your
          query with <code>LIMIT</code> — the result has to fit in the tab.
          Plain <code>http://</code> URLs are blocked by CSP; the bridge should
          serve TLS (self-signed is fine over a VPN). Per <code>plan/compute-bridge-protocol.md</code>.
        </p>
        <div class="mount-url-error" data-region="error" hidden></div>
        <div class="mount-url-actions">
          <button class="btn btn-ghost" data-action="close-mount-bridge">Cancel</button>
          <button class="btn btn-primary" data-action="confirm-mount-bridge">Mount</button>
        </div>
      </div>
    </div>
  `;
  overlay.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    if (target === overlay) closeMountComputeBridgeModal();
    if (target.closest('[data-action="close-mount-bridge"]')) closeMountComputeBridgeModal();
    if (target.closest('[data-action="confirm-mount-bridge"]')) {
      void confirmMount(overlay, opts);
    }
  });
  _onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') closeMountComputeBridgeModal();
  };
  document.addEventListener('keydown', _onKey);
  return overlay;
}

async function confirmMount(
  overlay: HTMLElement,
  opts: { onMount: (input: MountComputeBridgeInput) => Promise<void> | void },
): Promise<void> {
  const get = <T extends HTMLInputElement | HTMLTextAreaElement>(region: string): T | null =>
    overlay.querySelector<T>(`[data-region="${region}"]`);
  const errEl = overlay.querySelector<HTMLElement>('[data-region="error"]');

  const input: MountComputeBridgeInput = {
    label: get<HTMLInputElement>('label-input')?.value.trim() ?? '',
    bridgeUrl: get<HTMLInputElement>('bridge-url-input')?.value.trim() ?? '',
    bearerToken: get<HTMLInputElement>('bearer-token-input')?.value ?? '',
    tableName: get<HTMLInputElement>('table-name-input')?.value.trim() ?? '',
    sql: get<HTMLTextAreaElement>('sql-input')?.value ?? '',
    remember: get<HTMLInputElement>('remember-input')?.checked ?? false,
  };

  const required: Array<[keyof MountComputeBridgeInput, string, string]> = [
    ['bridgeUrl', 'Bridge URL', 'bridge-url-input'],
    ['tableName', 'Local table name', 'table-name-input'],
    ['sql', 'SQL', 'sql-input'],
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
    closeMountComputeBridgeModal();
  } catch (err) {
    if (errEl) {
      errEl.textContent = err instanceof Error ? err.message : String(err);
      errEl.hidden = false;
    }
  }
}
