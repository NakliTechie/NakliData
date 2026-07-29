// Wave 3 W3.4b — "Mount Compute Bridge catalog" modal. Two-phase
// flow: enter URL + Bearer → Connect → list tables (`/v1/tables`) →
// pick N tables with per-table row caps → Mount. Distinct from the
// W3.4a single-SQL-via-bridge modal because the persistence shape
// differs (catalog tracks the per-table selection, not raw SQL).

import type { BridgeTable } from '../core/bridge/protocol.ts';
import {
  BRIDGE_CATALOG_ROW_CAP_DEFAULT,
  BRIDGE_CATALOG_ROW_CAP_MAX,
  BRIDGE_CATALOG_ROW_CAP_MIN,
} from '../core/mount.ts';
import { iconSvg } from '../tokens/icons.ts';
import { restoreModalFocus } from './modal-focus.ts';

let _modalEl: HTMLElement | null = null;
let _previouslyFocused: HTMLElement | null = null;
let _onKey: ((ev: KeyboardEvent) => void) | null = null;
let _requestController: AbortController | null = null;

export interface MountComputeBridgeCatalogInput {
  label: string;
  bridgeUrl: string;
  bearerToken: string;
  remember: boolean;
  tables: Array<{ name: string; localName: string; rowCap: number }>;
}

export interface MountComputeBridgeCatalogHandlers {
  /**
   * Probe + list. Should construct a BridgeClient, call health() +
   * listTables(), and return the table list. Throws should surface as
   * inline errors. The modal stays open on failure so the user can
   * fix the URL/Bearer and retry.
   */
  onConnect: (opts: {
    bridgeUrl: string;
    bearerToken: string;
    signal: AbortSignal;
  }) => Promise<BridgeTable[]>;
  /**
   * Mount the picked tables. Receives sanitised input; throws surface
   * as inline errors and keep the modal open.
   */
  onMount: (input: MountComputeBridgeCatalogInput, signal: AbortSignal) => Promise<void> | void;
}

export function openMountComputeBridgeCatalogModal(
  handlers: MountComputeBridgeCatalogHandlers,
): void {
  if (_modalEl && document.body.contains(_modalEl)) return;
  _previouslyFocused = (document.activeElement as HTMLElement) ?? null;
  const overlay = renderModal(handlers);
  document.body.append(overlay);
  _modalEl = overlay;
  overlay.querySelector<HTMLInputElement>('[data-region="bridge-url-input"]')?.focus();
}

export function closeMountComputeBridgeCatalogModal(): void {
  _requestController?.abort('dialog closed');
  _requestController = null;
  if (_modalEl?.parentElement) {
    _modalEl.parentElement.removeChild(_modalEl);
  }
  _modalEl = null;
  if (_onKey) {
    document.removeEventListener('keydown', _onKey);
    _onKey = null;
  }
  restoreModalFocus(_previouslyFocused);
  _previouslyFocused = null;
}

function renderModal(handlers: MountComputeBridgeCatalogHandlers): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'schema-graph-overlay mount-bridge-catalog-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Mount Compute Bridge catalog');
  overlay.innerHTML = `
    <div class="schema-graph-modal mount-iceberg-modal" data-region="mount-bridge-catalog-modal">
      <div class="schema-graph-header">
        <strong>Mount Compute Bridge — catalog</strong>
        <button class="btn btn-ghost schema-graph-close" data-action="close-mount-bridge-catalog" aria-label="Close">
          ${iconSvg('x', 14)}
        </button>
      </div>
      <div class="mount-s3-body" data-region="catalog-body">
        <label class="mount-url-field">
          <span>Bridge URL <em>(e.g. https://nakli-compute.your-vpc.internal:8088)</em></span>
          <input type="url" data-region="bridge-url-input" placeholder="https://nakli-compute.your-vpc.internal:8088" autocomplete="off" spellcheck="false">
        </label>
        <label class="mount-url-field">
          <span>Bearer token <em>(optional)</em></span>
          <input type="password" data-region="bearer-token-input" autocomplete="off" spellcheck="false">
        </label>
        <label class="mount-url-field mount-s3-remember">
          <input type="checkbox" data-region="remember-input">
          <span>Remember token on this device <em>— stored plaintext in IndexedDB on this origin. Anyone with access to this browser profile can read it.</em></span>
        </label>
        <label class="mount-url-field">
          <span>Label <em>(optional)</em></span>
          <input type="text" data-region="label-input" placeholder="defaults to '&lt;host&gt; (bridge catalog)'" autocomplete="off" spellcheck="false">
        </label>
        <p class="mount-url-hint">
          Connect lists the tables the bridge exposes; pick any subset to
          copy into this browser. Each uses the row cap below, which a
          conformant bridge must enforce before Arrow bytes cross from your VPC.
        </p>
        <div class="mount-url-error" data-region="error" hidden></div>
        <div class="mount-url-actions">
          <button class="btn btn-ghost" data-action="close-mount-bridge-catalog">Cancel</button>
          <button class="btn btn-primary" data-action="bridge-catalog-connect">Connect</button>
        </div>
        <div data-region="catalog-pick" hidden>
          <hr class="mount-url-divider">
          <p class="mount-url-hint" data-region="catalog-summary"></p>
          <div class="mount-bridge-catalog-list" data-region="catalog-table-list"></div>
          <div class="mount-url-actions">
            <button class="btn btn-ghost" data-action="bridge-catalog-back">Reconnect</button>
            <button class="btn btn-primary" data-action="bridge-catalog-mount">Mount selected</button>
          </div>
        </div>
      </div>
    </div>
  `;
  overlay.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    if (target === overlay) closeMountComputeBridgeCatalogModal();
    if (target.closest('[data-action="close-mount-bridge-catalog"]')) {
      closeMountComputeBridgeCatalogModal();
    }
    if (target.closest('[data-action="bridge-catalog-connect"]')) {
      void runConnect(overlay, handlers);
    }
    if (target.closest('[data-action="bridge-catalog-back"]')) {
      revealPickStep(overlay, false);
    }
    if (target.closest('[data-action="bridge-catalog-mount"]')) {
      void runMount(overlay, handlers);
    }
  });
  _onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') closeMountComputeBridgeCatalogModal();
  };
  document.addEventListener('keydown', _onKey);
  return overlay;
}

async function runConnect(
  overlay: HTMLElement,
  handlers: MountComputeBridgeCatalogHandlers,
): Promise<void> {
  const get = <T extends HTMLInputElement>(region: string): T | null =>
    overlay.querySelector<T>(`[data-region="${region}"]`);
  const errEl = overlay.querySelector<HTMLElement>('[data-region="error"]');
  const connectBtn = overlay.querySelector<HTMLButtonElement>(
    '[data-action="bridge-catalog-connect"]',
  );

  const bridgeUrl = get<HTMLInputElement>('bridge-url-input')?.value.trim() ?? '';
  const bearerToken = get<HTMLInputElement>('bearer-token-input')?.value ?? '';

  if (!bridgeUrl) {
    setError(errEl, 'Bridge URL is required.');
    get('bridge-url-input')?.focus();
    return;
  }
  setError(errEl, null);
  if (connectBtn) {
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting…';
  }
  _requestController?.abort('new request started');
  const controller = new AbortController();
  _requestController = controller;
  try {
    const tables = await handlers.onConnect({
      bridgeUrl,
      bearerToken,
      signal: controller.signal,
    });
    if (!tables.length) {
      setError(errEl, 'Bridge reports zero tables. Nothing to mount.');
      return;
    }
    renderTableList(overlay, tables);
    revealPickStep(overlay, true);
  } catch (err) {
    if (controller.signal.aborted) return;
    setError(errEl, err instanceof Error ? err.message : String(err));
  } finally {
    if (_requestController === controller) _requestController = null;
    if (connectBtn) {
      connectBtn.disabled = false;
      connectBtn.textContent = 'Connect';
    }
  }
}

function renderTableList(overlay: HTMLElement, tables: BridgeTable[]): void {
  const listEl = overlay.querySelector<HTMLElement>('[data-region="catalog-table-list"]');
  const summaryEl = overlay.querySelector<HTMLElement>('[data-region="catalog-summary"]');
  if (!listEl || !summaryEl) return;
  summaryEl.textContent = `${tables.length} table${tables.length === 1 ? '' : 's'} available. Pick which to mount and bound each with a row cap (the result has to fit in the tab).`;
  listEl.innerHTML = '';
  const grouped = groupTables(tables);
  for (const catalog of grouped) {
    const catalogSection = document.createElement('section');
    catalogSection.className = 'mount-bridge-catalog-group';
    const catalogHeading = document.createElement('h4');
    catalogHeading.className = 'mount-bridge-catalog-group-title';
    catalogHeading.textContent = catalog.label;
    catalogSection.append(catalogHeading);
    for (const namespace of catalog.namespaces) {
      const namespaceSection = document.createElement('div');
      namespaceSection.className = 'mount-bridge-namespace-group';
      const namespaceHeading = document.createElement('h5');
      namespaceHeading.className = 'mount-bridge-namespace-title';
      namespaceHeading.textContent = namespace.label;
      namespaceSection.append(namespaceHeading);
      for (const table of namespace.tables) {
        namespaceSection.append(renderTableRow(table));
      }
      catalogSection.append(namespaceSection);
    }
    listEl.append(catalogSection);
  }
}

function renderTableRow(t: BridgeTable): HTMLElement {
  const row = document.createElement('div');
  row.className = 'mount-bridge-catalog-row';
  row.dataset.tableName = t.qualifiedName;
  row.dataset.localName = t.name;
  const colCount = t.schema.length;
  const schemaSummary = t.schema
    .slice(0, 6)
    .map((c) => `${c.name}: ${c.type}`)
    .join(', ');
  const schemaMore = colCount > 6 ? `, +${colCount - 6} more` : '';
  row.innerHTML = `
      <label class="mount-bridge-catalog-pick">
        <input type="checkbox" data-region="bridge-catalog-pick">
        <span class="mount-bridge-catalog-name">
          <code>${escapeHtml(t.name)}</code>
          <small>${escapeHtml(t.kind)}${t.source ? ` · ${escapeHtml(t.source)}` : ''}</small>
        </span>
        <span class="mount-bridge-catalog-cols">${colCount} col${colCount === 1 ? '' : 's'}${
          schemaSummary ? `: ${escapeHtml(schemaSummary)}${escapeHtml(schemaMore)}` : ''
        }</span>
      </label>
      <label class="mount-bridge-catalog-cap">
        <span>Cap:</span>
        <input type="number" data-region="bridge-catalog-cap"
               min="${BRIDGE_CATALOG_ROW_CAP_MIN}" max="${BRIDGE_CATALOG_ROW_CAP_MAX}"
               value="${BRIDGE_CATALOG_ROW_CAP_DEFAULT}" step="1000">
      </label>
    `;
  return row;
}

function groupTables(tables: BridgeTable[]): Array<{
  label: string;
  namespaces: Array<{ label: string; tables: BridgeTable[] }>;
}> {
  const catalogs = new Map<string, Map<string, BridgeTable[]>>();
  for (const table of tables) {
    const catalog = table.catalog ?? 'Unscoped catalog';
    const namespace = table.namespace.length ? table.namespace.join(' › ') : 'Default namespace';
    let namespaces = catalogs.get(catalog);
    if (!namespaces) {
      namespaces = new Map();
      catalogs.set(catalog, namespaces);
    }
    const entries = namespaces.get(namespace) ?? [];
    entries.push(table);
    namespaces.set(namespace, entries);
  }
  return [...catalogs.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, namespaces]) => ({
      label,
      namespaces: [...namespaces.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([namespaceLabel, entries]) => ({
          label: namespaceLabel,
          tables: entries.sort((a, b) => a.name.localeCompare(b.name)),
        })),
    }));
}

function revealPickStep(overlay: HTMLElement, show: boolean): void {
  const pick = overlay.querySelector<HTMLElement>('[data-region="catalog-pick"]');
  const connectBtn = overlay.querySelector<HTMLButtonElement>(
    '[data-action="bridge-catalog-connect"]',
  );
  if (pick) pick.hidden = !show;
  // On Reconnect, leave the URL/Bearer inputs as-is so the user can edit
  // and try again; just hide the pick list.
  if (!show && connectBtn) {
    connectBtn.focus();
  }
}

async function runMount(
  overlay: HTMLElement,
  handlers: MountComputeBridgeCatalogHandlers,
): Promise<void> {
  const get = <T extends HTMLInputElement>(region: string): T | null =>
    overlay.querySelector<T>(`[data-region="${region}"]`);
  const errEl = overlay.querySelector<HTMLElement>('[data-region="error"]');
  const mountBtn = overlay.querySelector<HTMLButtonElement>('[data-action="bridge-catalog-mount"]');

  const bridgeUrl = get<HTMLInputElement>('bridge-url-input')?.value.trim() ?? '';
  const bearerToken = get<HTMLInputElement>('bearer-token-input')?.value ?? '';
  const remember = get<HTMLInputElement>('remember-input')?.checked ?? false;
  const label = get<HTMLInputElement>('label-input')?.value.trim() ?? '';

  // Walk the table list, build the selection.
  const rows = overlay.querySelectorAll<HTMLElement>('.mount-bridge-catalog-row');
  const picks: MountComputeBridgeCatalogInput['tables'] = [];
  for (const row of rows) {
    const checkbox = row.querySelector<HTMLInputElement>('[data-region="bridge-catalog-pick"]');
    const capInput = row.querySelector<HTMLInputElement>('[data-region="bridge-catalog-cap"]');
    if (!checkbox?.checked) continue;
    const name = row.dataset.tableName ?? '';
    const localName = row.dataset.localName ?? name;
    const rowCap = Number(capInput?.value) || BRIDGE_CATALOG_ROW_CAP_DEFAULT;
    picks.push({ name, localName, rowCap });
  }
  if (!picks.length) {
    setError(errEl, 'Pick at least one table to mount.');
    return;
  }
  setError(errEl, null);
  if (mountBtn) {
    mountBtn.disabled = true;
    mountBtn.textContent = 'Mounting…';
  }
  _requestController?.abort('new request started');
  const controller = new AbortController();
  _requestController = controller;
  try {
    await handlers.onMount(
      { bridgeUrl, bearerToken, remember, label, tables: picks },
      controller.signal,
    );
    closeMountComputeBridgeCatalogModal();
  } catch (err) {
    if (controller.signal.aborted) return;
    setError(errEl, err instanceof Error ? err.message : String(err));
  } finally {
    if (_requestController === controller) _requestController = null;
    if (mountBtn) {
      mountBtn.disabled = false;
      mountBtn.textContent = 'Mount selected';
    }
  }
}

function setError(el: HTMLElement | null, msg: string | null): void {
  if (!el) return;
  if (msg) {
    el.textContent = msg;
    el.hidden = false;
  } else {
    el.textContent = '';
    el.hidden = true;
  }
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}
